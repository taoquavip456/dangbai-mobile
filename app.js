// ============================================================================
// Đăng bài · app điện thoại (PWA). Điều khiển app máy tính qua Supabase, mã hóa đầu cuối.
// Mọi việc nặng (Claude, Chrome, dựng video) chạy trên MÁY TÍNH; điện thoại chỉ ra lệnh + xem.
// ============================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm';

const E = window.DBE2E, CFG = window.DBRemoteConfig;
const APP_VERSION = '1.0.0';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const EASE = 'cubic-bezier(.2,.9,.25,1)';
const LIMITS = { facebook: 2200, threads: 500 };
const MAX_FILES = 10, MAX_VIDEO_MB = 45;

const sb = createClient(CFG.url, CFG.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dangbai-phone' } });
const LS = 'dangbai.pair.v1';
let P = (() => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch { return null; } })();
const saveP = () => { try { localStorage.setItem(LS, JSON.stringify(P)); } catch { /* bỏ qua */ } };
let ownerKey = null, snap = null, channel = null, pcLastSeen = null;
const pending = new Map();   // mã lệnh → { resolve, reject, onStep }

// ---------------- tiện ích giao diện ----------------
function toast(t, ms = 2600) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms); }
function pop(el) { if (el) el.animate([{ opacity: 0, transform: 'translateY(14px) scale(.96)' }, { opacity: 1, transform: 'scale(1.01)', offset: .7 }, { transform: 'none' }], { duration: 460, easing: 'ease-out' }); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const hm = d => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function ask(msg, sub = '', { ok = 'Đồng ý', cancel = 'Hủy' } = {}) {
  $('#ask-msg').textContent = msg; $('#ask-sub').textContent = sub; $('#ask-ok').textContent = ok; $('#ask-no').textContent = cancel;
  $('#ask').classList.add('on');
  return new Promise(res => {
    const done = v => { $('#ask').classList.remove('on'); $('#ask-ok').onclick = $('#ask-no').onclick = null; res(v); };
    $('#ask-ok').onclick = () => done(true); $('#ask-no').onclick = () => done(false);
  });
}

// ---------------- điều hướng ----------------
const TITLES = { home: 'Tổng quan', tao: 'Tạo bài', lich: 'Lịch đăng', run: 'Đang chạy', more: 'Thêm' };
let page = 'home';
function moveInd() {
  const b = $(`.tabbar .tab[data-p="${page}"]`), ind = $('#ind');
  ind.style.opacity = b ? 1 : 0;
  if (b) ind.style.transform = `translateX(${b.offsetLeft + b.offsetWidth / 2 - 11}px)`;
}
function go(p) {
  if (p === page) return;
  page = p;
  $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.p === p));
  $$('.page').forEach(s => s.classList.toggle('on', s.id === 'p-' + p));
  $('#title').textContent = p === 'home' ? greet() : TITLES[p];
  $('#sub').textContent = p === 'home' ? (snap?.shop || '') : '';
  $('#scroll').scrollTop = 0;
  moveInd();
  [...$('#p-' + p).children].filter(n => n.offsetParent).forEach((n, i) => n.animate(
    [{ opacity: 0, transform: 'translateY(18px) scale(.97)' }, { opacity: 1, transform: 'none' }],
    { duration: 380, delay: Math.min(i, 6) * 45, easing: EASE, fill: 'backwards' }));
  if (p === 'lich') drawLich();
  if (p === 'more') drawMore();
}
const greet = () => { const h = new Date().getHours(); return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'; };
$$('.tab[data-p]').forEach(t => t.addEventListener('click', () => go(t.dataset.p)));
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) go(g.dataset.go);
  const s = e.target.closest('[data-soon]'); if (s) toast(`${s.dataset.soon}: sẽ có trong bản sau`);
  const sh = e.target.closest('[data-sheet]'); if (sh) openSheet(true);
  const pk = e.target.closest('[data-pick]'); if (pk) $(pk.dataset.pick === 'cam' ? '#f-cam' : '#f-lib').click();
});
function openSheet(on) { $('#sheet').classList.toggle('on', on); $('#scrim').classList.toggle('on', on); $('#plus').classList.toggle('open', on); }
$('#plus').addEventListener('click', () => openSheet(!$('#sheet').classList.contains('on')));
$('#scrim').addEventListener('click', () => openSheet(false));
$$('#sheet .opt').forEach(o => o.addEventListener('click', () => {
  openSheet(false);
  if (o.dataset.act === 'more') return setTimeout(() => go('more'), 200);
  $(o.dataset.act === 'cam' ? '#f-cam' : '#f-lib').click();
}));

