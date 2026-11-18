"""Merge everyday chunks (chunks.json) and fast-speech forms (spoken.json) into vocab3000.js and make their audio.

Rows keep the vocab3000 layout [order, w, pos, ipa, vi, ex, topic, src, sp]. Phrase-type rows are re-ordered so
the most useful items of each kind come first, interleaved. Existing IDs (the phrase text) never change.
Usage: python add.py   (needs edge-tts)
"""
import asyncio, json, pathlib, re, edge_tts

HERE = pathlib.Path(__file__).parent
APP = HERE.parent.parent
src = (APP / "vocab3000.js").read_text()
rows = json.loads(src[src.index("=") + 1:].rstrip().rstrip(";"))
words = [r for r in rows if r[7] not in ("Phrase", "Chunk", "Spoken")]
old = {r[1]: r for r in rows if r[7] in ("Phrase", "Chunk", "Spoken")}

new = []
for f in ["spoken.json", "chunks.json"]:
    for x in json.load(open(HERE / f)):
        w = x["w"].strip()
        if w in old or any(n[1] == w for n in new) or w in {r[1] for r in words}: continue
        new.append([0, w, "phrase", x.get("ipa", ""), x["vi"].strip(), x["ex"].strip(), x["topic"], x["src"], x.get("sp", ""), bool(x.get("link"))])

# interleave: 2 everyday chunks, 1 fast-speech form, 1 meeting phrase, keeping each list's own order
groups = {k: [r for r in list(old.values()) + new if r[7] == k] for k in ("Chunk", "Spoken", "Phrase")}
mixed = []
while any(groups.values()):
    for k, n in (("Chunk", 2), ("Spoken", 1), ("Phrase", 1)):
        for _ in range(n):
            if groups[k]: mixed.append(groups[k].pop(0))
out = words + mixed
for i, r in enumerate(out, 1):
    r[0] = i
    if len(r) < 9: r.append("")
link = {r[1] for r in out if len(r) > 9 and r.pop()}       # linking items: the TTS links them by itself
slug = lambda w: re.sub(r"[^a-z0-9]+", "-", w).strip("-")
slugs = [slug(r[1]) for r in out]
dup = {s for s in slugs if slugs.count(s) > 1}
assert not dup, f"duplicate audio names: {dup}"
(APP / "vocab3000.js").write_text("window.V3=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";")
print(len(words), "words,", len(mixed), "phrases (", {k: sum(r[7] == k for r in mixed) for k in ("Phrase", "Chunk", "Spoken")}, ")")

OUT = APP / "audio" / "v"
VO = ["en-US-AvaNeural", "en-US-AndrewNeural", "en-GB-SoniaNeural", "en-GB-RyanNeural"]
sem = asyncio.Semaphore(8)
async def one(r):
    p = OUT / (slug(r[1]) + ".mp3")
    if p.exists() and p.stat().st_size > 1000: return
    # fast-speech items: careful form, then how it sounds, then the example said naturally
    text = f"{r[1]}. ... {r[8]}. ... {r[5]}" if r[8] and r[1] not in link else f"{r[1]}. ... {r[1]}. ... {r[5]}"
    async with sem:
        for k in range(5):
            try: await edge_tts.Communicate(text, VO[sum(map(ord, r[1])) % 4], rate="-5%" if not r[8] else "+0%").save(str(p)); return
            except Exception: await asyncio.sleep(2 + 3 * k)
        print("FAIL", r[1])
async def main(): await asyncio.gather(*(one(r) for r in mixed))
asyncio.run(main())
print("audio files:", sum((OUT / (slug(r[1]) + ".mp3")).exists() for r in mixed), "/", len(mixed))
