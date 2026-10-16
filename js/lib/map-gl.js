/* ==========================================================================
   lib/map-gl.js — 路線地圖的 MapLibre 版本（我的行程 index.html 使用）

   底圖：OpenFreeMap（OpenStreetMap 資料，免費、不需金鑰）
         淺色 positron／深色 dark，跟著頁面的深淺色切換
   圖層：路段（虛線，滑過行程清單的路段時標示）
   地名：HTML 文字，每次移動後挑右／左／上／下避開重疊
   標記：HTML 圓點 A/B/C…（沿用 data-stop 屬性，點擊照樣開啟景色圖卡）
   控制：縮放、指北（重設方向）、重設範圍、比例尺；捲動頁面時需按 Ctrl／⌘ 才會縮放地圖

   無法使用時（MapLibre 沒載入、瀏覽器不支援 WebGL、底圖讀不到）自動改回原本的 SVG 地圖。
   ========================================================================== */
(function (Trip) {
  'use strict';

  const cfg = Trip.config;
  const STYLES = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  };
  const STYLE_TIMEOUT = 15000;                 // 底圖樣式超過 15 秒沒讀到就改用 SVG
  const LOCALE = {
    'NavigationControl.ZoomIn': '放大',
    'NavigationControl.ZoomOut': '縮小',
    'NavigationControl.ResetBearing': '指北',
    'ScaleControl.Meters': 'm',
    'ScaleControl.Kilometers': 'km',
    'CooperativeGesturesHandler.WindowsHelpText': '按住 Ctrl 並捲動滑鼠滾輪來縮放地圖',
    'CooperativeGesturesHandler.MacHelpText': '按住 ⌘ 並捲動來縮放地圖',
    'CooperativeGesturesHandler.MobileHelpText': '用兩指移動地圖',
  };

  const root = document.documentElement;
  const systemDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const theme = () => root.getAttribute('data-theme') || (systemDark && systemDark.matches ? 'dark' : 'light');
  const cssVar = (name) => getComputedStyle(root).getPropertyValue('--' + name).trim();
  const letter = (i) => (cfg.stopLetters || 'ABCDEFGHIJ')[i] || String(i + 1);

  function webglOk() {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  const instances = [];

  /* ---------------- 深淺色切換：換底圖樣式，路段與名稱圖層重新加上 ---------------- */
  let lastTheme = theme();
  function onTheme() {
    const t = theme();
    if (t === lastTheme) return;
    lastTheme = t;
    instances.forEach((it) => it.restyle());
  }
  new MutationObserver(onTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (systemDark && systemDark.addEventListener) systemDark.addEventListener('change', onTheme);

  /**
   * 把 .routemap SVG 換成 MapLibre 地圖
   * @param {SVGSVGElement} svg   原本的路線地圖（失敗時改回用它）
   * @param {object} day          每日資料
   * @param {function} getView    取目前交通方式的資料（legs 等）
   * @returns {{ draw(activeLeg:number):void } | null}  null＝不能用，呼叫端照舊畫 SVG
   */
  function attach(svg, day, getView) {
    if (!window.maplibregl || !webglOk()) return null;

    const box = document.createElement('div');
    box.className = 'glmap';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', (day.title || ('第 ' + day.id + ' 天')) + ' 路線地圖');
    box.style.setProperty('--map-ratio', String(cfg.mapWidth / (day.map && day.map.height ? day.map.height : 560)));
    svg.style.display = 'none';                 // SVG 有 display 樣式，hidden 屬性蓋不掉
    svg.after(box);

    let map = null, styleReady = false, failed = false, active = -1, timer = null;

    function fallback(reason) {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      console.warn('[地圖] MapLibre 無法使用，改用 SVG 地圖：', reason);
      try { if (map) map.remove(); } catch (e) { /* 略過 */ }
      box.remove();
      svg.style.display = '';
      Trip.lib.map.drawRouteMap(svg, day, getView(), active);
    }

    /* ---------- 範圍 ---------- */
    function bounds() {
      const pts = (day.stops || []).map((s) => s.at);
      if (pts.length) {
        const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
        let w = Math.min(...lngs), e = Math.max(...lngs), s = Math.min(...lats), n = Math.max(...lats);
        const min = 0.004;                                   // 只有一個地點或很近時，至少約 400 m 範圍
        if (e - w < min) { w -= min; e += min; }
        if (n - s < min) { s -= min; n += min; }
        return [[w, s], [e, n]];
      }
      const b = (Trip.region && Trip.region.bounds) || (day.map && day.map.bounds);
      return b ? [[b.w, b.s], [b.e, b.n]] : [[127.6, 26.05], [128.36, 26.9]];
    }
    function padding() {
      const w = box.clientWidth || 600;
      const p = Math.round(Math.max(36, Math.min(72, w * 0.08)));
      return { top: p + 8, bottom: p, left: p, right: Math.round(Math.max(p, Math.min(150, w * 0.22))) };   // 地名多半放右側，右邊多留空間
    }
    function fit(animate) {
      if (map) map.fitBounds(bounds(), { padding: padding(), maxZoom: 15, duration: animate ? 600 : 0 });
    }

    /* ---------- 路段與名稱圖層 ---------- */
    function legsData() {
      const legs = (getView().legs || []);
      return {
        type: 'FeatureCollection',
        features: legs.map((g, i) => ({
          type: 'Feature',
          properties: { i: i, dashed: g.dashed ? 1 : 0 },
          geometry: { type: 'LineString', coordinates: (g.points || []).map((p) => [p[1], p[0]]) },
        })),
      };
    }
    function addLayers() {
      styleReady = true;
      clearTimeout(timer);
      const route = cssVar('route') || '#1a73e8';
      const panel = cssVar('panel') || '#ffffff';
      const ink = cssVar('ink') || '#202124';
      if (!map.getSource('legs')) map.addSource('legs', { type: 'geojson', data: legsData() });
      if (!map.getLayer('legs-casing')) {
        map.addLayer({ id: 'legs-casing', type: 'line', source: 'legs',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': panel, 'line-width': 8, 'line-opacity': 0.9 } });
      }
      if (!map.getLayer('legs-line')) {
        map.addLayer({ id: 'legs-line', type: 'line', source: 'legs',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': route, 'line-width': 4, 'line-dasharray': [2, 1.6] } });
      }
      paintActive();
    }

    // 滑過行程清單的路段：該路段加粗、實線，其他路段變淡
    function paintActive() {
      if (!map || !styleReady || !map.getLayer('legs-line')) return;
      const on = ['==', ['get', 'i'], active];
      if (active < 0) {
        map.setPaintProperty('legs-line', 'line-width', 4);
        map.setPaintProperty('legs-line', 'line-opacity', 1);
        map.setPaintProperty('legs-casing', 'line-opacity', 0.9);
      } else {
        map.setPaintProperty('legs-line', 'line-width', ['case', on, 6, 3]);
        map.setPaintProperty('legs-line', 'line-opacity', ['case', on, 1, 0.25]);
        map.setPaintProperty('legs-casing', 'line-opacity', ['case', on, 0.95, 0.3]);
      }
    }

    /* ---------- 地點標記（HTML，可點擊開景色圖卡）＋地點名稱 ---------- */
    // 名稱用網頁字型顯示，位置（右／左／上／下）每次地圖移動後重新挑選，避開其他名稱與圓點
    const marks = [];
    function addMarkers() {
      const last = day.stops.length - 1;
      day.stops.forEach((s, i) => {
        const name = s.mapName || s.name;
        const wrap = document.createElement('div');
        wrap.className = 'gl-stop pos-r';
        const el = document.createElement('div');
        el.className = 'gl-mk ' + (i === 0 ? 'is-start' : i === last ? 'is-end' : 'is-route');
        el.textContent = letter(i);
        el.setAttribute('data-stop', name);
        if (s.addr) el.setAttribute('data-addr', s.addr);
        if (s.scene) el.setAttribute('data-scene', s.scene);
        if (s.photo) el.setAttribute('data-photo', s.photo);
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', name + '：' + ((cfg.text && cfg.text.viewScene) || '查看景色'));
        const lbl = document.createElement('span');
        lbl.className = 'gl-lbl';
        lbl.textContent = name;
        lbl.setAttribute('aria-hidden', 'true');
        wrap.append(el, lbl);
        new maplibregl.Marker({ element: wrap, anchor: 'center' }).setLngLat([s.at[1], s.at[0]]).addTo(map);
        marks.push({ wrap: wrap, lbl: lbl, lngLat: [s.at[1], s.at[0]], z: day.stops.length - i });
      });
      map.on('moveend', placeLabels);
      map.on('resize', placeLabels);
      map.once('idle', placeLabels);
      placeLabels();
    }

    const R = 13, GAP = 6;                                    // 圓點半徑、名稱與圓點的間距
    const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    function placeLabels() {
      if (!map || !marks.length) return;
      const W = box.clientWidth, H = box.clientHeight;
      const pts = marks.map((m) => map.project(m.lngLat));
      const dots = pts.map((p) => ({ l: p.x - R, r: p.x + R, t: p.y - R, b: p.y + R }));
      const placed = [];
      // 起點、終點先放，其他依順序；放不下（與其他名稱重疊太多）的名稱先隱藏，放大地圖後會再出現
      const order = marks.map((m, i) => i).sort((a, b) => {
        const rank = (i) => (i === 0 || i === marks.length - 1 ? 0 : 1);
        return rank(a) - rank(b) || a - b;
      });
      order.forEach((i) => {
        const m = marks[i];
        const p = pts[i], w = m.lbl.offsetWidth, h = m.lbl.offsetHeight;
        const cands = {
          r: { l: p.x + R + GAP, r: p.x + R + GAP + w, t: p.y - h / 2, b: p.y + h / 2 },
          l: { l: p.x - R - GAP - w, r: p.x - R - GAP, t: p.y - h / 2, b: p.y + h / 2 },
          t: { l: p.x - w / 2, r: p.x + w / 2, t: p.y - R - GAP - h, b: p.y - R - GAP },
          b: { l: p.x - w / 2, r: p.x + w / 2, t: p.y + R + GAP, b: p.y + R + GAP + h },
        };
        let best = 'r', bestCost = Infinity;
        ['r', 'l', 't', 'b'].forEach((k, order) => {
          const c = cands[k];
          let cost = order * 0.5;                            // 同樣沒有重疊時，依右、左、上、下的順序
          placed.forEach((q) => { cost += overlap(c, q); });
          dots.forEach((d, j) => { if (j !== i) cost += overlap(c, d); });
          const out = Math.max(0, -c.l) + Math.max(0, c.r - W) + Math.max(0, -c.t) + Math.max(0, c.b - H);
          cost += out * h * 2;                               // 超出地圖邊界
          if (cost < bestCost) { bestCost = cost; best = k; }
        });
        const hide = bestCost > 2 + w * h * 0.04;               // 稍有重疊就先隱藏（點圓點仍可看名稱）
        if (!hide) placed.push(cands[best]);
        m.wrap.classList.toggle('no-lbl', hide);
        m.wrap.classList.remove('pos-r', 'pos-l', 'pos-t', 'pos-b');   // 只換位置 class（maplibregl-marker 等 class 要保留）
        m.wrap.classList.add('pos-' + best);
        m.wrap.style.zIndex = String(m.z);
      });
    }

    // 「重設範圍」按鈕（放在縮放按鈕下方）
    function fitControl() {
      return {
        onAdd() {
          const c = document.createElement('div');
          c.className = 'maplibregl-ctrl maplibregl-ctrl-group';
          c.innerHTML = '<button type="button" class="gl-fit" title="重設範圍" aria-label="重設範圍">' +
            '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></svg></button>';
          c.querySelector('button').addEventListener('click', () => { userMoved = false; fit(true); });
          return c;
        },
        onRemove() { /* 不需要 */ },
      };
    }

    function create() {
      try {
        map = new maplibregl.Map({
          container: box,
          style: STYLES[theme()] || STYLES.light,
          bounds: bounds(),
          fitBoundsOptions: { padding: padding(), maxZoom: 15 },
          maxZoom: 18,
          cooperativeGestures: true,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          locale: LOCALE,
        });
      } catch (e) { fallback(e.message); return; }
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(fitControl(), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-left');
      map.on('style.load', addLayers);
      map.on('error', (e) => { if (!styleReady) fallback((e && e.error && e.error.message) || '底圖讀取失敗'); });
      map.on('movestart', (e) => {
        if (!e.originalEvent) return;
        userMoved = true;                                   // 使用者移動過就不再自動重設範圍
        if (Trip.lib.popup) Trip.lib.popup.hide();          // 拖曳地圖時關閉景色圖卡
      });
      timer = setTimeout(() => { if (!styleReady) fallback('底圖讀取逾時'); }, STYLE_TIMEOUT);
      addMarkers();
    }

    // 隱藏中的天數寬度是 0，等顯示出來才建立地圖；之後尺寸改變時重新排版
    let userMoved = false;
    new ResizeObserver(() => {
      if (failed || !box.clientWidth) return;
      if (!map) { create(); return; }
      map.resize();
      if (!userMoved) fit(false);                           // 視窗大小改變：還沒手動移動過就重新對齊範圍
    }).observe(box);

    const it = {
      draw(activeLeg) {
        active = activeLeg;
        if (failed) { Trip.lib.map.drawRouteMap(svg, day, getView(), active); return; }
        if (map && styleReady && map.getSource('legs')) map.getSource('legs').setData(legsData());
        paintActive();
      },
      restyle() {
        if (!map || failed) return;
        styleReady = false;
        map.setStyle(STYLES[theme()] || STYLES.light, { diff: false });   // style.load 後 addLayers 會重新加上圖層
      },
    };
    instances.push(it);
    return it;
  }

  /* ------------------------------------------------------------------------
     活動範圍小圖（資訊卡右欄）：用真實底圖，依整趟行程的地點自動決定範圍
     不寫死國家或地名，日本、韓國、新加坡、中國…都適用；地名由底圖顯示
     ------------------------------------------------------------------------ */
  let tripBox = null;
  function tripBounds() {
    if (tripBox) return tripBox;
    const pts = [];
    (Trip.days || []).forEach((d) => (d.stops || []).forEach((t) => { if (t.at) pts.push(t.at); }));
    let w, e, s, n;
    if (pts.length) {
      w = Math.min(...pts.map((p) => p[1])); e = Math.max(...pts.map((p) => p[1]));
      s = Math.min(...pts.map((p) => p[0])); n = Math.max(...pts.map((p) => p[0]));
    } else if (Trip.region && Trip.region.bounds) {
      ({ w, e, s, n } = Trip.region.bounds);
    } else return null;
    // 四周多留空間，看得出所在的島或國家；行程很集中（例如只在一個城市）時至少約 50 公里寬
    const span = Math.max(e - w, n - s, 0.45);
    const cx = (w + e) / 2, cy = (s + n) / 2, half = span * 0.8;
    tripBox = [[cx - half, cy - half], [cx + half, cy + half]];
    return tripBox;
  }

  const OV_PAD = { top: 10, left: 10, right: 10, bottom: 26 };
  function overview(svg, day) {
    if (!window.maplibregl || !webglOk() || !tripBounds()) return false;
    const box = document.createElement('div');
    box.className = 'ovmap ovmap-gl';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', svg.getAttribute('aria-label') || '活動範圍');
    svg.style.display = 'none';
    svg.after(box);
    let map = null, failed = false;

    function fallback(reason) {
      if (failed) return;
      failed = true;
      console.warn('[地圖] 活動範圍小圖改用 SVG：', reason);
      try { if (map) map.remove(); } catch (e) { /* 略過 */ }
      box.remove();
      svg.style.display = '';
      Trip.lib.map.drawOverview(svg, day.area && day.area.box);
    }

    // 這天的範圍框；太小時放大到至少 22×18 像素，才看得到
    function areaData() {
      const b = day.area && day.area.box;
      if (!b || !map) return { type: 'FeatureCollection', features: [] };
      const p1 = map.project([b.w, b.n]), p2 = map.project([b.e, b.s]);
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      const hw = Math.max(Math.abs(p2.x - p1.x), 22) / 2, hh = Math.max(Math.abs(p2.y - p1.y), 18) / 2;
      const nw = map.unproject([cx - hw, cy - hh]), se = map.unproject([cx + hw, cy + hh]);
      const ring = [[nw.lng, nw.lat], [se.lng, nw.lat], [se.lng, se.lat], [nw.lng, se.lat], [nw.lng, nw.lat]];
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
    }
    function addLayers() {
      const end = cssVar('end') || '#d93025';
      if (map.getSource('area')) map.getSource('area').setData(areaData());
      else map.addSource('area', { type: 'geojson', data: areaData() });
      if (!map.getLayer('area-fill')) map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': end, 'fill-opacity': 0.15 } });
      if (!map.getLayer('area-line')) map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': end, 'line-width': 2.5 } });
    }
    function create() {
      try {
        map = new maplibregl.Map({
          container: box, style: STYLES[theme()] || STYLES.light, bounds: tripBounds(),
          fitBoundsOptions: { padding: OV_PAD }, interactive: false, attributionControl: { compact: true },
        });
      } catch (e) { fallback(e.message); return; }
      let ready = false;
      map.on('style.load', () => {
        ready = true;
        addLayers();
        // 版權說明預設收合成「i」按鈕，不遮住小圖（點一下可展開）
        const at = box.querySelector('.maplibregl-ctrl-attrib');
        if (at) at.classList.remove('maplibregl-compact-show');
      });
      map.on('error', (e) => { if (!ready) fallback((e && e.error && e.error.message) || '底圖讀取失敗'); });
      setTimeout(() => { if (!ready) fallback('底圖讀取逾時'); }, STYLE_TIMEOUT);
    }
    new ResizeObserver(() => {
      if (failed || !box.clientWidth) return;
      if (!map) { create(); return; }
      map.resize();
      map.fitBounds(tripBounds(), { padding: OV_PAD, duration: 0 });
      if (map.getSource('area')) map.getSource('area').setData(areaData());
    }).observe(box);
    instances.push({ restyle() { if (map && !failed) map.setStyle(STYLES[theme()] || STYLES.light, { diff: false }); } });
    return true;
  }

  Trip.lib.mapgl = { attach, overview };
})(window.Trip);
