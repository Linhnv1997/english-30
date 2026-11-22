"""Validate reading passages; with no arguments, check every r*.json here and write reading.js.

Usage: python3 check.py [file.json ...]
"""
import json, pathlib, re, sys
from collections import Counter

HERE = pathlib.Path(__file__).parent
APP = HERE.parent.parent
s = (APP / "vocab3000.js").read_text()
V = {r[1]: r for r in json.loads(s[s.index("["):s.rindex("]") + 1])}
LEN = {1: (80, 140), 2: (150, 230), 3: (240, 340)}
TYPES = {"email", "report", "memo", "notice", "chat", "minutes", "article", "job", "review"}


def check(x):
    i, e = x.get("id", "?"), []
    lv = x.get("level")
    if lv not in LEN or not re.fullmatch(rf"r{lv}-\d\d", i): e.append("id/level")
    if x.get("type") not in TYPES: e.append(f"type {x.get('type')}")
    for k in ["topic", "title", "title_vi"]:
        if not x.get(k): e.append(f"missing {k}")
    sents = [p for para in x.get("paras", []) for p in para]
    if any(len(p) != 2 or not p[0].strip() or not p[1].strip() for p in sents): e.append("each sentence needs [en, vi]")
    text = " ".join(p[0] for p in sents)
    n = len(re.findall(r"[A-Za-z0-9'’-]+", text))
    lo, hi = LEN.get(lv, (0, 9999))
    if not lo * 0.9 <= n <= hi * 1.1: e.append(f"{n} words, want {lo}-{hi}")
    voc = x.get("vocab", [])
    if not 6 <= len(voc) <= 12: e.append(f"{len(voc)} vocab items")
    for v in voc:
        if v["w"] not in V: e.append(f"vocab '{v['w']}' not in deck"); continue
        f = v.get("f", v["w"])
        if not re.search(r"(?<![A-Za-z])" + re.escape(f) + r"(?![A-Za-z])", text, re.I): e.append(f"vocab form '{f}' not in text")
    qs = x.get("questions", [])
    if len(qs) != (3 if lv == 1 else 4): e.append(f"{len(qs)} questions")
    for k, q in enumerate(qs, 1):
        if len(q.get("o", [])) != 4 or q.get("a") not in range(4) or not q.get("q") or not q.get("vi"): e.append(f"q{k} malformed")
    return [f"{i}: {m}" for m in e], n


def main():
    files = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(HERE.glob("r*.json"))
    allp, errs, ids = [], [], Counter()
    for f in files:
        for x in json.load(open(f)):
            er, n = check(x); errs += er; allp.append((x, n)); ids[x.get("id")] += 1
    errs += [f"{i}: duplicate id" for i, c in ids.items() if c > 1]
    print("\n".join(errs) or "OK")
    print(len(allp), "passages", dict(Counter(x["level"] for x, _ in allp)), "answers", dict(Counter(q["a"] for x, _ in allp for q in x["questions"])))
    if errs or sys.argv[1:]: sys.exit(1 if errs else 0)
    out = []
    for x, n in sorted(allp, key=lambda p: p[0]["id"]):
        y = dict(x, words=n)
        y["vocab"] = [dict(v, f=v.get("f", v["w"]), pos=V[v["w"]][2], ipa=V[v["w"]][3], vi=V[v["w"]][4]) for v in x["vocab"]]
        out.append(y)
    (APP / "reading.js").write_text("window.RD=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";")
    print("wrote reading.js")


main()
