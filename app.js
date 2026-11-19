import { PLACES_URL, CREW, NICHES, AREAS_IL, LAYOUTS, PRIVACY, EXCLUDED } from './config.js';

/* ============================ state ============================ */
const S = {
  places: {},
  view: 'list',        // list | map
  niche: 'all',        // all | crew | family | kids | adults
  region: 'all',       // all | il | world
  area: 'all',
  fams: 0,             // 0 = הכל, אחרת מינימום משפחות
  priv: 'all',         // all | exclusive+isolated
  open: null,
  map: null, layer: null, mapReady: false,
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ============================ utils ============================ */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nz = (v) => v !== undefined && v !== null && v !== '';
const arr = (v) => Array.isArray(v) ? v.filter(x => nz(x)) : [];

const CUR = { ILS: '₪', EUR: '€', USD: '$' };
const money = (n, c = 'ILS') =>
  (!nz(n) || isNaN(n)) ? '' : (CUR[c] || '') + Math.round(n).toLocaleString('he-IL');

const nicheOf = (id) => NICHES.find(n => n.id === id) || { label: id, icon: '•', short: id };
const layoutOf = (id) => (LAYOUTS.find(l => l.id === id) || {}).label || '';
const privOf = (id) => (PRIVACY.find(p => p.id === id) || {});

const famLabel = (n) => {
  if (!nz(n)) return 'לא ידוע';
  if (n >= CREW.families) return `${CREW.families} משפחות ומעלה`;
  if (n === 1) return 'משפחה אחת';
  return `עד ${n} משפחות`;
};
const famShort = (n) => !nz(n) ? '?' : (n >= CREW.families ? `${CREW.families}+` : String(n));

const dur = (min) => {
  if (!nz(min) || isNaN(min)) return '';
  const m = Math.round(+min), h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} דק׳`;
  if (!r) return `${h} שע׳`;
  return `${h}:${String(r).padStart(2, '0')} שע׳`;
};

const stars = (n, dark) => {
  const v = Math.round((+n || 0) * 2) / 2;
  let h = `<span class="stars${dark ? ' dark' : ''}">`;
  for (let i = 1; i <= 5; i++) h += i <= v ? '★' : '<span class="off">★</span>';
  return h + '</span>';
};

/* ---- מי אני, והציון של החבורה ----
   כל משפחה בחבורה נותנת ציון משלה. ׳הציון שלנו׳ הוא הממוצע. */
const WHO_KEY = 'vac_who';
const who = () => { try { return localStorage.getItem(WHO_KEY) || ''; } catch (e) { return ''; } };
const setWho = (v) => { try { localStorage.setItem(WHO_KEY, v); } catch (e) {} };

const votesOf = (p) => {
  const v = (p && p.votes) || {};
  return Object.entries(v).filter(([, n]) => +n > 0);
};
const crewScore = (p) => {
  const v = votesOf(p);
  if (!v.length) return null;
  return v.reduce((s, [, n]) => s + (+n), 0) / v.length;
};

async function askWho() {
  const cur = who();
  const v = prompt('מי נותן את הציון? (שם המשפחה או השם הפרטי)', cur || '');
  if (v === null) return cur;
  const t = v.trim();
  if (t) setWho(t);
  return t || cur;
}

const cover = (p) => {
  const ph = arr(p.photos);
  if (!ph.length) return '';
  return ph[Math.min(Math.max(+p.coverIndex || 0, 0), ph.length - 1)];
};

const mapsUrl = (p) => {
  if (p.mapUrl) return p.mapUrl;
  if (nz(p.lat) && nz(p.lng)) return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  const q = [p.name, p.address, p.area, p.country].filter(nz).join(' ');
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : '';
};

const toast = (msg) => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2400);
};

/* ---- יחידות: פירוק לרשימה שטוחה, הגדולות קודם ---- */
function flatUnits(cap) {
  const out = [];
  arr(cap.units).forEach(u => {
    const c = Math.max(1, +u.count || 1);
    for (let i = 0; i < c; i++) out.push({
      name: u.name || 'יחידה',
      sleeps: +u.sleeps || 0,
      bedrooms: +u.bedrooms || 0,
      bathrooms: +u.bathrooms || 0,
    });
  });
  return out.sort((a, b) => (b.sleeps - a.sleeps) || (b.bedrooms - a.bedrooms));
}

/* ---- האם המקום מתאים ל-n משפחות מהחבורה ----
   הדרישות של יעל: לכל משפחה אזור משלה, לפחות שירותים אחד לכל משפחה,
   ו-2–3 חדרים ומספיק מיטות לכל משפחה. */
function fitFor(p, n) {
  const cap = p.capacity || {};
  const units = flatUnits(cap);
  const need = CREW.peopleFor(n);           // התרחיש התובעני: המשפחות הגדולות נוסעות
  const fails = [];

  // וילה אחת: אין ׳יחידה למשפחה׳, אלא חדרים ושירותים משותפים בתוך בית אחד.
  if (p.layout === 'villa') {
    const beds = units.reduce((s, u) => s + u.sleeps, 0);
    const rooms = units.reduce((s, u) => s + (u.bedrooms || 1) * 1, 0);
    const baths = +cap.bathroomsTotal || 0;
    if (rooms && rooms < n) fails.push(`${rooms} חדרי שינה מול ${n} משפחות`);
    if (beds && beds < need) fails.push(`${beds} מיטות מול ${need} נפשות`);
    if (baths && baths < n) fails.push(`${baths} חדרי רחצה מול ${n} משפחות`);
    const unknown = !units.length || !beds;
    return { ok: !fails.length && !unknown, unknown, fails, units: rooms, beds, baths, need, villa: true };
  }

  const pick = units.slice(0, n);
  const beds = pick.reduce((s, u) => s + u.sleeps, 0);
  const baths = nz(cap.bathroomsTotal)
    ? +cap.bathroomsTotal
    : pick.reduce((s, u) => s + (u.bathrooms || 0), 0);
  const rooms = pick.every(u => !u.bedrooms || u.bedrooms >= 2);

  if (units.length < n) fails.push(`יש ${units.length} יחידות בלבד`);
  if (beds && beds < need) fails.push(`${beds} מיטות מול ${need} נפשות`);
  if (baths && baths < n) fails.push(`${baths} שירותים מול ${n} משפחות`);
  if (!rooms) fails.push('יש יחידה עם חדר שינה אחד');

  const unknown = !units.length || !beds;
  return { ok: !fails.length && !unknown, unknown, fails, units: units.length, beds, baths, need };
}

/* ============================ data ============================ */
async function load() {
  try {
    const r = await fetch(PLACES_URL() + '?t=' + Date.now());
    if (!r.ok) throw new Error('HTTP ' + r.status);
    S.places = (await r.json()) || {};
  } catch (e) {
    $('#list').innerHTML =
      `<div class="empty"><h3>לא הצלחתי לטעון את המאגר</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  render();
}

