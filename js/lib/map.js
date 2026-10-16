/* ==========================================================================
   lib/map.js — 依每日資料繪製路線地圖與全島小圖

   路線地圖的繪製順序：
     1. day.map.layers      底圖圖層（海、陸、河、道路、標籤…）
     2. view.layers         交通方式專屬圖層（例如第 1 天的單軌電車）
     3. view.legs           路段
     4. day.stops           地點標記 A、B、C…
     5. 指北針、比例尺

   ── 圖層類型（day.map.layers 每一項） ──────────────────────────────────
   { type:'background', fill }                         整張底色
   { type:'island' }                                   沖繩本島 + 周邊小島（含描邊）
   { type:'area',  points, fill, stroke?, width? }     多邊形
   { type:'line',  points, stroke, width, dash?, opacity? }   線（河、跑道…）
   { type:'raw',   d, fill?, stroke?, width? }         直接寫 SVG path（viewBox 座標）
   { type:'roads', lines:[points…], width?, edge? }    道路（先畫邊框再畫路面）
   { type:'rail',  from, to, width, dash?, opacity?, dots?, labels? }
                                                       ゆいレール，from/to 為站名
   { type:'label', at | xy, text, dx?, dy?, kind? }    文字；kind:'sea' 海域、'rail' 車站
   顏色可寫主題色名稱（'sea'、'land'、'route'…）或任何 CSS 顏色。
   ========================================================================== */
