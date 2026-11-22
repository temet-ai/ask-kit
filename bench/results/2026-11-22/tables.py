# Tables for the 22 Nov 2026 rerun, from the files in this folder.
#   python3 bench/results/2026-11-22/tables.py
# Early-answered ask rows carry runCostUsd / runMs: the full run's cost and time, from its later
# journal line (run-ask.mjs reads the journal before such a run finishes; see issue #16).
import json, os, statistics as st
D = os.path.dirname(os.path.abspath(__file__))
qs = {q["id"]: q for q in json.load(open(f"{D}/questions.json"))["questions"]}
# Read by hand against the source: k01's expected answer is newer than the pinned code (#15);
# Sonnet's s10 answer is the message before its last one, a remark on a background search.
HAND = {("k01-loop-limits", "*"): "correct", ("s10-herdr-sounds", "baseline-sonnet"): "correct"}
WAYS = {"deepseek-v4.1-flash-1017": "ask → deepseek-v4.1-flash", "glm-5.3-flash": "ask → glm-5.3-flash", "baseline-sonnet": "Sonnet 5.5 digs itself"}
def tier(i):
    q = qs[i]
    return "code" if q["domain"] == "code" else ("undated sessions" if q.get("tier") == "undated" else "dated sessions")
out = {}
for b in WAYS:
    R = [json.loads(l) for l in open(f"{D}/{b}.jsonl")]
    G = [json.loads(l) for l in open(f"{D}/{b}.graded.jsonl")]
    rows = []
    for r, g in zip(R, G):
        v = HAND.get((r["id"], "*")) or HAND.get((r["id"], b)) or g["verdict"]
        if b == "baseline-sonnet":
            ctx = (r["contextPeak"] - r["contextFirst"]) + (r["usage"] or {}).get("output", 0)
            cost = r["costUsd"]
        else:
            ctx = r["callerChars"] / 4
            cost = r["costUsd"] or r.get("runCostUsd") or 0
        rows.append(dict(id=r["id"], t=tier(r["id"]), v=v, ctx=ctx, cost=cost, ms=r["wallMs"]))
    out[b] = rows
score = lambda rs: sum(1 if r["v"] == "correct" else 0.5 if r["v"] == "partial" else 0 for r in rs)
print("| Questions | Way | Score | Median time | Cost / question (median) | Total cost | Context added / question (median) | Context added (total) |")
print("|---|---|---|---|---|---|---|---|")
for t in ["dated sessions", "undated sessions", "code", "all 21"]:
    for b, rows in out.items():
        rs = [r for r in rows if t == "all 21" or r["t"] == t]
        print(f"| {t} | {WAYS[b]} | {score(rs):g}/{len(rs)} | {st.median(r['ms'] for r in rs)/1000:.0f} s | ${st.median(r['cost'] for r in rs):.4f} | ${sum(r['cost'] for r in rs):.3f} | {st.median(r['ctx'] for r in rs):,.0f} | {sum(r['ctx'] for r in rs)/1000:.1f}k |")
print()
print("| Question | " + " | ".join(WAYS.values()) + " |")
print("|---|" + "---|" * len(WAYS))
for i in qs:
    print(f"| {i} | " + " | ".join({"correct": "C", "partial": "p", "wrong": "x"}[next(r["v"] for r in out[b] if r["id"] == i)] for b in out) + " |")
