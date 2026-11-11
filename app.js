(function(){
"use strict";
const K = window.KIT, $ = s => document.querySelector(s);
const LS = "en30-state", CFG = "en30-sync", DRAFT = "en30-drafts";
const GIST_FILE = "en30-progress.json";
const pad = n => String(n).padStart(2, "0");
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const LV = {Easy:"Dễ", Medium:"Trung bình", Hard:"Khó"};
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
const ICON = {
  today:'<path d="M4 6h16v14H4z"/><path d="M8 3v5M16 3v5M4 11h16"/>',
  cards:'<rect x="4" y="5" width="13" height="15" rx="2"/><path d="M8 3h11a1 1 0 0 1 1 1v13"/>',
  dict:'<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
  pron:'<path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  prog:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
};
const TABS = [["today","Hôm nay"],["cards","Thẻ từ"],["dict","Nghe chép"],["pron","Phát âm"],["prog","Tiến độ"]];

/* ---------- state: every record carries a timestamp t, merged per key (newest wins) ---------- */
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
let S = load(LS, {items:{}});
let cfg = load(CFG, {});
let drafts = load(DRAFT, {});
const get = k => S.items[k];
function put(k, obj){ S.items[k] = Object.assign({}, obj, {t: Date.now()}); persist(); queueSync(); }
function persist(){ try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} }
const saveCfg = () => { try { localStorage.setItem(CFG, JSON.stringify(cfg)); } catch (e) {} };
const cur = () => (get("cur") || {}).v || 1;
const day = () => K.days[cur() - 1];
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 6e4) / 864e5);
const wst = (d, i) => (get(`w:${d}-${i}`) || {}).s || "";
const card = (d, i) => get(`c:${d}-${i}`);

/* ---------- spaced repetition (SM-2 style, like Anki) ---------- */
function schedule(c, r){            // r: 1 Lại, 2 Khó, 3 Được, 4 Dễ
  c = Object.assign({ivl:0, ef:2.5, reps:0, lap:0}, c || {});
  let {ivl, ef} = c;
  if (r === 1){ if (ivl > 0) c.lap++; ivl = 0; ef = Math.max(1.3, ef - 0.2); }
  else if (ivl === 0){ ivl = r === 2 ? 1 : r === 3 ? (c.reps ? 3 : 1) : 4; if (r === 4) ef += 0.15; }
  else {
    ivl = r === 2 ? Math.max(ivl + 1, Math.round(ivl * 1.2))
        : r === 3 ? Math.max(ivl + 1, Math.round(ivl * ef))
        : Math.max(ivl + 2, Math.round(ivl * ef * 1.3));
    ef = Math.max(1.3, ef + (r === 2 ? -0.15 : r === 4 ? 0.15 : 0));
  }
  c.ivl = ivl; c.ef = +ef.toFixed(2); if (r > 1) c.reps++;
  c.due = today() + ivl; c.first = c.first || today();
  return c;
}
const ivlLabel = n => n === 0 ? "<10 phút" : n === 1 ? "1 ngày" : n < 30 ? n + " ngày" : Math.round(n / 30) + " tháng";
function buildQueue(){
  const t = today(), due = [], fresh = [];
  let introduced = 0;
  K.days.forEach((d, di) => d.w.forEach((_, i) => {
    const c = card(di + 1, i);
    if (c){ if (c.first === t) introduced++; if (c.due <= t) due.push([di + 1, i, c.due]); }
    else if (di + 1 <= cur()) fresh.push([di + 1, i]);
  }));
  due.sort((a, b) => a[2] - b[2]);
  const limit = Math.max(0, (cfg.newPerDay || 13) - introduced);
  return {due: due.map(x => [x[0], x[1]]), fresh: fresh.slice(0, limit), freshTotal: fresh.length};
}
let Q = null, qi = 0, flipped = false, again = [];

