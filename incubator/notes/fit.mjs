// A script's result has to fit in one cell's output, which ask-kit clips at 4000 characters.
// fit() shortens the result's lists from their ends until it does, and says how many rows it cut,
// so a long list never hides the counts or loses its end without a word.
const size = (v) => JSON.stringify(v, null, 1).length;

/**
 * `lists` returns the arrays that may be shortened, least important last: the last non-empty one
 * loses its last row first. With `even`, the longest loses a row instead (two lists of equal worth).
 */
export function fit(result, lists, { budget = 3600, even = false } = {}) {
  let cut = 0;
  while (size(result) > budget - (cut ? 0 : 90)) {
    const all = lists().filter((a) => a.length > (even ? 1 : 0));
    if (!all.length) break;
    const from = even ? all.reduce((a, b) => (b.length >= a.length ? b : a)) : all.at(-1);
    if (!even && all.length === 1 && from.length === 1) break; // keep at least one row
    from.pop();
    cut++;
    result.cutToFit = `${cut} rows at the end of the lists are not shown; the counts cover everything. Ask for fewer (a tag, a folder, a note, a shorter time) or a smaller max.`;
  }
  return result;
}
