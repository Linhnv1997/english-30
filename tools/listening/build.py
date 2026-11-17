"""Validate the listening lessons, synthesize one mp3 per lesson (a voice per speaker) and write listening.js.

Usage: python build.py            # needs edge-tts and ffmpeg
Audio: audio/l/<id>.mp3, line start times go into listening.js so the script can jump to a line.
"""
import asyncio, json, pathlib, re, subprocess, sys, tempfile, wave
import edge_tts

HERE = pathlib.Path(__file__).parent
APP = HERE.parent.parent
OUT = APP / "audio" / "l"
VOICES = {
    "M-US": ["en-US-AndrewNeural", "en-US-BrianNeural", "en-US-ChristopherNeural", "en-US-GuyNeural"],
    "F-US": ["en-US-AvaNeural", "en-US-EmmaNeural", "en-US-JennyNeural", "en-US-MichelleNeural"],
    "M-GB": ["en-GB-RyanNeural", "en-GB-ThomasNeural"],
    "F-GB": ["en-GB-SoniaNeural", "en-GB-LibbyNeural"],
    "M-AU": ["en-AU-WilliamMultilingualNeural"],
    "F-AU": ["en-AU-NatashaNeural"],
}
GAP = {3: 0.55, 4: 0.35}      # silence between turns / sentences, seconds
RATE = 22050


def load():
    L = []
    for f in ["p3a.json", "p3b.json", "p4a.json", "p4b.json"]:
        p = HERE / f
        if p.exists(): L += json.load(open(p))
    return L


def check(L):
    errs, ids = [], set()
    for x in L:
        i = x["id"]
        if i in ids: errs.append(f"{i}: duplicate id")
        ids.add(i)
        if x["part"] == 4 and set(x["speakers"]) != {"A"}: errs.append(f"{i}: part 4 must have one speaker")
        for s, _ in x["lines"]:
            if s not in x["speakers"]: errs.append(f"{i}: unknown speaker {s}")
        for s, v in x["speakers"].items():
            if v not in VOICES: errs.append(f"{i}: bad voice tag {v}")
        if len(x["questions"]) != 4: errs.append(f"{i}: {len(x['questions'])} questions")
        text = " ".join(t for _, t in x["lines"])
        for n, q in enumerate(x["questions"], 1):
            if len(q["o"]) != 4 or not 0 <= q["a"] <= 3: errs.append(f"{i} q{n}: options/answer")
            if not q["ev"] or any(not 0 <= e < len(x["lines"]) for e in q["ev"]): errs.append(f"{i} q{n}: evidence index")
            m = re.search(r'say[s]?,?\s*[“"](.+?)[”"]', q["q"])
            if m and m.group(1).strip(" .,?!").lower() not in text.lower(): errs.append(f"{i} q{n}: quoted phrase not in script")
    return errs


def cast(x):
    used, out = {}, {}
    for s, tag in x["speakers"].items():
        pool = VOICES[tag]
        k = (sum(map(ord, x["id"])) + used.get(tag, 0)) % len(pool)
        used[tag] = used.get(tag, 0) + 1
        out[s] = pool[k]
    return out


def to_wav(src, dst):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", src, "-ac", "1", "-ar", str(RATE), dst], check=True)
    with wave.open(dst) as w: return w.getnframes() / RATE


async def tts(text, voice, path):
    for k in range(5):
        try:
            await edge_tts.Communicate(text, voice, rate="-3%").save(path)
            if pathlib.Path(path).stat().st_size > 500: return
        except Exception:
            pass
        await asyncio.sleep(2 + 3 * k)
    raise RuntimeError(f"tts failed: {text[:40]}")


async def build_one(x, sem, force):
    dst = OUT / f"{x['id']}.mp3"
    meta = dst.with_suffix(".json")
    sig = json.dumps([x["lines"], x["speakers"]])
    if not force and dst.exists() and meta.exists() and json.load(open(meta))["sig"] == sig:
        return json.load(open(meta))["ts"]
    vo = cast(x)
    async with sem:
        with tempfile.TemporaryDirectory() as td:
            td = pathlib.Path(td)
            for n, (s, t) in enumerate(x["lines"]):
                await tts(t, vo[s], str(td / f"{n}.mp3"))
            gap = GAP[x["part"]]
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono", "-t", str(gap), str(td / "gap.wav")], check=True)
            ts, pos, parts = [], 0.4, []
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono", "-t", "0.4", str(td / "lead.wav")], check=True)
            parts.append(td / "lead.wav")
            for n in range(len(x["lines"])):
                d = to_wav(str(td / f"{n}.mp3"), str(td / f"{n}.wav"))
                ts.append(round(pos, 2)); pos += d + gap
                parts += [td / f"{n}.wav", td / "gap.wav"]
            (td / "list.txt").write_text("".join(f"file '{p}'\n" for p in parts))
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(td / "list.txt"),
                            "-ac", "1", "-b:a", "64k", str(dst)], check=True)
    json.dump({"sig": sig, "ts": ts}, open(meta, "w"))
    print("audio", x["id"], f"{pos:.0f}s", flush=True)
    return ts


async def main():
    L = load()
    errs = check(L)
    if errs:
        print("\n".join(errs)); sys.exit(1)
    OUT.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(4)
    force = "--force" in sys.argv
    tss = await asyncio.gather(*(build_one(x, sem, force) for x in L))
    data = sorted((dict(x, ts=t) for x, t in zip(L, tss)), key=lambda x: x["id"])
    (APP / "listening.js").write_text("window.LS=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";")
    from collections import Counter
    print(len(data), "lessons", Counter(x["part"] for x in data), "answer spread", Counter(q["a"] for x in data for q in x["questions"]))


asyncio.run(main())
