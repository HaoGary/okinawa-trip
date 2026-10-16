/* ==========================================================================
   myplan-build.js — 我的行程：在網頁端組出行程（index.html 我的行程使用）

   Apps Script 已更新時，資料直接由 ?action=myplan 取得（Itinerary.gs 的 buildMyPlan）。
   Apps Script 還沒更新（不認得 action=myplan）時，loader.js 改讀既有的三個網址：
     ?action=places          天數、原行程地點、地點清單（poi）
     ?table=poi_schedule     已按「確認」儲存的行程安排（原始資料，不含尚未儲存的原行程地點）
     ?action=itinerary       只取全島地理資料（geo）與地區範圍（region），不使用原行程內容
   再由這裡組成與 buildMyPlan 相同格式的資料，結果一致。
   ========================================================================== */
(function (Trip) {
  'use strict';

  const isStop = (r) => r.day_stop_id !== null && r.day_stop_id !== undefined && r.day_stop_id !== '';
  const isHidden = (r) => r.hidden === true || r.hidden === 'TRUE' || r.hidden === 'true' || r.hidden === 1;
  const hasNum = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
  const order = (r) => Number(hasNum(r.sort_order) ? r.sort_order : r.seq);

  function kmBetween(a, b) {
    const R = 6371, toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // 與 Itinerary.gs 的 replanDay_ ＋ myPlanText_ 相同的計算
  function planDay(d, regionBounds) {
    const W = 800;
    if (!d.stops.length) {
      d.legs = []; d.stats = [['0', '個地點']]; d.buttons = [];
      d.menu.sub = '尚未安排';
      d.title = '尚未安排地點';
      d.desc = '這天在地點管理頁的「行程安排」沒有安排地點';
      d.foot = '';
      d.area = { title: '尚未安排地點', note: '在地點管理頁的「行程安排」加入地點並按「確認」後，會顯示在這裡', box: null };
      d.empty = true;
      const b = regionBounds;
      if (b) {
        const cos = Math.cos((b.s + b.n) / 2 * Math.PI / 180);
        const H = Math.max(420, Math.min(720, Math.round(W * (b.n - b.s) / ((b.e - b.w) * cos))));
        const add = Math.max(0, ((b.n - b.s) * W / (H * cos) - (b.e - b.w)) / 2);
        d.map.height = H;
        d.map.bounds = { w: b.w - add, e: b.e + add, s: b.s, n: b.n };
      }
      return d;
    }

    const legs = [];
    let total = 0;
    for (let i = 0; i + 1 < d.stops.length; i++) {
      const a = d.stops[i].at, b = d.stops[i + 1].at, k = kmBetween(a, b);
      total += k;
      legs.push({ km: '直線約 ' + (k < 10 ? k.toFixed(1) : Math.round(k)) + ' km', t: '路線待規劃',
                  dashed: true, points: [a, b] });
    }
    d.legs = legs;
    d.stats = [['約 ' + Math.round(total), '公里（直線）'], [String(d.stops.length), '個地點']];

    const n = d.stops.length;
    if (n > 1) {
      d.stops[0].note = '出發｜' + d.stops[0].note;
      d.stops[n - 1].note = '終點｜' + d.stops[n - 1].note;
    }
    const first = d.stops[0].name, last = d.stops[n - 1].name;
    d.title = n > 1 ? first + ' → ' + last : first;
    d.desc = n + ' 個地點，依地點管理頁「行程安排」的順序';
    d.foot = '路段為兩點間的直線示意，距離為直線估計；實際路線與時間請以 Google 地圖導航為準。';

    const lats = d.stops.map((t) => t.at[0]), lngs = d.stops.map((t) => t.at[1]);
    const box = { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lngs), e: Math.max(...lngs) };
    const cos = Math.cos((box.s + box.n) / 2 * Math.PI / 180);
    const nsKm = (box.n - box.s) * 111, ewKm = (box.e - box.w) * 111 * cos;
    const span = (dir, k) => dir + (k < 1 ? '不到 1 km' : '約 ' + (k < 10 ? k.toFixed(1) : Math.round(k)) + ' km');
    const short = (name) => {
      const t = String(name || '').split(/[（(・]/)[0].replace(/\s*B\d+F$/i, '').trim();
      return t.length > 9 ? t.slice(0, 8) + '…' : t;
    };
    d.menu.sub = n > 1 ? short(first) + ' → ' + short(last) : short(first);
    d.area = {
      title: d.title,
      note: n + ' 個地點，' + span('南北', nsKm) + '、' + span('東西', ewKm),
      box: { w: box.w - 0.01, e: box.e + 0.01, s: box.s - 0.01, n: box.n + 0.01 },
    };

    const minSpan = 0.03;
    const lngSpan = Math.max(box.e - box.w, minSpan), latSpan = Math.max(box.n - box.s, minSpan);
    let w = box.w - lngSpan * 0.15, e = box.e + lngSpan * 0.35;
    let s = box.s - latSpan * 0.18, nn = box.n + latSpan * 0.18;
    const H = Math.max(420, Math.min(720, Math.round(W * (nn - s) / ((e - w) * cos))));
    const needLat = H * (e - w) * cos / W;
    if (needLat > nn - s) { const add = (needLat - (nn - s)) / 2; s -= add; nn += add; }
    else { const needLng = (nn - s) * W / (H * cos), add = (needLng - (e - w)) / 2; w -= add; e += add; }
    d.map.height = H;
    d.map.bounds = { w: w, e: e, s: s, n: nn };
    const widthKm = (e - w) * 111 * cos;
    const km = [1, 2, 5, 10, 20, 50, 100].reduce((best, k) => (Math.abs(k - widthKm / 5) < Math.abs(best - widthKm / 5) ? k : best), 1);
    d.map.scaleBar = { at: [s + (nn - s) * 0.05, w + (e - w) * 0.66], km: km };
    return d;
  }

  /**
   * places   ?action=places 的結果
   * rows     ?table=poi_schedule 的結果（陣列；讀不到時給 []）
   * itin     ?action=itinerary 的結果（只用 geo、region、code）
   */
  function build(places, rows, itin) {
    const itinId = places.itinerary && places.itinerary.itinerary_id;
    const regionBounds = itin.region && itin.region.bounds ? itin.region.bounds : null;
    const stopById = {}, poiById = {};
    (places.stops || []).forEach((s) => { stopById[Number(s.day_stop_id)] = s; });
    const normName = (v) => String(v || '').replace(/[\s・·()（）]/g, '').toLowerCase();
    const photoByName = {};
    (places.stops || []).forEach((s) => { if (s.photo_url) photoByName[normName(s.name)] = s.photo_url; });
    (places.pois || []).forEach((p) => { poiById[Number(p.poi_id)] = p; });
    const mine = (rows || []).filter((r) => Number(r.itinerary_id) === Number(itinId) && !isHidden(r));

    const dayNos = (places.days || []).map((d) => Number(d.day_no));
    if (!dayNos.length) (itin.days || []).forEach((d) => dayNos.push(Number(d.id)));

    const days = dayNos.map((n) => {
      const stops = [];
      mine.filter((r) => Number(r.day_no) === n).sort((a, b) => order(a) - order(b)).forEach((r) => {
        if (isStop(r)) {
          const s = stopById[Number(r.day_stop_id)];
          if (!s || !hasNum(s.lat) || !hasNum(s.lng)) return;
          const t = { name: s.name, note: s.address || '', addr: s.address || s.name,
                       at: [Number(s.lat), Number(s.lng)], label: [14, 5], scene: 'city' };
          if (s.photo_url) t.photo = s.photo_url;
          stops.push(t);
          return;
        }
        const p = poiById[Number(r.poi_id)];
        if (!p || !hasNum(p.lat) || !hasNum(p.lng)) return;          // 沒有座標無法畫在地圖上
        const t = { name: p.name, note: (p.address || '') + (p.note ? '；' + p.note : ''),
                     addr: p.address || p.name, at: [Number(p.lat), Number(p.lng)], label: [14, 5], scene: 'city' };
        const ph = p.photo_url || photoByName[normName(p.name)];   // 沒有自己的照片就沿用同名原行程地點的照片
        if (ph) t.photo = ph;
        stops.push(t);
      });
      return planDay({
        id: n,
        menu: { title: '第 ' + n + ' 天', sub: '' },
        title: '第 ' + n + ' 天', desc: '', foot: '',
        stops: stops,
        map: { height: 560, bounds: regionBounds, layers: [{ type: 'background', fill: 'sea' }, { type: 'island' }] },
        buttons: [{ text: '在 Google 地圖開啟全程導航', travelmode: 'driving', primary: true }],
      }, regionBounds);
    });

    return {
      code: itin.code || (places.itinerary && places.itinerary.code), title: '我的行程', mode: 'myplan',
      region: itin.region, days: days, planned: days.some((d) => !d.empty),
      geo: itin.geo, apiVersion: itin.apiVersion || places.apiVersion || null, builtInBrowser: true,
    };
  }

  Trip.MyPlan = { build: build };
})(window.Trip);