async function save(key, place) {
  const body = { ...place, updatedAt: Date.now() };
  if (!body.createdAt) body.createdAt = Date.now();
  const r = await fetch(PLACES_URL(key), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('שמירה נכשלה (' + r.status + ')');
  S.places[key] = body;
  return body;
}

async function remove(key) {
  const r = await fetch(PLACES_URL(key), { method: 'DELETE' });
  if (!r.ok) throw new Error('מחיקה נכשלה (' + r.status + ')');
  delete S.places[key];
}

/* הצבעה של משפחה אחת. PATCH על ענף ה-votes בלבד, כדי ששתי משפחות
   שמדרגות באותו רגע לא ידרסו אחת את השנייה. */
async function voteFor(key, name, value) {
  const url = `${PLACES_URL(key).replace(/\.json$/, '')}/votes.json`;
  const r = await fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [name]: value }),
  });
  if (!r.ok) throw new Error('שמירת הציון נכשלה (' + r.status + ')');
  S.places[key] = S.places[key] || {};
  S.places[key].votes = { ...(S.places[key].votes || {}), [name]: value };
}

const newKey = () => 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ============================ filtering ============================ */
function visible() {
  return Object.entries(S.places)
    .filter(([, p]) => p && typeof p === 'object' && p.name)
    .filter(([, p]) => S.niche === 'all' || arr(p.niches).includes(S.niche))
    .filter(([, p]) => S.region === 'all' || (p.region || 'il') === S.region)
    .filter(([, p]) => S.area === 'all' || p.area === S.area)
    .filter(([, p]) => !S.fams || (+((p.capacity || {}).maxFamilies) || 0) >= S.fams)
    .filter(([, p]) => S.priv === 'all' || ['exclusive', 'isolated'].includes(p.privacy))
    .sort((a, b) => {
      // קודם מה שדירגנו, אחר כך רשומות מלאות, ורק בסוף מה שהמחקר עליו חלקי
      const ra = crewScore(a[1]) || 0, rb = crewScore(b[1]) || 0;
      if (rb !== ra) return rb - ra;
      const da = a[1].status === 'draft' ? 1 : 0, db = b[1].status === 'draft' ? 1 : 0;
      if (da !== db) return da - db;
      return (b[1].createdAt || 0) - (a[1].createdAt || 0);
    });
}

/* ============================ render ============================ */
function render() {
  const v = visible();
  const total = Object.values(S.places).filter(p => p && p.name).length;
  $('#count').textContent = total ? `${v.length} מתוך ${total} מקומות במאגר` : 'המאגר עדיין ריק';
  $('#list').classList.toggle('hidden', S.view !== 'list');
  $('#mapwrap').classList.toggle('hidden', S.view !== 'map');
  buildAreaChips();
  if (S.view === 'list') renderList(v); else renderMap(v);
}

function renderList(v) {
  if (!v.length) {
    $('#list').innerHTML = `<div class="empty">
      <h3>אין כאן מקומות</h3>
      <p>${Object.keys(S.places).length ? 'נסי לשחרר את הסינון למעלה.' : 'אפשר להוסיף מקום ראשון עם הכפתור ‎+‎ בפינה.'}</p>
    </div>`;
    return;
  }
  $('#list').innerHTML = '<div class="grid">' + v.map(([k, p]) => card(k, p)).join('') + '</div>';
  $$('#list .card').forEach(el => el.onclick = () => openDetail(el.dataset.k));
}