// ============================================================================
// GHÉP MÁY
// ============================================================================
const deviceName = () => /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Điện thoại Android' : 'Điện thoại';
async function session() {
  let { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const r = await sb.auth.signInAnonymously();
  if (r.error) throw new Error('Không kết nối được máy trung gian: ' + r.error.message);
  return r.data.session;
}
function showPair(msg = '') {
  $('#pair').classList.remove('hidden');
  $('#pair-err').textContent = msg;
  $('#pair-msg').textContent = '';
}
async function pairWith(code, fpExpected) {
  $('#pair-err').textContent = '';
  $('#pair-msg').textContent = 'Đang ghép…';
  const s = await session();
  const keys = P?.keys || await E.generateDeviceKeys();
  const res = await fetch(`${CFG.url}/functions/v1/pair-finish`, {
    method: 'POST',
    headers: { apikey: CFG.publishableKey, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name: deviceName(), pubkey: E.pubOnly(keys.publicJwk) })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || 'Ghép không thành công.');
  const fp = await E.fingerprint(j.pcPubkey);
  if (fpExpected && fp !== fpExpected) throw new Error('Khóa máy tính KHÔNG khớp mã QR. Dừng lại để an toàn, thử lấy mã mới.');
  P = { ownerId: j.ownerId, deviceId: j.deviceId, pcDeviceId: j.pcDeviceId, pcPubkey: j.pcPubkey, keys, fp, keyVersion: 0 };
  saveP();
  $('#pair-msg').textContent = `Đã ghép. Dấu vân tay máy tính: ${fp.replace(/(.{4})(?=.)/g, '$1 ')}. Đang chờ máy tính gửi khóa mã hóa…`;
  await ensureOwnerKey(45000);
  $('#pair').classList.add('hidden');
  toast('Đã ghép với máy tính ✓');
  await startMain();
}
// Lấy khóa chung của quán (máy tính bọc riêng cho điện thoại này).
async function ensureOwnerKey(waitMs = 0) {
  const end = Date.now() + waitMs;
  for (;;) {
    const { data, error } = await sb.from('devices').select('wrapped_key, key_version, revoked').eq('id', P.deviceId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.revoked) { unpairLocal('Điện thoại này đã bị gỡ trên máy tính. Ghép lại nếu cần.'); throw new Error('revoked'); }
    if (data.wrapped_key) {
      const wk = await E.deriveWrapKey(P.keys.privateJwk, P.pcPubkey);
      const raw = await E.unwrapOwnerKey(data.wrapped_key, wk, E.aad.wrap(P.ownerId, P.deviceId, data.key_version));
      ownerKey = await E.importOwnerKey(raw);
      P.keyVersion = data.key_version; saveP();
      return true;
    }
    if (Date.now() > end) throw new Error('Máy tính chưa gửi khóa. Kiểm tra app trên máy tính đang mở và có mạng.');
    await new Promise(r => setTimeout(r, 1500));
  }
}
function unpairLocal(msg) {
  try { localStorage.removeItem(LS); } catch { /* bỏ qua */ }
  P = null; ownerKey = null;
  if (channel) sb.removeChannel(channel).catch(() => {});
  channel = null;
  showPair(msg);
}
// Mã QR trên máy tính là đường link: ...#pair=<base64url JSON {c, f}> (mở bằng camera điện thoại cũng được).
function parsePairText(t) {
  const s = String(t || '').trim();
  let jsonStr = null;
  const m = s.match(/#pair=([A-Za-z0-9_-]+)/);
  if (m) { try { jsonStr = atob(m[1].replace(/-/g, '+').replace(/_/g, '/')); jsonStr = decodeURIComponent(escape(jsonStr)); } catch { jsonStr = null; } }
  else if (s.startsWith('{')) jsonStr = s;
  if (!jsonStr) return null;
  try { const o = JSON.parse(jsonStr); return o.t === 'dangbai-pair' && o.c ? o : null; } catch { return null; }
}
$('#pair-go').addEventListener('click', async () => {
  const code = $('#pair-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) return ($('#pair-err').textContent = 'Mã gồm 8 ký tự (chữ và số) hiện trên máy tính.');
  try { await pairWith(code, null); } catch (e) { if (e.message !== 'revoked') { $('#pair-err').textContent = e.message; $('#pair-msg').textContent = ''; } }
});
let scanStream = null;
async function stopScan() { scanStream?.getTracks().forEach(t => t.stop()); scanStream = null; $('#pair-cam').classList.add('hidden'); }
$('#pair-scan').addEventListener('click', async () => {
  $('#pair-err').textContent = '';
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch { $('#pair-err').textContent = 'Không mở được camera. Cho phép camera, hoặc nhập mã 8 ký tự.'; return; }
  const v = $('#pair-video'); v.srcObject = scanStream; await v.play().catch(() => {});
  $('#pair-cam').classList.remove('hidden');
  const det = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (!scanStream) return;
    let text = null;
    try {
      if (det) { const r = await det.detect(v); text = r[0]?.rawValue || null; }
      else if (window.jsQR && v.videoWidth) {
        cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0);
        const img = cx.getImageData(0, 0, cv.width, cv.height);
        text = window.jsQR(img.data, img.width, img.height)?.data || null;
      }
    } catch { text = null; }
    const o = text && parsePairText(text);
    if (o) {
      await stopScan();
      try { await pairWith(o.c, o.f); } catch (e) { if (e.message !== 'revoked') { $('#pair-err').textContent = e.message; $('#pair-msg').textContent = ''; } }
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
});

// ============================================================================
// LỆNH: điện thoại → máy tính (mã hóa) và chờ kết quả
// ============================================================================
async function send(type, payload, onStep) {
  if (!ownerKey) throw new Error('Chưa có khóa mã hóa. Mở lại app.');
  const id = crypto.randomUUID();
  const box = await E.encrypt(ownerKey, payload || {}, E.aad.command(P.ownerId, id, type));
  const prom = new Promise((resolve, reject) => pending.set(id, { resolve, reject, onStep }));
  const { error } = await sb.from('commands').insert({ id, owner_id: P.ownerId, from_device: P.deviceId, type, v: CFG.protocol, payload: box });
  if (error) { pending.delete(id); throw new Error('Không gửi được lệnh: ' + error.message); }
  pollCommand(id);
  return prom;
}
async function settle(row) {
  const w = pending.get(row.id);
  if (!w || row.status === 'new' || row.status === 'running') return;
  pending.delete(row.id);
  let res = null;
  try { if (row.result) res = await E.decryptJSON(ownerKey, row.result, E.aad.result(P.ownerId, row.id)); } catch { res = null; }
  if (row.status === 'done') w.resolve(res);
  else w.reject(new Error(res?.error || { expired: 'Lệnh hết hạn (máy tính tắt quá lâu).', rejected: 'Máy tính từ chối lệnh.', error: 'Máy tính báo lỗi.' }[row.status] || row.status));
}
// Dự phòng khi Realtime chập chờn: hỏi lại trạng thái lệnh mỗi 2,5 giây.
async function pollCommand(id) {
  const end = Date.now() + 40 * 60000;
  while (pending.has(id) && Date.now() < end) {
    await new Promise(r => setTimeout(r, 2500));
    if (!pending.has(id)) return;
    const { data } = await sb.from('commands').select('id, status, result').eq('id', id).maybeSingle();
    if (data) await settle(data);
  }
}
async function onEvent(row) {
  let data = null;
  try { data = await E.decryptJSON(ownerKey, row.data, E.aad.event(P.ownerId, row.kind, row.ref)); } catch { return; }
  if (row.kind === 'step') pending.get(row.ref)?.onStep?.(data.text);
  else if (row.kind === 'snapshot') { snap = data; render(); }
  else if (row.kind === 'progress') { const n = document.querySelector(`[data-job-now="${CSS.escape(row.ref)}"]`); if (n) n.textContent = data.text; }
  else if (row.kind === 'done') { toast(data.status === 'waiting' ? `Xong: ${data.title || 'việc'} ✓` : `${data.title || 'Việc'}: ${data.status === 'quota' ? 'hết lượt Claude' : 'có lỗi'}`, 3500); }
}

// ============================================================================
// KẾT NỐI + DỮ LIỆU
// ============================================================================
async function startMain() {
  if (channel) await sb.removeChannel(channel).catch(() => {});
  channel = sb.channel(`phone-${P.deviceId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: `owner_id=eq.${P.ownerId}` }, p => onEvent(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'commands', filter: `owner_id=eq.${P.ownerId}` }, p => settle(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'devices', filter: `owner_id=eq.${P.ownerId}` }, p => {
      const d = p.new;
      if (d.id === P.pcDeviceId) { pcLastSeen = d.last_seen; drawPc(); }
      if (d.id === P.deviceId && (d.revoked || d.key_version !== P.keyVersion)) ensureOwnerKey(15000).then(() => toast('Đã nhận khóa mới từ máy tính.')).catch(() => {});
    })
    .subscribe();
  await refreshPc();
  await refresh();
}
async function refreshPc() {
  const { data } = await sb.from('devices').select('name, last_seen, revoked').eq('id', P.pcDeviceId).maybeSingle();
  pcLastSeen = data && !data.revoked ? data.last_seen : null;
  if (data?.name) P.pcName = data.name;
  drawPc();
}
const pcOnline = () => pcLastSeen && Date.now() - Date.parse(pcLastSeen) < 150000;
function drawPc() {
  const on = pcOnline();
  $('#pc').classList.toggle('off', !on);
  $('#pc-t').textContent = on ? 'Máy tính đang bật' : 'Máy tính đang tắt';
  $('#offbar').classList.toggle('hidden', !!on);
}
async function refresh() {
  try {
    const t0 = Date.now();
    snap = await send('snapshot.get', {});
    $('#h-upd').textContent = `cập nhật ${hm(Date.now())} · ${Date.now() - t0} ms`;
    render();
  } catch (e) { $('#h-upd').textContent = e.message.slice(0, 60); }
}
setInterval(() => { if (P && ownerKey && document.visibilityState === 'visible') { refreshPc(); } }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && P && ownerKey) { refreshPc(); refresh(); } });
// Kéo xuống ở đầu trang để làm mới.
let pullY = null;
$('#scroll').addEventListener('touchstart', e => { pullY = $('#scroll').scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
$('#scroll').addEventListener('touchend', e => { if (pullY !== null && e.changedTouches[0].clientY - pullY > 90 && P && ownerKey) { toast('Đang làm mới…', 1200); refreshPc(); refresh(); } pullY = null; });

function render() {
  if (!snap) return;
  if (page === 'home') { $('#title').textContent = greet(); $('#sub').textContent = snap.shop || ''; }
  const now = Date.now();
  const posts = snap.posts || [];
  $('#st-posts').textContent = posts.filter(p => p.posted && sameDay(p.scheduleAt || p.at, now)).length;
  $('#st-done').textContent = (snap.queue?.recent || []).filter(j => j.status === 'waiting' && sameDay(j.createdAt, now)).length;
  $('#st-run').textContent = (snap.queue?.active || []).length;
  const pend = posts.filter(p => !p.posted && Date.parse(p.scheduleAt || p.at) > now - 14 * 86400000).length;
  $('#st-pend').classList.toggle('hidden', !pend);
  $('#st-pend').textContent = `+${pend} bài chưa xác nhận đăng`;
  const next = posts.filter(p => p.scheduleAt && Date.parse(p.scheduleAt) > now).sort((a, b) => Date.parse(a.scheduleAt) - Date.parse(b.scheduleAt)).slice(0, 3);
  $('#h-next').innerHTML = next.length ? next.map(p => `<div class="li"><div class="mini g1"></div><div class="t"><b>${esc(p.title)}</b><small>${p.facebook ? 'FB + IG' : ''}${p.facebook && p.threads ? ', ' : ''}${p.threads ? 'Threads' : ''} · ${p.posted ? 'đã lên lịch' : 'mới điền sẵn'}</small></div><span class="time${p.posted ? '' : ' warn'}">${sameDay(p.scheduleAt, now) ? hm(p.scheduleAt) : new Date(p.scheduleAt).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span></div>`).join('')
    : '<div class="note">Chưa có bài hẹn giờ. Bấm nút + để chụp ảnh đăng bài.</div>';
  const nRun = (snap.queue?.active || []).length;
  $('#n-run').textContent = nRun; $('#n-run').classList.toggle('hidden', !nRun);
  const week = posts.filter(p => p.scheduleAt && Date.parse(p.scheduleAt) > now && Date.parse(p.scheduleAt) < now + 7 * 86400000).length;
  $('#n-lich').textContent = week; $('#n-lich').classList.toggle('hidden', !week);
  drawRun();
  if (page === 'lich') drawLich();
}

// ---------------- Đang chạy ----------------
const KIND = { video: 'Edit video', hook: 'Học hot', audit: 'Khám kênh', ads: 'Quảng cáo' };
function drawRun() {
  const a = snap?.queue?.active || [], r = snap?.queue?.recent || [];
  $('#run-active').innerHTML = a.length ? a.map((j, i) => `<div class="job${j.status === 'running' ? ' run' : ''}">
    <div class="ld">${j.status === 'running' ? '<svg class="ldsvg spin" viewBox="0 0 24 24"><circle class="trk" cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/></svg>' : '<svg class="ldsvg dots3" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.2" stroke="none"/><circle cx="12" cy="12" r="2.2" stroke="none"/><circle cx="19" cy="12" r="2.2" stroke="none"/></svg>'}</div>
    <div class="t"><b>${esc(KIND[j.kind] || 'Việc')} · ${esc(j.title)}</b><small data-job-now="${esc(j.id)}">${j.status === 'running' ? 'Đang làm…' : `Chờ tới lượt (thứ ${i + 1})`}</small>${j.status === 'running' ? '<div class="bar"><div style="width:55%"></div></div>' : ''}</div>
    <div class="acts"><button class="btn sm ghost" data-stop="${esc(j.kind)}|${esc(j.id)}">${j.status === 'running' ? 'Dừng' : 'Bỏ'}</button></div></div>`).join('')
    : '<div class="big-empty">Máy tính đang rảnh.<br>Bấm + để chụp ảnh đăng bài, hoặc nhờ app làm việc khác.</div>';
  $('#run-recent').innerHTML = r.length ? r.slice(0, 6).map(j => `<div class="job${j.status === 'waiting' ? ' done' : ''}"><div class="ld">${j.status === 'waiting' ? '<svg class="ic"><use href="#i-check"/></svg>' : '<svg class="ic"><use href="#i-x"/></svg>'}</div><div class="t"><b>${esc(KIND[j.kind] || 'Việc')} · ${esc(j.title)}</b><small>${hm(j.createdAt)} · ${j.status === 'waiting' ? 'xong' : 'lỗi / dừng'}</small></div></div>`).join('')
    : '<div class="note" style="padding:0 4px">Chưa có việc nào xong trong 24 giờ.</div>';
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-stop]'); if (!b) return;
  const [kind, id] = b.dataset.stop.split('|');
  if (!await ask('Dừng / bỏ việc này?', '', { ok: 'Dừng' })) return;
  try { await send('job.stop', { kind, id }); toast('Đã dừng.'); refresh(); } catch (err) { toast(err.message); }
});

// ---------------- Lịch ----------------
let selDay = 0;
function weekDays() {
  const m = new Date(); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(m); d.setDate(m.getDate() + i); return d; });
}
function drawLich(dir = 0) {
  const days = weekDays(), posts = snap?.posts || [], today = new Date();
  if (!drawLich.init) { selDay = days.findIndex(d => sameDay(d, today)); drawLich.init = true; }
  const DN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  $('#days').innerHTML = days.map((d, i) => {
    const ev = posts.filter(p => sameDay(p.scheduleAt || p.at, d));
    return `<button class="dy${i === selDay ? ' on' : ''}${sameDay(d, today) ? ' today' : ''}" data-day="${i}"><small>${DN[d.getDay()]}</small><b>${d.getDate()}</b><span class="dots">${ev.slice(0, 4).map(e => `<i class="${e.posted ? '' : 'w'}"></i>`).join('')}</span></button>`;
  }).join('');
  const d = days[selDay], list = posts.filter(p => sameDay(p.scheduleAt || p.at, d)).sort((a, b) => Date.parse(a.scheduleAt || a.at) - Date.parse(b.scheduleAt || b.at));
  const box = $('#day-list');
  box.innerHTML = list.length ? list.map(p => `<div class="ev${p.posted ? '' : ' pending'}" data-post="${esc(p.id)}"><div class="mini g1"></div><div class="t"><b>${esc(p.title)}</b><small>${hm(p.scheduleAt || p.at)} · ${p.facebook ? 'FB + IG' : ''}${p.facebook && p.threads ? ', ' : ''}${p.threads ? 'Threads' : ''}</small></div><span class="badge ${p.posted ? 'ok' : 'warn'}">${p.posted ? (p.scheduleAt && Date.parse(p.scheduleAt) > Date.now() ? 'Đã lên lịch' : 'Đã đăng') : 'Mới điền sẵn'}</span></div>`).join('')
    : `<div class="empty">Chưa có bài nào ngày ${d.getDate()}/${d.getMonth() + 1}.<br><br><button class="btn sm blue" data-pick="cam"><svg class="ic sm"><use href="#i-cam"/></svg>Chụp ảnh đăng bài</button></div>`;
  [...box.children].forEach((n, i) => n.animate([{ opacity: 0, transform: `translateX(${(dir || 1) * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 320, delay: i * 50, easing: EASE, fill: 'backwards' }));
}
$('#days').addEventListener('click', e => { const b = e.target.closest('.dy'); if (!b) return; const n = +b.dataset.day; const dir = Math.sign(n - selDay); selDay = n; drawLich(dir); });
$('#day-list').addEventListener('click', async e => {
  const ev = e.target.closest('.ev.pending'); if (!ev) return;
  const p = (snap?.posts || []).find(x => x.id === ev.dataset.post);
  if (!await ask('Bạn đã bấm "Đăng" cho bài này chưa?', p?.title || '', { ok: 'Đã đăng', cancel: 'Chưa' })) return;
  try { await send('post.markPosted', { id: ev.dataset.post, posted: true }); toast('Đã ghi nhận bài đã đăng ✓'); await refresh(); } catch (err) { toast(err.message); }
});

// ---------------- Thêm ----------------
function drawMore() {
  $('#m-pc').textContent = P?.pcName || 'Máy tính của quán';
  $('#m-pc-sub').textContent = `${pcOnline() ? 'Hoạt động ' + hm(pcLastSeen) : 'Đang tắt'} · dấu vân tay ${(P?.fp || '').replace(/(.{4})(?=.)/g, '$1 ')}`;
  $('#m-pc-badge').textContent = pcOnline() ? 'Đang bật' : 'Đang tắt';
  $('#m-pc-badge').className = 'badge ' + (pcOnline() ? 'ok' : 'warn');
  $('#m-ver').textContent = `App điện thoại ${APP_VERSION}${snap?.app ? ' · máy tính ' + snap.app : ''}`;
}
$('#m-unpair').addEventListener('click', async () => {
  if (!await ask('Gỡ ghép điện thoại này?', 'Muốn dùng lại thì quét mã QR trên máy tính lần nữa.', { ok: 'Gỡ ghép' })) return;
  await sb.auth.signOut().catch(() => {});
  unpairLocal('');
});
$('#pc').addEventListener('click', () => go('more'));

// ============================================================================
// TẠO BÀI: chụp ảnh → máy tính viết caption → điền → xem ảnh chụp → đăng
// ============================================================================
const T = { files: [], draftId: null, historyId: null, tab: 'facebook', platforms: { facebook: true, threads: true } };
const tShow = id => ['t-form', 't-wait', 't-prev', 't-check'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id));
function addFiles(list) {
  for (const f of [...list]) {
    if (T.files.length >= MAX_FILES) { toast(`Tối đa ${MAX_FILES} ảnh/clip mỗi bài.`); break; }
    const kind = f.type.startsWith('video/') ? 'video' : 'image';
    if (kind === 'video' && f.size > MAX_VIDEO_MB * 1048576) { toast(`Clip lớn hơn ${MAX_VIDEO_MB} MB, chưa gửi qua điện thoại được.`); continue; }
    T.files.push({ file: f, kind, url: URL.createObjectURL(f), name: f.name || (kind === 'video' ? 'clip.mp4' : 'anh.jpg') });
  }
  drawPhotos(); tShow('t-form');
  if (page !== 'tao') go('tao');
}
['#f-cam', '#f-lib'].forEach(s => $(s).addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; }));
function drawPhotos() {
  $('#t-photos').innerHTML = T.files.map((f, i) => `<div class="ph${i === 0 ? ' cover' : ''}" data-i="${i}">${f.kind === 'video' ? `<video src="${f.url}" muted playsinline></video>` : `<img src="${f.url}" alt="">`}<button class="x" data-rm="${i}"><svg class="ic sm"><use href="#i-x"/></svg></button>${i === 0 ? '<span class="star">★ Bìa</span>' : ''}</div>`).join('')
    + (T.files.length < MAX_FILES ? '<button class="add" data-pick="lib"><svg class="ic lg"><use href="#i-plus"/></svg></button>' : '');
  $('#t-hint').textContent = T.files.length ? `${T.files.length}/${MAX_FILES} · chạm ảnh để làm bìa` : `tối đa ${MAX_FILES}`;
}
$('#t-photos').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { const [f] = T.files.splice(+rm.dataset.rm, 1); URL.revokeObjectURL(f.url); return drawPhotos(); }
  const ph = e.target.closest('.ph');
  if (ph && +ph.dataset.i > 0) { T.files.unshift(...T.files.splice(+ph.dataset.i, 1)); drawPhotos(); }
});
$$('.tk[data-pf]').forEach(t => t.addEventListener('click', () => { t.classList.toggle('on'); T.platforms[t.dataset.pf] = t.classList.contains('on'); }));

