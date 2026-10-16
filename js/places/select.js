/* ==========================================================================
   places/select.js — 下拉選單外觀（參考 react-select 的預設樣式）

   原生 <select> 的展開清單無法用 CSS 改樣式，所以這裡把每個 <select> 包成：
     .rs            外框（與 react-select 的 control 相同：38px 高、4px 圓角、灰框、聚焦時藍框）
     .rs-value      目前選項（未選時以灰色顯示第一個空值選項當作提示文字）
     .rs-indicators 分隔線＋向下箭頭
     .rs-menu       展開清單（陰影、選項 8px 12px、滑過淡藍、已選藍底白字、停用灰字）
   原生 <select> 仍保留在畫面中（視覺隱藏），值與 change 事件都照舊，
   所以頁面其他程式不用改；用程式改 select.value 時，外觀也會跟著更新。

   鍵盤：Enter／空白／↓ 展開，↑↓ 移動，Enter 選取，Esc 關閉，Home／End，輸入文字跳到符合的選項。
   ========================================================================== */
(function () {
  'use strict';

  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  const indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
  let uid = 0;
  let openState = null;          // 目前展開的選單 { sel, control, menu, active }

  function labelText(sel) {
    if (sel.getAttribute('aria-label')) return sel.getAttribute('aria-label');
    const lab = sel.id && document.querySelector('label[for="' + CSS.escape(sel.id) + '"]');
    return lab ? lab.textContent.trim() : '';
  }

  function render(sel) {
    const control = sel._rs;
    if (!control) return;
    const opt = sel.options[sel.selectedIndex];
    const text = control.querySelector('.rs-value');
    const placeholder = !opt || opt.value === '';
    text.textContent = opt ? opt.textContent : '';
    text.classList.toggle('is-placeholder', placeholder);
    control.classList.toggle('is-disabled', sel.disabled);
    control.setAttribute('aria-disabled', sel.disabled ? 'true' : 'false');
    control.tabIndex = sel.disabled ? -1 : 0;
  }

  function enhance(sel) {
    if (sel._rs || sel.multiple || sel.closest('.rs')) return;
    const wrap = document.createElement('div');
    wrap.className = 'rs';
    wrap.setAttribute('role', 'combobox');
    wrap.setAttribute('aria-haspopup', 'listbox');
    wrap.setAttribute('aria-expanded', 'false');
    const listId = 'rs-list-' + (++uid);
    wrap.setAttribute('aria-controls', listId);
    wrap.dataset.list = listId;
    wrap.innerHTML = '<span class="rs-value"></span>' +
      '<span class="rs-indicators" aria-hidden="true"><span class="rs-sep"></span>' +
      '<svg class="rs-arrow" viewBox="0 0 20 20" width="20" height="20"><path d="M4.516 7.548c.436-.446 1.043-.481 1.576 0L10 11.295l3.908-3.747c.533-.481 1.141-.446 1.574 0 .436.445.408 1.197 0 1.615-.406.418-4.695 4.502-4.695 4.502a1.095 1.095 0 0 1-1.576 0S4.924 9.581 4.516 9.163c-.409-.418-.436-1.17 0-1.615z" fill="currentColor"/></svg></span>';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('rs-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    sel._rs = wrap;
    const name = labelText(sel);
    if (name) wrap.setAttribute('aria-label', name);

    // 程式設定 value／selectedIndex 時同步外觀
    Object.defineProperty(sel, 'value', {
      configurable: true,
      get() { return valueDesc.get.call(this); },
      set(v) { valueDesc.set.call(this, v); render(this); },
    });
    Object.defineProperty(sel, 'selectedIndex', {
      configurable: true,
      get() { return indexDesc.get.call(this); },
      set(v) { indexDesc.set.call(this, v); render(this); },
    });
    sel.addEventListener('change', () => render(sel));
    new MutationObserver(() => render(sel)).observe(sel, { attributes: true, attributeFilter: ['disabled'], childList: true, subtree: true });

    wrap.addEventListener('mousedown', (e) => {
      if (sel.disabled || e.button !== 0) return;
      e.preventDefault();
      wrap.focus();
      if (openState && openState.sel === sel) close(); else open(sel);
    });
    wrap.addEventListener('keydown', (e) => onKey(e, sel));
    wrap.addEventListener('blur', () => setTimeout(() => {
      if (openState && openState.sel === sel && !openState.menu.contains(document.activeElement)) close();
    }, 0));
    render(sel);
  }

  /* ---------------- 展開清單 ---------------- */
  function open(sel) {
    close();
    const control = sel._rs;
    const menu = document.createElement('div');
    menu.className = 'rs-menu';
    menu.id = control.dataset.list;
    menu.setAttribute('role', 'listbox');
    if (control.getAttribute('aria-label')) menu.setAttribute('aria-label', control.getAttribute('aria-label'));
    [...sel.options].forEach((o, i) => {
      if (o.value === '') return;                         // 空值選項只當提示文字（placeholder），不列在清單裡
      const item = document.createElement('div');
      item.className = 'rs-option' + (o.disabled ? ' is-disabled' : '') + (i === sel.selectedIndex && o.value !== '' ? ' is-selected' : '');
      item.id = menu.id + '-' + i;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false');
      if (o.disabled) item.setAttribute('aria-disabled', 'true');
      item.dataset.index = i;
      item.textContent = o.textContent;
      menu.appendChild(item);
    });
    menu.addEventListener('mousedown', (e) => e.preventDefault());      // 保持焦點在選單外框
    menu.addEventListener('mousemove', (e) => {
      const it = e.target.closest('.rs-option');
      if (it && !it.classList.contains('is-disabled')) setActive(Number(it.dataset.index));
    });
    menu.addEventListener('click', (e) => {
      const it = e.target.closest('.rs-option');
      if (it && !it.classList.contains('is-disabled')) choose(Number(it.dataset.index));
    });
    document.body.appendChild(menu);
    openState = { sel, control, menu, active: -1 };
    control.classList.add('is-open', 'is-focused');
    control.setAttribute('aria-expanded', 'true');
    position();
    const cur = sel.options[sel.selectedIndex];
    setActive(cur && !cur.disabled && cur.value !== '' ? sel.selectedIndex : nextEnabled(-1, 1));
  }

  // 清單放在 body（不會被卡片或對話框裁掉），依外框位置擺在下方；下方空間不夠就往上
  function position() {
    if (!openState) return;
    const { control, menu } = openState;
    const r = control.getBoundingClientRect();
    menu.style.minWidth = r.width + 'px';
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
    const below = window.innerHeight - r.bottom - 8;
    const h = Math.min(menu.scrollHeight, 300);
    if (below < h && r.top > below) menu.style.top = Math.max(8, r.top - h - 8) + 'px';
    else menu.style.top = (r.bottom + 8) + 'px';
    menu.style.maxHeight = Math.max(120, Math.min(300, below < h && r.top > below ? r.top - 16 : below)) + 'px';
  }

  function close() {
    if (!openState) return;
    const { control, menu } = openState;
    menu.remove();
    control.classList.remove('is-open');
    control.setAttribute('aria-expanded', 'false');
    control.removeAttribute('aria-activedescendant');
    if (document.activeElement !== control) control.classList.remove('is-focused');
    openState = null;
  }

  function setActive(i) {
    if (!openState) return;
    const { menu, control } = openState;
    menu.querySelectorAll('.rs-option.is-focused').forEach((x) => x.classList.remove('is-focused'));
    openState.active = i;
    const it = menu.querySelector('[data-index="' + i + '"]');
    if (!it) return;
    it.classList.add('is-focused');
    control.setAttribute('aria-activedescendant', it.id);
    const top = it.offsetTop, bottom = top + it.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }

  function nextEnabled(from, dir) {
    const opts = openState ? openState.sel.options : [];
    for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled && opts[i].value !== '') return i;
    return from;
  }

  function choose(i) {
    const { sel, control } = openState;
    close();
    control.focus();
    if (i !== sel.selectedIndex) {
      indexDesc.set.call(sel, i);
      render(sel);
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  let typed = '', typedAt = 0;
  function onKey(e, sel) {
    if (sel.disabled) return;
    const isOpen = openState && openState.sel === sel;
    const k = e.key;
    if (!isOpen) {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); open(sel); }
      return;
    }
    if (k === 'Escape') { e.preventDefault(); close(); return; }
    if (k === 'Tab') { close(); return; }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(nextEnabled(openState.active, 1)); return; }
    if (k === 'ArrowUp') { e.preventDefault(); setActive(nextEnabled(openState.active, -1)); return; }
    if (k === 'Home') { e.preventDefault(); setActive(nextEnabled(-1, 1)); return; }
    if (k === 'End') { e.preventDefault(); setActive(nextEnabled(sel.options.length, -1)); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); if (openState.active >= 0) choose(openState.active); return; }
    if (k.length === 1) {                                   // 輸入文字跳到符合的選項
      const now = Date.now();
      typed = (now - typedAt < 700 ? typed : '') + k.toLowerCase();
      typedAt = now;
      const i = [...sel.options].findIndex((o) => !o.disabled && o.value !== '' && o.textContent.toLowerCase().includes(typed));
      if (i >= 0) setActive(i);
    }
  }

  // 點外面、捲動、改變視窗大小時關閉或重新定位
  document.addEventListener('mousedown', (e) => {
    if (openState && !openState.control.contains(e.target) && !openState.menu.contains(e.target)) close();
  });
  window.addEventListener('resize', () => position());
  window.addEventListener('scroll', (e) => {
    if (openState && !openState.menu.contains(e.target)) position();
  }, true);

  // 點 <label for="原生 select"> 時，把焦點移到外框
  document.addEventListener('click', (e) => {
    const lab = e.target.closest('label[for]');
    if (!lab) return;
    const sel = document.getElementById(lab.htmlFor);
    if (sel && sel._rs) { e.preventDefault(); sel._rs.focus(); }
  });

  function enhanceAll(root) {
    (root || document).querySelectorAll('select:not(.rs-native)').forEach(enhance);
  }

  // 之後動態產生的 <select>（地點清單、行程安排、對話框）也自動套用
  new MutationObserver((list) => {
    list.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.tagName === 'SELECT') enhance(n); else if (n.querySelectorAll) enhanceAll(n);
    }));
    if (openState && !document.body.contains(openState.control)) close();
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => enhanceAll());
  if (document.readyState !== 'loading') enhanceAll();
  window.ReactSelectLike = { enhance, enhanceAll, close };
})();