function card(k, p) {
  const img = cover(p);
  const reg = p.region === 'world' ? 'world' : 'il';
  const loc = [p.area, reg === 'world' ? p.country : null].filter(nz).join(' · ');
  const cap = p.capacity || {};
  const ours = crewScore(p);
  const pr = p.pricePerNight || {};
  const nic = arr(p.niches).map(n => nicheOf(n).icon).join('');
  return `<article class="card" data-k="${esc(k)}">
    <div class="card-img">
      ${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy"
          onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'noimg',textContent:'התמונה לא נטענה'}))">`
            : `<div class="noimg">אין תמונה עדיין</div>`}
      <div class="card-shade"></div>
      <div class="card-top">
        <span class="badge ${reg}">${reg === 'il' ? 'הארץ' : 'העולם'}</span>
        ${nic ? `<span class="badge ghost">${nic}</span>` : ''}
        ${p.status === 'draft' ? '<span class="badge draft">חסר מידע</span>' : ''}
      </div>
      <div class="card-bot">
        <div class="card-name">${esc(p.name)}</div>
        ${loc ? `<div class="card-loc">${esc(loc)}${p.layout ? ' · ' + esc(layoutOf(p.layout)) : ''}</div>` : ''}
        <div class="card-meta">
          <span class="badge fam">👨‍👩‍👧‍👦 ${esc(famShort(cap.maxFamilies))}</span>
          ${nz(ours) ? stars(ours) : '<span class="badge ghost">בלי ציון</span>'}
          ${nz(pr.amount) ? `<span class="badge ghost">${esc(money(pr.amount, pr.currency))} / לילה</span>` : ''}
          ${p.privacy === 'exclusive' ? '<span class="badge ghost">🔒 כל המתחם שלנו</span>'
            : (p.privacy === 'isolated' ? '<span class="badge ghost">🌵 מבודד</span>' : '')}
        </div>
      </div>
    </div>
  </article>`;
}

function renderMap(v) {
  if (!S.mapReady) {
    S.map = L.map('map', { scrollWheelZoom: true }).setView([31.5, 35], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.map);
    S.layer = L.layerGroup().addTo(S.map);
    S.mapReady = true;
  }
  S.layer.clearLayers();
  const pts = [];
  v.forEach(([k, p]) => {
    if (!nz(p.lat) || !nz(p.lng)) return;
    const reg = p.region === 'world' ? 'world' : 'il';
    const icon = L.divIcon({
      className: '', iconSize: [34, 34], iconAnchor: [17, 32], popupAnchor: [0, -30],
      html: `<div class="pin ${reg}"><span>${esc(famShort((p.capacity || {}).maxFamilies))}</span></div>`,
    });
    const img = cover(p);
    const loc = [p.area, reg === 'world' ? p.country : null].filter(nz).join(' · ');
    L.marker([+p.lat, +p.lng], { icon }).addTo(S.layer).bindPopup(`<div class="pop">
      ${img ? `<img src="${esc(img)}" alt="">` : ''}
      <div class="pop-b">
        <div class="pop-n">${esc(p.name)}</div>
        ${loc ? `<div class="pop-l">${esc(loc)}</div>` : ''}
        <div class="pop-m">
          <span class="tag">👨‍👩‍👧‍👦 ${esc(famShort((p.capacity || {}).maxFamilies))}</span>
          ${nz(crewScore(p)) ? stars(crewScore(p), true) : ''}
        </div>
        <a class="pop-go" href="#" data-k="${esc(k)}">לפרטים המלאים</a>
      </div></div>`);
    pts.push([+p.lat, +p.lng]);
  });

  setTimeout(() => {
    S.map.invalidateSize();
    if (pts.length === 1) S.map.setView(pts[0], 11);
    else if (pts.length > 1) S.map.fitBounds(L.latLngBounds(pts).pad(.25));
  }, 60);

  S.map.off('popupopen').on('popupopen', (e) => {
    const a = e.popup.getElement().querySelector('a[data-k]');
    if (a) a.onclick = (ev) => { ev.preventDefault(); S.map.closePopup(); openDetail(a.dataset.k); };
  });

  const missing = v.filter(([, p]) => !nz(p.lat) || !nz(p.lng)).length;
  $('#mapnote').textContent = missing
    ? `${missing} מקומות עדיין בלי נקודה על המפה — צריך להוסיף להם קו אורך ורוחב בעריכה.` : '';
}

/* ============================ sheet ============================ */
function openSheet(title, bodyHtml, footHtml) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = bodyHtml;
  $('#sheet-foot').innerHTML = footHtml || '';
  $('#sheet-foot').classList.toggle('hidden', !footHtml);
  $('#sheet').classList.add('on');
  $('#sheet-bg').classList.add('on');
  $('#sheet-body').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').classList.remove('on');
  $('#sheet-bg').classList.remove('on');
  document.body.style.overflow = '';
  S.open = null;
}

/* ============================ detail ============================ */
function openDetail(k) {
  const p = S.places[k]; if (!p) return;
  S.open = k;
  openSheet(p.name, detailHtml(k, p),
    `<button class="btn" onclick="VAC.closeSheet()">סגירה</button>
     <button class="btn go" onclick="VAC.edit('${esc(k)}')">עריכה</button>`);
  wireDetail(k, p);
}

function detailHtml(k, p) {
  const ph = arr(p.photos);
  const cv = Math.min(Math.max(+p.coverIndex || 0, 0), Math.max(ph.length - 1, 0));
  const cap = p.capacity || {}, rec = p.rec || {}, pr = p.pricePerNight || {};
  const tr = p.travel || {}, rt = p.rating || {}, ru = p.rules || {}, ct = p.contact || {};
  const att = p.attractions || {};
  const isW = p.region === 'world';
  let h = '';

  /* תמונות */
  h += `<div class="hero">`;
  if (ph.length) {
    h += `<div class="hero-scroll" id="hs">` +
      ph.map((u, i) => `<figure><img src="${esc(u)}" alt="" loading="${i ? 'lazy' : 'eager'}"></figure>`).join('') + `</div>`;
    if (ph.length > 1) h += `<div class="hero-dots" id="hd">` +
      ph.map((_, i) => `<i class="${i === cv ? 'on' : ''}"></i>`).join('') + `</div>`;
    h += `<button class="hero-cover" id="setcover">★ קבעי כתמונת תצוגה</button>`;
  } else h += `<div class="hero-none">אין עדיין תמונות</div>`;
  h += `</div>`;

  /* כותרת */
  h += `<div class="sec">
    <div class="tagrow" style="margin-bottom:12px">
      <span class="badge ${isW ? 'world' : 'il'}">${isW ? 'שאר העולם' : 'הארץ'}</span>
      ${arr(p.niches).map(n => `<span class="tag">${nicheOf(n).icon} ${esc(nicheOf(n).label)}</span>`).join('')}
      ${p.layout ? `<span class="tag">${esc(layoutOf(p.layout))}</span>` : ''}
      ${p.privacy ? `<span class="tag ${p.privacy === 'shared' ? 'no' : 'yes'}">${esc(privOf(p.privacy).label)}</span>` : ''}
      ${p.status === 'draft' ? '<span class="badge draft">המחקר עדיין חלקי</span>' : ''}
    </div>
    <dl class="kv">
      ${nz(p.area) ? `<dt>אזור</dt><dd>${esc(p.area)}${isW && nz(p.country) ? ', ' + esc(p.country) : ''}</dd>` : ''}
      ${nz(p.address) ? `<dt>כתובת</dt><dd>${esc(p.address)}</dd>` : ''}
      ${nz(tr.mode) ? `<dt>${tr.mode === 'fly' ? 'טיסה' : 'נסיעה'}</dt><dd>${esc(travelText(tr))}</dd>` : ''}
      ${nz(p.bestTime) ? `<dt>מתי ללכת</dt><dd>${esc(p.bestTime)}</dd>` : ''}
    </dl>
    ${arr(p.topics).length ? `<div class="tagrow" style="margin-top:11px">` +
      arr(p.topics).map(t => `<span class="tag">#${esc(t)}</span>`).join('') + `</div>` : ''}
    ${mapsUrl(p) ? `<a class="lnk" style="margin-top:11px" href="${esc(mapsUrl(p))}" target="_blank" rel="noopener">
        <span class="i">📍</span> פתיחה בגוגל מפות</a>` : ''}
  </div>`;

  /* ציונים */
  const webs = Object.entries(rt.web || {}).filter(([, v]) => nz(v));
  const vts = votesOf(p), avg = crewScore(p), me = who(), mine = +((p.votes || {})[me]) || 0;
  h += `<div class="sec"><h3>ציונים והמלצות</h3><div class="scorebar">
      <div class="scorebox"><b>${nz(avg) ? avg.toFixed(1) : '–'}</b>
        <small>${vts.length ? `ממוצע ${vts.length} מהחבורה` : 'עוד אף אחד לא דירג'}</small></div>
      ${webs.map(([s, v]) => `<div class="scorebox"><b>${esc(v)}</b><small>${esc(srcName(s))}</small></div>`).join('')}
      ${nz(rec.count) ? `<div class="scorebox"><b>${esc(rec.count)}</b><small>ממליצים</small></div>` : ''}
    </div>
    <div style="margin-top:14px">
      <div style="font-size:13px;color:var(--ink3);font-weight:700;margin-bottom:6px">
        הציון של <span id="whoami">${esc(me || 'מי שלוחץ')}</span> — לחיצה אחת
        <button id="chwho" style="color:var(--accent);font-weight:700;font-size:12px">החלפה</button></div>
      <div class="rate" id="rate">` +
    [1, 2, 3, 4, 5].map(i => `<button data-v="${i}" class="${i <= mine ? 'on' : ''}">★</button>`).join('') +
    `</div>
      ${vts.length ? `<div class="tagrow" style="margin-top:11px">` + vts
        .sort((a, b) => b[1] - a[1])
        .map(([n, v]) => `<span class="tag">${esc(n)} ${'★'.repeat(+v)}</span>`).join('') + `</div>` : ''}
    </div></div>`;

  /* הרכב + התאמה להרכבי החבורה */
  const units = flatUnits(cap);
  if (units.length || nz(cap.note) || nz(cap.bathroomsTotal)) {
    h += `<div class="sec"><h3>לכמה משפחות, ומה ההרכב</h3>`;
    h += `<p style="font-size:14.5px;color:var(--ink2)">${esc(famLabel(cap.maxFamilies))}`;
    if (units.length) h += p.layout === 'villa'
      ? ` · ${units.reduce((a, u) => a + (u.bedrooms || 1), 0)} חדרי שינה`
      : ` · ${units.length} יחידות`;
    if (nz(cap.bathroomsTotal)) h += ` · ${esc(cap.bathroomsTotal)} שירותים`;
    h += `</p>`;
    if (arr(cap.units).length) {
      h += `<div class="units">` + arr(cap.units).map(u => `<div class="unit">
        <span class="u-n">${esc(u.count || 1)}×</span>
        <div><b>${esc(u.name || 'יחידה')}</b>
        <small>${[nz(u.sleeps) ? u.sleeps + ' נפשות' : '', nz(u.bedrooms) ? u.bedrooms + ' חד׳ שינה' : '',
          nz(u.bathrooms) ? u.bathrooms + ' שירותים' : ''].filter(Boolean).map(x => ' · ' + x).join('')}</small>
        ${nz(u.note) ? `<br><small>${esc(u.note)}</small>` : ''}</div></div>`).join('') + `</div>`;
    }
    if (nz(cap.note)) h += `<p style="margin-top:9px;font-size:14px;color:var(--ink2)">${esc(cap.note)}</p>`;

    if (arr(p.niches).includes('crew') && units.length) {
      h += `<div style="margin-top:14px"><div style="font-size:13px;color:var(--ink3);font-weight:700;margin-bottom:7px">
        התאמה להרכבי החבורה</div><div class="units">`;
      for (let n = 2; n <= 6; n++) {
        const f = fitFor(p, n);
        h += `<div class="unit">
          <span class="u-n" style="${f.ok ? 'background:var(--il-soft);color:var(--il)' : 'background:var(--warn-soft);color:var(--warn)'}">${f.ok ? '✓' : '✗'}</span>
          <div><b>${n} משפחות</b> <small>· ${f.need} נפשות</small>
          ${f.ok ? '' : `<br><small>${esc(f.unknown ? 'חסר מידע על היחידות' : f.fails.join(' · '))}</small>`}</div></div>`;
      }
      h += `</div><div class="calc-note">החישוב מניח את התרחיש התובעני — שהמשפחות עם שלושה ילדים הן שנוסעות.</div></div>`;
    }
    h += `</div>`;
  }

  /* מחיר */
  if (nz(pr.amount)) {
    const startF = Math.min(cap.maxFamilies || CREW.families, CREW.families);
    h += `<div class="sec"><h3>מחיר והערכת עלות</h3><div class="calc">
      <div class="calc-row"><label>לילות</label>
        <div class="stepper"><button id="nminus">−</button><b id="nv">2</b><button id="nplus">+</button></div></div>
      <div class="calc-row"><label>כמה משפחות נוסעות</label>
        <div class="stepper"><button id="fminus">−</button><b id="fv">${startF}</b><button id="fplus">+</button></div></div>
      <div class="calc-out"><span style="font-size:13px;color:var(--ink3);font-weight:700">סה״כ משוער</span>
        <span class="big" id="total">—</span></div>
      <div class="calc-note" id="cnote"></div>
    </div></div>`;
  }

  /* אטרקציות */
  if (arr(att.kids).length || arr(att.adults).length) {
    h += `<div class="sec"><h3>אטרקציות באזור</h3><div class="prosc">`;
    if (arr(att.kids).length) h += `<div class="pc"><h4>🧒 לילדים</h4><ul>` +
      arr(att.kids).map(x => `<li>${esc(x)}</li>`).join('') + `</ul></div>`;
    if (arr(att.adults).length) h += `<div class="pc"><h4>🥂 למבוגרים</h4><ul>` +
      arr(att.adults).map(x => `<li>${esc(x)}</li>`).join('') + `</ul></div>`;
    h += `</div></div>`;
  }

  /* יתרונות וחסרונות */
  if (arr(p.pros).length || arr(p.cons).length) {
    h += `<div class="sec"><h3>בשורה התחתונה</h3><div class="prosc">`;
    if (arr(p.pros).length) h += `<div class="pc p"><h4>יתרונות</h4><ul>` +
      arr(p.pros).map(x => `<li>${esc(x)}</li>`).join('') + `</ul></div>`;
    if (arr(p.cons).length) h += `<div class="pc c"><h4>חסרונות</h4><ul>` +
      arr(p.cons).map(x => `<li>${esc(x)}</li>`).join('') + `</ul></div>`;
    h += `</div></div>`;
  }

  if (arr(p.specials).length) h += `<div class="sec"><h3>מה מיוחד כאן</h3><div class="tagrow">` +
    arr(p.specials).map(x => `<span class="tag">✦ ${esc(x)}</span>`).join('') + `</div></div>`;

  /* הגבלות */
  const rules = [];
  if (ru.pets === true) rules.push(['yes', '🐕 מותר להביא כלבים']);
  if (ru.pets === false) rules.push(['no', '🐕 אסור להביא כלבים']);
  arr(ru.allowed).forEach(x => rules.push(['yes', '✓ ' + x]));
  arr(ru.forbidden).forEach(x => rules.push(['no', '✗ ' + x]));
  if (rules.length) h += `<div class="sec"><h3>הגבלות ומותרות</h3><div class="tagrow">` +
    rules.map(([c, t]) => `<span class="tag ${c}">${esc(t)}</span>`).join('') + `</div></div>`;

  /* ביקורות */
  const qs = arr(rec.quotes), srcs = arr(rec.sources);
  if (qs.length || srcs.length) {
    h += `<div class="sec"><h3>מה אומרים עליו</h3>`;
    qs.forEach(q => h += `<div class="quote ${q.sentiment === 'neg' ? 'neg' : ''}">${esc(q.text)}
      <span class="who">${esc(q.author || 'אנונימי')}${q.source ? ' · ' + esc(srcName(q.source)) : ''}
      ${q.url ? ` · <a href="${esc(q.url)}" target="_blank" rel="noopener">למקור</a>` : ''}</span></div>`);
    if (srcs.length) {
      h += `<div style="margin-top:10px"><div style="font-size:13px;color:var(--ink3);font-weight:700;margin-bottom:7px">מאיפה ההמלצה הגיעה</div><div class="links">`;
      srcs.forEach(s => h += s.url
        ? `<a class="lnk" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="i">${srcIcon(s.type)}</span>${esc(s.label || srcName(s.type))}<small>${esc(s.author || '')}</small></a>`
        : `<div class="lnk"><span class="i">${srcIcon(s.type)}</span>${esc(s.label || srcName(s.type))}<small>${esc(s.author || '')}</small></div>`);
      h += `</div></div>`;
    }
    h += `</div>`;
  }

  /* קשר */
  const links = [['🌐', 'האתר הרשמי', ct.site], ['🛏️', 'Booking', ct.booking],
    ['🏠', 'Airbnb', ct.airbnb], ['🏨', 'אתר הזמנות נוסף', ct.otherBooking],
    ['📷', 'אינסטגרם', ct.instagram]].filter(x => nz(x[2]));
  if (links.length || nz(ct.phone) || nz(ct.email)) {
    h += `<div class="sec"><h3>פרטים והזמנה</h3><div class="links">`;
    links.forEach(([i, t, u]) => h += `<a class="lnk" href="${esc(u)}" target="_blank" rel="noopener"><span class="i">${i}</span>${t}</a>`);
    if (nz(ct.phone)) h += `<a class="lnk" href="tel:${esc(String(ct.phone).replace(/[^+\d]/g, ''))}"><span class="i">📞</span>טלפון<small>${esc(ct.phone)}</small></a>`;
    if (nz(ct.email)) h += `<a class="lnk" href="mailto:${esc(ct.email)}"><span class="i">✉️</span>מייל<small>${esc(ct.email)}</small></a>`;
    h += `</div></div>`;
  }

  if (nz(p.notes)) h += `<div class="sec"><h3>הערות</h3><p>${esc(p.notes).replace(/\n/g, '<br>')}</p></div>`;
  if (nz(p.researchGap)) h += `<div class="sec"><h3>מה עוד חסר</h3>
    <div class="quote neg">${esc(p.researchGap).replace(/\n/g, '<br>')}</div></div>`;

  return h;
}

const travelText = (tr) => {
  const bits = [];
  if (tr.mode === 'fly') {
    if (nz(tr.flightMinutes)) bits.push('טיסה ' + dur(tr.flightMinutes));
    if (nz(tr.minutes)) bits.push('ועוד ' + dur(tr.minutes) + ' נסיעה');
  } else if (nz(tr.minutes)) bits.push(dur(tr.minutes));
  if (nz(tr.km)) bits.push(`(${tr.km} ק״מ)`);
  bits.push('מ' + (tr.fromLabel || 'בת חפר'));
  if (nz(tr.note)) bits.push('· ' + tr.note);
  return bits.join(' ');
};

const srcName = (t) => ({
  instagram: 'אינסטגרם', facebook: 'קבוצת פייסבוק', whatsapp: 'וואטסאפ', friend: 'חברים',
  booking: 'Booking', airbnb: 'Airbnb', google: 'גוגל', tripadvisor: 'Tripadvisor',
  weekend: 'וויקנד', zimmer: 'Zimmer', hotels: 'Hotels.com', site: 'האתר הרשמי', other: 'מקור אחר',
}[t] || t || 'מקור');

const srcIcon = (t) => ({
  instagram: '📷', facebook: '👥', whatsapp: '💬', friend: '🧑‍🤝‍🧑', booking: '🛏️',
  airbnb: '🏠', google: '🔍', tripadvisor: '🦉', weekend: '🗓️', zimmer: '🏕️', site: '🌐',
}[t] || '🔗');

function wireDetail(k, p) {
  const cap = p.capacity || {}, pr = p.pricePerNight || {};
  let nights = 2;
  let fams = Math.min(cap.maxFamilies || CREW.families, CREW.families);

  const calc = () => {
    const n = $('#total'); if (!n) return;
    const amt = +pr.amount, basis = pr.basis || 'unit';
    const perUnit = +cap.familiesPerUnit || 1;
    const units = Math.max(1, Math.ceil(fams / perUnit));
    let total = 0, how = '';
    if (basis === 'whole') { total = amt * nights; how = `${money(amt, pr.currency)} למתחם × ${nights} לילות`; }
    else if (basis === 'person') {
      const pp = CREW.peopleFor(fams);
      total = amt * nights * pp; how = `${money(amt, pr.currency)} לאדם × ${pp} נפשות × ${nights} לילות`;
    } else { total = amt * units * nights; how = `${money(amt, pr.currency)} ליחידה × ${units} יחידות × ${nights} לילות`; }
    n.textContent = money(total, pr.currency);
    $('#cnote').innerHTML = esc(how)
      + (nz(pr.note) ? '<br>' + esc(pr.note) : '')
      + (nz(pr.season) ? '<br>תקף ל: ' + esc(pr.season) : '')
      + `<br><b>${money(total / Math.max(fams, 1), pr.currency)}</b> למשפחה לכל החופשה.`;
  };
  const bind = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  bind('#nminus', () => { nights = Math.max(1, nights - 1); $('#nv').textContent = nights; calc(); });
  bind('#nplus', () => { nights = Math.min(30, nights + 1); $('#nv').textContent = nights; calc(); });
  bind('#fminus', () => { fams = Math.max(1, fams - 1); $('#fv').textContent = fams; calc(); });
  bind('#fplus', () => { fams = Math.min(CREW.families, fams + 1); $('#fv').textContent = fams; calc(); });
  calc();

  const chw = $('#chwho');
  if (chw) chw.onclick = async () => { await askWho(); openDetail(k); };

  $$('#rate button').forEach(b => b.onclick = async () => {
    let me = who();
    if (!me) { me = await askWho(); if (!me) { toast('צריך שם כדי לשמור ציון'); return; } }
    const v = +b.dataset.v;
    $$('#rate button').forEach(x => x.classList.toggle('on', +x.dataset.v <= v));
    try {
      await voteFor(k, me, v);
      toast(`הציון של ${me} נשמר`);
      openDetail(k); render();
    } catch (e) { toast(e.message); }
  });

  const hs = $('#hs');
  if (hs) {
    hs.onscroll = () => {
      const i = Math.round(Math.abs(hs.scrollLeft) / hs.clientWidth);
      $$('#hd i').forEach((d, j) => d.classList.toggle('on', j === i));
      hs.dataset.i = i;
    };
    const sc = $('#setcover');
    if (sc) sc.onclick = async () => {
      try { await save(k, { ...p, coverIndex: +(hs.dataset.i || 0) }); toast('תמונת התצוגה הוחלפה'); render(); }
      catch (e) { toast(e.message); }
    };
  }
}

/* ============================ form ============================ */
const lineList = (v) => arr(v).join('\n');
const parseLines = (s) => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);

function openForm(k) {
  const isNew = !k;
  const p = isNew
    ? { region: 'il', status: 'draft', niches: [], photos: [], capacity: {}, rec: {}, rating: {}, contact: {}, travel: {} }
    : S.places[k];
  openSheet(isNew ? 'מקום חדש' : 'עריכה — ' + p.name, formHtml(p),
    `<button class="btn" onclick="VAC.closeSheet()">ביטול</button>
     ${isNew ? '' : `<button class="btn danger" id="fdel">מחיקה</button>`}
     <button class="btn go" id="fsave">שמירה</button>`);
  wireForm(k, p);
}

function formHtml(p) {
  const cap = p.capacity || {}, rec = p.rec || {}, pr = p.pricePerNight || {};
  const tr = p.travel || {}, rt = p.rating || {}, ru = p.rules || {}, ct = p.contact || {};
  const att = p.attractions || {}, web = rt.web || {};
  const ph = arr(p.photos);
  const f = (label, id, val, type = 'text', hint = '', ltr = false) => `<div class="f">
    <label for="${id}">${label}</label>${hint ? `<div class="hint">${hint}</div>` : ''}
    <input id="${id}" type="${type}" value="${esc(val ?? '')}" class="${ltr ? 'ltr' : ''}"></div>`;
  const ta = (label, id, val, hint = '') => `<div class="f">
    <label for="${id}">${label}</label>${hint ? `<div class="hint">${hint}</div>` : ''}
    <textarea id="${id}">${esc(val ?? '')}</textarea></div>`;
  const sel = (label, id, val, opts, hint = '') => `<div class="f">
    <label for="${id}">${label}</label>${hint ? `<div class="hint">${hint}</div>` : ''}
    <select id="${id}">${opts.map(([v, t]) =>
      `<option value="${esc(v)}" ${String(val ?? '') === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;

  return `<div class="form">
    <div class="fgroup"><h4>הבסיס</h4>
      ${f('שם המקום', 'f_name', p.name)}
      <div class="f"><label>לאיזו נישה זה שייך</label>
        <div class="hint">אפשר לסמן יותר מאחת</div>
        <div class="tagrow" id="f_niches">${NICHES.map(n =>
          `<button type="button" class="tag ${arr(p.niches).includes(n.id) ? 'yes' : ''}" data-n="${n.id}">
            ${n.icon} ${esc(n.label)}</button>`).join('')}</div></div>
      ${sel('הארץ או שאר העולם', 'f_region', p.region || 'il', [['il', 'הארץ'], ['world', 'שאר העולם']])}
      <div class="f2">
        <div class="f"><label for="f_area">אזור</label>
          <input id="f_area" list="arealist" value="${esc(p.area ?? '')}"></div>
        ${f('מדינה', 'f_country', p.country, 'text', 'רק לחו״ל')}
      </div>
      <datalist id="arealist">${AREAS_IL.map(a => `<option value="${esc(a)}">`).join('')}</datalist>
      ${sel('סוג המקום', 'f_layout', p.layout, [['', '—'], ...LAYOUTS.map(l => [l.id, l.label])])}
      ${sel('פרטיות', 'f_privacy', p.privacy, [['', '—'], ...PRIVACY.map(x => [x.id, x.label])],
        'יעל מעדיפה שהמתחם כולו יהיה שלנו, או לפחות מבודד')}
      ${f('כתובת מלאה', 'f_address', p.address)}
      ${f('לינק לגוגל מפות', 'f_mapUrl', p.mapUrl, 'url', 'אם ריק — ייבנה לינק חיפוש מהשם', true)}
      <div class="f2">
        ${f('קו רוחב (lat)', 'f_lat', p.lat, 'text', 'בשביל הסיכה על המפה', true)}
        ${f('קו אורך (lng)', 'f_lng', p.lng, 'text', '', true)}
      </div>
      ${f('תגיות', 'f_topics', arr(p.topics).join(', '), 'text', 'מופרד בפסיק: נוף כנרת, בריכה מחוממת, ספא…')}
      ${sel('מצב הרשומה', 'f_status', p.status || 'draft', [['draft', 'המחקר עדיין חלקי'], ['full', 'מלא']])}
    </div>

    <div class="fgroup"><h4>כמה משפחות ומה ההרכב</h4>
      ${sel('לכמה משפחות המקום מתאים', 'f_fam', cap.maxFamilies,
        [['', 'לא ידוע'], ...[1, 2, 3, 4, 5, 6, 7].map(n =>
          [n, n === 7 ? '7 ומעלה' : (n === 1 ? 'רק המשפחה שלנו' : n + ' משפחות')])])}
      <div class="f2">
        ${f('סה״כ שירותים במתחם', 'f_bath', cap.bathroomsTotal, 'number', 'צריך לפחות אחד לכל משפחה')}
        ${f('כמה משפחות ביחידה', 'f_fpu', cap.familiesPerUnit, 'number', 'בדרך כלל 1')}
      </div>
      <div class="f"><label>הרכב היחידות</label>
        <div class="hint">שורה לכל סוג יחידה:<br>כמות | שם | נפשות | חדרי שינה | שירותים | הערה</div>
        <textarea id="f_units">${esc(arr(cap.units).map(u =>
          [u.count || 1, u.name || '', u.sleeps || '', u.bedrooms || '', u.bathrooms || '', u.note || ''].join(' | ')).join('\n'))}</textarea></div>
      ${ta('הערה על הקיבולת', 'f_capnote', cap.note)}
    </div>

    <div class="fgroup"><h4>מחיר וזמן</h4>
      <div class="f2">
        ${f('מחיר ללילה', 'f_price', pr.amount, 'number')}
        ${sel('מטבע', 'f_cur', pr.currency || 'ILS', ['ILS', 'EUR', 'USD'].map(c => [c, c + ' ' + CUR[c]]))}
      </div>
      ${sel('המחיר הוא…', 'f_basis', pr.basis || 'unit',
        [['unit', 'ליחידה / לצימר / לחדר'], ['whole', 'למתחם כולו'], ['person', 'לאדם']])}
      ${f('הערה על המחיר', 'f_pnote', pr.note, 'text', 'כולל ארוחת בוקר? מינימום לילות?')}
      ${f('לאיזו עונה המחיר', 'f_season', pr.season)}
      ${f('הזמן הכי מומלץ לבקר', 'f_best', p.bestTime)}
      ${sel('איך מגיעים', 'f_mode', tr.mode || 'drive', [['drive', 'נסיעה'], ['fly', 'טיסה']])}
      <div class="f2">
        ${f('זמן נסיעה (דקות)', 'f_min', tr.minutes, 'number', 'בטיסה — מהשדה והלאה')}
        ${f('זמן טיסה (דקות)', 'f_fmin', tr.flightMinutes, 'number')}
      </div>
      <div class="f2">
        ${f('מרחק בק״מ', 'f_km', tr.km, 'number')}
        ${f('מאיפה', 'f_from', tr.fromLabel, 'text', 'ברירת מחדל: בת חפר')}
      </div>
      ${f('הערה על הדרך', 'f_tnote', tr.note)}
    </div>

    <div class="fgroup"><h4>המלצות, ציונים וביקורות</h4>
      ${f('כמה ממליצים נמצאו', 'f_reccount', rec.count, 'number',
        'הציון שלנו לא נקבע כאן — כל משפחה מדרגת בכוכבים בכרטיס עצמו')}
      <div class="f2">
        ${f('ציון Booking', 'f_wb', web.booking, 'text', 'למשל 8.9', true)}
        ${f('ציון גוגל', 'f_wg', web.google, 'text', 'למשל 4.7', true)}
      </div>
      <div class="f2">
        ${f('ציון Airbnb / Tripadvisor', 'f_wa', web.airbnb, 'text', '', true)}
        ${f('ציון וויקנד / אחר', 'f_ww', web.weekend, 'text', '', true)}
      </div>
      <div class="f"><label>מאיפה ההמלצה הגיעה</label>
        <div class="hint">שורה למקור: סוג | תיאור | לינק | מי<br>
          סוגים: instagram, facebook, whatsapp, friend, booking, airbnb, google, tripadvisor, weekend, zimmer, site, other</div>
        <textarea id="f_srcs">${esc(arr(rec.sources).map(s =>
          [s.type || 'other', s.label || '', s.url || '', s.author || ''].join(' | ')).join('\n'))}</textarea></div>
      <div class="f"><label>תגובות וציטוטים</label>
        <div class="hint">שורה לציטוט: טוב/רע | הטקסט | מי | לינק<br>חשוב גם הרע — שנדע למה לצפות</div>
        <textarea id="f_quotes">${esc(arr(rec.quotes).map(q =>
          [q.sentiment === 'neg' ? 'רע' : 'טוב', q.text || '', q.author || '', q.url || ''].join(' | ')).join('\n'))}</textarea></div>
    </div>

    <div class="fgroup"><h4>אטרקציות, יתרונות וחסרונות</h4>
      ${ta('אטרקציות לילדים', 'f_akids', lineList(att.kids), 'שורה לכל אטרקציה')}
      ${ta('אטרקציות למבוגרים', 'f_aad', lineList(att.adults), 'שורה לכל אטרקציה')}
      ${ta('יתרונות', 'f_pros', lineList(p.pros))}
      ${ta('חסרונות', 'f_cons', lineList(p.cons))}
      ${ta('פיצ׳רים מיוחדים', 'f_spec', lineList(p.specials), 'מה נותן למקום בונוס על פני האחרים')}
    </div>

    <div class="fgroup"><h4>הגבלות ומותרות</h4>
      ${sel('כלבים', 'f_pets', ru.pets === true ? 'yes' : (ru.pets === false ? 'no' : ''),
        [['', 'לא ידוע'], ['yes', 'מותר להביא כלבים'], ['no', 'אסור להביא כלבים']])}
      ${ta('מה מותר', 'f_allow', lineList(ru.allowed))}
      ${ta('מה אסור / מגבלות', 'f_forbid', lineList(ru.forbidden))}
    </div>

    <div class="fgroup"><h4>קשר והזמנה</h4>
      <div class="f2">
        ${f('טלפון', 'f_phone', ct.phone, 'tel', '', true)}
        ${f('מייל', 'f_email', ct.email, 'email', '', true)}
      </div>
      ${f('האתר הרשמי', 'f_site', ct.site, 'url', '', true)}
      ${f('לינק Booking', 'f_booking', ct.booking, 'url', '', true)}
      ${f('לינק Airbnb', 'f_airbnb', ct.airbnb, 'url', '', true)}
      ${f('אתר הזמנות נוסף', 'f_other', ct.otherBooking, 'url', 'Hotels, וויקנד, Expedia…', true)}
      ${f('אינסטגרם', 'f_ig', ct.instagram, 'url', '', true)}
    </div>

    <div class="fgroup"><h4>תמונות</h4>
      <div class="hint">כתובת של תמונה מהאינטרנט. הכוכב קובע מה תמונת התצוגה.</div>
      <div class="photoedit" id="photos">${ph.map((u, i) => photoRow(u, i === (+p.coverIndex || 0))).join('')}
        ${ph.length ? '' : photoRow('', true)}</div>
      <button class="addrow" id="addphoto">+ עוד תמונה</button>
    </div>

    <div class="fgroup"><h4>הערות</h4>
      ${ta('הערות חופשיות', 'f_notes', p.notes)}
      ${ta('מה עוד חסר במחקר', 'f_gap', p.researchGap, 'מה שעדיין לא ידוע — כדי שלא ייעלם')}
    </div>
  </div>`;
}

const photoRow = (url, isCover) => `<div class="photorow">
  <img src="${esc(url)}" alt="" onerror="this.style.visibility='hidden'">
  <input type="url" class="ltr" value="${esc(url)}" placeholder="https://…">
  <button class="cov ${isCover ? 'on' : ''}" title="תמונת תצוגה">★</button>
  <button class="del">✕</button></div>`;

function wireForm(k, p) {
  const box = $('#photos');
  const syncPhotos = () => {
    $$('.photorow', box).forEach(row => {
      row.querySelector('input').oninput = (e) => {
        const im = row.querySelector('img'); im.src = e.target.value; im.style.visibility = '';
      };
      row.querySelector('.cov').onclick = () => {
        $$('.photorow .cov', box).forEach(c => c.classList.remove('on'));
        row.querySelector('.cov').classList.add('on');
      };
      row.querySelector('.del').onclick = () => { row.remove(); syncPhotos(); };
    });
  };
  syncPhotos();
  $('#addphoto').onclick = () => { box.insertAdjacentHTML('beforeend', photoRow('', false)); syncPhotos(); };

  $$('#f_niches [data-n]').forEach(b => b.onclick = () => b.classList.toggle('yes'));

  $('#fsave').onclick = async () => {
    const g = (id) => ($('#' + id) || {}).value ?? '';
    const num = (id) => { const v = g(id).trim(); return v === '' ? null : +v; };
    const str = (id) => { const v = g(id).trim(); return v === '' ? null : v; };
    if (!str('f_name')) { toast('צריך לפחות שם'); return; }

    const photos = [], covIdx = [];
    $$('.photorow', box).forEach(row => {
      const u = row.querySelector('input').value.trim(); if (!u) return;
      if (row.querySelector('.cov').classList.contains('on')) covIdx.push(photos.length);
      photos.push(u);
    });

    const units = parseLines(g('f_units')).map(l => {
      const [count, name, sleeps, bedrooms, bathrooms, note] = l.split('|').map(x => (x || '').trim());
      return {
        count: +count || 1, name: name || 'יחידה', sleeps: +sleeps || null,
        bedrooms: +bedrooms || null, bathrooms: +bathrooms || null, note: note || null,
      };
    });
    const sources = parseLines(g('f_srcs')).map(l => {
      const [type, label, url, author] = l.split('|').map(x => (x || '').trim());
      return { type: type || 'other', label: label || null, url: url || null, author: author || null };
    });
    const quotes = parseLines(g('f_quotes')).map(l => {
      const [sent, text, author, url] = l.split('|').map(x => (x || '').trim());
      return { sentiment: /רע|neg/.test(sent) ? 'neg' : 'pos', text: text || '', author: author || null, url: url || null };
    }).filter(q => q.text);

    const petsV = g('f_pets');
    const place = {
      ...p,
      name: str('f_name'),
      niches: $$('#f_niches .tag.yes').map(b => b.dataset.n),
      region: g('f_region') || 'il',
      area: str('f_area'), country: str('f_country'), address: str('f_address'),
      layout: str('f_layout'), privacy: str('f_privacy'),
      topics: g('f_topics').split(',').map(x => x.trim()).filter(Boolean),
      mapUrl: str('f_mapUrl'), lat: num('f_lat'), lng: num('f_lng'),
      status: g('f_status') || 'draft',
      bestTime: str('f_best'), notes: str('f_notes'), researchGap: str('f_gap'),
      capacity: {
        maxFamilies: num('f_fam'), bathroomsTotal: num('f_bath'),
        familiesPerUnit: num('f_fpu') || 1, units, note: str('f_capnote'),
      },
      pricePerNight: {
        amount: num('f_price'), currency: g('f_cur') || 'ILS', basis: g('f_basis') || 'unit',
        note: str('f_pnote'), season: str('f_season'),
      },
      travel: {
        mode: g('f_mode') || 'drive', minutes: num('f_min'), flightMinutes: num('f_fmin'),
        km: num('f_km'), fromLabel: str('f_from'), note: str('f_tnote'),
      },
      rating: {
        ours: (p.rating || {}).ours || null,
        web: { booking: str('f_wb'), google: str('f_wg'), airbnb: str('f_wa'), weekend: str('f_ww') },
      },
      rec: { count: num('f_reccount'), sources, quotes },
      attractions: { kids: parseLines(g('f_akids')), adults: parseLines(g('f_aad')) },
      pros: parseLines(g('f_pros')), cons: parseLines(g('f_cons')), specials: parseLines(g('f_spec')),
      rules: {
        pets: petsV === 'yes' ? true : (petsV === 'no' ? false : null),
        allowed: parseLines(g('f_allow')), forbidden: parseLines(g('f_forbid')),
      },
      contact: {
        phone: str('f_phone'), email: str('f_email'), site: str('f_site'),
        booking: str('f_booking'), airbnb: str('f_airbnb'),
        otherBooking: str('f_other'), instagram: str('f_ig'),
      },
      photos, coverIndex: covIdx.length ? covIdx[0] : 0,
    };

    $('#fsave').disabled = true;
    try { await save(k || newKey(), place); toast('נשמר'); closeSheet(); render(); }
    catch (e) { toast(e.message); $('#fsave').disabled = false; }
  };

  const del = $('#fdel');
  if (del) del.onclick = async () => {
    if (!confirm(`למחוק את "${p.name}" מהמאגר? אי אפשר לבטל.`)) return;
    try { await remove(k); toast('נמחק'); closeSheet(); render(); } catch (e) { toast(e.message); }
  };
}

/* ============================ filters ============================ */
function buildNiches() {
  const box = $('#niches');
  box.innerHTML = `<button class="ntab" data-n="all" aria-selected="true">הכל</button>` +
    NICHES.map(n => `<button class="ntab" data-n="${n.id}" aria-selected="false">
      <span>${n.icon}</span>${esc(n.short)}</button>`).join('');
  $$('.ntab', box).forEach(b => b.onclick = () => {
    S.niche = b.dataset.n;
    $$('.ntab', box).forEach(x => x.setAttribute('aria-selected', x === b));
    $('#nhint').textContent = S.niche === 'all' ? '' : (nicheOf(S.niche).hint || '');
    render();
  });
}

function buildAreaChips() {
  const box = $('#areas');
  const used = [...new Set(Object.values(S.places).filter(p => p && p.name && nz(p.area)).map(p => p.area))];
  const cur = S.area;
  if (box.dataset.sig === used.join('|') + cur + S.region) return;
  box.dataset.sig = used.join('|') + cur + S.region;
  box.innerHTML = `<button class="chip" data-a="all" aria-pressed="${cur === 'all'}">כל האזורים</button>` +
    used.sort().map(a => `<button class="chip" data-a="${esc(a)}" aria-pressed="${cur === a}">${esc(a)}</button>`).join('');
  $$('[data-a]', box).forEach(b => b.onclick = () => {
    S.area = b.dataset.a; box.dataset.sig = ''; render();
  });
}

function buildFilters() {
  const box = $('#filters');
  let h = `<button class="chip" data-r="all" aria-pressed="true">הכל</button>
    <button class="chip il" data-r="il" aria-pressed="false">הארץ</button>
    <button class="chip world" data-r="world" aria-pressed="false">העולם</button>
    <span class="chip-sep"></span>
    <button class="chip" data-p="1" aria-pressed="false">🔒 רק אנחנו / מבודד</button>
    <span class="chip-sep"></span>
    <button class="chip" data-f="0" aria-pressed="true">כל גודל</button>`;
  for (let n = 1; n <= CREW.families; n++)
    h += `<button class="chip" data-f="${n}" aria-pressed="false">${n === CREW.families ? '7+' : (n === 1 ? 'רק אנחנו' : n + ' משפ׳')}</button>`;
  box.innerHTML = h;
  $$('[data-r]', box).forEach(b => b.onclick = () => {
    S.region = b.dataset.r;
    $$('[data-r]', box).forEach(x => x.setAttribute('aria-pressed', x === b));
    render();
  });
  $$('[data-f]', box).forEach(b => b.onclick = () => {
    S.fams = +b.dataset.f;
    $$('[data-f]', box).forEach(x => x.setAttribute('aria-pressed', x === b));
    render();
  });
  const pb = $('[data-p]', box);
  pb.onclick = () => {
    S.priv = S.priv === 'all' ? 'priv' : 'all';
    pb.setAttribute('aria-pressed', S.priv !== 'all');
    render();
  };
}

function showExcluded() {
  openSheet('מקומות שלא חוזרים אליהם',
    `<div class="sec">${EXCLUDED.map(e =>
      `<div class="quote neg"><b>${esc(e.name)}</b><br>${esc(e.why)}</div>`).join('')}
      <p style="font-size:13.5px;color:var(--ink3);margin-top:10px">
        הסגנון עצמו כן מעניין — רק המקום הספציפי יצא מהרשימה.</p></div>`,
    `<button class="btn go" onclick="VAC.closeSheet()">סגירה</button>`);
}

/* ============================ boot ============================ */
window.VAC = { closeSheet, edit: openForm, add: () => openForm(null), reload: load, excluded: showExcluded };

document.addEventListener('DOMContentLoaded', () => {
  buildNiches();
  buildFilters();
  $$('.vtab').forEach(t => t.onclick = () => {
    S.view = t.dataset.v;
    $$('.vtab').forEach(x => x.setAttribute('aria-selected', x === t));
    render();
  });
  $('#fab').onclick = () => openForm(null);
  $('#sheet-bg').onclick = closeSheet;
  $('#btn-close').onclick = closeSheet;
  $('#btn-reload').onclick = () => { toast('מרענן…'); load(); };
  $('#btn-x').onclick = showExcluded;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  load();
});