/* ---------- GitHub Gist sync ---------- */
let syncState = {cls:"", msg:"Chưa bật đồng bộ"};
let syncTimer = null, syncing = false;
function setSync(cls, msg){ syncState = {cls, msg}; document.querySelectorAll("[data-sync]").forEach(e => { e.className = "chip " + cls; e.innerHTML = "<i></i>" + esc(msg); }); }
if (cfg.token) setSync("", "Đồng bộ đang bật");
async function gh(path, opt = {}){
  const r = await fetch("https://api.github.com" + path, Object.assign({cache:"no-store"}, opt, {headers:Object.assign({
    Authorization:"Bearer " + cfg.token, Accept:"application/vnd.github+json"}, opt.body ? {"Content-Type":"application/json"} : {})}));
  if (!r.ok){ const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}
function merge(a, b){
  const out = Object.assign({}, a); let changed = false;
  for (const k in b){ if (!out[k] || (b[k].t || 0) > (out[k].t || 0)){ out[k] = b[k]; changed = true; } }
  return [out, changed];
}
async function sync(){
  if (!cfg.token || syncing || !navigator.onLine){ if (cfg.token && !navigator.onLine) setSync("err", "Đang offline, sẽ đồng bộ khi có mạng"); return; }
  syncing = true; setSync("busy", "Đang đồng bộ…");
  try {
    if (!cfg.gist){
      const list = await gh("/gists?per_page=100");
      const g = list.find(x => x.files && x.files[GIST_FILE]);
      if (g) cfg.gist = g.id;
      else cfg.gist = (await gh("/gists", {method:"POST", body:JSON.stringify({description:"English 30 days – progress", public:false, files:{[GIST_FILE]:{content:JSON.stringify(S)}}})})).id;
      saveCfg();
    }
    const g = await gh("/gists/" + cfg.gist);
    const f = g.files[GIST_FILE];
    let remote = {items:{}};
    if (f){ const txt = f.truncated ? await (await fetch(f.raw_url, {cache:"no-store"})).text() : f.content; try { remote = JSON.parse(txt); } catch (e) {} }
    const [mine, gotNew] = merge(S.items, remote.items || {});
    const [, remoteBehind] = merge(remote.items || {}, S.items);
    S.items = mine; persist();
    if (remoteBehind) await gh("/gists/" + cfg.gist, {method:"PATCH", body:JSON.stringify({files:{[GIST_FILE]:{content:JSON.stringify(S)}}})});
    cfg.last = Date.now(); saveCfg();
    setSync("ok", "Đã đồng bộ lúc " + new Date().toLocaleTimeString("vi-VN", {hour:"2-digit", minute:"2-digit"}));
    if (gotNew){ Q = null; render(); }
  } catch (e){
    if (e.status === 401) setSync("err", "Token sai hoặc đã hết hạn, vào Tiến độ để nhập lại");
    else if (e.status === 404){ cfg.gist = ""; saveCfg(); setSync("err", "Không thấy Gist, thử đồng bộ lại"); }
    else setSync("err", "Chưa đồng bộ được (" + (e.status || "mạng") + "), dữ liệu vẫn lưu trên máy");
  } finally { syncing = false; }
}
function queueSync(){ if (!cfg.token) return; clearTimeout(syncTimer); syncTimer = setTimeout(sync, 2500); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); else if (syncTimer){ clearTimeout(syncTimer); sync(); } });
window.addEventListener("online", sync);

/* ---------- audio ---------- */
const player = $("#player");
let playingBtn = null;
function play(src, btn, rate){
  if (playingBtn) playingBtn.classList.remove("on");
  player.src = src; player.playbackRate = rate || 1;
  player.play().catch(() => {});
  playingBtn = btn || null; if (btn) btn.classList.add("on");
}
player.onended = player.onpause = () => { if (playingBtn){ playingBtn.classList.remove("on"); playingBtn = null; } };
const wAudio = (d, i) => `audio/w/${pad(d)}-${pad(i)}.mp3`;

/* ---------- views ---------- */
let tab = location.hash.slice(1) || "today";
if (!TABS.some(t => t[0] === tab)) tab = "today";
let cmode = "review", filter = "all", ui = {rate:1};

function setDay(n){ n = Math.min(30, Math.max(1, n)); if (n !== cur()){ put("cur", {v:n}); Q = null; ui.res = null; } render(); scrollTo(0, 0); }
$("#prev").onclick = () => setDay(cur() - 1);
$("#next").onclick = () => setDay(cur() + 1);

