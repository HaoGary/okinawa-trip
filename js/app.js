/* ==========================================================================
   app.js — 頁面啟動與互動（最後載入）
     1. 依 Trip.days 產生選單與每日區塊
     2. 每日：地圖、行程、交通方式切換、路段滑過標示
     3. 天數切換、選單收合、深淺色切換
     4. 小螢幕地圖文字放大
   ========================================================================== */
(function (Trip) {
  'use strict';

  const { store } = Trip.lib.util;
  const { drawRouteMap, drawOverview } = Trip.lib.map;
  const { menuItem, dayView, fill } = Trip.lib.views;
  const popup = Trip.lib.popup;
  const T = Trip.config.text;

  const shell = document.querySelector('.shell');
  const menu = document.querySelector('.days');
  const themeRow = menu.querySelector('.theme-row');
  const dayList = menu.querySelector('.day-list');      // 天數按鈕的容器（手機版 App Bar 的分頁列）
  menu.querySelector('.days-head h2').textContent = T.menuTitle.replace('{n}', Trip.days.length);

  /* ========================================================================
     1. 每日區塊
     ======================================================================== */
  function setupDay(day) {
    const el = dayView(day);
    shell.appendChild(el);
    (dayList || themeRow).insertAdjacentHTML(dayList ? 'beforeend' : 'beforebegin', menuItem(day));

    const svg = el.querySelector('.routemap');
    const list = el.querySelector('.stops');
    const state = { mode: null, activeLeg: -1 };

    // 目前的「視圖」：有交通方式時取該方式的資料，否則就是 day 本身
    const view = () => (state.mode ? day.modes[state.mode] : day);
    // 有載入 MapLibre（我的行程）時改用真實底圖；沒有或無法使用時照舊畫 SVG
    const gl = Trip.lib.mapgl ? Trip.lib.mapgl.attach(svg, day, view) : null;
    const drawMap = () => (gl ? gl.draw(state.activeLeg) : drawRouteMap(svg, day, view(), state.activeLeg));

    function render() {
      fill(el, day, view());
      drawMap();
      bindLegHover();
      el.querySelectorAll('.tab[data-mode]').forEach((tab) =>
        tab.setAttribute('aria-pressed', String(tab.dataset.mode === state.mode)));
    }

    // 滑過或聚焦路段卡 → 地圖上標示該路段
    function bindLegHover() {
      list.querySelectorAll('.leg a').forEach((link) => {
        const i = Number(link.dataset.leg);
        const on = () => setActiveLeg(i);
        const off = () => setActiveLeg(-1);
        link.addEventListener('mouseenter', on);
        link.addEventListener('focus', on);
        link.addEventListener('mouseleave', off);
        link.addEventListener('blur', off);
      });
    }

    function setActiveLeg(i) {
      state.activeLeg = i;
      list.querySelectorAll('.leg a').forEach((a) => a.classList.toggle('on', Number(a.dataset.leg) === i));
      drawMap();
    }

    // 交通方式切換（只有設定 modes 的天數才有）
    if (day.modes) {
      const saved = store.get('mode');
      state.mode = day.modes[saved] ? saved : (day.defaultMode || Object.keys(day.modes)[0]);
      el.querySelectorAll('.tab[data-mode]').forEach((tab) => tab.addEventListener('click', () => {
        popup.hide();
        state.mode = tab.dataset.mode;
        store.set('mode', state.mode);
        render();
      }));
    }

    // 活動範圍小圖：有 MapLibre 時用真實底圖（任何國家都適用），否則用 SVG
    const ov = el.querySelector('.ovmap');
    if (!(Trip.lib.mapgl && Trip.lib.mapgl.overview && Trip.lib.mapgl.overview(ov, day))) drawOverview(ov, day.area.box);
    render();
  }

  Trip.days.forEach(setupDay);

  /* ========================================================================
     2. 天數切換
     ======================================================================== */
  const dayButtons = () => menu.querySelectorAll('.day');

  function showDay(id) {
    popup.hide();
    dayButtons().forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.day) === id)));
    Trip.days.forEach((d) => { document.getElementById(`day-${d.id}`).hidden = d.id !== id; });
    store.set('day', id);
  }

  dayButtons().forEach((b) => b.addEventListener('click', () => showDay(Number(b.dataset.day))));
  const savedDay = Number(store.get('day'));
  showDay(Trip.days.some((d) => d.id === savedDay) ? savedDay : Trip.days[0].id);

  /* ========================================================================
     3. 選單收合
     ======================================================================== */
  const collapseBtn = document.getElementById('collapse');

  function setMini(on) {
    shell.classList.toggle('mini', on);
    collapseBtn.setAttribute('aria-expanded', String(!on));
    const label = on ? T.expandMenu : T.collapseMenu;
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.title = label;
    // 收合時以 tooltip 顯示完整名稱
    dayButtons().forEach((b) => {
      if (on) b.title = `${b.querySelector('b').textContent}｜${b.querySelector('small').textContent}`;
      else b.removeAttribute('title');
    });
    store.set('mini', on ? '1' : '0');
  }

  collapseBtn.addEventListener('click', () => setMini(!shell.classList.contains('mini')));
  setMini(store.get('mini') === '1');

  /* ========================================================================
     4. 深淺色切換
     未選擇時跟隨系統設定；選擇後寫入 <html data-theme> 並記住。
     ======================================================================== */
  (function setupTheme() {
    const root = document.documentElement;
    const btn = document.getElementById('theme-btn');
    const label = document.getElementById('theme-lbl');
    const systemDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

    const current = () => root.getAttribute('data-theme') || (systemDark && systemDark.matches ? 'dark' : 'light');

    function sync() {
      const dark = current() === 'dark';
      btn.setAttribute('aria-pressed', String(dark));
      label.textContent = dark ? T.lightMode : T.darkMode;
      btn.setAttribute('aria-label', dark ? `切換為${T.lightMode}` : `切換為${T.darkMode}`);
    }

    const saved = store.get('theme');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
    sync();

    btn.addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('theme', next);
      sync();
    });
    if (systemDark && systemDark.addEventListener) systemDark.addEventListener('change', sync);
    new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  })();

  /* ========================================================================
     5. 小螢幕地圖文字放大
     地圖縮小時，把 --k 設為放大倍率（CSS 用來放大文字），
     同時放大標記圓點，並讓地點名稱隨圓點外移、不超出地圖。
     ======================================================================== */
  (function setupLabelScaling() {
    const { ratio, max } = Trip.config.labelScale;
    const R = Trip.config.markerRadius;
    const maps = [...document.querySelectorAll('.mapcard svg')];

    function scale(svg) {
      const shownWidth = svg.getBoundingClientRect().width;
      if (!shownWidth) return;                      // 隱藏中的天數，顯示時再算
      const vb = svg.viewBox.baseVal;
      const k = Math.max(1, Math.min(max, (vb.width * ratio) / shownWidth));
      svg.style.setProperty('--k', k.toFixed(3));

      const markers = [...svg.querySelectorAll('circle[data-stop]')];
      markers.forEach((c) => c.setAttribute('r', (R * k).toFixed(1)));
      const centers = markers.map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
      if (!centers.length) return;

      svg.querySelectorAll('text.lbl-b').forEach((t) => {
        // 第一次記下名稱與最近標記的相對位置
        if (!t.dataset.ox) {
          const tx = Number(t.getAttribute('x')), ty = Number(t.getAttribute('y'));
          let best = centers[0], bestD = Infinity;
          centers.forEach((c) => {
            const d = (c[0] - tx) ** 2 + (c[1] - ty) ** 2;
            if (d < bestD) { bestD = d; best = c; }
          });
          Object.assign(t.dataset, { cx: best[0], cy: best[1], ox: tx - best[0], oy: ty - best[1] });
        }
        t.setAttribute('x', (Number(t.dataset.cx) + Number(t.dataset.ox) * k).toFixed(1));
        t.setAttribute('y', (Number(t.dataset.cy) + Number(t.dataset.oy) * k).toFixed(1));

        // 不超出地圖左右邊界
        try {
          const b = t.getBBox();
          let shift = 0;
          if (b.x < vb.x + 4) shift = vb.x + 4 - b.x;
          else if (b.x + b.width > vb.x + vb.width - 4) shift = vb.x + vb.width - 4 - (b.x + b.width);
          if (shift) t.setAttribute('x', (Number(t.getAttribute('x')) + shift).toFixed(1));
        } catch (e) { /* 尚未顯示時 getBBox 可能失敗 */ }
      });
    }

    // 地圖重畫或尺寸改變時重新計算
    const redraws = new MutationObserver((records) => new Set(records.map((r) => r.target)).forEach(scale));
    maps.forEach((svg) => { redraws.observe(svg, { childList: true }); scale(svg); });
    if ('ResizeObserver' in window) {
      const sizes = new ResizeObserver((entries) => entries.forEach((e) => scale(e.target)));
      maps.forEach((svg) => sizes.observe(svg));
    } else {
      window.addEventListener('resize', () => maps.forEach(scale));
    }
  })();
})(window.Trip);
