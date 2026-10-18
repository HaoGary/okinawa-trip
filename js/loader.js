/* ==========================================================================
   loader.js — 從 Apps Script 取得行程資料，再啟動頁面（在 config.js 之後載入）

   1. 讀取 Trip.config.api.url + ?action=itinerary&code=…（index.html 由 myplan-mode.js 改成 action=myplan）
      先用 fetch；失敗時改用 JSONP（<script>），可帶著瀏覽器的 Google 登入狀態，
      部署限「網域中的使用者」時，已登入公司帳號的瀏覽器也讀得到
      行程代碼可由網址指定：index.html?code=okinawa-5d（未指定時用 config 的 api.code）
   2. 取得後填入 Trip.days、Trip.geo、Trip.region、Trip.trip
   3. 依序載入 lib/*.js 與 app.js
   4. 載入期間顯示骨架畫面（index.html 的 #skeleton、#skeleton-menu）
   5. 失敗時顯示錯誤與「重新載入」按鈕（不使用寫死的資料）
   ========================================================================== */
(function (Trip) {
  'use strict';

  const APP = ['js/lib/util.js', 'js/lib/svg.js', 'js/lib/map.js', 'js/lib/scenes.js',
               'js/lib/popup.js', 'js/lib/views.js', 'js/app.js'];

  const status = document.getElementById('load-status');

  // 選單中的「連線狀態」：loading 連線中／ok 已連線／error 連線失敗／unset 未設定
  const conn = document.getElementById('conn-status');
  const connLbl = document.getElementById('conn-lbl');
  function setConn(state, label, detail) {
    if (!conn) return;
    conn.classList.remove('is-loading', 'is-ok', 'is-error', 'is-unset');
    conn.classList.add('is-' + state);
    if (connLbl) connLbl.textContent = label;
    conn.title = detail || label;
    conn.setAttribute('aria-label', '連線狀態：' + label + (detail ? '。' + detail : ''));
  }
  let via = 'fetch';
  let oldItinerary = false;

  // 「重新整理」按鈕：重新讀取頁面與最新資料（目前看的天數會保留）
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('is-busy');
      try { sessionStorage.setItem('trip-fresh', '1'); } catch (e) { /* 無法記住也沒關係 */ }
      refreshBtn.disabled = true;
      location.reload();
    });
  }

  function show(text, isError, canRetry) {
    if (!status) return;
    status.hidden = !text;
    status.classList.toggle('is-error', !!isError);
    status.textContent = text || '';
    if (isError && canRetry) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'load-retry';
      btn.textContent = '重新載入';
      btn.addEventListener('click', () => location.reload());
      status.appendChild(btn);
    }
  }

  // MapLibre（我的行程的真實底圖）：從 CDN 載入，失敗或逾時就略過，頁面改用 SVG 地圖
  const MAPLIBRE = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
  function loadMapLibre() {
    if (Trip.config.mapEngine !== 'maplibre') return Promise.resolve(false);
    if (window.maplibregl) return Promise.resolve(true);
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = MAPLIBRE + '.css';
    document.head.appendChild(css);
    return new Promise((resolve) => {
      const s = document.createElement('script');
      const t = setTimeout(() => { console.warn('[Trip] MapLibre 載入逾時，改用 SVG 地圖'); resolve(false); }, 10000);
      s.src = MAPLIBRE + '.js';
      s.onload = () => { clearTimeout(t); resolve(!!window.maplibregl); };
      s.onerror = () => { clearTimeout(t); console.warn('[Trip] 無法載入 MapLibre，改用 SVG 地圖'); resolve(false); };
      document.head.appendChild(s);
    });
  }

  const V = '20261018e';                                   // 換版本號，避免瀏覽器用到舊的快取檔案

  // 先下載、晚點才執行：等 Apps Script 回應的同時，瀏覽器就先把頁面程式抓下來
  function preload(list) {
    list.forEach((src) => {
      const l = document.createElement('link');
      l.rel = 'preload';
      l.as = 'script';
      l.href = src + '?v=' + V;
      document.head.appendChild(l);
    });
  }

  // 依序載入一串 <script>（保持順序）
  function loadScripts(list) {
    return list.reduce((p, src) => p.then(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src + '?v=' + V;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入 ' + src));
      document.body.appendChild(s);
    })), Promise.resolve());
  }

  function itineraryCode(api) {
    const fromUrl = new URLSearchParams(location.search).get('code');
    return fromUrl || api.code || 'okinawa-5d';
  }

  // fresh：要求 Apps Script 不用暫存、重讀試算表（只有按「重新整理」時）
  // skipLocal：不先顯示這個瀏覽器記住的資料，直接等最新資料（地點管理按「確認」後、網址帶 ?fresh=1）
  //   按「確認」時 Apps Script 已經把我的行程重算好放進暫存，所以不必 fresh
  let fresh = false, skipLocal = false;
  try {
    fresh = sessionStorage.getItem('trip-fresh') === '1';
    skipLocal = fresh || sessionStorage.getItem('trip-skip-local') === '1';
    sessionStorage.removeItem('trip-fresh');
    sessionStorage.removeItem('trip-skip-local');
  } catch (e) { /* 略過 */ }
  const qs = new URLSearchParams(location.search);
  if (qs.get('fresh') === '1') {
    skipLocal = true;
    qs.delete('fresh');
    try { history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash); } catch (e) { /* 略過 */ }
  }

  // 地點管理頁按「確認」後，這個分頁若開著我的行程，自動重新讀取最新排序
  function reloadFresh() {
    show('行程已在地點管理頁更新，重新載入中…');
    try { sessionStorage.setItem('trip-skip-local', '1'); } catch (e) { /* 略過 */ }
    setTimeout(() => location.reload(), 600);
  }
  try { new BroadcastChannel('naha-trip').onmessage = (e) => { if (e.data && e.data.type === 'plan-saved') reloadFresh(); }; }
  catch (e) {
    window.addEventListener('storage', (e) => { if (e.key === 'naha-plan-saved') reloadFresh(); });
  }

  function itineraryUrl(api) {
    return api.url + (api.url.indexOf('?') < 0 ? '?' : '&')
      + 'action=' + (api.action || 'itinerary') + '&code=' + encodeURIComponent(itineraryCode(api)) + (fresh ? '&fresh=1' : '');
  }

  function check(data) {
    if (!data || typeof data !== 'object') throw new Error('資料格式不正確');
    if (data.error) throw Object.assign(new Error(data.error), { fromServer: true });
    // 我的行程：舊版 Apps Script 不認得 action=myplan，會回傳整份資料表
    if (!data.days && api.action === 'myplan') throw Object.assign(new Error('Apps Script 尚未支援 action=myplan'), { fromServer: true, noMyPlan: true });
    if (!Array.isArray(data.days) || !data.days.length) throw Object.assign(new Error('這個行程沒有任何天數'), { fromServer: true });
    if (!data.geo) throw Object.assign(new Error('缺少地理資料'), { fromServer: true });
    return data;
  }

  // 一般行程資料（action=itinerary）的檢查，不套用上面我的行程的判斷
  function checkItinerary(data) {
    if (!data || typeof data !== 'object') throw new Error('資料格式不正確');
    if (data.error) throw Object.assign(new Error(data.error), { fromServer: true });
    if (!data.geo) throw Object.assign(new Error('行程資料缺少地理資料'), { fromServer: true });
    return data;
  }

  // 方法一：fetch（部署為「任何人」時使用）
  function viaFetch(api, url, chk) {
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), api.timeout || 15000);
    return fetch(url || itineraryUrl(api), { signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error('伺服器回應 ' + r.status); return r.json(); })
      .then(chk || check)
      .catch((err) => { throw err.name === 'AbortError' ? new Error('連線逾時') : err; })
      .finally(() => clearTimeout(timer));
  }

  // 方法二：JSONP（會帶著瀏覽器的 Google 登入狀態）
  let jsonpSeq = 0;
  function viaJsonp(api, url, chk) {
    return new Promise((resolve, reject) => {
      const name = '__tripCallback' + Date.now() + '_' + (++jsonpSeq);   // 同時送出多個請求時，名稱不能重複
      const s = document.createElement('script');
      const done = (fn, arg) => { clearTimeout(timer); delete window[name]; s.remove(); fn(arg); };
      const timer = setTimeout(() => done(reject, new Error('連線逾時')), api.timeout || 15000);
      window[name] = (data) => { try { done(resolve, (chk || check)(data)); } catch (e) { done(reject, e); } };
      const denied = () => done(reject, new Error('需要登入或沒有存取權限，請確認 Apps Script 部署的「誰可以存取」設定'));
      s.onerror = denied;
      s.onload = () => setTimeout(() => { if (window[name]) denied(); }, 0);   // 載入的是登入頁，callback 沒被呼叫
      s.src = (url || itineraryUrl(api)) + '&callback=' + name;
      document.head.appendChild(s);
    });
  }

  // 先用 fetch，失敗再用 JSONP
  function getJson(api, url, chk) {
    if (via === 'JSONP') return viaJsonp(api, url, chk);
    return viaFetch(api, url, chk).catch((err) => {
      if (err.fromServer) throw err;                     // 伺服器明確回報的錯誤，不必再試
      if (err.message === '連線逾時') throw err;          // 已等很久，改用 JSONP 只會再等一次
      console.warn('[Trip] fetch 失敗，改用 JSONP：', err);
      via = 'JSONP';
      return viaJsonp(api, url, chk);
    });
  }

  function apiUrl(api, query) {
    return api.url + (api.url.indexOf('?') < 0 ? '?' : '&') + query + (fresh ? '&fresh=1' : '');
  }

  function fetchItinerary(api) {
    return getJson(api).catch((err) => {
      if (!err.noMyPlan) throw err;
      return myPlanInBrowser(api);
    });
  }

  // 我的行程：Apps Script 還沒更新（不認得 action=myplan）時，
  // 改讀既有的 places、poi_schedule、itinerary（只取地理資料），在網頁端組出相同內容（js/myplan-build.js）
  function myPlanInBrowser(api) {
    if (!Trip.MyPlan) throw new Error('缺少 js/myplan-build.js');
    console.info('[Trip] Apps Script 尚未支援 action=myplan，改在網頁端組出我的行程');
    const code = encodeURIComponent(itineraryCode(api));
    const obj = (data) => {
      if (!data || typeof data !== 'object') throw new Error('資料格式不正確');
      if (data.error) throw Object.assign(new Error(data.error.message || data.error), { fromServer: true });
      return data;
    };
    const places = getJson(api, apiUrl(api, 'action=places&code=' + code), obj);
    const rows = getJson(api, apiUrl(api, 'table=poi_schedule'), (d) => (Array.isArray(d) ? d : obj(d) && []))
      .catch((err) => { if (/找不到|not found/i.test(err.message)) return []; throw err; });   // 還沒有 poi_schedule 頁籤＝還沒送出過
    const itin = getJson(api, apiUrl(api, 'action=itinerary&code=' + code), checkItinerary);
    return Promise.all([places, rows, itin]).then(([p, r, i]) => {
      via += '，網頁端組合';
      return Trip.MyPlan.build(p, r, i);
    });
  }

  // 把資料放進 Trip，並更新頁面標題
  function apply(data) {
    Trip.trip = { code: data.code, title: data.title, apiVersion: data.apiVersion || null, mode: data.mode || 'itinerary', planned: data.planned !== false };
    Trip.region = data.region || null;
    Trip.geo = data.geo;
    Trip.days.length = 0;
    data.days.forEach((d) => Trip.addDay(d));
    if (data.title) document.title = data.mode === 'myplan' ? data.title : data.title + '地圖';   // 我的行程不加「地圖」
  }

  const api = Trip.config.api || {};
  if (!api.url) {
    ['skeleton', 'skeleton-menu'].forEach((id) => { const el = document.getElementById(id); if (el) el.remove(); });
    show('尚未設定資料來源：請在 js/config.js 的 api.url 填入 Apps Script 網址。', true);
    setConn('unset', '未設定資料來源', '請在 js/config.js 的 api.url 填入 Apps Script 網址');
    return;
  }

  // 骨架畫面：資料到了、真正的畫面產生前移除
  function hideSkeleton() {
    ['skeleton', 'skeleton-menu'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  const isFile = /\.json(\?|$)/.test(api.url);
  const timeText = (at) => new Date(at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  /* ---------- 1. 這個瀏覽器記住的上次資料（localStorage）：先畫出來，再到背景讀最新資料 ---------- */
  const CACHE_KEY = 'trip-data:' + (api.action || 'itinerary') + ':' + itineraryCode(api) + ':' + api.url;
  const CACHE_DAYS = 30;
  function readLocal() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && c.data && c.v === V && Date.now() - c.at < CACHE_DAYS * 864e5) return c;
    } catch (e) { /* 讀不到就當作沒有 */ }
    return null;
  }
  function writeLocal(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ v: V, at: Date.now(), data: data })); } catch (e) { /* 空間不足或不允許時略過 */ }
  }

  /* ---------- 3. 同時下載：MapLibre 與頁面程式先開始抓，不必等資料回來 ---------- */
  const glReady = loadMapLibre();
  preload(APP.concat(Trip.config.mapEngine === 'maplibre' ? ['js/lib/map-gl.js'] : []));
  const appList = (gl) => (gl ? APP.slice(0, -1).concat('js/lib/map-gl.js', APP[APP.length - 1]) : APP);

  // 有了資料之後：填入 Trip、移除骨架、執行頁面程式
  function start(data) {
    apply(data);
    if (!isFile && !(Number(Trip.trip && Trip.trip.apiVersion) >= 3)) {
      if (conn) conn.title += '｜Itinerary.gs 為舊版，未套用地點管理的行程安排';
      oldItinerary = true;
    }
    return glReady
      .then((gl) => { hideSkeleton(); return loadScripts(appList(gl)); })
      .then(() => {
        // 我的行程：還沒從地點管理送出任何行程
        show(Trip.trip.mode === 'myplan' && !Trip.trip.planned ? '還沒有從地點管理送出行程：到「地點管理 → 行程安排」安排地點並按「確認」後，會顯示在這裡。' : '');
        if (oldItinerary) console.warn('[Trip] Apps Script 沒有回傳 apiVersion：Itinerary.gs 可能不是最新版');
      });
  }
  function connected(label) {
    const t = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    if (isFile) setConn('ok', '本機資料檔', '資料來源：' + api.url + '（未連線 Google 試算表）・' + t + ' 讀取');
    else setConn('ok', label || '已連線', '資料來源：Apps Script（' + via + '）・' + t + ' 讀取');
  }
  function failed(err) {
    console.error('[Trip] 無法取得行程資料：', err);
    hideSkeleton();
    setConn('error', '連線失敗', err.message);
    show('無法取得行程資料（' + err.message + '）。連線網址：' + api.url.replace(/^https:\/\/script\.google\.com\/macros\/s\//, '…/').slice(0, 40) + '…', true, true);
  }

  const local = !skipLocal && !isFile ? readLocal() : null;

  if (local) {
    // 先用上次的資料立即顯示；最新資料回來後若有不同，再重新載入頁面（會直接用新記住的資料，很快）
    setConn('loading', '更新中…', '先顯示 ' + timeText(local.at) + ' 的資料，正在讀取最新行程');
    start(local.data).catch(failed);
    fetchItinerary(api)
      .then((data) => {
        writeLocal(data);
        if (JSON.stringify(data) === JSON.stringify(local.data)) { connected(); return; }
        let again = false;
        try { again = Date.now() - Number(sessionStorage.getItem('trip-local-reload') || 0) < 15000; sessionStorage.setItem('trip-local-reload', String(Date.now())); } catch (e) { /* 略過 */ }
        if (again) { connected(); return; }               // 避免連續重新載入
        show('行程有更新，重新載入中…');
        setTimeout(() => location.reload(), 300);
      })
      .catch((err) => {
        console.warn('[Trip] 讀取最新行程失敗，畫面為暫存資料：', err);
        setConn('error', '連線失敗', '目前顯示 ' + timeText(local.at) + ' 記住的資料（' + err.message + '）');
      });
  } else {
    setConn('loading', '連線中…', '正在向 Apps Script 讀取行程資料');
    // 超過 6 秒還沒回應：Apps Script 可能正在啟動，提示使用者稍候
    const slow = setTimeout(() => show('Apps Script 啟動中，第一次讀取可能需要 10～30 秒，請稍候…'), 6000);
    fetchItinerary(api)
      // 讀到的資料沒有 apiVersion（可能是 Apps Script 暫存中的舊資料）：略過暫存再讀一次，確定是舊版才提醒
      .then((data) => (!fresh && !isFile && !(Number(data.apiVersion) >= 3))
        ? (fresh = true, fetchItinerary(api)) : data)
      .finally(() => clearTimeout(slow))
      .then((data) => { if (!isFile) writeLocal(data); connected(); return start(data); })
      .catch(failed);
  }
})(window.Trip);
