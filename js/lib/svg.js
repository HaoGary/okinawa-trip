/* ==========================================================================
   lib/svg.js — SVG 繪圖基本工具
   ========================================================================== */
(function (Trip) {
  'use strict';

  const NS = Trip.config.svgNS;

  /**
   * 建立 SVG 元素並加到 parent；值為 undefined / null / '' 的屬性會略過。
   * @returns {SVGElement}
   */
  function el(parent, tag, attrs = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (value !== undefined && value !== null && value !== '') node.setAttribute(name, value);
    }
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  /**
   * 經緯度 → viewBox 座標（等距圓柱投影，城市尺度足夠）
   * @param {{w:number,e:number,s:number,n:number}} bounds 地圖四邊的經緯度
   * @returns {(point:[number,number]) => [number,number]}
   */
  function projection(bounds, width, height) {
    const { w, e, s, n } = bounds;
    return ([lat, lng]) => [
      (lng - w) / (e - w) * width,
      (n - lat) / (n - s) * height
    ];
  }

  /** 一串 [緯度, 經度] → SVG path 的 d 字串 */
  function pathD(project, points, close = false) {
    return points
      .map((p, i) => (i ? 'L' : 'M') + project(p).map((v) => v.toFixed(1)).join(' '))
      .join(' ') + (close ? 'Z' : '');
  }

  /** 主題色名稱 → CSS 變數（'sea' → 'var(--sea)'）；已是完整值則原樣回傳 */
  const color = (name) => (name && /^[a-z-]+$/.test(name) ? `var(--${name})` : name);

  Trip.lib.svg = { el, projection, pathD, color };
})(window.Trip);
