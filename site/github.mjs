// The gallery lists public repositories. Keep its API token off the raw-content host.
export async function publicFile(repo, branch, file, { fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const url = `https://raw.githubusercontent.com/${repo}/${branch}/${file}`;
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { "user-agent": "ask-kit-site" }, signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      if (attempt >= 2) throw new Error(`${repo}/${file}: download failed`, { cause: error });
    }
    if (response?.ok) return response.text();
    if (response?.status === 404) return null;
    if (response && (attempt >= 2 || (response.status !== 429 && response.status < 500))) {
      throw new Error(`${repo}/${file}: HTTP ${response.status}; gallery was not rebuilt`);
    }
    await sleep(250 * 2 ** attempt);
  }
}
