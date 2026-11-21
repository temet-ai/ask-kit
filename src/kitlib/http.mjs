// HTTP and HTTPS for kits: a method, headers and a body, redirects, one deadline for the whole
// exchange, a size cap, and a CONNECT tunnel through HTTPS_PROXY or HTTP_PROXY when NO_PROXY does not
// cover the host. Node's own fetch does not use those variables, so on a machine whose only way out
// is a proxy nothing else gets through.
//
// From the kits' own copies (ask-kit kit commons, 2026-11-21): the api kit's client (methods, bodies,
// the deadline, loopback never proxied, `stay` inside one origin) with the web kit's guard against
// private addresses, as `publicOnly`.
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import net from "node:net";
import zlib from "node:zlib";
import dns from "node:dns/promises";

const env = (k) => process.env[k] ?? process.env[k.toLowerCase()] ?? "";
const bare = (host) => host.replace(/^\[|\]$/g, "");
const LOOPBACK = /^(localhost|.*\.localhost|127(\.\d+){3}|::1|0\.0\.0\.0)$/i;

/** Whether NO_PROXY covers a host: exact names, .suffixes, *.suffixes and "*". CIDR entries are matched for IPv4 literals. */
export function noProxy(host) {
  const h = bare(host).toLowerCase();
  if (LOOPBACK.test(h)) return true;
  for (const raw of env("NO_PROXY").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const e = raw.replace(/:\d+$/, "");
    if (e === "*") return true;
    if (e.includes("/") && net.isIPv4(h)) {
      const [base, bits] = e.split("/");
      if (net.isIPv4(base)) {
        const n = (ip) => ip.split(".").reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
        const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
        if ((n(h) & mask) === (n(base) & mask)) return true;
      }
      continue;
    }
    const suffix = e.replace(/^\*?\./, "");
    if (h === suffix || h.endsWith(`.${suffix}`)) return true;
  }
  return false;
}

export function proxyFor(url) {
  const u = new URL(url);
  if (noProxy(u.hostname)) return null;
  const p = u.protocol === "https:" ? env("HTTPS_PROXY") || env("ALL_PROXY") : env("HTTP_PROXY") || env("ALL_PROXY");
  if (!p) return null;
  try {
    const pu = new URL(p);
    return /^https?:$/.test(pu.protocol) ? pu : null;
  } catch {
    return null;
  }
}

// Addresses a page must not make this kit read: this machine, the local network, cloud metadata.
const PRIVATE_V4 = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
export const isPrivate = (ip) => (net.isIPv4(ip) ? PRIVATE_V4.some((r) => r.test(ip)) : /^(::1|::|fe80:|f[cd][0-9a-f]{2}:)/i.test(ip) || /^::ffff:(127\.|10\.|192\.168\.|169\.254\.)/i.test(ip));
const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa|metadata\.google\.internal)$/i;

/** Throws when a URL points at this machine or a private network, unless `allowPrivate`. */
export async function guard(url, { allowPrivate = false, viaProxy = false } = {}) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error(`not allowed: ${u.protocol} URLs; only http and https`);
  if (allowPrivate) return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const why = `not allowed: ${host} is on this machine or a private network. A page's text could otherwise make this kit read internal addresses. this request is limited to public addresses (publicOnly)`;
  if (net.isIP(host)) {
    if (isPrivate(host)) throw new Error(why);
    return;
  }
  if (LOCAL_NAME.test(host) || !host.includes(".")) throw new Error(why);
  if (viaProxy) return; // the proxy resolves the name; a public-looking name is all that can be checked here
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    return; // the request itself reports the name that does not resolve
  }
  if (addrs.some((a) => isPrivate(a.address))) throw new Error(why);
}

const connectThrough = (proxy, host, port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const headers = { Host: `${host}:${port}` };
    if (proxy.username) headers["Proxy-Authorization"] = `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}`;
    const req = (proxy.protocol === "https:" ? https : http).request({ host: proxy.hostname, port: proxy.port || (proxy.protocol === "https:" ? 443 : 80), method: "CONNECT", path: `${host}:${port}`, headers, timeout: timeoutMs });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(Object.assign(new Error(`the proxy refused the connection to ${host}: ${res.statusCode} ${res.statusMessage}`), { code: "EPROXY", status: res.statusCode }));
      } else {
        socket.on("error", () => {}); // a tunnel cut after the answer is not an error of the caller's
        resolve(socket);
      }
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error("timed out connecting to the proxy"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  });