// Hiện các bước "máy tính đang làm"
const SPIN = '<svg class="ldsvg spin" viewBox="0 0 24 24" style="width:16px;height:16px"><circle class="trk" cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/></svg>';
function live(title) {
  $('#t-wait-title').textContent = title; $('#t-live').innerHTML = ''; tShow('t-wait'); pop($('#t-wait'));
  const add = text => {
    $$('#t-live .sl.now').forEach(n => { n.className = 'sl done'; n.querySelector('i').innerHTML = '<svg class="ic sm"><use href="#i-check"/></svg>'; });
    $('#t-live').insertAdjacentHTML('beforeend', `<div class="sl now"><i>${SPIN}</i>${esc(text)}</div>`);
  };
  return { add, done: () => add('Xong') };
}
// Thu nhỏ ảnh trên điện thoại (cạnh dài 2048 px, JPEG) cho gửi nhanh.
async function shrink(f) {
  if (f.kind !== 'image') return { blob: f.file, name: f.name };
  try {
    const bmp = await createImageBitmap(f.file);
    const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
    return { blob, name: f.name.replace(/\.\w+$/, '') + '.jpg' };
  } catch { return { blob: f.file, name: f.name }; }
}
async function uploadAll(L) {
  const folder = `${P.ownerId}/${crypto.randomUUID()}`, paths = [], names = [];
  for (let i = 0; i < T.files.length; i++) {
    L.add(`Gửi ảnh/clip lên (${i + 1}/${T.files.length})…`);
    const { blob, name } = await shrink(T.files[i]);
    const p = `${folder}/${i + 1}${(name.match(/\.\w+$/) || ['.jpg'])[0].toLowerCase()}`;
    const box = await E.encrypt(ownerKey, new Uint8Array(await blob.arrayBuffer()), E.aad.file(P.ownerId, p));
    const { error } = await sb.storage.from(CFG.bucket).upload(p, new Blob([box], { type: 'text/plain' }));
    if (error) throw new Error('Không gửi được ảnh: ' + error.message);
    paths.push(p); names.push(name);
  }
  return { paths, names };
}
function suggestedTime() {
  const now = Date.now() + 20 * 60000;
  for (let day = 0; day < 3; day++) for (const [h, m] of [[11, 30], [19, 30]]) {
    const d = new Date(); d.setDate(d.getDate() + day); d.setHours(h, m, 0, 0);
    if (d.getTime() > now) return d;
  }
  return null;
}
const toLocalInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
async function compose() {
  const note = $('#t-note').value.trim();
  if (!T.files.length && !note) return toast('Chụp / chọn ảnh hoặc gõ vài chữ trước.');
  if (!pcOnline() && !await ask('Máy tính đang tắt', 'Lệnh sẽ được giữ lại, máy bật lên mới làm. Vẫn gửi?', { ok: 'Vẫn gửi' })) return;
  const L = live('Máy tính đang làm');
  try {
    const { paths, names } = await uploadAll(L);
    L.add('Đã gửi. Chờ máy tính nhận…');
    const r = await send('post.compose', { files: paths, names, note }, text => L.add(text));
    T.draftId = r.draftId;
    $('#cap-facebook').value = r.captions.facebook || ''; $('#cap-threads').value = r.captions.threads || '';
    const t = suggestedTime(); $('#t-at').value = t ? toLocalInput(t) : '';
    drawPreview(); tShow('t-prev'); pop($('#t-prev'));
    toast('Caption đã xong ✓');
  } catch (e) { tShow('t-form'); toast(e.message, 4500); }
}
$('#t-make').addEventListener('click', compose);
$('#t-redo').addEventListener('click', compose);
function drawPreview() {
  $('#t-shop').textContent = snap?.shop || 'Trang của bạn';
  const v = $('#t-at').value; $('#t-when').textContent = v ? `Hẹn đăng ${hm(v)} ${new Date(v).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}` : 'Đăng ngay';
  const th = T.tab === 'threads';
  $('#cap-facebook').classList.toggle('hidden', th); $('#cap-threads').classList.toggle('hidden', !th);
  const n = [...$('#cap-' + T.tab).value].length;
  $('#t-count').textContent = `${n}/${LIMITS[T.tab]} ký tự`; $('#t-count').classList.toggle('over', n > LIMITS[T.tab]);
  const imgs = th ? [] : T.files.slice(0, 3);
  $('#t-imgs').className = 'imgs'; $('#t-imgs').style.display = imgs.length ? '' : 'none';
  $('#t-imgs').innerHTML = imgs.map(f => f.kind === 'video' ? `<video src="${f.url}" muted playsinline style="width:100%;height:100%;object-fit:cover"></video>` : `<div style="background:url('${f.url}') center/cover"></div>`).join('');
}
$('#t-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; T.tab = b.dataset.p; $$('#t-tabs button').forEach(x => x.classList.toggle('on', x === b)); drawPreview(); });
['#cap-facebook', '#cap-threads', '#t-at'].forEach(s => $(s).addEventListener('input', drawPreview));
$('#t-now').addEventListener('click', () => { $('#t-at').value = ''; drawPreview(); });

async function decryptShot(p) {
  const { data, error } = await sb.storage.from(CFG.bucket).download(p);
  if (error) return null;
  const bytes = await E.decryptBytes(ownerKey, await data.text(), E.aad.file(P.ownerId, p));
  sb.storage.from(CFG.bucket).remove([p]).catch(() => {});
  return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
}
$('#t-fill').addEventListener('click', async () => {
  const caps = { facebook: $('#cap-facebook').value.trim(), threads: $('#cap-threads').value.trim() };
  if (!T.platforms.facebook && !T.platforms.threads) return toast('Chọn ít nhất 1 nơi đăng.');
  for (const pf of ['facebook', 'threads']) if (T.platforms[pf] && [...caps[pf]].length > LIMITS[pf]) return toast(`Caption ${pf === 'facebook' ? 'Facebook' : 'Threads'} quá dài.`);
  const v = $('#t-at').value;
  if (v && new Date(v) < new Date()) return toast('Giờ đăng đã qua. Chọn lại hoặc bấm "Đăng ngay".');
  const L = live('Máy tính đang điền bài');
  try {
    const r = await send('post.fill', { draftId: T.draftId, captions: caps, platforms: T.platforms, scheduleAt: v ? new Date(v).toISOString() : null, cropIG: true }, text => L.add(text));
    T.historyId = r.historyId;
    $('#t-steps').innerHTML = (r.steps || []).map(s => `<div class="${s.ok ? '' : 'bad'}">${s.ok ? '✓' : '✗'} ${esc(s.where)}: ${esc(s.name)}${s.error ? ' — ' + esc(s.error) : ''}</div>`).join('');
    const url = r.shot ? await decryptShot(r.shot) : null;
    $('#t-shot').classList.toggle('hidden', !url); if (url) $('#t-shot').src = url;
    const fbOnly = T.platforms.facebook;
    $('#t-publish').classList.toggle('hidden', !fbOnly);
    $('#t-check-title').textContent = 'Máy tính đã điền xong';
    $('#t-check-note').textContent = fbOnly ? (v ? `Kiểm tra ảnh chụp. Bấm Đăng: máy tính sẽ bấm "Lên lịch" (${hm(v)}).` : 'Kiểm tra ảnh chụp. Bấm Đăng: máy tính sẽ bấm "Đăng" trong Business Suite.') + (T.platforms.threads ? ' Threads đã điền sẵn, cần bấm Đăng trên máy tính.' : '')
      : 'Threads đã điền sẵn trên máy tính, bấm "Đăng" ở đó.';
    tShow('t-check'); pop($('#t-check'));
  } catch (e) { tShow('t-prev'); toast(e.message, 4500); }
});
$('#t-publish').addEventListener('click', async () => {
  if (!await ask('Đăng bài này?', 'Máy tính sẽ bấm nút "Lên lịch" / "Đăng" trong Business Suite.', { ok: 'Đăng' })) return;
  const L = live('Máy tính đang đăng');
  L.add('Bấm nút trong Business Suite…');
  try {
    const r = await send('post.publish', { historyId: T.historyId });
    const url = r.shot ? await decryptShot(r.shot) : null;
    $('#t-shot').classList.toggle('hidden', !url); if (url) $('#t-shot').src = url;
    $('#t-steps').innerHTML = `<div>✓ Máy tính đã bấm "${esc(r.clicked)}"</div>`;
    $('#t-check-title').textContent = 'Đã đăng / lên lịch ✓';
    $('#t-check-note').textContent = 'Ảnh chụp sau khi bấm. Bài đã được ghi "đã đăng" trong Lịch.';
    $('#t-publish').classList.add('hidden');
    tShow('t-check'); pop($('#t-check'));
    toast('Đã đăng ✓'); refresh();
  } catch (e) { tShow('t-check'); toast(e.message, 5000); }
});
$('#t-new').addEventListener('click', () => {
  T.files.forEach(f => URL.revokeObjectURL(f.url));
  Object.assign(T, { files: [], draftId: null, historyId: null });
  $('#t-note').value = ''; $('#t-publish').classList.remove('hidden');
  drawPhotos(); tShow('t-form');
});

// ---------------- Nhờ app làm gì ----------------
$('#cmd').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('#cmd-in').value.trim(); if (!text) return;
  const out = $('#cmd-out');
  out.innerHTML = '<div class="note" style="padding:8px 4px">Claude đang đọc yêu cầu (10–60 giây)…</div>';
  try {
    const r = await send('command.run', { text });
    const acts = r.actions || [];
    const NAME = { edit: 'Edit video', post: 'Soạn bài', hoc: 'Học từ video hot', kham: 'Khám kênh', qc: 'Quảng cáo' };
    out.innerHTML = `<div class="card" style="margin-top:8px"><div>${esc(r.reply || 'Đây là các việc app sẽ làm:')}</div>${acts.length ? `<ul class="plan">${acts.map(a => `<li>${esc(NAME[a.type] || a.type)}${a.note || a.links || a.url || a.request ? ': ' + esc(a.note || a.links || a.url || a.request) : ''}</li>`).join('')}</ul><button class="btn acc block" id="cmd-ok">Làm ${acts.length} việc</button>` : ''}</div>`;
    $('#cmd-ok')?.addEventListener('click', async () => {
      try {
        const x = await send('command.exec', { actions: acts });
        openSheet(false); out.innerHTML = ''; $('#cmd-in').value = '';
        if (x.created.length) toast(`Đã giao ${x.created.length} việc cho máy tính ✓`);
        if (x.errors.length) toast(x.errors[0], 4000);
        if (x.posts.length) { $('#t-note').value = x.posts[0].note || ''; go('tao'); toast('Chụp / chọn ảnh rồi bấm "Làm cho tôi".', 3500); } else { go('run'); refresh(); }
      } catch (err) { toast(err.message); }
    });
  } catch (err) { out.innerHTML = `<div class="err" style="padding:8px 4px">${esc(err.message)}</div>`; }
});

// ============================================================================
// KHỞI ĐỘNG
// ============================================================================
addEventListener('resize', moveInd);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
(async () => {
  requestAnimationFrame(moveInd);
  drawPhotos();
  const fromLink = parsePairText(location.hash);
  if (fromLink) history.replaceState(null, '', location.pathname);
  if (fromLink && !P) {
    showPair();
    try { await pairWith(fromLink.c, fromLink.f); } catch (e) { if (e.message !== 'revoked') { $('#pair-err').textContent = e.message; $('#pair-msg').textContent = ''; } }
    return;
  }
  if (!P) return showPair();
  try {
    await session();
    await ensureOwnerKey(P.keyVersion ? 0 : 20000);
    await startMain();
  } catch (e) {
    if (e.message !== 'revoked') { toast(e.message, 5000); setTimeout(() => location.reload(), 15000); }
  }
})();
