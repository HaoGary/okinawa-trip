/* ==========================================================================
   places/store.js — 景點管理的資料存取

   兩種模式，畫面用同一組方法：
     remote  Apps Script（okinawaTrip）→ 讀寫 Google 試算表的 poi、poi_schedule 頁籤
     local   離線示範 → 資料只存在這個瀏覽器（localStorage），景點搜尋使用示範資料

   方法
     load()            → { mode, itinerary, days, pois, schedule, searchEnabled }
     write(op)         → { pois, schedule, result }；失敗時丟出 Error（含 code、days）
     search(params)    → { source: 'google'|'demo', results, note }；失敗時丟出 Error（code: NO_API_KEY / API_ERROR / NETWORK）
   ========================================================================== */
(function (Trip) {
  'use strict';

  const api = Trip.config.api || {};
  const LOCAL_KEY = 'naha-places-v1';

  function err(code, message, extra) {
    return Object.assign(new Error(message), { code }, extra || {});
  }

  // 伺服器回傳的錯誤可能是字串或 { code, message }
  function serverError(e) {
    if (typeof e === 'string') return err('ERROR', e);
    return err(e.code || 'ERROR', e.message || '發生錯誤', { days: e.days || null });
  }

  /* ---------------- 傳輸：fetch，失敗時改用 JSONP ---------------- */
  function withQuery(params) {
    const q = Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== null)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    return api.url + (api.url.indexOf('?') < 0 ? '?' : '&') + q;
  }

  function fetchJson(url, init) {
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), api.timeout || 20000);
    return fetch(url, Object.assign({ cache: 'no-store', signal: ctrl ? ctrl.signal : undefined }, init || {}))
      .then((r) => { if (!r.ok) throw err('NETWORK', '伺服器回應 ' + r.status); return r.json(); })
      .catch((e) => {
        if (e.name === 'AbortError') throw err('NETWORK', '連線逾時');
        if (e.code) throw e;
        // 瀏覽器只會回報「Failed to fetch」：多半是 Apps Script 回傳了錯誤頁（沒有 CORS 標頭）
        throw err('NETWORK', '無法連線到 Apps Script（' + e.message + '）');
      })
      .finally(() => clearTimeout(timer));
  }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const name = '__placesCb' + Date.now() + Math.floor(Math.random() * 1000);
      const s = document.createElement('script');
      const done = (fn, arg) => { clearTimeout(timer); delete window[name]; s.remove(); fn(arg); };
      const timer = setTimeout(() => done(reject, err('NETWORK', '連線逾時')), api.timeout || 20000);
      const denied = () => done(reject, err('NETWORK', '需要登入或沒有存取權限，請確認 Apps Script 部署的「誰可以存取」設定'));
      window[name] = (data) => done(resolve, data);
      s.onerror = denied;
      s.onload = () => setTimeout(() => { if (window[name]) denied(); }, 0);
      s.src = url + '&callback=' + name;
      document.head.appendChild(s);
    });
  }

  let transport = 'fetch';          // 第一次讀取成功的方式；之後的寫入沿用，避免同一個操作送兩次

  function get(params) {
    const url = withQuery(params);
    if (transport === 'jsonp') return jsonp(url);
    return fetchJson(url).catch((e) => {
      if (transport !== 'fetch-only') { transport = 'jsonp'; return jsonp(url); }
      throw e;
    });
  }

  // Apps Script 還是舊版本時，?action=places 會回傳整份資料表，沒有 days／pois
  const OLD_VERSION = 'Apps Script 部署的還是舊版本，沒有地點管理功能。請確認專案已加入 PoiLogic.gs、PoiStore.gs、PlacesSearch.gs 並更新 Api.gs，' +
    '再到「部署 → 管理部署作業 → 編輯 → 版本：新版本 → 部署」。';

  // 寫入資料不需要的空欄位不送，縮短網址（JSONP 寫入時資料放在網址裡）
  function compact(v) {
    if (Array.isArray(v)) return v.map(compact);
    if (v && typeof v === 'object') {
      const o = {};
      Object.keys(v).forEach((k) => { if (v[k] !== null && v[k] !== undefined) o[k] = compact(v[k]); });
      return o;
    }
    return v;
  }

  /* ---------------- remote（Apps Script） ---------------- */
  const remote = {
    mode: 'remote',

    load() {
      return get({ action: 'places', code: currentCode() }).then((data) => {
        if (transport === 'fetch') transport = 'fetch-only';
        if (data.error) throw serverError(data.error);
        if (!Array.isArray(data.days) || !Array.isArray(data.pois)) {
          throw err('OLD_VERSION', OLD_VERSION, {
            received: Object.keys(data || {}).slice(0, 8),
            testUrl: withQuery({ action: 'places', code: currentCode() }),
          });
        }
        return Object.assign({ mode: 'remote' }, data);
      });
    },

    // 寫入：先用 POST；POST 被瀏覽器擋下（Failed to fetch）時，改用 JSONP（GET）再送一次，之後都用 JSONP。
    // 重送是安全的：匯入會略過已存在的景點，備註與「確認」行程是覆寫。
    write(op) {
      const payload = compact({ code: currentCode(), op, token: api.writeToken || undefined });
      const viaJsonp = () => jsonp(withQuery({ action: 'write', payload: JSON.stringify(payload) }));
      const req = transport === 'jsonp'
        ? viaJsonp()
        : fetchJson(api.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
            .catch((e) => {
              if (e.code !== 'NETWORK' || /逾時/.test(e.message)) throw e;
              console.warn('[places] POST 失敗，改用 JSONP 寫入：', e);
              return viaJsonp().then((data) => { transport = 'jsonp'; return data; });
            });
      return req.then((data) => {
        if (data.error) {
          // 刪除景點重送時，第一次其實已經刪除成功
          if (op.type === 'deletePoi' && data.error.code === 'NOT_FOUND') return remote.load().then((st) => ({ ok: true, result: {}, pois: st.pois, schedule: st.schedule }));
          throw serverError(data.error);
        }
        if (!data.ok) throw err('OLD_VERSION', OLD_VERSION);
        return data;
      });
    },

    // 部署檢查：目前網址上跑的程式版本（舊版沒有 action=version，會回傳整份資料表）
    version() {
      return get({ action: 'version' }).then((d) => (d && d.build ? d : null), () => null);
    },

    // 景點照片：只能用 POST（照片資料太大，不能放在 JSONP 網址裡）
    uploadPhoto(target) {
      const payload = compact({ code: currentCode(), op: Object.assign({ type: 'uploadPhoto' }, target), token: api.writeToken || undefined });
      return fetchJson(api.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
        .catch((e) => {
          if (e.code === 'NETWORK' && transport === 'jsonp') throw err('NETWORK', '照片需要直接連線上傳：請把 Apps Script 部署的「誰可以存取」設為「任何人」');
          throw e;
        })
        .then((data) => {
          if (data.error) throw serverError(data.error);
          if (!data.ok || !data.result || !data.result.photo_url) throw err('OLD_VERSION', 'Apps Script 還沒更新，無法上傳照片');
          return data.result;
        });
    },

    search(params) {
      return get({ action: 'searchPlaces', region: params.region, minRating: params.minRating, category: params.category })
        .then((data) => {
          if (data.error) throw serverError(data.error);
          return data;
        });
    },
  };

  /* ---------------- local（離線示範） ---------------- */
  function readLocal() {
    try {
      const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
      if (v && Array.isArray(v.pois) && Array.isArray(v.schedule)) return v;
    } catch (e) { /* 無法讀取時從空白開始 */ }
    return { pois: [], schedule: [] };
  }

  function saveLocal(state) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
  }

  // 離線時的行程地點：讀取 api.itineraryJson（行程 JSON 檔，例如預覽版的 data/itinerary.json）；沒有就不顯示
  function readItineraryJson() {
    if (!api.itineraryJson) return Promise.resolve({ stops: [] });
    return fetch(api.itineraryJson, { cache: 'no-store' }).then((r) => r.json()).then((d) => ({
      title: d.title,
      days: (d.days || []).map((x, i) => ({ day_no: i + 1, title: x.title || '', menu_sub: '' })),
      stops: [].concat.apply([], (d.days || []).map((x, i) => (x.stops || []).map((t, j, all) => ({
        day_stop_id: (i + 1) * 1000 + j + 1,            // 離線時沒有 day_stop 表，用天數與順序組出唯一 ID
        day_no: i + 1, seq: j + 1, letter: String.fromCharCode(65 + j),
        role: j === 0 ? '出發' : j === all.length - 1 ? '終點' : null,
        name: t.name, address: t.addr || null, category: t.category || 'attraction',
        lat: t.at ? t.at[0] : null, lng: t.at ? t.at[1] : null,
        maps_url: t.at ? 'https://www.google.com/maps/search/?api=1&query=' + t.at[0] + ',' + t.at[1] : null,
      })))),
    })).catch(() => ({ stops: [] }));
  }

  const LOCAL_DAYS = [1, 2, 3, 4, 5].map((n) => ({ day_no: n, title: '', menu_sub: '' }));
  let localState = null;
  let localStops = [];
  let localDays = LOCAL_DAYS;

  const local = {
    mode: 'local',

    load() {
      localState = readLocal();
      return readItineraryJson().then((it) => {
        localStops = it.stops || [];
        localDays = it.days || LOCAL_DAYS;
        // 原行程地點併入同一份排序資料（與 Apps Script 相同規則）
        const state = JSON.parse(JSON.stringify(localState));
        Trip.PoiLogic.planFor(state, 1, localStops);
        return {
          mode: 'local',
          itinerary: { itinerary_id: 1, code: currentCode(), title: (it.title || '沖繩五日行程') + '（離線示範）' },
          days: localDays,
          stops: localStops,
          pois: state.pois,
          schedule: state.schedule,
          searchEnabled: false,
          rules: {},
        };
      });
    },

    write(op) {
      return new Promise((resolve) => {
        const state = JSON.parse(JSON.stringify(localState));
        Trip.PoiLogic.planFor(state, 1, localStops);
        const result = Trip.PoiLogic.apply(state, op, {
          now: new Date().toISOString(), itineraryId: 1, days: localDays.map((d) => d.day_no),
        });
        localState = state;
        saveLocal(state);
        resolve({ ok: true, result, pois: state.pois, schedule: state.schedule });
      });
    },

    search() {
      return Promise.reject(err('NO_API_KEY', '離線示範不會連線 Google Maps'));
    },
  };

  /* ---------------- 示範搜尋（模擬資料） ---------------- */
  const CATEGORY_LABEL = { attraction: '觀光景點', nature: '自然景觀', heritage: '文化古蹟', shopping: '購物中心' };

  // 搜尋地區（下拉選單）：「沖繩」＝全部；其他地區用名稱、地址裡的關鍵字判斷
  const REGION_KEYWORDS = {
    '沖繩': null,
    '那霸': ['那霸', '那覇', 'naha'],
    '沖繩中部': ['北谷', '恩納', '宜野灣', '宜野湾', '讀谷', '読谷', '沖繩市', '沖縄市', '浦添', '中城', '北中城', '嘉手納'],
    '沖繩北部': ['名護', '本部', '今歸仁', '今帰仁', '古宇利', '國頭', '国頭', '大宜味', '美麗海', '美ら海', '備瀨', '備瀬'],
    '沖繩南部': ['糸滿', '糸満', '豐見城', '豊見城', '瀨長', '瀬長', '南城', '八重瀨', '八重瀬', '玉城', '齋場', '斎場', '玉泉洞'],
    '宮古島': ['宮古'],
    '石垣島': ['石垣'],
  };
  function inRegion(params) {
    const region = String(params.region || '').toLowerCase();
    if (!region || Object.prototype.hasOwnProperty.call(REGION_KEYWORDS, params.region)) return true;
    return Trip.placesDemo.regionWords.some((w) => region.indexOf(w.toLowerCase()) >= 0);
  }
  function regionHit(r, params) {
    const keys = REGION_KEYWORDS[params.region];
    if (!keys) return true;
    const text = (String(r.name || '') + ' ' + String(r.address || '')).toLowerCase();
    return keys.some((k) => text.indexOf(k.toLowerCase()) >= 0);
  }

  // 目前行程（day_stop → place）的地點，轉成搜尋結果。
  // 景點類型：試算表 place 有 category 欄就用它，沒有先一律當「觀光景點」。
  // 評分：有評分（試算表 place.rating）就照「景點評分」篩選；無評分的只在「不限」時列入。地區與類型照常篩選。
  function stopResults(stops, params) {
    if (!stops || !stops.length || !inRegion(params)) return [];
    const seen = {};
    const results = [];
    stops.forEach((t) => {
      const key = String(t.name || '').replace(/\s+/g, '').toLowerCase();
      if (!key) return;
      if (seen[key]) { if (seen[key].days.indexOf(t.day_no) < 0) seen[key].days.push(t.day_no); return; }
      const category = t.category || 'attraction';
      const r = {
        google_place_id: null, name: t.name, address: t.address || null, lat: t.lat, lng: t.lng,
        rating: typeof t.rating === 'number' ? t.rating : null, rating_count: null, primary_type: null,
        type_label: CATEGORY_LABEL[category] || '觀光景點', category: category,
        maps_url: t.maps_url || null, photo: null, source: 'itinerary', fromStops: true, days: [t.day_no],
        place_id: t.place_id != null ? t.place_id : null, photo_url: t.photo_url || null, note: t.note || null,
        updated_at: t.updated_at || null,
      };
      seen[key] = r;
      results.push(r);
    });
    const min = Number(params.minRating) || 0;
    return results.filter((r) => regionHit(r, params) && (params.category === 'all' || r.category === params.category) &&
      (r.rating == null ? min === 0 : r.rating >= min));
  }

  // 把目前行程的地點放在最前面；名稱和其他結果相同的，以其他結果（資料較完整）為準
  function mergeStops(stops, params, others) {
    const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
    const names = new Set((others || []).map((r) => norm(r.name)));
    return stopResults(stops, params).filter((r) => !names.has(norm(r.name))).concat(others || []);
  }

  // 示範資料：預設只列目前行程的地點；simulated = true 時加上 demo-data.js 的模擬景點
  function demoSearch(params, stops, simulated) {
    const wait = (v, ms) => new Promise((resolve) => setTimeout(() => resolve(v), ms));
    if (!simulated && stops && stops.length) return wait({ source: 'stops', results: stopResults(stops, params) }, 200);
    const demo = Trip.placesDemo;
    const min = Number(params.minRating) || 0;
    const sim = !inRegion(params) ? [] : demo.places.filter((p) => regionHit(p, params) &&
      (params.category === 'all' || p.category === params.category) &&
      typeof p.rating === 'number' && p.rating >= min);
    return wait({ source: 'demo', note: demo.note, results: mergeStops(stops, params, sim) }, 350);
  }

  function currentCode() {
    return new URLSearchParams(location.search).get('code') || api.code || 'okinawa-5d';
  }

  Trip.PoiLogic = window.PoiLogic;
  // 目前所有景點：目前行程（day_stop → place）＋ 地點清單（poi，含尚未儲存的），依搜尋條件篩選
  //   地區：同目前行程（沖繩相關的地區名稱）；類型：沒有類型的當作觀光景點；評分：無評分的只在「不限」時列出
  function poiResult(p) {
    return {
      google_place_id: p.google_place_id || null, name: p.name, address: p.address || null, lat: p.lat, lng: p.lng,
      rating: typeof p.rating === 'number' ? p.rating : (p.rating == null || p.rating === '' ? null : Number(p.rating)),
      rating_count: p.rating_count == null || p.rating_count === '' ? null : Number(p.rating_count),
      primary_type: p.primary_type || null, type_label: p.type_label || CATEGORY_LABEL[p.category || 'attraction'] || null,
      category: p.category || 'attraction', maps_url: p.maps_url || null, photo: null, photo_url: p.photo_url || null,
      note: p.note || null, source: p.source || 'manual', fromPois: true,
    };
  }
  function localSearch(params, stops, pois) {
    const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
    // 名稱相同時以地點清單（poi）為準：安排行程、編輯都是針對地點清單的地點
    const poiNames = new Set((pois || []).map((p) => norm(p.name)));
    const fromStops = stopResults(stops, params).filter((r) => !poiNames.has(norm(r.name)));
    const min = Number(params.minRating) || 0;
    const fromPois = !inRegion(params) ? [] : (pois || []).map(poiResult)
      .filter((r) => regionHit(r, params) && (params.category === 'all' || r.category === params.category) &&
        (r.rating == null ? min === 0 : r.rating >= min));
    return { source: 'local', results: fromStops.concat(fromPois) };
  }
  // Google 搜尋結果併入目前所有景點：目前景點放前面；名稱相同的以 Google 結果（資料較完整）為準
  function mergeLocal(local, others) {
    const norm = (v) => String(v || '').replace(/\s+/g, '').toLowerCase();
    const names = new Set((others || []).map((r) => norm(r.name)));
    return local.filter((r) => !names.has(norm(r.name))).concat(others || []);
  }

  Trip.placesStore = {
    localSearch: localSearch,
    mergeLocal: mergeLocal,
    create: () => (api.url ? remote : local),
    local: local,
    demoSearch: demoSearch,
    mergeStops: mergeStops,
  };
})(window.Trip);