(function (Trip) {
  'use strict';

  const { el, projection, pathD, color } = Trip.lib.svg;
  const { letter } = Trip.lib.util;
  const cfg = Trip.config;

  /* ------------------------------------------------------------------------
     圖層
     ------------------------------------------------------------------------ */
  const LAYERS = {
    background(ctx, layer) {
      el(ctx.svg, 'rect', { x: 0, y: 0, width: ctx.width, height: ctx.height, fill: color(layer.fill) });
    },

    island(ctx) {
      const shapes = [Trip.geo.okinawa, ...Object.values(Trip.geo.islands)];
      shapes.forEach((points) => LAYERS.area(ctx, { points, fill: 'land', stroke: 'roadedge', width: 1.5 }));
    },

    area(ctx, layer) {
      el(ctx.svg, 'path', {
        d: ctx.path(layer.points, true),
        fill: color(layer.fill),
        stroke: color(layer.stroke),
        'stroke-width': layer.stroke ? (layer.width || 1.5) : undefined,
        'stroke-linejoin': layer.stroke ? 'round' : undefined
      });
    },

    line(ctx, layer) {
      el(ctx.svg, 'path', {
        d: ctx.path(layer.points),
        fill: 'none',
        stroke: color(layer.stroke),
        'stroke-width': layer.width,
        'stroke-dasharray': layer.dash,
        'stroke-opacity': layer.opacity,
        'stroke-linecap': 'round'
      });
    },

    raw(ctx, layer) {
      el(ctx.svg, 'path', {
        d: layer.d,
        fill: layer.fill ? color(layer.fill) : 'none',
        stroke: color(layer.stroke),
        'stroke-width': layer.width,
        'stroke-linecap': layer.stroke ? 'round' : undefined
      });
    },

    roads(ctx, layer) {
      const style = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      layer.lines.forEach((points) => el(ctx.svg, 'path', { ...style, d: ctx.path(points), stroke: color('roadedge'), 'stroke-width': layer.edge || 9 }));
      layer.lines.forEach((points) => el(ctx.svg, 'path', { ...style, d: ctx.path(points), stroke: color('road'), 'stroke-width': layer.width || 6 }));
    },

    rail(ctx, layer) {
      const all = Trip.geo.yuiRail;
      const from = all.findIndex((s) => s.name === layer.from);
      const to = all.findIndex((s) => s.name === layer.to);
      const stations = all.slice(from, to + 1);

      el(ctx.svg, 'path', {
        d: ctx.path(stations.map((s) => s.at)),
        fill: 'none',
        stroke: color('rail'),
        'stroke-width': layer.width,
        'stroke-dasharray': layer.dash,
        'stroke-opacity': layer.opacity,
        'stroke-linecap': 'round'
      });

      if (layer.dots) {
        stations.forEach((s) => {
          const [x, y] = ctx.project(s.at);
          el(ctx.svg, 'circle', { cx: x, cy: y, r: layer.dots.r, fill: color('panel'), stroke: color('rail'), 'stroke-width': layer.dots.width });
        });
      }

      (layer.labels || []).forEach((l) => {
        const station = all.find((s) => s.name === l.station);
        LAYERS.label(ctx, { at: station.at, text: l.text || station.name, dx: l.dx, dy: l.dy, kind: l.kind });
      });
    },

    label(ctx, layer) {
      const [x, y] = layer.xy || ctx.project(layer.at);
      el(ctx.svg, 'text', {
        x: x + (layer.dx || 0),
        y: y + (layer.dy || 0),
        class: layer.kind === 'sea' ? 'lbl sea-lbl' : 'lbl',
        style: layer.kind === 'rail' ? 'fill:var(--rail)' : undefined
      }, layer.text);
    }
  };

  /* ------------------------------------------------------------------------
     路段
     style 'drive'（預設）：白色底線 + 藍色路線；滑過某段時其他段變淡
     style 'walk'        ：藍色點狀線
     dashed: true        ：未滑過時以虛線表示（回程等）
     ------------------------------------------------------------------------ */
  function drawLegs(ctx, legs, activeLeg) {
    legs.forEach((leg, i) => {
      const d = ctx.path(leg.points);
      if (leg.style === 'walk') {
        el(ctx.svg, 'path', { d, fill: 'none', stroke: color('route'), 'stroke-width': 4, 'stroke-dasharray': '2 7', 'stroke-linecap': 'round' });
        return;
      }
      const on = activeLeg === -1 || activeLeg === i;
      const style = { d, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      el(ctx.svg, 'path', { ...style, stroke: color('panel'), 'stroke-width': on ? 10 : 6, 'stroke-opacity': on ? 1 : 0.6 });
      el(ctx.svg, 'path', {
        ...style,
        stroke: color('route'),
        'stroke-width': on ? 5 : 3,
        'stroke-opacity': on ? 1 : 0.25,
        'stroke-dasharray': leg.dashed && activeLeg === -1 ? '8 6' : undefined
      });
    });
  }

  /* ------------------------------------------------------------------------
     地點標記：圓點（可點擊開啟景色圖卡）＋字母＋名稱
     ------------------------------------------------------------------------ */
  function drawStops(ctx, stops) {
    const last = stops.length - 1;
    stops.forEach((stop, i) => {
      const [x, y] = ctx.project(stop.at);
      const [ox, oy] = stop.nudge || [0, 0];       // 與其他標記重疊時微調圓點位置
      const [dx, dy] = stop.label || [16, 5];      // 名稱相對於地點的位置
      const name = stop.mapName || stop.name;
      const fill = i === 0 ? 'start' : i === last ? 'end' : 'route';

      el(ctx.svg, 'circle', {
        cx: x + ox, cy: y + oy, r: cfg.markerRadius,
        fill: color(fill), stroke: color('panel'), 'stroke-width': 2.5,
        'data-stop': name, 'data-addr': stop.addr, 'data-scene': stop.scene, 'data-photo': stop.photo,
        tabindex: '0', role: 'button', 'aria-label': `${name}：${cfg.text.viewScene}`
      });
      el(ctx.svg, 'text', { x: x + ox, y: y + oy, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'mk-t' }, letter(i));
      el(ctx.svg, 'text', { x: x + dx, y: y + dy, class: 'lbl-b' }, name);
    });
  }

  /* ------------------------------------------------------------------------
     指北針與比例尺
     ------------------------------------------------------------------------ */
  function drawCompass(ctx) {
    const x = ctx.width - 40;
    el(ctx.svg, 'path', { d: `M${x} 30 l8 22 l-8 -6 l-8 6 z`, fill: color('ink') });
    el(ctx.svg, 'text', { x: x - 5, y: 68, class: 'lbl' }, 'N');
  }

  function drawScaleBar(ctx, bar) {
    if (!bar) return;
    const [lat, lng] = bar.at;
    const [x1] = ctx.project([lat, lng]);
    const [x2] = ctx.project([lat, lng + bar.km * cfg.kmToLng]);
    const y = ctx.height - 20;
    el(ctx.svg, 'line', { x1, y1: y, x2, y2: y, stroke: color('ink'), 'stroke-width': 2 });
    el(ctx.svg, 'text', { x: x1, y: y - 8, class: 'lbl' }, `${bar.km} km`);
  }

  /* ------------------------------------------------------------------------
     公開：繪製一天的路線地圖
     @param {SVGSVGElement} svg
     @param {object} day        每日資料
     @param {object} view       day 本身，或 day.modes[目前交通方式]
     @param {number} activeLeg  滑過中的路段，-1 表示沒有
     ------------------------------------------------------------------------ */
  function drawRouteMap(svg, day, view, activeLeg = -1) {
    const width = cfg.mapWidth;
    const height = day.map.height;
    const project = projection(day.map.bounds, width, height);
    const ctx = { svg, width, height, project, path: (pts, close) => pathD(project, pts, close) };

    svg.innerHTML = '';
    [...day.map.layers, ...(view.layers || [])].forEach((layer) => {
      const draw = LAYERS[layer.type];
      if (!draw) throw new Error(`未知的地圖圖層類型：${layer.type}`);
      draw(ctx, layer);
    });
    drawLegs(ctx, view.legs, activeLeg);
    drawStops(ctx, day.stops);
    drawCompass(ctx);
    drawScaleBar(ctx, day.map.scaleBar);
  }

  /* ------------------------------------------------------------------------
     公開：全島小圖，框出 box 範圍
     ------------------------------------------------------------------------ */
  const OVERVIEW = { width: 320, height: 400, bounds: { w: 127.60, e: 128.36, s: 26.05, n: 26.90 } };
  const OVERVIEW_LABELS = [
    { at: [26.225, 127.715], text: '那霸' },
    { at: [26.60, 127.995], text: '名護' },
    { at: [26.875, 128.245], text: '邊戶岬', anchor: 'end' },
    { at: [26.40, 127.88], text: '沖繩本島' },
    { at: [26.73, 127.80], text: '伊江島', anchor: 'middle' }
  ];

  function drawOverview(svg, box) {
    const { width, height } = OVERVIEW;
    const bounds = (Trip.region && Trip.region.bounds) || OVERVIEW.bounds;   // 地區範圍由資料提供
    const project = projection(bounds, width, height);
    svg.innerHTML = '';
    el(svg, 'rect', { x: 0, y: 0, width, height, fill: color('sea') });
    // 有海岸線資料（目前只有沖繩）才畫陸地與地名；其他國家只畫範圍框（有 MapLibre 時會改用真實底圖）
    const geo = Trip.geo || {};
    const hasCoast = Array.isArray(geo.okinawa) && geo.okinawa.length > 0;
    if (hasCoast) [geo.okinawa, ...Object.values(geo.islands || {})].forEach((points) =>
      el(svg, 'path', { d: pathD(project, points, true), fill: color('land'), stroke: color('roadedge'), 'stroke-width': 1.2, 'stroke-linejoin': 'round' }));
    if (hasCoast) OVERVIEW_LABELS.forEach(({ at, text, anchor }) => {
      const [x, y] = project(at);
      el(svg, 'text', { x, y, class: 'lbl', 'text-anchor': anchor || 'start', style: 'font-size:12px' }, text);
    });
    if (box) {
      const [x1, y1] = project([box.n, box.w]);
      const [x2, y2] = project([box.s, box.e]);
      const w = Math.max(x2 - x1, 26), h = Math.max(y2 - y1, 22);   // 範圍太小時保留最小框
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      el(svg, 'rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 3, fill: color('end'), 'fill-opacity': 0.14, stroke: color('end'), 'stroke-width': 2.5 });
    }
    el(svg, 'path', { d: 'M296 14 l6 16 l-6 -4 l-6 4 z', fill: color('ink') });
  }

  Trip.lib.map = { drawRouteMap, drawOverview };
})(window.Trip);
