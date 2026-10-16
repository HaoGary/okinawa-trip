/* ==========================================================================
   lib/views.js — 由每日資料產生 HTML
     menuItem(day)        左側選單的一個按鈕
     dayView(day)         一天的整個區塊（地圖卡、行程卡、資訊卡）
     fill(dayEl, day, v)  依目前交通方式填入統計、按鈕、行程清單
   ========================================================================== */
(function (Trip) {
  'use strict';

  const { esc, directionsUrl, letter } = Trip.lib.util;
  const T = Trip.config.text;

  /* ------------------------------------------------------------------------
     左側選單
     ------------------------------------------------------------------------ */
  function menuItem(day) {
    return `<button class="day" data-day="${day.id}">`
      + `<span class="n">D${day.id}</span>`
      + `<b>${esc(day.menu.title)}</b>`
      + `<small>${esc(day.menu.sub)}</small>`
      + `</button>`;
  }

  /* ------------------------------------------------------------------------
     地圖卡上方工具列：有多種交通方式時顯示切換按鈕，否則顯示固定標籤
     ------------------------------------------------------------------------ */
  function mapBar(day) {
    const note = day.mapNote ? `<span class="note">${esc(day.mapNote)}</span>` : '';
    if (!day.modes) {
      return `<div class="mapbar"><span class="tab static" aria-pressed="true">${esc(day.modeLabel || '開車')}</span><span class="spacer"></span>${note}</div>`;
    }
    const tabs = Object.entries(day.modes)
      .map(([key, mode]) => `<button class="tab" id="t-${key}" data-mode="${key}" aria-pressed="false">${esc(mode.label)}</button>`)
      .join('');
    return `<div class="mapbar" role="group" aria-label="交通方式">${tabs}<span class="spacer"></span>${note}</div>`;
  }

  /* ------------------------------------------------------------------------
     一天的區塊
     ------------------------------------------------------------------------ */
  function dayView(day) {
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.id = `day-${day.id}`;
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="row">
        <section class="card mapcard" aria-label="第 ${day.id} 天路線地圖">
          ${mapBar(day)}
          <svg class="routemap" viewBox="0 0 ${Trip.config.mapWidth} ${day.map.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(day.title)} 路線示意地圖"></svg>
        </section>
        <aside class="card side">
          <h2 class="sec">${esc(T.itinerary)}</h2>
          <ol class="stops"></ol>
          <p class="foot">${esc(day.foot)}</p>
        </aside>
      </div>
      <div class="card info">
        <header>
          <p class="day-tag">DAY ${day.id}</p>
          <h3>${esc(day.title)}</h3>
        </header>
        <div class="stats"></div>
        <div class="btns"></div>
        <div class="ov">
          <svg class="ovmap" viewBox="0 0 320 400" role="img" aria-label="沖繩本島全圖，框出第 ${day.id} 天活動範圍"></svg>
          <div class="ov-t">
            <span class="eyebrow">${esc(T.areaEyebrow)}</span>
            <b>${esc(day.area.title)}</b>
            <small>${esc(day.area.note)}</small>
            <span class="key"><i></i>${esc(T.areaKey)}</span>
          </div>
        </div>
      </div>`;
    return wrap;
  }

  /* ------------------------------------------------------------------------
     依交通方式填入內容（view = day 或 day.modes[key]）
     ------------------------------------------------------------------------ */
  function fill(dayEl, day, view) {
    const stops = day.stops;
    const last = stops.length - 1;
    const travelmode = view.travelmode || Trip.config.defaultTravelMode;

    // 統計數字
    dayEl.querySelector('.stats').innerHTML = view.stats
      .map(([value, unit]) => `<div><strong>${esc(value)}</strong><span>${esc(unit)}</span></div>`)
      .join('');

    // 全程導航按鈕
    const waypoints = stops.slice(1, last).map((s) => s.addr);
    dayEl.querySelector('.btns').innerHTML = view.buttons
      .map((b) => `<a class="btn${b.primary ? ' primary' : ''}" href="${directionsUrl(stops[0].addr, stops[last].addr, { waypoints, travelmode: b.travelmode })}" target="_blank" rel="noopener">${esc(b.text)}</a>`)
      .join('');

    // 行程清單：地點 → 路段 → 地點 …（這天在地點管理頁被清空時顯示提示）
    if (!stops.length) {
      dayEl.querySelector('.stops').innerHTML = '<li class="stop empty"><div><b>這天尚未安排地點</b><small>到「地點管理 → 行程安排」加入地點並按「確認」</small></div></li>';
      return;
    }
    dayEl.querySelector('.stops').innerHTML = stops.map((stop, i) => {
      const cls = ['stop', i === 0 && 'first', i === last && 'last'].filter(Boolean).join(' ');
      let html = `<li class="${cls}"><span class="mk">${letter(i)}</span><div><b>${esc(stop.name)}</b><small>${esc(stop.note)}</small></div></li>`;
      if (i < last) {
        const leg = view.legs[i];
        const href = directionsUrl(stop.addr, stops[i + 1].addr, { travelmode });
        html += `<li class="leg"><span class="rail"></span>`
          + `<a data-leg="${i}" href="${href}" target="_blank" rel="noopener">`
          + `<b>${letter(i)} → ${letter(i + 1)}</b>`
          + `<span>${esc(leg.km)}・${esc(leg.t)}</span>`
          // 「直線示意」不顯示（舊版 Apps Script 或瀏覽器記住的資料仍可能帶這段文字）
          + (leg.via && leg.via !== '直線示意' ? `<span class="via">${esc(leg.via)}</span>` : '')
          + `</a></li>`;
      }
      return html;
    }).join('');
  }

  Trip.lib.views = { menuItem, dayView, fill };
})(window.Trip);