function dueCount(){ const q = buildQueue(); return q.due.length + q.fresh.length; }
function renderTabs(){
  const n = dueCount();
  $("#tabs").innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" ${k === tab ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>${l}${k === "cards" && n ? `<span class="badge">${n}</span>` : ""}</button>`).join("");
}
const known = d => K.days[d - 1].w.filter((_, i) => wst(d, i) === "k").length;

function vToday(){
  const d = day(), n = cur(), st = get("d:" + n) || {}, q = buildQueue();
  const steps = [
    ["15′", "Ôn thẻ từ", `${q.due.length} thẻ cần ôn · ${q.fresh.length} thẻ mới · ${known(n)}/13 từ hôm nay đã biết`, "cards"],
    ["30′", "Nghe chép bài của ngày", st.score != null ? `Điểm cao nhất ${st.score}%` : "Chưa chép", "dict"],
    ["30′", "Nghe rộng + shadowing", esc(K.weeks[d.wk][1]), null],
    ["35′", "Luyện nói với voice bot", `Gõ “Day ${n}” cho bot`, null],
    ["10′", "Ôn lại thẻ sai, bấm Xong ngày", "", null],
  ];
  return `
  <div class="card">
    <div class="row" style="justify-content:space-between"><span class="tag">Tuần ${d.wk} · ${esc(K.weeks[d.wk][0])}</span><span data-sync class="chip ${syncState.cls}"><i></i>${esc(syncState.msg)}</span></div>
    <h2>${esc(d.t)}</h2>
    <div class="steps">${steps.map(s => `<div class="step"><span class="min">${s[0]}</span><div class="txt"><b>${s[1]}</b>${s[2] ? `<div class="mute">${s[2]}</div>` : ""}</div>${s[3] ? `<button class="btn sm go" data-go="${s[3]}">Mở</button>` : ""}</div>`).join("")}</div>
  </div>
  <div class="card">
    <h3>Tình huống nói hôm nay</h3>
    <div class="speak">${esc(d.sp)}</div>
    <p class="mute">Mở voice bot, gõ <b>Day ${n}</b>. Cuối tuần 1, 2, 3: gõ <b>Story 1 / 2 / 3</b> để luyện kể dự án trong CV.</p>
  </div>
  <button class="btn ${st.done ? "" : "pri"}" id="done">${st.done ? "✓ Đã xong ngày " + n + " · bấm để bỏ" : "Đánh dấu xong ngày " + n}</button>`;
}

