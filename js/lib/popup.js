/* ==========================================================================
   lib/popup.js — 點選地圖標記時顯示的景色圖卡

   標記元素需帶有：
     data-stop   地點名稱（必填）
     data-addr   地址，用於「在 Google 地圖看實景」
     data-scene  插圖種類（見 lib/scenes.js）
     data-photo  實景照片網址（選填，有的話優先顯示）
   ========================================================================== */
(function (Trip) {
  'use strict';

  const { esc, searchUrl } = Trip.lib.util;
  const T = Trip.config.text;

  const GAP = 6;          // 圖卡與標記的距離
  const EDGE = 8;         // 圖卡與地圖邊緣的最小距離
  const TOP_LIMIT = 56;   // 上方空間小於此值時改開在標記下方（避開地圖工具列）

  const CLOSE_ICON = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  let current = null;     // { el, name }

  function hide() {
    if (!current) return;
    current.el.remove();
    current = null;
  }

  function picture(marker) {
    const photo = marker.getAttribute('data-photo');
    if (photo) return `<img src="${esc(photo)}" alt="">`;
    return Trip.lib.scenes.render(marker.getAttribute('data-scene') || 'city');
  }

  function show(marker) {
    const name = marker.getAttribute('data-stop');
    const addr = marker.getAttribute('data-addr') || name;
    const card = marker.closest('.mapcard');
    if (!card) return;

    // 再點一次同一個標記 → 關閉
    if (current && current.name === name && current.el.parentNode === card) {
      hide();
      return;
    }
    hide();

    const pop = document.createElement('div');
    pop.className = 'scene-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', `${name} 景色`);
    pop.innerHTML = `
      <div class="frame">${picture(marker)}</div>
      <span class="tip"></span>
      <div class="cap">
        <b>${esc(name)}</b>
        <small>${marker.getAttribute('data-photo') ? '景點照片' : esc(T.sceneNote)}</small>
        <a href="${searchUrl(addr)}" target="_blank" rel="noopener">${esc(T.sceneLink)}</a>
      </div>
      <button class="x" type="button" aria-label="${esc(T.close)}">${CLOSE_ICON}</button>`;
    pop.querySelector('.x').addEventListener('click', hide);
    card.appendChild(pop);

    // 定位：預設在標記上方置中，空間不夠就改到下方，並限制在地圖內
    const cardRect = card.getBoundingClientRect();
    const markRect = marker.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const centerX = markRect.left + markRect.width / 2 - cardRect.left;
    const left = Math.max(EDGE, Math.min(centerX - w / 2, cardRect.width - w - EDGE));
    let top = markRect.top - cardRect.top - h - GAP;
    const below = top < TOP_LIMIT;
    if (below) top = markRect.bottom - cardRect.top + GAP;

    pop.classList.toggle('below', below);
    pop.style.left = `${left}px`;
    pop.style.top = `${Math.min(top, cardRect.height - h - EDGE)}px`;
    current = { el: pop, name };
  }

  /* 事件：點標記開啟、點其他地方關閉、Esc 關閉、Enter／空白鍵開啟 */
  document.addEventListener('click', (e) => {
    const marker = e.target.closest('[data-stop]');
    if (marker) return show(marker);
    if (current && !e.target.closest('.scene-pop')) hide();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
    const marker = e.target.closest && e.target.closest('[data-stop]');
    if (marker && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      show(marker);
    }
  });

  Trip.lib.popup = { show, hide };
})(window.Trip);
