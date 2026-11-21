// Redaction for kits: what a kit returns goes to a cloud model, so secrets in text and in values are
// masked before they leave the kit. A match keeps its kind and loses its value: "--password
// <redacted>", "API_KEY=<redacted>", "Bearer <redacted>", "https://vimes:<redacted>@example.com".
//
// From the kits' own copies (ask-kit kit commons, 2026-11-21): the shapes are the host's transcript
// scrubber (PEM keys, URL passwords, bearer and basic headers, provider key formats, NAME=value and
// "key": "value"); the name rules are the shell kit's (a name is split into parts, and
// "--password-file" or "TOKEN_URL" name where a secret is, not the secret); flags that take a
// secret come from the procs and shell kits. Redaction goes by pattern: a secret that looks like
// nothing in particular, passed in an unusual way, is not caught.
import { scrubSecrets } from "../transcripts/scrub.mjs";

export const R = "<redacted>";

// "tokens" is not a credential word here: input_tokens and max_tokens are counts, and agent logs are full of them.
const CRED_PARTS = new Set([
  "password", "passwd", "passphrase", "pass", "pwd", "pw", "passcode", "token", "secret", "secrets", "apikey", "apikeys",
  "credential", "credentials", "cred", "creds", "auth", "bearer", "cookie", "cookies", "signature", "otp", "pat", "authtoken",
  "accesskey", "secretkey", "privatekey", "accesstoken", "authorization", "dsn",
]);
// A name part before "key" that makes it a credential: API_KEY, access-key, SIGNING_KEY.
const KEY_KINDS = new Set(["api", "access", "secret", "private", "auth", "license", "licence", "encryption", "master", "signing", "session", "app", "consumer", "client", "account", "storage", "deploy", "service", "admin", "shared", "sas", "webhook"]);
// A last part that says the value is not the credential itself: --password-file, TOKEN_URL, SSH_AUTH_SOCK.
const NOT_VALUE = new Set([
  "file", "files", "path", "dir", "stdin", "name", "names", "id", "type", "method", "mode", "url", "uri", "endpoint", "length", "len", "ttl",
  "expiry", "expires", "prompt", "cmd", "command", "helper", "sock", "socket", "store", "policy", "timeout", "version", "count", "enabled",
  "required", "fd", "format", "algorithm", "algo", "scope", "scopes", "plugin", "provider", "realm", "user", "username", "host", "port",
  "source", "header", "prefix", "suffix", "location", "manager", "backend", "check", "strength", "age", "days",
]);

export function nameParts(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Whether a variable, flag, header or key name looks like it holds a credential. */
export function isCredName(name) {
  const parts = nameParts(name);
  if (!parts.length) return false;
  if (/^(no|without|skip|with|disable|enable|use|show|ask|prompt|generate|new|reset|forgot|change|check|verify|validate|require|requires)$/.test(parts[0]) && parts.length > 1) return false;
  if (NOT_VALUE.has(parts[parts.length - 1])) return false;
  for (let i = 0; i < parts.length; i++) {
    if (CRED_PARTS.has(parts[i])) return true;
    if ((parts[i] === "key" || parts[i] === "keys") && i > 0 && KEY_KINDS.has(parts[i - 1])) return true;
  }
  return false;
}


const QUOTED = `"[^"\\n]*"|'[^'\\n]*'|[^\\s"'\`;&|,)]+`;
const FLAG = new RegExp(`(^|\\s)(--?[A-Za-z][\\w-]*)(=|\\s+)(${QUOTED})`, "g");
const HEADER = /\b((?:authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie|set-cookie)\s*[:=]\s*)(?:(bearer|basic|token)\s+)?[^\s"',;]+/gi;
const USERPASS = /(^|\s)(-u\s*|--user[= ])([^\s:'"]+):([^\s'"]+)/g;
const MYSQL_P = /(^|\s)((?:mysql|mysqldump|mariadb|mysqladmin)\b[^|;&\n]*?\s-p)(?!\s)(\S+)/g;
const isRef = (v) => /^\$\{?[A-Za-z_][\w.:]*\}?$/.test(v) || /^\$\(|^`|^%\w+%$|^\$env:\w+$|^<\(/.test(v);
const unq = (v) => v.replace(/^(["'])(.*)\1$/, "$2");

/**
 * Text with secrets masked. o.names adds names (header, flag or field) the kit knows to be secret.
 * A value that is a reference ($TOKEN, ${TOKEN}, $(cmd)) is kept: it is not the secret.
 */
export function redact(text, o = {}) {
  if (typeof text !== "string" || text.length < 6) return text;
  const extra = new Set([].concat(o.names ?? []).map((n) => String(n).toLowerCase()));
  const secretName = (n) => isCredName(n) || extra.has(String(n).toLowerCase().replace(/^-+/, ""));
  let t = scrubSecrets(text).replace(/\[redacted\]/g, R);
  t = t.replace(FLAG, (all, pre, flag, sep, value) => (secretName(flag.replace(/^-+/, "")) && !isRef(unq(value)) && unq(value) !== R && !/^-/.test(value) ? `${pre}${flag}${sep}${R}` : all));
  t = t.replace(HEADER, (all, head, kind) => `${head}${kind ? `${kind} ` : ""}${R}`);
  t = t.replace(USERPASS, (all, pre, flag, user, pass) => (isRef(pass) ? all : `${pre}${flag}${user}:${R}`));
  t = t.replace(MYSQL_P, (all, pre, cmd) => `${pre}${cmd}${R}`);
  // name=value and name: value pairs whose name is a credential, in any case (logfmt, query strings, YAML).
  t = t.replace(/(^|[\s?&;,{(])([A-Za-z_][\w.-]*)(\s*=\s*|\s*:\s+)("[^"\n]*"|'[^'\n]*'|[^\s"'&;,)}]+)/g, (all, pre, name, sep, value) => (secretName(name) && !isRef(unq(value)) && unq(value) !== R && unq(value).length >= 4 && !/^\d+$/.test(unq(value)) && !/^https?:\/\//.test(unq(value)) ? `${pre}${name}${sep}${R}` : all));
  return t;
}

/**
 * Every string in a value redacted, and every field whose name is a credential (password, apiKey,
 * client_secret) replaced whole. o.names adds field names. Depth-limited, so a cycle cannot loop.
 */
export function redactDeep(v, o = {}, depth = 0) {
  if (typeof v === "string") return redact(v, o);
  if (!v || typeof v !== "object" || depth > 12) return v;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, o, depth + 1));
  if (Buffer.isBuffer(v) || v instanceof Date) return v;
  const extra = new Set([].concat(o.names ?? []).map((n) => String(n).toLowerCase()));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = x != null && x !== "" && typeof x !== "boolean" && typeof x !== "number" && (isCredName(k) || extra.has(k.toLowerCase())) ? R : redactDeep(x, o, depth + 1);
  return out;
}
