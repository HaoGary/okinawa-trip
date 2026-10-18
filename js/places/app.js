/* ==========================================================================
   places/app.js — 地點管理頁面（places.html）

   流程
     1. 景點搜尋：Google Maps Places API（經 Apps Script，金鑰不在網頁）
        → 景點搜尋與地點清單顯示同一批景點（原行程地點＋地點清單），在卡片上「選擇天數＋加入」安排行程
     2. 地點清單：看完整資訊、編輯備註、刪除、安排到第 1～5 天
     3. 行程安排：依天分組、調整順序、移到其他天、從行程移除（寫入試算表 poi_schedule）
   「匯入景點」與「安排到行程」是兩個不同的步驟。
   行程安排先在畫面上編輯（草稿），按「確認」才一次寫入試算表；「全部清除」也要按「確認」才生效。
   ========================================================================== */
(function (Trip) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const CATEGORY = { attraction: '觀光景點', nature: '自然景觀', heritage: '文化古蹟', shopping: '購物中心' };
  const SOURCE = { google: 'Google Maps', demo: '示範資料', manual: '手動新增', itinerary: '目前行程' };

  let store = Trip.placesStore.create();
  const S = {
    loaded: false, rules: {}, mode: store.mode, itinerary: null, days: [], pois: [], schedule: [], draft: [], newPois: [], stops: [], stopsError: null, searchEnabled: false,
    results: [], resultSource: null, resultNote: '', busy: false,
  };

  /* ---------------- 共用 ---------------- */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function safeUrl(u) {
    return /^https:\/\//i.test(String(u || '')) ? String(u) : '';
  }

  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'pm-toast' + (kind ? ' is-' + kind : '');
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();   // 最多同時顯示 3 則
    const ms = kind === 'error' ? 9000 : 3600;          // 錯誤訊息停留久一點
    setTimeout(() => el.classList.add('is-out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  function stars(rating, count) {
    if (typeof rating !== 'number') return '<span class="pm-rating is-none">無評分</span>';
    return '<span class="pm-rating"><span class="pm-star" aria-hidden="true">★</span>' + rating.toFixed(1) +
      (count ? ' <small>(' + Number(count).toLocaleString('zh-TW') + ')</small>' : '') + '</span>';
  }

  function sourceChip(src) {
    if (!src || src === 'demo' || src === 'itinerary' || src === 'manual') return '';   // 不顯示「示範資料」「原行程」「手動新增」標籤
    return '<span class="pm-chip is-' + esc(src || 'manual') + '">' + esc(SOURCE[src] || SOURCE.manual) + '</span>';
  }

  function dayName(no) {
    const d = S.days.find((x) => Number(x.day_no) === Number(no));
    return '第 ' + no + ' 天' + (d && d.title ? '・' + d.title : '');
  }

  // 地點 = 已存在試算表的（S.pois）＋ 尚未儲存、暫存在頁面上的（S.newPois，poi_id 為負數）
  function allPois() { return S.pois.concat(S.newPois); }
  const isNew = (id) => Number(id) < 0;
  function poiById(id) { return allPois().find((p) => Number(p.poi_id) === Number(id)); }
  function daysOf(poiId) {
    return S.draft.filter((s) => !Trip.PoiLogic.isStop(s) && Number(s.poi_id) === Number(poiId))
      .map((s) => Number(s.day_no)).sort((a, b) => a - b);
  }
  // 行程景點排序：顯示中的項目（不含已移出的原行程地點）
  const visible = (rows) => rows.filter((r) => !Trip.PoiLogic.isHidden(r));
  function stopById(id) { return S.stops.find((t) => Number(t.day_stop_id) === Number(id)); }
  // 地點清單的地點沒有自己的照片時，若和原行程地點同名，就沿用原行程地點（place）的照片
  function photoOf(p) {
    if (!p) return null;
    if (p.photo_url) return p.photo_url;
    const n = normName(p.name);
    const t = n.length >= 2 && S.stops.find((x) => x.photo_url && normName(x.name) === n);
    return t ? t.photo_url : null;
  }
  // 一個排序項目要顯示的內容：原行程地點讀 S.stops，新增景點讀地點清單
  function itemInfo(r) {
    if (Trip.PoiLogic.isStop(r)) {
      const t = stopById(r.day_stop_id) || { name: '（找不到原行程地點 #' + r.day_stop_id + '）' };
      return { kind: 'stop', name: t.name, address: t.address, maps_url: t.maps_url, role: t.role || null,
               hasCoords: t.lat != null, origDay: t.day_no, photo: t.photo_url || null, place_id: t.place_id };
    }
    const p = poiById(r.poi_id) || { name: '（找不到地點 #' + r.poi_id + '）' };
    return { kind: 'poi', name: p.name, address: p.address, maps_url: p.maps_url, note: p.note,
             hasCoords: p.lat != null && p.lng != null, unsaved: isNew(r.poi_id), photo: photoOf(p), poi_id: p.poi_id };
  }
  // 行程地圖上原本的地點（Apps Script 讀取 day_stop → place，唯讀）
  function stopsOn(dayNo) {
    return S.stops.filter((s) => Number(s.day_no) === Number(dayNo)).sort((a, b) => a.seq - b.seq);
  }
  const normName = (v) => String(v || '').replace(/[\s・·()（）]/g, '').toLowerCase();
  // 名稱相同或互相包含，就視為原行程已有這個地點
  function stopDaysForName(name) {
    const n = normName(name);
    if (n.length < 2) return [];
    const days = S.stops.filter((s) => {
      const m = normName(s.name);
      return m.length >= 2 && (m === n || m.indexOf(n) >= 0 || n.indexOf(m) >= 0);
    }).map((s) => Number(s.day_no));
    return [...new Set(days)].sort((a, b) => a - b);
  }
  function stopChip(name) {
    const d = stopDaysForName(name);
    return d.length ? '<span class="pm-chip is-stop" title="原行程第 ' + d.join('、') + ' 天已有這個地點">原行程第 ' + d.join('、') + ' 天</span>' : '';
  }

  // 地點清單＝原行程地點（名稱和地點清單的地點相同時以地點清單為準）＋地點清單的地點；與景點搜尋的預設清單相同
  const ALL = { region: '沖繩', minRating: '0', category: 'all' };
  function listStops() {
    const names = new Set(allPois().map((p) => normName(p.name)));
    return Trip.placesStore.localSearch(ALL, S.stops, []).results.filter((r) => !names.has(normName(r.name)));
  }
  function listCount() { return allPois().length + listStops().length; }
  function importedKeys() { return new Set(allPois().map(Trip.PoiLogic.poiKey)); }
  function savedKeys() { return new Set(S.pois.map(Trip.PoiLogic.poiKey)); }

  function dayOptions(selected, placeholder) {
    return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      S.days.map((d) => '<option value="' + d.day_no + '"' + (Number(selected) === Number(d.day_no) ? ' selected' : '') + '>第 ' + d.day_no + ' 天</option>').join('');
  }

  function setBusy(on) {
    S.busy = on;
    document.body.classList.toggle('is-busy', on);
    document.querySelectorAll('[data-act], #search-btn, #manual-btn, #plan-save, #plan-clear').forEach((b) => {
      if (on) { b.dataset.wasDisabled = b.disabled ? '1' : ''; b.disabled = true; }
      else if (b.dataset.wasDisabled !== undefined) { b.disabled = b.dataset.wasDisabled === '1'; delete b.dataset.wasDisabled; }
    });
  }

  /* ---------------- 行程草稿 ----------------
     S.schedule  已儲存在試算表的安排
     S.draft     畫面上正在編輯的安排（按「確認」才寫入） */
  const clone = (rows) => rows.map((r) => Object.assign({}, r));
  // 排序：同一天依 sort_order；已移出的原行程地點（sort_order 0）排在當天最後
  const ord = (r) => (Trip.PoiLogic.isHidden(r) ? 1e9 : Number(r.sort_order != null ? r.sort_order : r.seq));
  const sortRows = (rows) => rows.slice().sort((a, b) => a.day_no - b.day_no || ord(a) - ord(b));
  const sig = (rows) => sortRows(rows).map((r) => Trip.PoiLogic.itemKey(r) + ':' + r.day_no + ':' + ord(r)).join('|');
  function isDirty() { return S.newPois.length > 0 || sig(S.draft) !== sig(S.schedule); }

  function draftDiff() {
    const pairs = (rows) => new Set(visible(rows).map((r) => Trip.PoiLogic.itemKey(r) + ':' + r.day_no));
    const a = pairs(S.schedule), b = pairs(S.draft);
    const added = [...b].filter((k) => !a.has(k)).length, removed = [...a].filter((k) => !b.has(k)).length;
    return { added, removed, newPois: S.newPois.length, reordered: !added && !removed && sig(S.draft) !== sig(S.schedule) };
  }

  // 在草稿上執行安排操作（規則與試算表相同，由 PoiLogic 檢查）；不會連線
  function draftApply(op) {
    const state = { pois: allPois(), schedule: clone(S.draft) };
    const roles = {};
    S.stops.forEach((t) => { if (t.role) roles[t.day_stop_id] = t.role; });
    const result = Trip.PoiLogic.apply(state, op, {
      now: new Date().toISOString(),
      itineraryId: S.itinerary ? S.itinerary.itinerary_id : 1,
      days: S.days.map((d) => Number(d.day_no)),
      rules: S.rules,             // 出發地／終點的位置限制（Apps Script 指令碼屬性 PLAN_RULES；預設沒有限制）
      roles: roles,
    });
    S.draft = state.schedule;
    renderHead(); renderPois(); renderPlan();
    if (S.results.length) renderResults();          // 景點搜尋卡片的「已安排」標籤跟著更新
    return result;
  }

  // 景點被刪除後，草稿中對應的安排也拿掉
  function pruneDraft() {
    const ids = new Set(allPois().map((p) => Number(p.poi_id)));
    S.draft = S.draft.filter((r) => (Trip.PoiLogic.isStop(r) ? !!stopById(r.day_stop_id) : ids.has(Number(r.poi_id))));
    S.days.forEach((d) => visible(sortRows(S.draft.filter((r) => Number(r.day_no) === Number(d.day_no))))
      .forEach((r, i) => { r.sort_order = i + 1; r.seq = i + 1; }));
  }

  // 執行一個寫入操作；成功後以伺服器回傳的最新資料重畫
  // resetDraft：儲存行程後，草稿改成與試算表相同；其他操作保留尚未儲存的草稿
  function run(op, resetDraft) {
    if (S.busy) return Promise.reject(Object.assign(new Error('正在處理上一個操作'), { code: 'BUSY' }));
    const keepDraft = !resetDraft && isDirty();
    setBusy(true);
    return store.write(op)
      .then((data) => {
        S.pois = data.pois || [];
        S.schedule = data.schedule || [];
        if (Array.isArray(data.stops)) S.stops = data.stops;          // 編輯原行程地點後回傳最新的地點資料
        if (resetDraft) S.newPois = [];
        if (keepDraft) pruneDraft(); else S.draft = clone(S.schedule);
        return data.result;
      })
      .finally(() => { setBusy(false); renderAll(); });
  }

  function fail(e) {
    toast((e && e.message) || '操作失敗', 'error');
  }

  /* ---------------- 頁首與分頁 ---------------- */
  function renderHead() {
    const src = $('pm-source');
    src.hidden = false;
    if (S.mode === 'remote') {
      src.className = 'pm-source is-remote';
      src.textContent = '已連線';
      src.title = '匯入與安排會直接寫入試算表的 poi、poi_schedule 頁籤';
    } else {
      src.className = 'pm-source is-local';
      src.textContent = '離線示範';
      src.title = '資料只存在這個瀏覽器，不會寫入 Google 試算表';
    }
    if (S.itinerary) $('pm-sub').textContent = '搜尋景點、整理地點清單，再安排到每天的行程';
    $('count-pois').textContent = listCount();
    $('count-plan').textContent = visible(S.draft).length;
    $('tab-plan').classList.toggle('is-dirty', isDirty());
    $('tab-plan').title = isDirty() ? '行程安排有尚未儲存的變更' : '';
  }

  const TABS = ['search', 'pois', 'plan'];
  function showTab(name, focus) {
    if (TABS.indexOf(name) < 0) name = 'search';
    TABS.forEach((t) => {
      const on = t === name;
      $('tab-' + t).setAttribute('aria-selected', on);
      $('tab-' + t).setAttribute('aria-pressed', on);
      $('tab-' + t).tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    if (focus) $('tab-' + name).focus();
  }

  document.querySelector('.pm-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  document.querySelector('.pm-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const cur = TABS.findIndex((t) => !$('panel-' + t).hidden);
    showTab(TABS[(cur + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length], true);
  });

  /* ---------------- 深淺色（與行程地圖頁共用設定） ---------------- */
  (function theme() {
    const key = (Trip.config.storageKeys && Trip.config.storageKeys.theme) || 'naha-theme';
    const root = document.documentElement;
    const btn = $('theme-btn');
    const sys = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const current = () => root.getAttribute('data-theme') || (sys && sys.matches ? 'dark' : 'light');
    const label = () => {
      const dark = current() === 'dark';
      const text = dark ? '淺色模式' : '深色模式';
      const span = btn.querySelector('.pm-theme-text');
      if (span) span.textContent = text; else btn.textContent = text;
      btn.setAttribute('aria-label', text);
      btn.setAttribute('aria-pressed', dark);
    };
    try {
      const saved = localStorage.getItem(key);
      if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
    } catch (e) { /* 無法讀取時跟隨系統 */ }
    label();
    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(key, next); } catch (e) { /* 無法記住也沒關係 */ }
      label();
    });
    if (sys && sys.addEventListener) sys.addEventListener('change', label);
  })();

  /* ======================================================================
     1. 景點搜尋
     ====================================================================== */
  function searchParams() {
    return { region: $('f-region').value.trim(), minRating: $('f-rating').value, category: $('f-category').value };
  }

  function stateBox(kind, title, text, actions) {
    return '<div class="card pm-state is-' + kind + '">' +
      '<h2>' + esc(title) + '</h2>' + (text ? '<p>' + text + '</p>' : '') +
      (actions ? '<div class="pm-state-actions">' + actions + '</div>' : '') + '</div>';
  }

  function showResultsState(html) {
    S.results = [];
    $('results-bar').hidden = true;
    $('results').innerHTML = html;
  }

  function noKeyState(message) {
    const why = S.mode === 'local'
      ? '目前是離線示範（js/config.js 沒有設定 api.url），無法連線 Google Maps。'
      : esc(message || '尚未設定 Google Maps API 金鑰。') + '<br>請在 Apps Script「專案設定 → 指令碼屬性」新增 <code>PLACES_API_KEY</code>，再重新部署。';
    showResultsState(stateBox('nokey', '無法使用 Google Maps 搜尋', why,
      '<button class="btn primary" type="button" data-state="local">顯示目前所有景點</button>'));
  }

  // 目前所有景點（不連線，立即顯示）：預設畫面、沒有 Google 金鑰時的「搜尋」、改變篩選條件時
  function localResults() {
    const p = searchParams();
    const data = Trip.placesStore.localSearch(p, S.stops, allPois());
    S.results = data.results;
    S.resultSource = 'local';
    S.resultNote = '';
    renderResults();
  }

  function doSearch() {
    const p = searchParams();
    if (!p.region) { toast('請選擇搜尋地區', 'error'); return; }
    if (S.mode === 'local' || !S.searchEnabled) { localResults(); return; }

    showResultsState('<div class="pm-results-grid" aria-busy="true">' +
      Array.from({ length: 6 }, () => '<div class="card pm-result is-skeleton" aria-hidden="true">' +
        '<span class="pm-photo sk"></span><span class="sk sk-line w70"></span><span class="sk sk-line w40 sm"></span><span class="sk sk-line w90 sm"></span></div>').join('') +
      '<span class="visually-hidden">正在搜尋景點…</span></div>');
    $('search-btn').disabled = true;

    const req = store.search(p).then((d) => Object.assign({}, d, { results: Trip.placesStore.mergeLocal(Trip.placesStore.localSearch(p, S.stops, allPois()).results, d.results || []) }));
    req.then((data) => {
      S.results = data.results || [];
      S.resultSource = data.source;
      S.resultNote = data.note || '';
      renderResults();
    }).catch((e) => {
      if (e.code === 'NO_API_KEY') { S.searchEnabled = false; noKeyState(e.message); return; }
      showResultsState(stateBox('error', '搜尋失敗', esc(e.message || '無法取得景點資料'),
        '<button class="btn primary" type="button" data-state="retry">重新搜尋</button>' +
        '<button class="btn" type="button" data-state="local">顯示目前所有景點</button>'));
    }).finally(() => { $('search-btn').disabled = false; });
  }

  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });
  $('manual-btn').addEventListener('click', openManual);

  function onStateClick(e) {
    const b = e.target.closest('[data-state]');
    if (!b) return;
    if (b.dataset.state === 'local') localResults();
    else if (b.dataset.state === 'rating-any') { $('f-rating').value = '0'; doSearch(); }
    else if (b.dataset.state === 'manual') openManual();
    else if (b.dataset.state === 'retry') doSearch();
    else if (b.dataset.state === 'google') doSearch();
  }
  $('results').addEventListener('click', onStateClick);
  $('results-source').addEventListener('click', onStateClick);

  function renderResults() {
    const keys = importedKeys();
    const list = S.results;
    const bar = $('results-bar');
    if (!list.length) {
      const p = searchParams();
      // 無評分的景點只在「不限」時列出：算出因評分被隱藏的數量，提示使用者
      const hidden = Number(p.minRating)
        ? Trip.placesStore.localSearch(Object.assign({}, p, { minRating: '0' }), S.stops, allPois()).results.filter((r) => r.rating == null).length
        : 0;
      showResultsState(stateBox('empty', '沒有符合條件的景點',
        '「' + esc(($('f-region').selectedOptions[0] || {}).textContent || p.region) + '」找不到' + (Number(p.minRating) ? ' ' + esc(p.minRating) + ' 星以上的' : '') +
        esc(CATEGORY[p.category] || '') + '。可以放寬評分、改變類型或地區再試一次。' +
        (hidden ? '<br>有 <b>' + hidden + '</b> 個無評分的景點，評分選「不限」才會列出。' : ''),
        (hidden ? '<button class="btn primary" type="button" data-state="rating-any">改成「不限」再搜尋</button>' : '') +
        (S.resultSource === 'local' && S.mode === 'remote' && S.searchEnabled
          ? '<button class="btn" type="button" data-state="google">用 Google Maps 搜尋</button>' : '')));
      return;
    }

    bar.hidden = false;
    const google = S.mode === 'remote' && S.searchEnabled;
    // 景點搜尋與地點清單是同一批景點（原行程地點＋地點清單）；Google 搜尋時再加上 Google 的結果
    $('results-source').innerHTML = S.resultSource === 'local'
      ? (google ? '<button class="pm-link" type="button" data-state="google">用 Google Maps 搜尋更多</button>' : '')
      : '已加入 Google Maps 搜尋結果 <button class="pm-link" type="button" data-state="local">只看地點清單</button>';
    bar.hidden = !$('results-source').innerHTML;      // 沒有可顯示的內容時整列隱藏

    $('results').innerHTML = '<div class="pm-results-grid">' + list.map((r, i) => {
      const inList = r.fromStops || r.fromPois || keys.has(Trip.PoiLogic.poiKey(r));
      const own = ownPhoto(r);
      const photo = own
        ? '<figure class="pm-photo"><img src="' + esc(own) + '" alt="' + esc(r.name) + '" loading="lazy" referrerpolicy="no-referrer">' +
          (pendingOf(r) ? '<figcaption>尚未上傳（按「確認」後上傳）</figcaption>' : '') + '</figure>'
        : r.photo && safeUrl(r.photo.uri)
        ? '<figure class="pm-photo"><img src="' + esc(safeUrl(r.photo.uri)) + '" alt="' + esc(r.name) + '" loading="lazy" referrerpolicy="no-referrer">' +
          ((r.photo.attributions || []).length ? '<figcaption>照片：' + r.photo.attributions.map((a) =>
            safeUrl(a.uri) ? '<a href="' + esc(safeUrl(a.uri)) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a>' : esc(a.name)).join('、') + '</figcaption>' : '') +
          '</figure>'
        : '<div class="pm-photo is-empty" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>' +
          '<small>沒有照片</small>' + '</div>';
      const t = resultTarget(r);
      return '<article class="card pm-result">' +
        photo +
        '<div class="pm-result-body">' +
          '<h3>' + esc(r.name) + '</h3>' +
          '<div class="pm-meta">' + stars(r.rating, r.rating_count) +
            (r.type_label ? '<span class="pm-chip">' + esc(r.type_label) + '</span>' : '') +
            (t.kind === 'staged' ? '<span class="pm-chip is-new">未儲存</span>' : '') +
            (!inList ? '<span class="pm-chip">Google Maps</span>' : '') +
            planChips(r) + '</div>' +
          '<p class="pm-addr">' + esc(r.address || '（沒有地址）') + '</p>' +
          (safeUrl(r.maps_url) ? '<a class="pm-maplink" href="' + esc(safeUrl(r.maps_url)) + '" target="_blank" rel="noopener">在 Google 地圖查看 ↗</a>' : '') +
          // 選擇天數＋加入：還不在地點清單的（Google 結果）會先加入地點清單（暫存），再排進那一天
          '<div class="pm-poi-actions pm-result-actions">' +
            '<label class="visually-hidden" for="rday-' + i + '">安排 ' + esc(r.name) + ' 到哪一天</label>' +
            '<select id="rday-' + i + '">' + dayOptions(null, '選擇天數') + '</select>' +
            '<button class="btn primary pm-small" type="button" data-act="schedule-result" data-i="' + i + '" aria-label="把 ' + esc(r.name) + ' 加入行程">加入</button>' +
          '</div>' +
        '</div></article>';
    }).join('') + '</div>';
  }

  // 匯入：只存景點資料（照片網址會過期、依規範不保存）
  function toItem(r) {
    return {
      google_place_id: r.google_place_id || null, name: r.name, address: r.address || null,
      lat: r.lat, lng: r.lng, rating: r.rating, rating_count: r.rating_count,
      primary_type: r.primary_type || null, type_label: r.type_label || null, category: r.category || null,
      maps_url: r.maps_url || null, source: r.source || 'google',
      note: r.note || null, _photo: r._photo || null,
      photo_url: r.photo_url || null,          // 自己的照片（雲端硬碟，例如原行程地點的照片）一併帶進地點清單
    };
  }

  // 「加入地點」：先暫存在頁面上（S.newPois，poi_id 用負數），按「確認」時才和行程一起寫入試算表
  function addNewPois(items) {
    const state = { pois: allPois(), schedule: [] };
    const res = Trip.PoiLogic.importPois(state, items, new Date().toISOString());
    let tmp = Math.min(0, ...S.newPois.map((p) => Number(p.poi_id)));
    res.added.forEach((p) => {
      p.poi_id = --tmp; p.unsaved = true;
      const src = items.find((it) => Trip.PoiLogic.poiKey(it) === Trip.PoiLogic.poiKey(p));
      if (src && src._photo) p._photo = src._photo;                // 選好的照片：按「確認」儲存地點後才上傳
      S.newPois.push(p);
    });
    renderAll();
    return res;
  }

  /* ---------------- 手動新增 ---------------- */
  function openManual() {
    openModal('手動新增',
      '<form class="pm-form" id="manual-form" novalidate>' +
        '<div class="pm-field"><label for="m-name">景點名稱 <b class="pm-req">必填</b></label><input id="m-name" maxlength="80" required></div>' +
        '<div class="pm-field"><label for="m-address">地址</label><input id="m-address" maxlength="160"></div>' +
        '<div class="pm-form-row">' +
          '<div class="pm-field"><label for="m-category">類型</label><select id="m-category">' +
            Object.keys(CATEGORY).map((k) => '<option value="' + k + '">' + CATEGORY[k] + '</option>').join('') + '</select></div>' +
          '<div class="pm-field"><label for="m-rating">評分（選填，0–5）</label><input id="m-rating" type="number" min="0" max="5" step="0.1" inputmode="decimal"></div>' +
        '</div>' +
        '<div class="pm-form-row">' +
          '<div class="pm-field"><label for="m-lat">緯度（選填）</label><input id="m-lat" type="number" step="any" inputmode="decimal" placeholder="26.2125"></div>' +
          '<div class="pm-field"><label for="m-lng">經度（選填）</label><input id="m-lng" type="number" step="any" inputmode="decimal" placeholder="127.6792"></div>' +
        '</div>' +
        '<div class="pm-field"><label for="m-url">Google 地圖連結（選填）</label><input id="m-url" type="url" placeholder="https://maps.app.goo.gl/…"></div>' +
        '<div class="pm-field"><label for="m-note">備註</label><textarea id="m-note" rows="2" maxlength="500"></textarea></div>' +
        photoField('m-photo', null) +
        '<p class="pm-form-err" id="m-err" role="alert" hidden></p>' +
        '<div class="pm-modal-actions"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">加入地點</button></div>' +
      '</form>', { full: true, submit: { form: 'manual-form', label: '加入' } });
    $('m-name').focus();
    const manualPhoto = bindPhotoField('m-photo');
    $('manual-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (id) => $(id).value.trim();
      const errBox = $('m-err');
      const num = (id, lo, hi) => { const s = v(id); if (!s) return null; const n = Number(s); return isFinite(n) && n >= lo && n <= hi ? n : NaN; };
      const rating = num('m-rating', 0, 5), lat = num('m-lat', -90, 90), lng = num('m-lng', -180, 180);
      const url = v('m-url');
      const problem = !v('m-name') ? '請輸入景點名稱'
        : Number.isNaN(rating) ? '評分需介於 0 到 5'
        : Number.isNaN(lat) || Number.isNaN(lng) ? '緯度需介於 -90～90、經度需介於 -180～180'
        : (lat == null) !== (lng == null) ? '緯度與經度要一起填寫'
        : url && !safeUrl(url) ? '地圖連結需以 https:// 開頭' : '';
      if (problem) { errBox.textContent = problem; errBox.hidden = false; return; }
      const name = v('m-name'), address = v('m-address');
      const item = {
        name, address: address || null, category: $('m-category').value,
        type_label: CATEGORY[$('m-category').value], rating, rating_count: null, lat, lng,
        maps_url: url || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + (address ? ' ' + address : '')),
        note: v('m-note') || null, source: 'manual', _photo: manualPhoto.get(),
      };
      const res = addNewPois([item]);
      if (res.added.length) { closeModal(); toast('已加入「' + name + '」（暫存，到「行程安排」按「確認」才會寫入）', 'ok'); }
      else { errBox.textContent = '「' + name + '」已在景點清單中（名稱與地址相同）'; errBox.hidden = false; }
    });
  }

  /* ======================================================================
     2. 地點清單
     ====================================================================== */
  function renderPois() {
    const box = $('pois');
    const nNew = S.newPois.length;
    const stops = listStops();
    $('pois-count').textContent = '共 ' + (allPois().length + stops.length) + ' 個地點' + (nNew ? '（' + nNew + ' 個尚未儲存）' : '');
    if (!allPois().length && !stops.length) {
      box.innerHTML = stateBox('empty', '景點清單是空的', '按上方「手動新增」，或到「景點搜尋」用 Google Maps 搜尋後排進行程。',
        '<button class="btn primary" type="button" data-go="search">前往景點搜尋</button>');
      return;
    }
    // 尚未儲存的排最前面，其次是最新匯入的
    const pois = S.newPois.slice().reverse().concat(S.pois.slice().sort((a, b) => Number(b.poi_id) - Number(a.poi_id)));
    box.innerHTML = '<div class="pm-pois-grid">' + pois.map((p) => {
      const days = namedDays(p.name);
      const coords = p.lat != null && p.lng != null ? Number(p.lat).toFixed(5) + ', ' + Number(p.lng).toFixed(5) : '—';
      return '<article class="card pm-poi' + (isNew(p.poi_id) ? ' is-new' : '') + '" data-poi="' + p.poi_id + '">' +
        poiThumb(p) +
        '<header class="pm-poi-head">' +
          '<h3>' + esc(p.name) + '</h3>' +
          '<div class="pm-meta">' + stars(p.rating, p.rating_count) +
            (p.type_label ? '<span class="pm-chip">' + esc(p.type_label) + '</span>' : '') + sourceChip(p.source) +
            (isNew(p.poi_id) ? '<span class="pm-chip is-new">未儲存</span>' : '') + dayChips(days) + '</div>' +
        '</header>' +
        '<details class="pm-details"><summary>完整資訊</summary><dl>' +
          '<dt>地址</dt><dd>' + esc(p.address || '—') + '</dd>' +
          '<dt>類型</dt><dd>' + esc(p.type_label || CATEGORY[p.category] || '—') + '</dd>' +   // 與卡片上的類型標籤相同，只顯示一個
          '<dt>座標</dt><dd>' + esc(coords) + '</dd>' +
          '<dt>景點編號</dt><dd class="pm-mono">' + esc(p.poi_id) + '</dd>' +
          '<dt>匯入時間</dt><dd>' + esc(fmtTime(p.created_at)) + '</dd>' +
          '<dt>更新時間</dt><dd>' + esc(fmtTime(p.updated_at)) + '</dd>' +
          '<dt>備註</dt><dd>' + esc(p.note || '—') + '</dd>' +
        '</dl>' + (safeUrl(p.maps_url) ? '<a class="pm-maplink" href="' + esc(safeUrl(p.maps_url)) + '" target="_blank" rel="noopener">在 Google 地圖查看 ↗</a>' : '') +
        '</details>' +
        // 編輯與刪除放在一起（安排到哪一天改在「景點搜尋」）
        '<div class="pm-poi-actions">' +
          '<button class="btn pm-small" type="button" data-act="edit-poi" data-id="' + p.poi_id + '" aria-label="編輯 ' + esc(p.name) + '">編輯</button>' +
          '<button class="btn pm-small pm-danger" type="button" data-act="ask-delete" data-id="' + p.poi_id + '" aria-label="刪除 ' + esc(p.name) + '">刪除</button>' +
        '</div>' +
      '</article>';
    }).join('') + stops.map(stopCard).join('') + '</div>';
  }

  // 同名景點（原行程地點與地點清單的地點）目前排在哪幾天：同一個景點可以在不同天重複出現
  function namedDays(name) {
    const n = normName(name);
    return [...new Set(visible(S.draft).filter((r) => normName(itemInfo(r).name) === n).map((r) => Number(r.day_no)))].sort((a, b) => a - b);
  }
  // 「已安排」標籤（放在 pm-meta 裡）
  function dayChips(days) {
    return days.length
      ? days.map((d) => '<span class="pm-chip is-day">已安排：第 ' + d + ' 天</span>').join('')
      : '';                                     // 沒有安排時不顯示標籤
  }

  // 原行程地點（試算表 place）的卡片：可編輯、可刪除（刪除＝從地點清單與行程移除，place 資料保留）
  function stopCard(r) {
    const days = namedDays(r.name);
    const coords = r.lat != null && r.lng != null ? Number(r.lat).toFixed(5) + ', ' + Number(r.lng).toFixed(5) : '—';
    return '<article class="card pm-poi" data-place="' + esc(r.place_id) + '">' +
      poiThumb(r) +
      '<header class="pm-poi-head">' +
        '<h3>' + esc(r.name) + '</h3>' +
        '<div class="pm-meta">' + stars(r.rating, r.rating_count) +
          (r.type_label ? '<span class="pm-chip">' + esc(r.type_label) + '</span>' : '') + dayChips(days) + '</div>' +
      '</header>' +
      '<details class="pm-details"><summary>完整資訊</summary><dl>' +
        '<dt>地址</dt><dd>' + esc(r.address || '—') + '</dd>' +
        '<dt>類型</dt><dd>' + esc(r.type_label || '—') + '</dd>' +
        '<dt>座標</dt><dd>' + esc(coords) + '</dd>' +
        '<dt>地點編號</dt><dd class="pm-mono">place ' + esc(r.place_id) + '</dd>' +
        '<dt>更新時間</dt><dd>' + esc(fmtTime(r.updated_at)) + '</dd>' +
        '<dt>備註</dt><dd>' + esc(r.note || '—') + '</dd>' +
      '</dl>' + (safeUrl(r.maps_url) ? '<a class="pm-maplink" href="' + esc(safeUrl(r.maps_url)) + '" target="_blank" rel="noopener">在 Google 地圖查看 ↗</a>' : '') +
      '</details>' +
      '<div class="pm-poi-actions">' +
        '<button class="btn pm-small" type="button" data-act="edit-stop" data-place="' + esc(r.place_id) + '" aria-label="編輯 ' + esc(r.name) + '">編輯</button>' +
        '<button class="btn pm-small pm-danger" type="button" data-act="ask-delete-stop" data-place="' + esc(r.place_id) + '" aria-label="刪除 ' + esc(r.name) + '">刪除</button>' +
      '</div>' +
    '</article>';
  }
  // 景點搜尋卡片：目前（畫面上的行程安排）排在哪幾天
  function stopDays(placeId) {
    return [...new Set(S.draft.filter((s) => Trip.PoiLogic.isStop(s) && !Trip.PoiLogic.isHidden(s))
      .filter((s) => { const t = stopById(s.day_stop_id); return t && Number(t.place_id) === Number(placeId); })
      .map((s) => Number(s.day_no)))].sort((a, b) => a - b);
  }
  function planChips(r) {
    const days = namedDays(r.name);
    return days.map((d) => '<span class="pm-chip is-day">已安排：第 ' + d + ' 天</span>').join('');
  }
  const stopItem = (placeId) => listStops().find((r) => Number(r.place_id) === Number(placeId));

  function askDeleteStop(placeId) {
    const r = stopItem(placeId);
    if (!r) return;
    if (S.mode !== 'remote') { toast('離線示範不能刪除原行程地點', 'warn'); return; }
    const ids = [...new Set(S.stops.filter((t) => normName(t.name) === normName(r.name) && t.place_id != null).map((t) => Number(t.place_id)))];
    const days = [...new Set(S.stops.filter((t) => ids.indexOf(Number(t.place_id)) >= 0).map((t) => Number(t.day_no)))].sort((a, b) => a - b);
    const planned = namedDays(r.name);
    openModal('刪除確認',
      '<p>確定刪除「<b>' + esc(r.name) + '</b>」？' + (planned.length ? '第 ' + esc(planned.join('、')) + ' 天的行程也會一併移除。' : '') + '</p>' +
      '<div class="pm-modal-actions">' +
        '<button class="btn" type="button" data-close>取消</button>' +
        '<button class="btn pm-danger is-solid" type="button" id="delete-confirm">刪除</button>' +
      '</div>');
    $('delete-confirm').focus();
    $('delete-confirm').addEventListener('click', () => {
      closeModal();
      run({ type: 'deletePlace', place_ids: ids }).then(() => toast('已刪除「' + r.name + '」', 'ok'))
        .catch((e) => toast(e.code === 'BAD_OP'
          ? 'Apps Script 還沒更新，請部署新版本（PoiStore.gs、Itinerary.gs）' : e.message, 'error'));
    });
  }

  /* ---------------- 景點照片（存到雲端硬碟 images 資料夾，網址寫回試算表） ---------------- */
  const CAMERA = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  function photoAttrs(t) {
    return (t.poi_id != null ? ' data-poi-id="' + t.poi_id + '"' : '') + (t.place_id != null ? ' data-place-id="' + t.place_id + '"' : '');
  }
  function poiThumb(p) {
    if (p._photo) return '<figure class="pm-photo pm-poi-photo"><img src="' + esc(p._photo.preview) + '" alt="' + esc(p.name) + '"><figcaption>按「確認」後上傳</figcaption></figure>';
    return safeUrl(photoOf(p))
      ? '<figure class="pm-photo pm-poi-photo"><img src="' + esc(safeUrl(photoOf(p))) + '" alt="' + esc(p.name) + '" loading="lazy" referrerpolicy="no-referrer"></figure>'
      : '<div class="pm-photo pm-poi-photo is-empty" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg><small>沒有照片</small></div>';
  }
  function photoButton(t) {
    const blocked = t.unsaved ? ' disabled title="按「確認」儲存這個地點後才能上傳照片"' : ' title="JPG、PNG、WebP，檔案 1 MB 以內"';
    return '<button class="btn pm-small" type="button" data-act="photo"' + photoAttrs(t) + blocked +
      ' aria-label="' + (t.photo ? '更換' : '上傳') + ' ' + esc(t.name) + ' 的照片">' + (t.photo ? '更換照片' : '上傳照片') + '</button>';
  }
  // 行程安排：每個地點左邊的小縮圖，只能預覽（照片在「地點清單」上傳）；點一下放大
  const NO_PHOTO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m5 17 4.5-4.5 3 3 2.5-2.5L19 17"/></svg>';
  function slotThumb(it) {
    const url = safeUrl(it.photo);
    if (!url) return '<span class="pm-slot-thumb is-empty" title="沒有照片" aria-hidden="true">' + NO_PHOTO + '</span>';
    return '<button class="pm-slot-thumb" type="button" data-act="preview-photo" data-src="' + esc(url) + '" data-name="' + esc(it.name) + '"' +
      ' title="預覽照片" aria-label="預覽 ' + esc(it.name) + ' 的照片">' +
      '<img src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></button>';
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="preview-photo"]');
    if (!b) return;
    openModal(b.dataset.name || '照片',
      '<figure class="pm-photo-preview"><img src="' + esc(b.dataset.src) + '" alt="' + esc(b.dataset.name || '') + '" referrerpolicy="no-referrer"></figure>' +
      '<div class="pm-modal-actions"><button class="btn" type="button" data-close>關閉</button></div>');
  });

  // 縮小照片：長邊 1000px，優先 WebP（不支援時用 JPG），檔案控制在約 600 KB 內
  const PHOTO_MAX = 1024 * 1024;                     // 照片檔案上限 1 MB
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('請選擇圖片檔（JPG、PNG、WebP）')); return; }
      if (file.size > PHOTO_MAX) { reject(new Error('照片不能超過 1 MB（這張約 ' + (file.size / 1048576).toFixed(1) + ' MB），請先縮小再上傳')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        let mime = 'image/webp', q = 0.82, d = c.toDataURL(mime, q);
        if (d.indexOf('data:image/webp') !== 0) { mime = 'image/jpeg'; q = 0.85; d = c.toDataURL(mime, q); }
        while (d.length * 0.75 > 600 * 1024 && q > 0.45) { q -= 0.1; d = c.toDataURL(mime, q); }
        resolve({ mime: mime, data: d.slice(d.indexOf(',') + 1), preview: d });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片（HEIC 等格式請先轉成 JPG）')); };
      img.src = url;
    });
  }

  const photoInput = document.createElement('input');
  photoInput.type = 'file';
  photoInput.accept = 'image/jpeg,image/png,image/webp';
  photoInput.hidden = true;
  document.body.appendChild(photoInput);
  let photoTarget = null;

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="photo"]');
    if (!b || b.disabled || S.busy) return;
    if (S.mode !== 'remote' || !store.uploadPhoto) { toast('離線示範不支援上傳照片', 'warn'); return; }
    photoTarget = b.dataset.poiId != null ? { poi_id: Number(b.dataset.poiId) } : { place_id: Number(b.dataset.placeId) };
    photoInput.value = '';
    photoInput.click();
  });

  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0];
    const target = photoTarget;
    if (!file || !target) return;
    shrinkImage(file).then((img) => doUpload(target, img)).catch((e) => toast('照片上傳失敗：' + e.message, 'error'));
  });

  // 上傳一張已縮小的照片（img = shrinkImage 的結果）到 target（{ poi_id } 或 { place_id }），成功後更新畫面
  function doUpload(target, img, quiet) {
    setBusy(true);
    if (!quiet) toast('照片上傳中…', 'ok');
    return store.uploadPhoto(Object.assign({ mime: img.mime, data: img.data }, target))
      .then((res) => {
        if (target.poi_id != null) S.pois.forEach((p) => { if (Number(p.poi_id) === target.poi_id) p.photo_url = res.photo_url; });
        else {
          S.stops.forEach((t) => { if (Number(t.place_id) === target.place_id) t.photo_url = res.photo_url; });
          S.results.forEach((x) => { if (x.fromStops && Number(x.place_id) === target.place_id) x.photo_url = res.photo_url; });
        }
        notifyMap();
        if (!quiet) toast('照片已上傳到雲端硬碟 images 資料夾', 'ok');
        return res;
      })
      .catch((e) => {
        throw Object.assign(new Error(e.code === 'BAD_OP' ? 'Apps Script 還沒更新，請部署新版本（PoiStore.gs）' : e.message), { code: e.code });
      })
      .finally(() => { setBusy(false); renderAll(); });
  }

  // 「確認」儲存新地點後，上傳在「編輯」或「手動新增」時選好的照片
  function uploadPending(list) {
    let ok = 0, bad = 0;
    return list.reduce((pr, x) => pr.then(() => {
      const poi = S.pois.find((p) => Trip.PoiLogic.poiKey(p) === x.key);
      if (!poi) { bad++; return null; }
      return doUpload({ poi_id: Number(poi.poi_id) }, x.photo, true).then(() => { ok++; }, () => { bad++; });
    }), Promise.resolve()).then(() => {
      if (ok) toast('已上傳 ' + ok + ' 張照片到雲端硬碟 images 資料夾', 'ok');
      if (bad) toast(bad + ' 張照片上傳失敗，可到「地點清單」重新上傳', 'error');
    });
  }

  /* ---------------- 照片欄位（手動新增、編輯共用） ---------------- */
  const isDataImg = (u) => /^data:image\/(webp|jpeg|png);base64,/.test(String(u || ''));
  function photoField(id, current) {
    const url = isDataImg(current) ? current : safeUrl(current);
    const off = S.mode !== 'remote';
    return '<div class="pm-field pm-photo-field"><label for="' + id + '">照片（選填）</label>' +
      '<div class="pm-photo-pick">' +
        '<div class="pm-photo-prev" id="' + id + '-prev">' + (url ? '<img src="' + esc(url) + '" alt="" referrerpolicy="no-referrer">' : '<small>沒有照片</small>') + '</div>' +
        '<div class="pm-photo-pick-input"><input type="file" id="' + id + '" accept="image/jpeg,image/png,image/webp"' + (off ? ' disabled' : '') + '>' +
          '<small>' + (off ? '離線示範不支援上傳照片' : '檔案 1 MB 以內；長邊會縮成 1000px，存到雲端硬碟 images 資料夾') + '</small></div>' +
      '</div></div>';
  }
  // 選檔後先縮小並預覽；get() 取得縮好的照片（沒選就是 null）
  function bindPhotoField(id) {
    const input = $(id), prev = $(id + '-prev');
    const form = input.closest('form');
    const submit = form && form.querySelector('[type=submit]');
    let chosen = null;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (submit) submit.disabled = true;
      shrinkImage(file)
        .then((img) => { chosen = img; prev.innerHTML = '<img src="' + esc(img.preview) + '" alt="">'; })
        .catch((e) => { chosen = null; input.value = ''; toast(e.message, 'error'); })
        .finally(() => { if (submit) submit.disabled = false; });
    });
    return { get: () => chosen };
  }

  /* ---------------- 景點搜尋：編輯搜尋結果 ---------------- */
  const keyOf = (x) => Trip.PoiLogic.poiKey(x);
  function resultTarget(r) {
    if (r.fromStops && r.place_id != null) return { kind: 'stop', obj: r };
    const saved = S.pois.find((p) => keyOf(p) === keyOf(r));
    if (saved) return { kind: 'saved', obj: saved };
    const staged = S.newPois.find((p) => keyOf(p) === keyOf(r));
    if (staged) return { kind: 'staged', obj: staged };
    return { kind: 'raw', obj: r };
  }
  // 還沒上傳的照片：只有尚未加入（raw）或已加入但未儲存（staged）的地點才有
  function pendingOf(r) {
    const t = resultTarget(r);
    if (t.kind === 'staged') return t.obj._photo || null;
    if (t.kind === 'raw') return r._photo || null;
    return null;
  }
  function ownPhoto(r) {
    const pend = pendingOf(r);
    if (pend) return pend.preview;
    const t = resultTarget(r);
    return safeUrl(t.obj.photo_url) || safeUrl(r.photo_url) || safeUrl(photoOf(t.obj)) || '';
  }

  // r：要編輯的地點（地點清單的 poi；也可傳入搜尋結果）
  function openEdit(r) {
    if (!r) return;
    const t = resultTarget(r), o = t.obj;
    const stop = t.kind === 'stop';
    if (stop && S.mode !== 'remote') { toast('離線示範不能編輯原行程地點', 'warn'); return; }
    const val = (v) => (v == null ? '' : esc(String(v)));
    const hint = { raw: '修改後排進行程，按「確認」時才會寫入試算表。',
                   staged: '這個地點已加入但尚未儲存：修改先暫存，按「確認」時一起寫入。',
                   saved: '這個地點已在地點清單：按「儲存」會直接更新試算表。',
                   stop: '目前行程的地點：按「儲存」會直接更新試算表 place 頁籤（名稱、座標、評分、類型、地圖連結、備註、照片）。地址請在試算表修改。' }[t.kind];
    const current = (o._photo && o._photo.preview) || o.photo_url || r.photo_url || photoOf(o) || null;
    openModal('編輯「' + r.name + '」',
      '<form class="pm-form" id="edit-form" novalidate>' +
        '<p class="pm-hint">' + esc(hint) + '</p>' +
        '<div class="pm-field"><label for="e-name">景點名稱 <b class="pm-req">必填</b></label><input id="e-name" maxlength="80" required value="' + val(o.name) + '"></div>' +
        '<div class="pm-field"><label for="e-address">地址</label><input id="e-address" maxlength="160" value="' + val(o.address) + '"' + (stop ? ' disabled' : '') + '></div>' +
        '<div class="pm-form-row">' +
          '<div class="pm-field"><label for="e-lat">緯度' + (stop ? '' : '（選填）') + '</label><input id="e-lat" type="number" step="any" inputmode="decimal" value="' + val(o.lat) + '"></div>' +
          '<div class="pm-field"><label for="e-lng">經度' + (stop ? '' : '（選填）') + '</label><input id="e-lng" type="number" step="any" inputmode="decimal" value="' + val(o.lng) + '"></div>' +
        '</div>' +
        '<div class="pm-form-row">' +
          '<div class="pm-field"><label for="e-category">類型</label><select id="e-category">' +
            Object.keys(CATEGORY).map((k) => '<option value="' + k + '"' + ((o.category || 'attraction') === k ? ' selected' : '') + '>' + CATEGORY[k] + '</option>').join('') + '</select></div>' +
          '<div class="pm-field"><label for="e-rating">評分（選填，0–5）</label><input id="e-rating" type="number" min="0" max="5" step="0.1" inputmode="decimal" value="' + val(o.rating) + '"></div>' +
        '</div>' +
        '<div class="pm-field"><label for="e-url">Google 地圖連結（選填）</label><input id="e-url" type="url" placeholder="https://maps.app.goo.gl/…" value="' + val(o.maps_url) + '"></div>' +
        '<div class="pm-field"><label for="e-note">備註</label><textarea id="e-note" rows="2" maxlength="500">' + val(o.note) + '</textarea></div>' +
        photoField('e-photo', current) +
        '<p class="pm-form-err" id="e-err" role="alert" hidden></p>' +
        '<div class="pm-modal-actions"><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">儲存</button></div>' +
      '</form>', { full: true, submit: { form: 'edit-form', label: '儲存' } });
    $('e-name').focus();
    const pick = bindPhotoField('e-photo');
    $('edit-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (id) => ($(id) ? $(id).value.trim() : '');
      const num = (id, lo, hi) => { const x = v(id); if (!x) return null; const n = Number(x); return isFinite(n) && n >= lo && n <= hi ? n : NaN; };
      const lat = num('e-lat', -90, 90), lng = num('e-lng', -180, 180), rating = num('e-rating', 0, 5);
      const url = v('e-url');
      const problem = !v('e-name') ? '請輸入景點名稱'
        : Number.isNaN(rating) ? '評分需介於 0 到 5'
        : url && !safeUrl(url) ? '地圖連結需以 https:// 開頭'
        : Number.isNaN(lat) || Number.isNaN(lng) ? '緯度需介於 -90～90、經度需介於 -180～180'
        : (lat == null) !== (lng == null) ? '緯度與經度要一起填寫'
        : stop && lat == null ? '原行程地點需要座標' : '';
      if (problem) { $('e-err').textContent = problem; $('e-err').hidden = false; return; }
      const category = $('e-category').value;
      const common = { name: v('e-name'), lat: lat, lng: lng, rating: rating, category: category, maps_url: url || null, note: v('e-note') || null };
      // 類型改了，顯示的類型名稱也跟著換（原本是 Google 類型名稱且類型沒變的，保留原名稱）
      const typeLabel = category !== (o.category || 'attraction') || !o.type_label ? CATEGORY[category] : o.type_label;
      const patch = stop ? common : Object.assign({ address: v('e-address') || null, type_label: typeLabel }, common);
      const photo = pick.get();
      const syncResult = () => {
        Object.assign(r, { name: patch.name, lat: patch.lat, lng: patch.lng, rating: patch.rating, category: patch.category,
                           maps_url: patch.maps_url || r.maps_url, note: patch.note, type_label: typeLabel }, stop ? {} : { address: patch.address });
      };
      closeModal();
      if (t.kind === 'raw') {
        Object.assign(r, patch, { type_label: typeLabel, maps_url: patch.maps_url || r.maps_url });
        if (photo) r._photo = photo;
        renderResults();
        toast('已修改（尚未儲存）：排進行程後到「行程安排」按「確認」', 'ok');
        return;
      }
      if (t.kind === 'staged') {
        try { Trip.PoiLogic.updatePoi({ pois: S.newPois, schedule: [] }, o.poi_id, patch, new Date().toISOString()); }
        catch (e2) { fail(e2); return; }
        if (photo) o._photo = photo;
        syncResult();
        renderAll();
        toast('已修改（暫存）：按「確認」時一起寫入' + (photo ? '，照片也會一起上傳' : ''), 'ok');
        return;
      }
      const op = stop ? { type: 'updatePlace', place_id: Number(o.place_id), patch: patch }
                      : { type: 'updatePoi', poi_id: Number(o.poi_id), patch: patch };
      run(op)
        .then(() => {
          syncResult();
          if (stop) S.results.forEach((x) => { if (x.fromStops && Number(x.place_id) === Number(o.place_id)) Object.assign(x, { name: patch.name, lat: patch.lat, lng: patch.lng }); });
          notifyMap();
          if (!photo) { toast('已儲存到 Google 試算表', 'ok'); return null; }
          return doUpload(stop ? { place_id: Number(o.place_id) } : { poi_id: Number(o.poi_id) }, photo, true)
            .then(() => toast('已儲存到 Google 試算表，照片已上傳', 'ok'));
        })
        .catch((e2) => toast((e2.code === 'BAD_OP' ? 'Apps Script 還沒更新，請部署新版本（PoiLogic.gs、PoiStore.gs）' : e2.message), 'error'))
        .finally(() => renderAll());
    });
  }

  // 景點搜尋卡片的「選擇天數＋加入」
  $('results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="schedule-result"]');
    if (!b || S.busy) return;
    const i = Number(b.dataset.i), r = S.results[i];
    if (!r) return;
    const daySel = $('rday-' + i);
    const day = daySel && daySel.value;
    if (!day) { toast('請先選擇要安排到第幾天', 'warn'); if (daySel && daySel._rs) daySel._rs.focus(); return; }
    const nm = normName(r.name);
    if (namedDays(r.name).indexOf(Number(day)) >= 0) { toast('「' + r.name + '」已經在第 ' + day + ' 天，同一天不能重複安排', 'warn'); return; }
    let poi = allPois().find((x) => Trip.PoiLogic.poiKey(x) === Trip.PoiLogic.poiKey(r)) ||
              allPois().find((x) => normName(x.name) === nm);         // 同名的地點已在清單中就直接用它
    if (!poi) {
      const res = addNewPois([toItem(r)]);
      poi = res.added[0] || allPois().find((x) => Trip.PoiLogic.poiKey(x) === Trip.PoiLogic.poiKey(r));
    }
    if (poi) scheduleAdd(poi.poi_id, Number(day), false);
  });

  // 地點清單卡片的「編輯」
  $('pois').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="edit-poi"]');
    if (!b || S.busy) return;
    const p = allPois().find((x) => Number(x.poi_id) === Number(b.dataset.id));
    if (p) openEdit(p);
  });

  function fmtTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString('zh-TW', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function scheduleAdd(poiId, dayNo, move) {
    const p = poiById(poiId);
    const before = p ? namedDays(p.name) : [];
    try {
      openDays.add(Number(dayNo));
      draftApply({ type: 'scheduleAdd', poi_id: poiId, day_no: dayNo, move: !!move });
      toast((move ? '已移到' : '已安排到') + '第 ' + dayNo + ' 天：' + (p ? p.name : '') +
        (before.length ? '（也在第 ' + before.join('、') + ' 天）' : '') + '。到「行程安排」按「確認」才會儲存', 'ok');
    } catch (e) {
      if (e.code === 'SAME_DAY') return toast(e.message + '，同一天不能重複安排', 'warn');
      fail(e);
    }
  }

  $('pois').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { showTab(go.dataset.go); return; }
    const b = e.target.closest('[data-act]');
    if (!b || S.busy) return;
    const id = Number(b.dataset.id);
    switch (b.dataset.act) {
      case 'note': {
        const v = $('note-' + id).value;
        if (isNew(id)) {                                  // 尚未寫入試算表的地點：只改頁面上的暫存
          try { Trip.PoiLogic.updatePoi({ pois: S.newPois, schedule: [] }, id, { note: v }, new Date().toISOString()); toast('備註已暫存，按「確認」時一起寫入', 'ok'); }
          catch (e2) { fail(e2); }
          break;
        }
        run({ type: 'updatePoi', poi_id: id, patch: { note: v } }).then(() => toast('備註已儲存', 'ok')).catch(fail);
        break;
      }
      case 'schedule': {
        const day = $('day-' + id).value;
        if (!day) { toast('請先選擇要安排到第幾天', 'warn'); $('day-' + id).focus(); return; }
        scheduleAdd(id, Number(day), false);
        break;
      }
      case 'ask-delete': askDelete(id); break;
      case 'ask-delete-stop': askDeleteStop(b.dataset.place); break;
      case 'edit-stop': { const r = stopItem(b.dataset.place); if (r) openEdit(r); break; }
    }
  });

  // 刪除景點：一律用對話框確認
  function askDelete(id) {
    const p = poiById(id);
    if (!p) return;
    const days = daysOf(id);
    openModal('刪除確認',
      '<p>確定刪除「<b>' + esc(p.name) + '</b>」？' + (days.length ? '第 ' + esc(days.join('、')) + ' 天的行程也會一併移除。' : '') + '</p>' +
      '<div class="pm-modal-actions">' +
        '<button class="btn" type="button" data-close>取消</button>' +
        '<button class="btn pm-danger is-solid" type="button" id="delete-confirm">刪除</button>' +
      '</div>');
    $('delete-confirm').focus();
    $('delete-confirm').addEventListener('click', () => {
      closeModal();
      if (isNew(id)) {
        S.newPois = S.newPois.filter((x) => Number(x.poi_id) !== Number(id));
        pruneDraft();
        renderAll();
        toast('已移除「' + p.name + '」', 'ok');
        return;
      }
      run({ type: 'deletePoi', poi_id: id }).then((r) => {
        toast('已刪除「' + p.name + '」' + (r && r.removedSchedules ? '，並移除它的行程安排' : ''), 'ok');
      }).catch(fail);
    });
  }

  /* ======================================================================
     3. 行程安排
     ====================================================================== */
  function renderPlanBar() {
    const bar = $('plan-bar');
    const dirty = isDirty();
    const where = S.mode === 'remote' ? 'Google 試算表' : '這個瀏覽器（離線示範）';
    let status;
    if (dirty) {
      const d = draftDiff();
      const parts = [];
      if (d.newPois) parts.push('新地點 ' + d.newPois + ' 個');
      if (d.added) parts.push('新增安排 ' + d.added + ' 個');
      if (d.removed) parts.push('移除安排 ' + d.removed + ' 個');
      if (d.reordered) parts.push('順序或天數已調整');
      status = '<b>尚未儲存：</b>' + esc(parts.join('、')) + '。按「確認」寫入 ' + esc(where) +
        '。<button class="pm-link" type="button" id="plan-revert">放棄變更</button>';
    } else {
      status = (S.schedule.length ? '所有安排都已儲存在 ' + esc(where) + '。' : '目前沒有任何安排。') +
        (S.mode === 'remote' ? ' <a class="pm-link" href="index.html?fresh=1" id="plan-myplan-link">查看行程 ↗</a>' : '');
    }
    bar.classList.toggle('is-dirty', dirty);
    $('plan-status').innerHTML = status;
    $('plan-clear').disabled = !visible(S.draft).length || S.busy;
    // 只要任何一天有安排就能按「確認」；全部清除後（有變更但沒有安排）也能按，用來把清空寫入
    $('plan-save').disabled = !(visible(S.draft).length || dirty) || S.busy;
    // 手機版 Bottom navigation 的「放棄變更」「查看行程」
    $('plan-revert2').disabled = !dirty || S.busy;
    $('plan-view').hidden = S.mode !== 'remote';
  }

  function renderPlan() {
    renderPlanBar();
    $('plan-hint').textContent = S.stopsError ? '無法讀取原行程的地點（' + S.stopsError + '）。' : '';
    $('plan-hint').hidden = !S.stopsError;
    if (!S.days.length) {
      $('plan').innerHTML = stateBox('error', '這個行程沒有天數', '請確認試算表 itinerary_day 有資料。');
      return;
    }
    $('plan').innerHTML = '<div class="pm-plan-grid">' + S.days.map((d) => {
      const all = sortRows(S.draft.filter((s) => Number(s.day_no) === Number(d.day_no)));
      const slots = visible(all);
      const removed = all.filter((r) => Trip.PoiLogic.isHidden(r));
      const n = slots.length;
      const posOptions = (cur) => Array.from({ length: n }, (_, k) =>
        '<option value="' + (k + 1) + '"' + (k + 1 === cur ? ' selected' : '') + '>第 ' + (k + 1) + ' 個</option>').join('');
      const open = openDays.has(Number(d.day_no));
      const first = n ? itemInfo(slots[0]).name : '', last = n > 1 ? itemInfo(slots[n - 1]).name : '';
      // 手機版：每天可收合，標題列顯示起訖景點；桌機一律展開（收合按鈕只在手機版作用）
      return '<section class="card pm-day' + (open ? ' is-open' : '') + '" aria-label="' + esc(dayName(d.day_no)) + '">' +
        '<header class="pm-day-head">' +
          '<button class="pm-day-toggle" type="button" data-toggle-day="' + d.day_no + '" aria-expanded="' + open + '" aria-controls="day-body-' + d.day_no + '">' +
            '<span class="day-tag">DAY ' + d.day_no + '</span>' +
            '<span class="pm-day-summary">' + (n ? esc(first) + (last ? ' → ' + esc(last) : '') : '尚未安排景點') + '</span>' +
            '<span class="pm-count">' + n + ' 個景點</span>' +
            '<svg class="pm-day-chevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
          '</button>' +
        '</header>' +
        '<div class="pm-day-body" id="day-body-' + d.day_no + '">' +
        (n ? '<ol class="pm-slots">' + slots.map((s, i) => {
          const it = itemInfo(s);
          const pos = i + 1;
          const kindChip = it.unsaved ? '<span class="pm-chip is-new">未儲存</span>' : '';
          return '<li class="pm-slot" data-key="' + esc(Trip.PoiLogic.itemKey(s)) + '">' +
            '<span class="pm-seq">' + pos + '</span>' +
            '<div class="pm-slot-body">' + slotThumb(it) +
            '<div class="pm-slot-main">' +
              '<b>' + esc(it.name) + '</b>' +
              '<span class="pm-slot-chips">' + kindChip +
                (it.hasCoords ? '' : '<span class="pm-chip is-warn" title="沒有座標，地圖上不會顯示">無座標</span>') + '</span>' +
              (it.address ? '<small>' + esc(it.address) + '</small>' : '') +
              (it.note ? '<small class="pm-slot-note">備註：' + esc(it.note) + '</small>' : '') +
              (safeUrl(it.maps_url) ? '<a class="pm-maplink" href="' + esc(safeUrl(it.maps_url)) + '" target="_blank" rel="noopener" aria-label="在 Google 地圖查看 ' + esc(it.name) + '">地圖 ↗</a>' : '') +
            '</div></div>' +
            '<div class="pm-slot-actions">' +
              '<button class="pm-icon" type="button" data-act="up" data-id="' + s.schedule_id + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="上移 ' + esc(it.name) + '" title="上移">↑</button>' +
              '<button class="pm-icon" type="button" data-act="down" data-id="' + s.schedule_id + '"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="下移 ' + esc(it.name) + '" title="下移">↓</button>' +
              '<label class="visually-hidden" for="pos-' + s.schedule_id + '">移到第幾個</label>' +
              '<select id="pos-' + s.schedule_id + '" data-pos="' + s.schedule_id + '"' + (n < 2 ? ' disabled' : '') + '>' + posOptions(pos) + '</select>' +
              '<label class="visually-hidden" for="mv-' + s.schedule_id + '">移到其他天</label>' +
              '<select id="mv-' + s.schedule_id + '" data-move="' + s.schedule_id + '">' + dayOptions(null, '移到…天').replace('<option value="' + d.day_no + '">', '<option value="' + d.day_no + '" disabled>') + '</select>' +
              '<button class="btn pm-small pm-remove" type="button" data-act="remove" data-id="' + s.schedule_id + '" aria-label="移出行程：' + esc(it.name) + '" title="移出行程">' +
                '<svg class="pm-remove-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg><span class="pm-remove-text">移出行程</span></button>' +
            '</div></li>';
        }).join('') + '</ol>' : '<p class="pm-day-empty">這天沒有景點</p>') +
        (removed.length ? '<details class="pm-removed" data-day="' + d.day_no + '"' + (openRemoved.has(Number(d.day_no)) ? ' open' : '') + '><summary>已移出地點（' + removed.length + '）</summary><p class="pm-hint">按「確認」後會清除；地點仍保留在地點清單，可從景點搜尋再加入。</p><ul>' +
          removed.map((r) => {
            const it = itemInfo(r);
            return '<li><span>' + esc(it.name) + '</span>' +
              '<button class="btn pm-small" type="button" data-act="restore" data-id="' + r.schedule_id + '">加回</button></li>';
          }).join('') + '</ul></details>' : '') +
      '</div></section>';
    }).join('') + '</div>';
  }

  // 手機版每天的展開狀態（預設展開第 1 天；排進景點、移動到某天時自動展開那天）
  const openDays = new Set([1]);
  $('plan').addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle-day]');
    if (!t) return;
    const day = Number(t.dataset.toggleDay);
    if (openDays.has(day)) openDays.delete(day); else openDays.add(day);
    const sec = t.closest('.pm-day');
    sec.classList.toggle('is-open', openDays.has(day));
    t.setAttribute('aria-expanded', String(openDays.has(day)));
  });

  // 「已移出地點」展開狀態：重畫後維持展開，方便連續「加回」
  const openRemoved = new Set();
  $('plan').addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('details.pm-removed');
    if (!d) return;
    if (d.open) openRemoved.add(Number(d.dataset.day)); else openRemoved.delete(Number(d.dataset.day));
  }, true);

  $('plan').addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { showTab(go.dataset.go); return; }
    const b = e.target.closest('[data-act]');
    if (!b || S.busy) return;
    const id = Number(b.dataset.id);
    try {
      if (b.dataset.act === 'up' || b.dataset.act === 'down') {
        draftApply({ type: 'scheduleReorder', schedule_id: id, dir: b.dataset.act === 'up' ? -1 : 1 });
        const again = document.querySelector('[data-act="' + b.dataset.act + '"][data-id="' + id + '"]:not(:disabled)');
        if (again) again.focus();
      } else if (b.dataset.act === 'remove') {
        const r = S.draft.find((x) => Number(x.schedule_id) === id);
        const stop = r && Trip.PoiLogic.isStop(r);
        draftApply({ type: 'scheduleRemove', schedule_id: id });
        toast(stop ? '已移出行程，可在當天下方「已移出地點」加回；按「確認」後會清除（地點仍保留在地點清單）'
                   : '已移出行程，景點仍保留在地點清單（按「確認」後儲存）', 'ok');
      } else if (b.dataset.act === 'restore') {
        draftApply({ type: 'scheduleRestore', schedule_id: id });
        toast('已加回，排在當天最後', 'ok');
      }
    } catch (err2) { fail(err2); }
  });

  $('plan').addEventListener('change', (e) => {
    const posSel = e.target.closest('[data-pos]');
    if (posSel && !S.busy) {
      try {
        draftApply({ type: 'scheduleMoveTo', schedule_id: Number(posSel.dataset.pos), position: Number(posSel.value) });
        const again = document.getElementById('pos-' + posSel.dataset.pos);
        if (again) again.focus();
      } catch (err2) { fail(err2); renderPlan(); }
      return;
    }
    const sel = e.target.closest('[data-move]');
    if (!sel || !sel.value || S.busy) return;
    const day = Number(sel.value);
    try {
      openDays.add(day);
      draftApply({ type: 'scheduleMove', schedule_id: Number(sel.dataset.move), day_no: day });
      toast('已移到第 ' + day + ' 天（排在最後）', 'ok');
    } catch (err2) {
      sel.value = '';
      toast(err2.code === 'SAME_DAY' ? err2.message + '，同一天不能重複安排' : err2.message, err2.code === 'SAME_DAY' ? 'warn' : 'error');
    }
  });

  // 通知其他分頁中開著的我的行程：重新讀取最新資料（BroadcastChannel，舊瀏覽器改用 localStorage 事件）
  function notifyMap() {
    const msg = { type: 'plan-saved', at: Date.now() };
    try { const ch = new BroadcastChannel('naha-trip'); ch.postMessage(msg); ch.close(); } catch (e) { /* 不支援時略過 */ }
    try { localStorage.setItem('naha-plan-saved', String(msg.at)); } catch (e) { /* 略過 */ }
  }

  const NEED_API = 3;
  const OLD_SERVER_MSG = 'Apps Script 還是舊版，無法儲存行程安排。請用最新的 PoiLogic.gs、PoiStore.gs、Itinerary.gs、Config.gs 取代原檔，' +
    '再到「部署 → 管理部署作業 → 編輯 → 版本：新版本 → 部署」。';

  // 儲存時 Apps Script 回覆「不支援的操作」：讀 ?action=version 說明網址上跑的是哪一版
  function explainOldServer(opType) {
    const id = String((Trip.config.api || {}).url || '').replace(/^.*\/s\//, '').replace(/\/exec.*$/, '');
    const shortId = id ? id.slice(0, 12) + '…' + id.slice(-6) : '';
    const steps = '到 Apps Script「部署 → 管理部署作業」，選部署作業 ID 為 ' + shortId + ' 的那一個 → 編輯（鉛筆）→ 版本選「新版本」→ 部署。' +
      '只按「儲存」不會更新網址上的程式。';
    const fn = store.version ? store.version() : Promise.resolve(null);
    fn.then((v) => {
      let msg;
      if (!v) {
        msg = '儲存失敗：這個網址上部署的仍是舊程式（不認得 ' + opType + '）。畫面上的變更仍保留。' + steps +
          '部署前可在編輯器執行 Tests.gs 的 checkSetup，確認程式碼都是新版。';
      } else if (v.ops.indexOf(opType) < 0) {
        msg = '儲存失敗：網址上的程式版本 ' + v.build + '，PoiLogic 缺少 ' + opType + '。專案裡可能還有舊的 PoiLogic 副本蓋掉新檔，' +
          '請在編輯器執行 Tests.gs 的 checkSetup 檢查，刪掉舊檔後再部署新版本。';
      } else {
        msg = OLD_SERVER_MSG;
      }
      toast(msg, 'error');
      console.warn('[地點管理] 部署檢查', v || '沒有 action=version（舊版部署）');
    });
  }

  /* ---------------- 確認（寫入）／全部清除／放棄變更 ---------------- */
  // 「確認」：先跳出確認視窗，說明會更新哪些資料表，按「確定更新」才寫入
  $('plan-save').addEventListener('click', () => {
    if ((!visible(S.draft).length && !isDirty()) || S.busy) return;

    const nNew = S.newPois.length;
    const shown = visible(S.draft).length;
    const removedStops = S.draft.filter((r) => Trip.PoiLogic.isHidden(r)).length;
    const stopRows = S.draft.filter((r) => Trip.PoiLogic.isStop(r)).length;
    const d = draftDiff();
    const changes = [];
    if (d.newPois) changes.push('新地點 ' + d.newPois + ' 個');
    if (d.added) changes.push('新增安排 ' + d.added + ' 個');
    if (d.removed) changes.push('移除安排 ' + d.removed + ' 個');
    if (d.reordered) changes.push('順序或天數已調整');
    const remote = S.mode === 'remote';
    const tables = remote
      ? '<ul class="pm-tables">' +
          '<li><code>poi_schedule</code>（行程景點排序）：覆寫第 1～' + S.days.length + ' 天的排序，共 <b>' + shown + '</b> 個景點' +
            (removedStops ? '，另有 ' + removedStops + ' 個原行程地點標為「已移出」' : '') + '</li>' +
          (nNew ? '<li><code>poi</code>（地點清單）：新增 <b>' + nNew + '</b> 個地點</li>' : '') +
          (stopRows ? '<li><code>day_stop</code>（原行程列表）：更新 <b>' + stopRows + '</b> 個原行程地點的天數與順序' +
            (removedStops ? '，移出的 ' + removedStops + ' 個標為 <code>hidden</code>（不刪除）' : '') + '</li>' : '') +
        '</ul>' +
        '<p class="pm-hint">新增景點只寫入 <code>poi</code>、<code>poi_schedule</code>，不會加進 <code>day_stop</code>；<code>place</code> 等其他資料表不會修改。我的行程會依新的排序顯示。</p>'
      : '<p>離線示範：只會存在這個瀏覽器，不會寫入 Google 試算表。</p>';
    openModal('確認更新行程？',
      (changes.length ? '<p>本次變更：' + esc(changes.join('、')) + '</p>' : '<p>沒有新的變更，會以目前的排序重新寫入一次。</p>') +
      (remote ? '<p>會更新 Google 試算表的以下資料表：</p>' : '') + tables +
      '<div class="pm-modal-actions">' +
        '<button class="btn" type="button" data-close>取消</button>' +
        '<button class="btn primary" type="button" id="save-confirm">確定更新</button>' +
      '</div>');
    $('save-confirm').focus();
    $('save-confirm').addEventListener('click', () => { closeModal(); savePlan(); });
  });

  function savePlan() {
    if ((!visible(S.draft).length && !isDirty()) || S.busy) return;
    // 原行程地點與新增景點一起送出（含已移出的原行程地點，才能記住「移出」）
    const items = sortRows(S.draft).map((r) => Trip.PoiLogic.isStop(r)
      ? { day_stop_id: Number(r.day_stop_id), day_no: Number(r.day_no), hidden: Trip.PoiLogic.isHidden(r) }
      : { poi_id: Number(r.poi_id), day_no: Number(r.day_no) });
    const shown = items.filter((x) => !x.hidden).length;
    const nNew = S.newPois.length;
    // 有暫存的新地點：一次新增地點並覆寫安排（commitPlan）；沒有就只覆寫安排
    const op = nNew
      ? { type: 'commitPlan', schedule: items,
          pois: S.newPois.map((p) => ({ tmp_id: p.poi_id, item: Object.assign({}, p, { poi_id: undefined, unsaved: undefined, created_at: undefined, updated_at: undefined, _photo: undefined }) })) }
      : { type: 'scheduleReplace', items: items };
    const pendingPhotos = S.newPois.filter((p) => p._photo).map((p) => ({ key: Trip.PoiLogic.poiKey(p), name: p.name, photo: p._photo }));
    run(op, true).then(() => {
      toast(S.mode === 'remote'
        ? '已更新 Google 試算表（' + (nNew ? '新地點 ' + nNew + ' 個、' : '') + '行程景點 ' + shown + ' 個），我的行程會依新順序顯示'
        : '已儲存（離線示範，只存在這個瀏覽器）', 'ok');
      if (pendingPhotos.length && S.mode === 'remote') uploadPending(pendingPhotos);    // 新地點已存進試算表，接著上傳選好的照片
      if (S.mode === 'remote') notifyMap();
    }).catch((e) => {
      if (e.code !== 'BAD_OP') { toast('儲存失敗，畫面上的變更仍保留，可以再按一次「確認」：' + e.message, 'error'); return; }
      explainOldServer(op.type);
    });
  }

  $('plan-clear').addEventListener('click', () => {
    if (!visible(S.draft).length || S.busy) return;
    openModal('清除全部行程安排？',
      '<p>會移除第 1～' + S.days.length + ' 天的全部 <b>' + visible(S.draft).length + '</b> 個景點）；按「確認」後清除，地點資料都會保留在地點清單。</p>' +
      '<p>清除後要按「確認」才會寫入' + (S.mode === 'remote' ? ' Google 試算表' : '') + '；按「放棄變更」可以復原。</p>' +
      '<div class="pm-modal-actions">' +
        '<button class="btn" type="button" data-close>取消</button>' +
        '<button class="btn pm-danger is-solid" type="button" id="clear-confirm">全部清除</button>' +
      '</div>');
    $('clear-confirm').focus();
    $('clear-confirm').addEventListener('click', () => {
      closeModal();
      // 原行程地點標為已移出（保留資料，可加回）；新增景點的安排移除
      S.draft = S.draft.filter((r) => Trip.PoiLogic.isStop(r))
        .map((r) => Object.assign({}, r, { hidden: true, sort_order: 0, seq: 0 }));
      renderHead(); renderPois(); renderPlan();
      toast('已清除全部安排，按「確認」寫入後才會生效', 'warn');
      $('plan-save').focus();
    });
  });

  $('plan-bar').addEventListener('click', (e) => {
    if (!e.target.closest('#plan-revert, #plan-revert2') || S.busy) return;
    S.draft = clone(S.schedule);
    S.newPois = [];
    renderAll();
    toast('已還原為試算表中的內容（暫存的新地點也一併移除）');
  });

  // 有尚未儲存的地點或安排時，離開頁面前提醒
  window.addEventListener('beforeunload', (e) => {
    if (S.loaded && isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------- 對話框 ---------------- */
  let lastFocus = null;
  // opts.full：手機版改成全螢幕對話框；opts.submit：{ form, label } 標題列右側的送出按鈕（只在手機版顯示）
  function openModal(title, html, opts) {
    opts = opts || {};
    lastFocus = document.activeElement;
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = html;
    $('modal').classList.toggle('is-full', !!opts.full);
    const sub = $('modal-submit');
    sub.hidden = !opts.submit;
    if (opts.submit) { sub.setAttribute('form', opts.submit.form); sub.textContent = opts.submit.label; }
    else sub.removeAttribute('form');
    $('modal').hidden = false;
    document.body.classList.add('pm-modal-open');
  }
  function closeModal() {
    $('modal').hidden = true;
    $('modal-body').innerHTML = '';
    document.body.classList.remove('pm-modal-open');
    if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  }
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal') || e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('modal').hidden) closeModal();
  });

  /* ---------------- 載入 ---------------- */
  function renderAll() {
    renderHead();
    renderPois();
    renderPlan();
    if (S.resultSource === 'local') localResults(true);       // 目前景點：地點清單有增減時跟著更新
    else if (S.results.length) renderResults();
  }

  // 預設：顯示目前所有景點（目前行程＋地點清單），並套用畫面上的搜尋條件
  function initialSearchState() {
    localResults();
  }
  // 篩選條件改變時，目前景點的清單立即重新篩選（Google、示範資料的結果要按「搜尋」才更新）
  ['f-region', 'f-rating', 'f-category'].forEach((id) => $(id).addEventListener('change', () => { if (S.resultSource === 'local') localResults(); }));

  function load() {
    $('results').innerHTML = '<div class="card pm-state is-loading" role="status"><span class="pm-spinner" aria-hidden="true"></span>正在讀取景點清單…</div>';
    $('pois').innerHTML = ''; $('plan').innerHTML = '';
    return store.load().then((data) => {
      S.loaded = true;
      S.mode = data.mode;
      S.itinerary = data.itinerary;
      S.days = data.days || [];
      S.pois = data.pois || [];
      S.schedule = data.schedule || [];
      S.draft = clone(S.schedule);
      S.rules = data.rules || {};
      // Apps Script 版本檢查：舊版沒有「行程景點排序」與「確認一次寫入」（commitPlan）
      // 以「有沒有新功能的資料」判斷，不只看版本號（前一版沒有 apiVersion，但已支援行程景點排序）
      const supportsPlan = Number(data.apiVersion) >= NEED_API || 'rules' in data ||
        (data.schedule || []).some((r) => r && Object.prototype.hasOwnProperty.call(r, 'day_stop_id'));
      S.oldServer = S.mode === 'remote' && !supportsPlan;
      if (S.oldServer) toast(OLD_SERVER_MSG, 'error');
      S.stops = Array.isArray(data.stops) ? data.stops : [];
      S.stopsError = data.stopsError || null;
      S.searchEnabled = !!data.searchEnabled;
      renderAll();
      initialSearchState();
    }).catch((e) => {
      const url = String((Trip.config.api || {}).url || '');
      const id = (url.match(/\/s\/([^/]+)\/exec/) || [])[1] || '';
      const diag = e.code === 'OLD_VERSION'
        ? '<br><br><b>診斷資訊</b><br>網頁連線的部署 ID：<code>' + esc(id ? id.slice(0, 10) + '…' + id.slice(-10) : url) + '</code>' +
          '（請和 Apps Script「管理部署作業」裡的部署 ID 比對；建立「新增部署作業」會產生新的 ID，網頁不會跟著換）' +
          (e.received && e.received.length ? '<br>伺服器回傳的欄位：<code>' + esc(e.received.join(', ')) + '</code>（新版應包含 days, pois）' : '') +
          (safeUrl(e.testUrl) ? '<br><a class="pm-maplink" href="' + esc(e.testUrl) + '" target="_blank" rel="noopener">在新分頁開啟測試網址 ↗</a>' : '')
        : '<br>請確認 Apps Script 已加入 PoiStore.gs 等檔案、重新部署新版本，且「誰可以存取」為「任何人」。';
      $('results').innerHTML = stateBox('error', '無法讀取景點資料', esc(e.message) + diag,
        '<button class="btn primary" type="button" id="reload-btn">重新載入</button>' +
        '<button class="btn" type="button" id="offline-btn">改用離線示範</button>');
      $('reload-btn').addEventListener('click', load);
      $('offline-btn').addEventListener('click', () => { store = Trip.placesStore.local; load(); });
    });
  }

  console.info('[地點管理] 程式版本 20261018d');
  showTab((location.hash || '').slice(1));
  load();
})(window.Trip);
