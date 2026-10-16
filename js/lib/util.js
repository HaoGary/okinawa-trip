/* ==========================================================================
   lib/util.js — 小工具：本機儲存、HTML 跳脫、Google 地圖網址
   ========================================================================== */
(function (Trip) {
  'use strict';

  const { storageKeys } = Trip.config;

  /** localStorage 包裝：無痕模式或被封鎖時不會出錯 */
  const store = {
    get(key, fallback = null) {
      try {
        const value = localStorage.getItem(storageKeys[key]);
        return value === null ? fallback : value;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(storageKeys[key], value);
      } catch (e) { /* 無法儲存時忽略 */ }
    }
  };

  /** 放進 innerHTML 前跳脫文字 */
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);

  /**
   * Google 地圖路線網址
   * @param {string}   origin       起點地址
   * @param {string}   destination  終點地址
   * @param {object}   [opts]
   * @param {string[]} [opts.waypoints]   中途點地址
   * @param {string}   [opts.travelmode]  driving | transit | walking
   */
  function directionsUrl(origin, destination, { waypoints = [], travelmode = Trip.config.defaultTravelMode } = {}) {
    return 'https://www.google.com/maps/dir/?api=1'
      + '&origin=' + encodeURIComponent(origin)
      + '&destination=' + encodeURIComponent(destination)
      + (waypoints.length ? '&waypoints=' + encodeURIComponent(waypoints.join('|')) : '')
      + '&travelmode=' + travelmode;
  }

  /** Google 地圖搜尋網址 */
  const searchUrl = (query) =>
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);

  /** 依序號取得 A、B、C… */
  const letter = (index) => Trip.config.stopLetters[index];

  Trip.lib.util = { store, esc, directionsUrl, searchUrl, letter };
})(window.Trip);