function vCards(){
  const seg = `<div class="seg" role="group" aria-label="Chế độ">${[["review","Ôn thẻ"],["list","Danh sách ngày " + cur()]].map(([k, l]) => `<button data-cm="${k}" aria-pressed="${cmode === k}">${l}</button>`).join("")}</div>`;
  if (cmode === "list") return seg + vList();
  if (!Q){ const b = buildQueue(); Q = b.due.concat(b.fresh); Q.freshTotal = b.freshTotal; qi = 0; flipped = false; again = []; }
  if (qi >= Q.length && again.length){ Q = Q.concat(again); again = []; }
  if (qi >= Q.length){
    const b = buildQueue();
    return seg + `<div class="card empty"><b>Xong phần ôn hôm nay</b>
      <p class="mute">${b.freshTotal ? `Còn ${b.freshTotal} thẻ mới, đã đủ giới hạn ${cfg.newPerDay || 13} thẻ mới mỗi ngày.` : `Đã học hết thẻ tới ngày ${cur()}. Chuyển sang ngày sau để mở thêm 13 thẻ.`}</p>
      ${b.freshTotal ? `<button class="btn" id="more">Học thêm 13 thẻ mới</button>` : ""}</div>`;
  }
  const [dn, i] = Q[qi], w = K.days[dn - 1].w[i], c = card(dn, i);
  const isNew = !c;
  const prev = r => ivlLabel(schedule(c, r).ivl);
  return seg + `
  <div class="card flash" id="flash" role="button" tabindex="0" aria-label="Lật thẻ">
    <div class="tags"><span class="tag ${w[0]}">${LV[w[0]]}</span><span class="row" style="gap:4px">${isNew ? '<span class="tag new">Mới</span>' : ""}${w[5] !== "Chung" ? `<span class="tag src">${esc(w[5])}</span>` : ""}<span class="tag">Ngày ${dn}</span></span></div>
    <div class="term">${esc(w[1])}</div><div class="pos">${esc(w[2])}</div>
    ${flipped ? `<hr><div class="vi">${esc(w[3])}</div><div class="ex">${esc(w[4])}</div>` : `<div class="hint">Nghĩ nghĩa của từ, rồi chạm để lật</div>`}
    <div class="count">${qi + 1}/${Q.length + again.length}</div>
  </div>
  <div class="row"><button class="btn grow" id="say">🔊 Nghe từ + ví dụ</button></div>
  ${flipped ? `<div class="rate">
    <button class="r1" data-r="1">Lại<small>${prev(1)}</small></button>
    <button class="r2" data-r="2">Khó<small>${prev(2)}</small></button>
    <button class="r3" data-r="3">Được<small>${prev(3)}</small></button>
    <button class="r4" data-r="4">Dễ<small>${prev(4)}</small></button></div>`
  : `<button class="btn pri" id="flip">Xem nghĩa</button>`}
  <div class="kbdhint"><kbd>Space</kbd> lật · <kbd>1</kbd>–<kbd>4</kbd> chấm · <kbd>R</kbd> nghe</div>`;
}
function vList(){
  const n = cur(), d = day();
  const items = d.w.map((w, i) => ({w, i, st: wst(n, i)})).filter(x => filter === "all" || (filter === "todo" ? x.st !== "k" : x.w[0] === filter));
  return `<div class="seg" role="group" aria-label="Lọc">${[["all","Tất cả"],["todo","Chưa thuộc"],["Easy","Dễ"],["Medium","TB"],["Hard","Khó"]].map(([k, l]) => `<button data-f="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}</div>
  <div class="card"><p class="mute">Chạm vòng tròn để đổi: ✓ đã biết → ~ đang học → ✗ chưa. Chấm thẻ ở chế độ Ôn thẻ cũng tự cập nhật.</p>
  <div class="wl">${items.map(({w, i, st}) => `
    <div class="wi"><button class="dot ${st}" data-cyc="${i}" aria-label="Đổi trạng thái ${esc(w[1])}">${st === "k" ? "✓" : st === "l" ? "~" : st === "n" ? "✗" : ""}</button>
    <div class="t"><b>${esc(w[1])} <span class="mute">(${esc(w[2])})</span></b><small>${esc(w[3])}</small><small><i>${esc(w[4])}</i></small></div>
    <div class="row" style="flex-direction:column;gap:6px;align-items:flex-end"><span class="tag ${w[5] === "Chung" ? w[0] : "src"}">${w[5] === "Chung" ? LV[w[0]] : esc(w[5])}</span><button class="play" data-wa="${i}" aria-label="Nghe ${esc(w[1])}">${PLAY}</button></div></div>`).join("") || '<p class="mute">Không có từ nào trong mục này.</p>'}</div></div>`;
}

function norm(s){ return s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s-]/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean); }
function score(ref, hyp){
  const a = norm(ref), b = norm(hyp), m = a.length, n = b.length;
  const L = Array.from({length:m + 1}, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const hit = new Array(m).fill(false); let i = 0, j = 0;
  while (i < m && j < n){ if (a[i] === b[j]){ hit[i] = true; i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  let k = 0;
  const html = ref.split(/\s+/).map(w => { const t = norm(w); let ok = true; t.forEach(() => { if (!hit[k]) ok = false; k++; }); return t.length ? `<span class="${ok ? "hit" : "miss"}">${esc(w)}</span>` : esc(w); }).join(" ");
  return {pct: m ? Math.round(100 * L[0][0] / Math.max(m, n)) : 0, html};
}
function vDict(){
  const n = cur(), d = day(), st = get("d:" + n) || {}, r = ui.res;
  return `
  <div class="card">
    <h3>Bài nghe ngày ${n}</h3>
    <audio id="aud" controls preload="metadata" src="audio/day${pad(n)}.mp3"></audio>
    <div class="row"><span class="mute">Tốc độ</span><div class="seg grow" role="group" aria-label="Tốc độ">${[0.75, 0.9, 1, 1.15].map(v => `<button data-rate="${v}" aria-pressed="${ui.rate === v}">${v}×</button>`).join("")}</div></div>
    <div class="row"><button class="btn sm" data-seek="-5">⟲ 5 giây</button><button class="btn sm" data-seek="-2">⟲ 2 giây</button><button class="btn sm grow" id="pp">Phát / dừng</button></div>
  </div>
  <div class="card">
    <h3>Chép lại những gì bạn nghe</h3>
    <textarea id="txt" placeholder="Nghe từng đoạn, dừng lại và gõ. Không cần đúng dấu câu hay viết hoa." autocapitalize="off" autocorrect="off" spellcheck="false">${esc(drafts[n] || "")}</textarea>
    <div class="row"><button class="btn pri grow" id="check">Chấm điểm</button><button class="btn" id="clear">Xoá</button></div>
    ${st.score != null ? `<div class="mute">Điểm cao nhất: <b>${st.score}%</b> · mục tiêu ≥ 90%</div>` : ""}
  </div>
  ${r ? `<div class="card" id="result"><div class="row"><span class="score">${r.pct}%</span><span class="mute grow">số từ đúng so với bài gốc. Từ gạch đỏ là từ bị sót hoặc nghe sai.</span></div><div class="diff">${r.html}</div></div>` : ""}
  <div class="card">
    <h3>Nghe từng câu</h3>
    <p class="mute">Câu bị làm mờ. Bấm ▶ để nghe riêng câu đó (theo tốc độ đã chọn), chạm vào chữ để xem đáp án.</p>
    <ol class="sents">${d.s.map((s, i) => `<li><button class="play" data-sent="${i}" aria-label="Nghe câu ${i + 1}">${PLAY}</button><span class="blur" data-reveal>${esc(s)}</span></li>`).join("")}</ol>
  </div>`;
}

function vPron(){
  return `<div class="card"><h3>30 tên công nghệ hay bị nghe nhầm</h3><p class="mute">Mỗi file đọc tên 2 lần rồi đọc câu ví dụ. Tick ✓ khi nghe là nhận ra ngay.</p>
  <div class="wl">${K.pron.map((p, i) => { const on = (get("p:" + i) || {}).v; return `<div class="pi"><button class="play" data-pron="${i}" aria-label="Nghe ${esc(p[0])}">${PLAY}</button>
  <div class="t"><b>${esc(p[0])}</b><small>đọc: <b>${esc(p[1])}</b> · ${esc(p[2])}</small><small><i>${esc(p[3])}</i></small></div>
  <button class="dot ${on ? "k" : ""}" data-pk="${i}" aria-label="Đã nhận ra ${esc(p[0])}">${on ? "✓" : ""}</button></div>`; }).join("")}</div></div>`;
}

function vProg(){
  let tot = 0, done = 0, sc = [], last = null, started = 0, mature = 0;
  const lv = {Easy:[0,0], Medium:[0,0], Hard:[0,0]}, src = {};
  K.days.forEach((d, di) => {
    d.w.forEach((w, i) => {
      const k = wst(di + 1, i) === "k", c = card(di + 1, i);
      if (c){ started++; if (c.ivl >= 21) mature++; }
      lv[w[0]][1]++; if (k){ tot++; lv[w[0]][0]++; }
      const sk = w[5] === "Chung" ? "Chung" : w[5].includes("JD") ? "JD" : w[5].includes("CV") ? "CV" : "Sản phẩm";
      src[sk] = src[sk] || [0, 0]; src[sk][1]++; if (k) src[sk][0]++;
    });
    const st = get("d:" + (di + 1)) || {};
    if (st.done) done++;
    if (st.score != null){ sc.push(st.score); if (!last || st.t > last[2]) last = [di + 1, st.score, st.t]; }
  });
  const avg = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
  const pron = K.pron.filter((_, i) => (get("p:" + i) || {}).v).length;
  const weeks = [1, 2, 3, 4].map(w => { const ds = K.days.map((d, i) => [d, i + 1]).filter(([d]) => d.wk === w);
    return `<div class="wk">Tuần ${w} · ${esc(K.weeks[w][0])}</div><div class="cal">${ds.map(([, n]) => `<button class="${(get("d:" + n) || {}).done ? "done" : ""} ${n === cur() ? "cur" : ""}" data-day="${n}" aria-label="Ngày ${n}">${n}</button>`).join("")}</div>`; }).join("");
  return `
  <div class="card"><h3>Tổng quan</h3>
    <div class="stats"><div class="stat"><b>${tot}</b><span>/390 từ đã biết · mục tiêu 330</span></div><div class="stat"><b>${done}</b><span>/30 ngày xong</span></div><div class="stat"><b>${avg == null ? "–" : avg + "%"}</b><span>điểm chép TB · mục tiêu 90%</span></div></div>
    <div class="bar" aria-label="Tiến độ từ vựng"><i style="width:${(tot / 390 * 100).toFixed(1)}%"></i></div>
    <p class="mute">Thẻ đã học ${started}/390 · thẻ nhớ lâu (khoảng ôn ≥ 21 ngày) ${mature} · phát âm ${pron}/30${last ? ` · lần chép gần nhất: ngày ${last[0]}, ${last[1]}%` : ""}</p>
  </div>
  <div class="card"><h3>Lịch 30 ngày</h3><p class="mute">Chạm một ngày để chuyển tới ngày đó.</p>${weeks}</div>
  <div class="card"><h3>Từ đã biết</h3>
    <table class="t"><tr><th>Mức độ</th><th>Đã biết</th><th>Tổng</th></tr>${Object.entries(lv).map(([l, v]) => `<tr><td>${LV[l]}</td><td>${v[0]}</td><td>${v[1]}</td></tr>`).join("")}</table>
    <table class="t"><tr><th>Nguồn</th><th>Đã biết</th><th>Tổng</th></tr>${Object.entries(src).map(([k, v]) => `<tr><td>${k}</td><td>${v[0]}</td><td>${v[1]}</td></tr>`).join("")}</table>
  </div>
  ${vSync()}
  <div class="card"><h3>Dùng offline</h3>
    <p class="mute">Tải sẵn toàn bộ audio (khoảng 25 MB) để học khi không có mạng.</p>
    <div class="row"><button class="btn" id="offline">Tải audio về máy</button><span class="mute" id="offmsg"></span></div>
  </div>
  <div class="card"><h3>Sao lưu</h3>
    <div class="row"><button class="btn sm" id="export">Xuất file sao lưu</button><label class="btn sm" for="importf">Nhập file sao lưu</label><input type="file" id="importf" accept="application/json" hidden></div>
    <div class="row"><span class="mute">Số thẻ mới mỗi ngày</span><div class="seg grow" role="group" aria-label="Số thẻ mới">${[10, 13, 20, 30].map(v => `<button data-np="${v}" aria-pressed="${(cfg.newPerDay || 13) === v}">${v}</button>`).join("")}</div></div>
  </div>`;
}
function vSync(){
  if (cfg.token) return `<div class="card"><h3>Đồng bộ máy tính ↔ điện thoại</h3>
    <span data-sync class="chip ${syncState.cls}"><i></i>${esc(syncState.msg)}</span>
    <p class="mute">Tiến độ lưu trong một Gist bí mật trên GitHub của bạn. App tự đồng bộ khi mở, khi chuyển ứng dụng và vài giây sau mỗi thay đổi.</p>
    <div class="row"><button class="btn sm pri" id="syncnow">Đồng bộ ngay</button><button class="btn sm" id="logout">Tắt đồng bộ trên máy này</button></div></div>`;
  return `<div class="card"><h3>Đồng bộ máy tính ↔ điện thoại</h3>
    <p class="mute">Làm một lần trên mỗi thiết bị, dùng cùng một token:</p>
    <ol class="how">
      <li>Mở <a href="https://github.com/settings/tokens/new?scopes=gist&description=English%2030%20sync" target="_blank" rel="noopener">github.com/settings/tokens/new</a> (token loại classic).</li>
      <li>Chỉ tick quyền <b>gist</b>, chọn hạn 90 ngày, bấm Generate.</li>
      <li>Copy token (bắt đầu bằng <code>ghp_</code>), dán vào ô dưới.</li>
    </ol>
    <label for="tok" class="mute">Token GitHub (chỉ quyền gist)</label>
    <input id="tok" type="password" autocomplete="off" placeholder="ghp_…">
    <button class="btn pri" id="savetok">Bật đồng bộ</button>
    <p class="mute">Token chỉ lưu trên thiết bị này và chỉ đọc/ghi được Gist, không đụng tới code hay repo.</p></div>`;
}

const VIEWS = {today:vToday, cards:vCards, dict:vDict, pron:vPron, prog:vProg};
function render(){
  const d = day();
  $("#dTitle").textContent = "Ngày " + cur();
  $("#dTheme").textContent = d.t;
  $("#prev").disabled = cur() === 1; $("#next").disabled = cur() === 30;
  renderTabs();
  $("#view").innerHTML = VIEWS[tab]();
  bind();
}
function go(t){ tab = t; if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t); render(); scrollTo(0, 0); }

function rate(r){
  const [dn, i] = Q[qi], k = `${dn}-${i}`;
  const c = schedule(card(dn, i), r);
  put("c:" + k, c);
  put("w:" + k, {s: r === 1 ? "n" : r === 2 ? "l" : r === 4 || c.ivl >= 3 ? "k" : "l"});
  if (r === 1) again.push([dn, i]);
  qi++; flipped = false; render();
}
function flip(){ flipped = !flipped; render(); if (flipped && cfg.autoplay !== false){ const [dn, i] = Q[qi]; play(wAudio(dn, i)); } }

function bind(){
  const on = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
  on("[data-tab]", b => b.onclick = () => go(b.dataset.tab));
  on("[data-go]", b => b.onclick = () => go(b.dataset.go));
  const dn = $("#done"); if (dn) dn.onclick = () => { const st = get("d:" + cur()) || {}; put("d:" + cur(), Object.assign({}, st, {done: !st.done})); render(); };
  on("[data-cm]", b => b.onclick = () => { cmode = b.dataset.cm; render(); });
  on("[data-f]", b => b.onclick = () => { filter = b.dataset.f; render(); });
  const fl = $("#flash"); if (fl) fl.onclick = flip;
  const fb = $("#flip"); if (fb) fb.onclick = flip;
  on("[data-r]", b => b.onclick = () => rate(+b.dataset.r));
  const sy = $("#say"); if (sy) sy.onclick = () => { const [d, i] = Q[qi]; play(wAudio(d, i), sy); };
  const mo = $("#more"); if (mo) mo.onclick = () => { cfg.newPerDay = (cfg.newPerDay || 13) + 13; saveCfg(); Q = null; render(); };
  on("[data-cyc]", b => b.onclick = () => { const k = `w:${cur()}-${b.dataset.cyc}`, order = ["", "k", "l", "n"]; put(k, {s: order[(order.indexOf(wst(cur(), +b.dataset.cyc)) + 1) % 4]}); render(); });
  on("[data-wa]", b => b.onclick = () => play(wAudio(cur(), +b.dataset.wa), b));
  const a = $("#aud");
  if (a){
    a.onloadedmetadata = () => a.playbackRate = ui.rate;
    a.onplay = () => { player.pause(); a.playbackRate = ui.rate;
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({title: "Ngày " + cur() + ": " + day().t, artist: "English 30 ngày", artwork: [{src: "icon-512.png", sizes: "512x512", type: "image/png"}]}); };
  }
  on("[data-rate]", b => b.onclick = () => { ui.rate = +b.dataset.rate; if (a) a.playbackRate = ui.rate; on("[data-rate]", x => x.setAttribute("aria-pressed", x === b)); });
  on("[data-seek]", b => b.onclick = () => { if (a) a.currentTime = Math.max(0, a.currentTime + +b.dataset.seek); });
  const pp = $("#pp"); if (pp) pp.onclick = () => { if (a) a.paused ? a.play().catch(() => {}) : a.pause(); };
  const tx = $("#txt"); if (tx) tx.oninput = () => { drafts[cur()] = tx.value; try { localStorage.setItem(DRAFT, JSON.stringify(drafts)); } catch (e) {} };
  const ck = $("#check"); if (ck) ck.onclick = () => {
    const r = score(day().s.join(" "), tx.value); ui.res = r;
    const st = get("d:" + cur()) || {};
    if (st.score == null || r.pct > st.score) put("d:" + cur(), Object.assign({}, st, {score: r.pct}));
    render(); const el = $("#result"); if (el) el.scrollIntoView({behavior: "smooth", block: "start"});
  };
  const cl = $("#clear"); if (cl) cl.onclick = () => { drafts[cur()] = ""; ui.res = null; try { localStorage.setItem(DRAFT, JSON.stringify(drafts)); } catch (e) {} render(); };
  on("[data-sent]", b => b.onclick = () => { if (a) a.pause(); play(`audio/s/${pad(cur())}-${pad(+b.dataset.sent)}.mp3`, b, ui.rate); });
  on("[data-reveal]", s => s.onclick = () => s.classList.toggle("show"));
  on("[data-pron]", b => b.onclick = () => play(`audio/pron/pron${pad(+b.dataset.pron + 1)}.mp3`, b));
  on("[data-pk]", b => b.onclick = () => { const k = "p:" + b.dataset.pk; put(k, {v: !(get(k) || {}).v}); render(); });
  on("[data-day]", b => b.onclick = () => { setDay(+b.dataset.day); go("today"); });
  on("[data-np]", b => b.onclick = () => { cfg.newPerDay = +b.dataset.np; saveCfg(); Q = null; render(); });
  const st = $("#savetok"); if (st) st.onclick = () => { const v = $("#tok").value.trim(); if (!v) return; cfg.token = v; cfg.gist = ""; saveCfg(); render(); sync(); };
  const sn = $("#syncnow"); if (sn) sn.onclick = sync;
  const lo = $("#logout"); if (lo) lo.onclick = () => { cfg = {newPerDay: cfg.newPerDay}; saveCfg(); setSync("", "Chưa bật đồng bộ"); render(); };
  const ex = $("#export"); if (ex) ex.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(S)], {type: "application/json"}));
    const l = document.createElement("a"); l.href = url; l.download = "english30-backup-" + new Date().toISOString().slice(0, 10) + ".json"; l.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const im = $("#importf"); if (im) im.onchange = async () => {
    try { const data = JSON.parse(await im.files[0].text()); S.items = merge(S.items, data.items || {})[0]; persist(); queueSync(); Q = null; render(); }
    catch (e) { im.value = ""; }
  };
  const of = $("#offline"); if (of) of.onclick = async () => {
    const msg = $("#offmsg");
    if (!("caches" in window)){ msg.textContent = "Trình duyệt này không hỗ trợ lưu offline."; return; }
    const urls = [];
    K.days.forEach((d, di) => { urls.push(`audio/day${pad(di + 1)}.mp3`); d.w.forEach((_, i) => urls.push(wAudio(di + 1, i))); d.s.forEach((_, i) => urls.push(`audio/s/${pad(di + 1)}-${pad(i)}.mp3`)); });
    K.pron.forEach((_, i) => urls.push(`audio/pron/pron${pad(i + 1)}.mp3`));
    of.disabled = true; let n = 0, fail = 0;
    const c = await caches.open("en30-audio");
    const work = urls.slice();
    await Promise.all(Array.from({length: 6}, async () => { while (work.length){ const u = work.shift();
      try { if (!(await c.match(u))){ const r = await fetch(u); if (r.ok) await c.put(u, r); else fail++; } } catch (e) { fail++; }
      n++; msg.textContent = `${n}/${urls.length}`; } }));
    msg.textContent = fail ? `Xong, ${fail} file lỗi. Bấm lại để thử tiếp.` : "Đã tải đủ, học offline được."; of.disabled = false;
  };
}

document.addEventListener("keydown", e => {
  if (tab !== "cards" || cmode !== "review" || /INPUT|TEXTAREA/.test(e.target.tagName) || !Q || qi >= Q.length) return;
  if (e.key === " " || e.key === "Enter"){ e.preventDefault(); flip(); }
  else if (flipped && "1234".includes(e.key)) rate(+e.key);
  else if (e.key === "r" || e.key === "R"){ const [d, i] = Q[qi]; play(wAudio(d, i)); }
});
window.addEventListener("hashchange", () => { const t = location.hash.slice(1); if (VIEWS[t] && t !== tab){ tab = t; render(); } });

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
render();
sync();
})();