function once(url, { method, timeoutMs, maxBytes, headers, body }) {
  return new Promise(async (resolve, reject) => {
    const u = new URL(url);
    const secure = u.protocol === "https:";
    const proxy = proxyFor(url);
    const opts = { method, host: bare(u.hostname), port: u.port || (secure ? 443 : 80), path: u.pathname + u.search, headers, timeout: timeoutMs };
    try {
      if (proxy && secure) {
        const socket = await connectThrough(proxy, opts.host, opts.port, timeoutMs);
        opts.createConnection = () => {
          const t = tls.connect({ socket, servername: net.isIP(opts.host) ? undefined : opts.host });
          t.on("error", () => {}); // the request reports it; this keeps a late reset from being unhandled
          return t;
        };
        opts.agent = false;
      } else if (proxy) {
        Object.assign(opts, { host: proxy.hostname, port: proxy.port || 80, path: url, headers: { ...headers, Host: u.host } });
      }
    } catch (e) {
      return reject(e);
    }
    // The whole exchange has one deadline: a server that sends a byte now and then must not hold a cell open.
    const deadline = setTimeout(() => req.destroy(Object.assign(new Error(`timed out after ${timeoutMs} ms`), { code: "ETIMEDOUT" })), timeoutMs);
    const settle = (fn, v) => (clearTimeout(deadline), fn(v));
    const req = (secure ? https : http).request(opts, (res) => {
      const chunks = [];
      let size = 0;
      let cut = false;
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream = method === "HEAD" ? res : enc === "gzip" ? res.pipe(zlib.createGunzip()) : enc === "br" ? res.pipe(zlib.createBrotliDecompress()) : enc === "deflate" ? res.pipe(zlib.createInflate()) : res;
      const done = () => settle(resolve, { status: res.statusCode, statusText: res.statusMessage, headers: res.headers, body: Buffer.concat(chunks), cut });
      stream.on("data", (c) => {
        if (cut) return;
        size += c.length;
        if (size > maxBytes) {
          cut = true;
          chunks.push(c.subarray(0, c.length - (size - maxBytes)));
          req.destroy();
          done();
        } else chunks.push(c);
      });
      stream.on("end", () => !cut && done());
      stream.on("error", (e) => (chunks.length ? done() : settle(reject, e)));
      res.on("error", (e) => (chunks.length ? done() : settle(reject, e)));
    });
    req.on("timeout", () => req.destroy(Object.assign(new Error(`timed out after ${timeoutMs} ms`), { code: "ETIMEDOUT" })));
    req.on("error", (e) => settle(reject, e));
    req.end(body ?? undefined);
  });
}

const MEANING = { ENOTFOUND: "the name does not resolve", EAI_AGAIN: "the name does not resolve (DNS did not answer)", ECONNREFUSED: "nothing accepts connections there", ETIMEDOUT: "no answer in time", ECONNRESET: "the connection was cut", EHOSTUNREACH: "no route to the host", ENETUNREACH: "no route to the network", EPIPE: "the connection was cut", CERT_HAS_EXPIRED: "its TLS certificate has expired", DEPTH_ZERO_SELF_SIGNED_CERT: "its TLS certificate is self-signed", SELF_SIGNED_CERT_IN_CHAIN: "its TLS certificate chain holds a self-signed certificate", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "its TLS certificate chain does not verify", ERR_TLS_CERT_ALTNAME_INVALID: "its TLS certificate is for another name", EPROXY: "the proxy refused it", EPROTO: "it does not speak TLS on that port (http, not https?)" };

export const sameOrigin = (a, b) => {
  const x = new URL(a);
  const y = new URL(b);
  return x.protocol === y.protocol && x.host === y.host;
};

/**
 * One request. Redirects are followed only for GET and HEAD, up to `redirects` of them, and with
 * `stay: true` only inside the first address's origin (scheme, host and port): a redirect that
 * leaves it comes back as the 3xx answer with `left: <the other origin>`, so headers that hold a
 * credential are never sent anywhere else.
 * Never throws for a network failure: {ok:false, error, code, meaning}. On an answer:
 * {ok, status, statusText, url (final), hops, headers, type, body:Buffer, cut, viaProxy, left?}.
 * publicOnly: refuse (throw "not allowed") addresses on this machine, a private network or cloud
 * metadata, at every hop; for a kit that follows addresses it read in text nobody vouched for.
 */
export async function request(url, { method = "GET", headers = {}, body = null, timeoutMs = 30_000, maxBytes = 16 << 20, redirects = 5, stay = false, publicOnly = false, agent = "ask-kit" } = {}) {
  const hops = [];
  let current = String(url);
  const m = method.toUpperCase();
  const all = { "User-Agent": `${agent} (+https://github.com/temet-ai/ask-kit)`, Accept: "application/json, */*;q=0.5", "Accept-Encoding": "gzip, br, deflate", ...headers };
  if (body != null) all["Content-Length"] = Buffer.byteLength(body);
  for (let i = 0; ; i++) {
    const viaProxy = !!proxyFor(current);
    // Every hop is checked, so a redirect cannot lead a public-only request to a private address.
    if (publicOnly) await guard(current, { viaProxy });
    let r;
    try {
      r = await once(current, { method: m, timeoutMs, maxBytes, headers: all, body });
    } catch (e) {
      const code = e.code ?? e.cause?.code ?? "ERROR";
      return { ok: false, url: current, hops, code, error: e.message || code, meaning: MEANING[code] ?? null, viaProxy };
    }
    hops.push({ url: current, status: r.status });
    const loc = r.headers.location;
    let left = null;
    if (r.status >= 300 && r.status < 400 && loc && (m === "GET" || m === "HEAD")) {
      let next = null;
      try {
        next = new URL(loc, current).href;
      } catch {}
      if (next && /^https?:/.test(next)) {
        if (stay && !sameOrigin(next, url)) left = new URL(next).origin;
        else if (i < redirects) {
          current = next;
          continue;
        } else return { ok: false, url: current, hops, code: "EREDIRECTS", error: `more than ${redirects} redirects`, meaning: "a redirect loop or a very long chain", viaProxy };
      }
    }
    const ct = String(r.headers["content-type"] ?? "");
    return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: r.statusText, url: current, hops, headers: r.headers, type: ct.split(";")[0].trim().toLowerCase(), charset: /charset=["']?([\w-]+)/i.exec(ct)?.[1]?.toLowerCase() ?? null, body: r.body, cut: r.cut, viaProxy, ...(left ? { left } : {}) };
  }
}
