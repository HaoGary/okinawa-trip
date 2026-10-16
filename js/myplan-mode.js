/* ==========================================================================
   myplan-mode.js — 我的行程（index.html，在 config.js 之後、loader.js 之前載入）

   讓 loader.js 改讀 Apps Script 的 action=myplan：
   只包含地點管理頁「行程安排」按「確認」送出的地點與順序，
   不帶入試算表原本的行程（原路線、道路、地名、說明文字）。
   路段為兩點間的直線示意；沒有安排的天數顯示「尚未安排地點」。
   ========================================================================== */
(function (Trip) {
  'use strict';
  Trip.config.api = Object.assign({}, Trip.config.api, { action: 'myplan' });
  // 路線地圖改用 MapLibre＋OpenFreeMap 真實底圖（js/lib/map-gl.js）；載入失敗時自動用原本的 SVG 地圖
  Trip.config.mapEngine = 'maplibre';
})(window.Trip);
