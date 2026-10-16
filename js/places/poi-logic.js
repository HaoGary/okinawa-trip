/**
 * PoiLogic — 地點匯入與「行程景點排序」的規則（純函式，不讀寫試算表或畫面）
 *
 * 同一份程式同時用在：
 *   - Apps Script（PoiLogic.gs）：讀試算表 → 套用規則 → 寫回試算表
 *   - 網頁（js/places/poi-logic.js）：暫存草稿、離線示範
 * 兩邊規則一致，結果才會一致。
 *
 * 資料（state）
 *   pois:     [{ poi_id, google_place_id, name, address, lat, lng, rating, ..., note, source, created_at, updated_at }]
 *   schedule: 行程景點排序（試算表 poi_schedule），原行程地點與新增景點放在同一份資料：
 *             [{ schedule_id, itinerary_id, day_no, sort_order, seq, poi_id, day_stop_id, hidden, created_at }]
 *             - 每一列只會有 poi_id（新增景點）或 day_stop_id（行程地圖原有的地點）其中一個
 *             - sort_order 是當天的順序（1、2、3…，沒有重複、沒有跳號）；seq 與 sort_order 相同（相容舊版）
 *             - hidden = true：原行程地點被「移出行程」（保留這一列，才知道它被移出；day_stop 原始資料不刪）
 *
 * 規則
 *   - 地點以 google_place_id 判斷是否重複（手動新增的地點以「名稱＋地址」判斷）
 *   - 同一個新增景點在同一天只能出現一次；同一個原行程地點在整個行程只能出現一次
 *   - 同一個景點可以安排在不同天（重複出現）；options.move = true 時改為從其他天移過來
 *   - 從行程移除不會刪除地點資料；刪除地點會一併移除它的安排
 *   - 出發地、終點的位置限制不寫死在這裡，由 ctx.rules 決定（預設沒有限制），見 checkRules()
 */
var PoiLogic = (function () {

  function fail(code, message, extra) {
    var e = new Error(message);
    e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    throw e;
  }

  function nextId(rows, key) {
    return rows.reduce(function (m, r) { return Math.max(m, Number(r[key]) || 0); }, 0) + 1;
  }

  function norm(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  // 地點的識別鍵：Google Place ID；沒有時（手動）用名稱＋地址
  function poiKey(p) {
    return p.google_place_id ? 'gp:' + p.google_place_id : 'na:' + norm(p.name) + '|' + norm(p.address);
  }

  // 排序項目的識別鍵：新增景點 p:poi_id、原行程地點 s:day_stop_id（不用名稱判斷）
  function itemKey(r) {
    return isStop(r) ? 's:' + Number(r.day_stop_id) : 'p:' + Number(r.poi_id);
  }
  function isStop(r) { return r.day_stop_id !== null && r.day_stop_id !== undefined && r.day_stop_id !== ''; }
  function isHidden(r) { return r.hidden === true || r.hidden === 'TRUE' || r.hidden === 1; }

  function findPoi(state, poiId) {
    var p = state.pois.filter(function (x) { return Number(x.poi_id) === Number(poiId); })[0];
    if (!p) fail('NOT_FOUND', '找不到這個地點（可能已被刪除）');
    return p;
  }

  // 當天「顯示中」的項目，依順序
  function daySlots(state, itineraryId, dayNo) {
    return state.schedule
      .filter(function (s) { return Number(s.itinerary_id) === Number(itineraryId) && Number(s.day_no) === Number(dayNo) && !isHidden(s); })
      .sort(function (a, b) { return order(a) - order(b); });
  }
  function order(r) { return Number(r.sort_order != null && r.sort_order !== '' ? r.sort_order : r.seq) || 0; }
  function setOrder(r, n) { r.sort_order = n; r.seq = n; }

  // 重新編號：1、2、3…（沒有重複、沒有跳號）；移出的項目順序設為 0
  function renumber(state, itineraryId, dayNo) {
    daySlots(state, itineraryId, dayNo).forEach(function (s, i) { setOrder(s, i + 1); });
    state.schedule.forEach(function (s) {
      if (isHidden(s) && Number(s.itinerary_id) === Number(itineraryId) && Number(s.day_no) === Number(dayNo)) setOrder(s, 0);
    });
  }

  function checkDay(dayNo, days) {
    if (days && days.indexOf(Number(dayNo)) < 0) fail('BAD_DAY', '沒有第 ' + dayNo + ' 天');
  }

  /* ---------------- 行程景點排序：把原行程地點併進排序資料 ---------------- */

  // stops：行程地圖上的地點 [{ day_stop_id, day_no, seq, ... }]
  // 還沒有排序資料的原行程地點，依原本的天數與順序補上（不會重複補）。
  // 整個行程完全沒有原行程地點的排序資料時（第一次使用），原行程地點排在新增景點前面；
  // 之後試算表 day_stop 新增的地點，排在該天最後。
  function planFor(state, itineraryId, stops) {
    var mine = state.schedule.filter(function (s) { return Number(s.itinerary_id) === Number(itineraryId); });
    var have = {};
    mine.forEach(function (s) { if (isStop(s)) have[Number(s.day_stop_id)] = true; });
    var first = !mine.some(isStop);
    var id = nextId(state.schedule, 'schedule_id');
    var touched = {};
    (stops || []).slice().sort(function (a, b) { return a.day_no - b.day_no || a.seq - b.seq; }).forEach(function (t) {
      if (have[Number(t.day_stop_id)]) return;
      if (isHidden(t)) return;            // 已移出、並在「確認」時清除的原行程地點：不再自動排回行程
      have[Number(t.day_stop_id)] = true;
      var row = { schedule_id: id++, itinerary_id: Number(itineraryId), day_no: Number(t.day_no),
                  poi_id: null, day_stop_id: Number(t.day_stop_id), hidden: false, created_at: null };
      setOrder(row, first ? Number(t.seq) - 100000 : 100000 + Number(t.seq));
      state.schedule.push(row);
      touched[t.day_no] = true;
    });
    // 補上欄位預設值並重新編號
    state.schedule.forEach(function (s) {
      if (s.hidden === undefined || s.hidden === '' || s.hidden === null) s.hidden = false;
      if (s.sort_order === undefined || s.sort_order === '' || s.sort_order === null) s.sort_order = s.seq;
      if (s.day_stop_id === undefined || s.day_stop_id === '') s.day_stop_id = null;
    });
    var days = {};
    mine.concat(state.schedule.filter(function (s) { return Number(s.itinerary_id) === Number(itineraryId); }))
      .forEach(function (s) { days[s.day_no] = true; });
    Object.keys(days).forEach(function (d) { renumber(state, itineraryId, d); });
    return state.schedule.filter(function (s) { return Number(s.itinerary_id) === Number(itineraryId); });
  }

  /* ---------------- 出發地／終點等位置限制（獨立設定，預設沒有限制） ---------------- */

  // ctx.rules = { startFirst: true }  → 標為「出發」的原行程地點必須是當天第 1 個
  // ctx.rules = { endLast: true }     → 標為「終點」的原行程地點必須是當天最後 1 個
  // ctx.roles = { day_stop_id: '出發' | '終點' }
  function checkRules(state, itineraryId, ctx) {
    var rules = (ctx && ctx.rules) || {};
    if (!rules.startFirst && !rules.endLast) return;
    var roles = (ctx && ctx.roles) || {};
    var days = {};
    state.schedule.forEach(function (s) { if (Number(s.itinerary_id) === Number(itineraryId)) days[s.day_no] = true; });
    Object.keys(days).forEach(function (d) {
      var list = daySlots(state, itineraryId, d);
      list.forEach(function (s, i) {
        var role = isStop(s) ? roles[Number(s.day_stop_id)] : null;
        if (rules.startFirst && role === '出發' && i !== 0) fail('RULE', '依目前設定，出發地必須排在第 ' + d + ' 天的第 1 個');
        if (rules.endLast && role === '終點' && i !== list.length - 1) fail('RULE', '依目前設定，終點必須排在第 ' + d + ' 天的最後 1 個');
      });
    });
  }

  /* ---------------- 地點 ---------------- */

  // 匯入：回傳 { added: [地點], skipped: [{ name, reason }] }
  function importPois(state, items, now) {
    var seen = {};
    state.pois.forEach(function (p) { seen[poiKey(p)] = p; });
    var added = [], skipped = [];
    (items || []).forEach(function (it) {
      var name = String(it.name || '').trim();
      if (!name) { skipped.push({ name: '（未命名）', reason: '缺少景點名稱' }); return; }
      var key = poiKey(it);
      if (seen[key]) { skipped.push({ name: name, reason: '已在景點清單中', poi_id: seen[key].poi_id }); return; }
      var p = {
        poi_id: nextId(state.pois, 'poi_id'),
        google_place_id: it.google_place_id || null,
        name: name,
        address: it.address || null,
        lat: it.lat == null || it.lat === '' ? null : Number(it.lat),
        lng: it.lng == null || it.lng === '' ? null : Number(it.lng),
        rating: it.rating == null || it.rating === '' ? null : Number(it.rating),
        rating_count: it.rating_count == null || it.rating_count === '' ? null : Number(it.rating_count),
        primary_type: it.primary_type || null,
        type_label: it.type_label || null,
        category: it.category || null,
        maps_url: it.maps_url || null,
        note: it.note || null,
        photo_url: /^https:\/\//i.test(String(it.photo_url || '')) ? String(it.photo_url) : null,   // 自己的照片（雲端硬碟）；Google 的暫時照片網址不保存
        source: it.source || 'manual',
        created_at: now,
        updated_at: now,
      };
      state.pois.push(p);
      seen[key] = p;
      added.push(p);
    });
    return { added: added, skipped: skipped };
  }

  // 修改備註（目前只開放 note）
  // 可修改：note（備註）、name（名稱）、address（地址）、lat／lng（座標，要一起填或一起清空）、rating、category、type_label、maps_url
  function updatePoi(state, poiId, patch, now) {
    var p = findPoi(state, poiId);
    var has = function (k) { return patch && Object.prototype.hasOwnProperty.call(patch, k); };
    if (has('name')) {
      var name = String(patch.name || '').trim();
      if (!name) fail('BAD_REQUEST', '請輸入景點名稱');
      if (name.length > 80) fail('TOO_LONG', '名稱最多 80 字');
    }
    if (has('address') && String(patch.address || '').trim().length > 200) fail('TOO_LONG', '地址最多 200 字');
    if (has('lat') || has('lng')) {
      var empty = function (v) { return v === null || v === undefined || v === ''; };
      var la = has('lat') ? patch.lat : p.lat, ln = has('lng') ? patch.lng : p.lng;
      if (empty(la) !== empty(ln)) fail('BAD_REQUEST', '緯度與經度要一起填寫');
      if (!empty(la) && !(isFinite(Number(la)) && Math.abs(Number(la)) <= 90 && isFinite(Number(ln)) && Math.abs(Number(ln)) <= 180)) {
        fail('BAD_REQUEST', '緯度需介於 -90～90、經度需介於 -180～180');
      }
      p.lat = empty(la) ? null : Number(la);
      p.lng = empty(ln) ? null : Number(ln);
    }
    if (has('rating')) {
      var rt = patch.rating;
      if (rt === null || rt === undefined || rt === '') p.rating = null;
      else if (isFinite(Number(rt)) && Number(rt) >= 0 && Number(rt) <= 5) p.rating = Math.round(Number(rt) * 10) / 10;
      else fail('BAD_REQUEST', '評分需介於 0 到 5');
    }
    if (has('category')) {
      var cat = String(patch.category || '');
      if (cat && ['attraction', 'nature', 'heritage', 'shopping'].indexOf(cat) < 0) fail('BAD_REQUEST', '不支援的景點類型');
      p.category = cat || null;
    }
    if (has('type_label')) p.type_label = String(patch.type_label || '').slice(0, 40) || null;
    if (has('maps_url')) {
      var url = String(patch.maps_url || '').trim();
      if (url && !/^https:\/\//i.test(url)) fail('BAD_REQUEST', '地圖連結需以 https:// 開頭');
      if (url.length > 500) fail('TOO_LONG', '地圖連結太長');
      p.maps_url = url || null;
    }
    if (has('name')) p.name = String(patch.name).trim();
    if (has('address')) p.address = String(patch.address || '').trim() || null;
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'note')) {
      var note = String(patch.note || '').trim();
      if (note.length > 500) fail('TOO_LONG', '備註最多 500 字');
      p.note = note || null;
    }
    p.updated_at = now;
    return p;
  }

  // 刪除地點，連同它的安排
  function deletePoi(state, poiId) {
    var p = findPoi(state, poiId);
    var touched = {};
    state.schedule = state.schedule.filter(function (s) {
      if (isStop(s) || Number(s.poi_id) !== Number(p.poi_id)) return true;
      touched[s.itinerary_id + ':' + s.day_no] = [s.itinerary_id, s.day_no];
      return false;
    });
    Object.keys(touched).forEach(function (k) { renumber(state, touched[k][0], touched[k][1]); });
    state.pois = state.pois.filter(function (x) { return x !== p; });
    return { removedSchedules: Object.keys(touched).length };
  }

  /* ---------------- 行程景點排序 ---------------- */

  // 把新增景點安排到某一天（排在最後）；可以同時安排在其他天；options.move = true 時，從其他天移過來
  function scheduleAdd(state, poiId, itineraryId, dayNo, options, now, days) {
    var p = findPoi(state, poiId);
    checkDay(dayNo, days);
    var mine = state.schedule.filter(function (s) {
      return !isStop(s) && Number(s.poi_id) === Number(p.poi_id) && Number(s.itinerary_id) === Number(itineraryId);
    });
    if (mine.some(function (s) { return Number(s.day_no) === Number(dayNo); }))
      fail('SAME_DAY', '「' + p.name + '」已經在第 ' + dayNo + ' 天');
    var others = mine.map(function (s) { return Number(s.day_no); });
    if (others.length && options && options.move) {
      state.schedule = state.schedule.filter(function (s) { return mine.indexOf(s) < 0; });
      others.forEach(function (d) { renumber(state, itineraryId, d); });
    }
    var row = {
      schedule_id: nextId(state.schedule, 'schedule_id'),
      poi_id: p.poi_id, day_stop_id: null, hidden: false,
      itinerary_id: Number(itineraryId),
      day_no: Number(dayNo),
      created_at: now,
    };
    setOrder(row, daySlots(state, itineraryId, dayNo).length + 1);
    state.schedule.push(row);
    return row;
  }

  function findSlot(state, scheduleId) {
    var s = state.schedule.filter(function (x) { return Number(x.schedule_id) === Number(scheduleId); })[0];
    if (!s) fail('NOT_FOUND', '找不到這筆行程安排（可能已被移除）');
    return s;
  }

  // 移出行程：新增景點刪掉這筆安排；原行程地點標為 hidden（保留排序資料，day_stop 原始資料不動）
  function scheduleRemove(state, scheduleId) {
    var s = findSlot(state, scheduleId);
    if (isStop(s)) { s.hidden = true; }
    else state.schedule = state.schedule.filter(function (x) { return x !== s; });
    renumber(state, s.itinerary_id, s.day_no);
    return s;
  }

  // 把移出的原行程地點加回當天（排在最後）
  function scheduleRestore(state, scheduleId) {
    var s = findSlot(state, scheduleId);
    if (!isHidden(s)) return s;
    s.hidden = false;
    setOrder(s, daySlots(state, s.itinerary_id, s.day_no).length + 1);
    renumber(state, s.itinerary_id, s.day_no);
    return s;
  }

  // 移到另一天（排在最後）
  function scheduleMove(state, scheduleId, toDay, days) {
    var s = findSlot(state, scheduleId);
    checkDay(toDay, days);
    if (Number(s.day_no) === Number(toDay)) return s;
    if (!isStop(s)) {
      var dup = state.schedule.some(function (x) {
        return x !== s && !isStop(x) && Number(x.poi_id) === Number(s.poi_id) && Number(x.itinerary_id) === Number(s.itinerary_id)
          && Number(x.day_no) === Number(toDay);
      });
      if (dup) fail('SAME_DAY', '這個景點已經在第 ' + toDay + ' 天');
    }
    var from = s.day_no;
    s.day_no = Number(toDay);
    s.hidden = false;
    setOrder(s, daySlots(state, s.itinerary_id, toDay).length + 1);   // 先排最後
    renumber(state, s.itinerary_id, from);
    renumber(state, s.itinerary_id, toDay);
    return s;
  }

  // 同一天內上移（-1）或下移（+1）
  function scheduleReorder(state, scheduleId, dir) {
    var s = findSlot(state, scheduleId);
    var list = daySlots(state, s.itinerary_id, s.day_no);
    var i = list.indexOf(s);
    if (i < 0) return s;
    return scheduleMoveTo(state, scheduleId, i + 1 + (dir < 0 ? -1 : 1));
  }

  // 移到當天的第 position 個（1 起算；超出範圍時排到最前或最後）
  function scheduleMoveTo(state, scheduleId, position) {
    var s = findSlot(state, scheduleId);
    if (isHidden(s)) fail('HIDDEN', '這個地點已移出行程，請先加回');
    var list = daySlots(state, s.itinerary_id, s.day_no).filter(function (x) { return x !== s; });
    var pos = Math.max(1, Math.min(list.length + 1, Math.round(Number(position) || 1)));
    list.splice(pos - 1, 0, s);
    list.forEach(function (x, i) { setOrder(x, i + 1); });
    return s;
  }

  // 整份覆寫某個行程的排序（「確認」時使用）
  // items：[{ poi_id | day_stop_id, day_no, hidden }]，同一天依陣列順序排；hidden 的原行程地點保留但不排序
  // 同一個項目原本就有的資料列，會保留 schedule_id 與建立時間
  function scheduleReplace(state, itineraryId, items, now, days) {
    if (!Array.isArray(items)) fail('BAD_REQUEST', '缺少行程安排資料');
    var mine = state.schedule.filter(function (s) { return Number(s.itinerary_id) === Number(itineraryId); });
    var others = state.schedule.filter(function (s) { return mine.indexOf(s) < 0; });
    var old = {};
    mine.forEach(function (s) { old[itemKey(s) + (isStop(s) ? '' : '@' + s.day_no)] = s; });
    var id = nextId(state.schedule, 'schedule_id');
    var seenPoi = {}, seenStop = {}, seqs = {}, rows = [], kept = 0;
    items.forEach(function (it) {
      var day = Number(it.day_no);
      checkDay(day, days);
      var stop = isStop(it);
      var hidden = stop && isHidden(it);
      var key;
      if (stop) {
        key = 's:' + Number(it.day_stop_id);
        if (seenStop[key]) fail('DUPLICATE', '同一個原行程地點出現了兩次');
        seenStop[key] = true;
      } else {
        var p = findPoi(state, it.poi_id);
        var pk = p.poi_id + ':' + day;
        if (seenPoi[pk]) fail('SAME_DAY', '「' + p.name + '」在第 ' + day + ' 天重複出現');
        seenPoi[pk] = true;
        key = 'p:' + p.poi_id + '@' + day;
      }
      var n = 0;
      if (!hidden) { seqs[day] = (seqs[day] || 0) + 1; n = seqs[day]; }
      var prev = old[key];
      if (prev) kept++;
      var row = {
        schedule_id: prev ? prev.schedule_id : id++,
        poi_id: stop ? null : Number(it.poi_id),
        day_stop_id: stop ? Number(it.day_stop_id) : null,
        hidden: hidden,
        itinerary_id: Number(itineraryId),
        day_no: day,
        created_at: prev ? prev.created_at : now,
      };
      setOrder(row, n);
      rows.push(row);
    });
    state.schedule = others.concat(rows);
    return { count: rows.filter(function (r) { return !r.hidden; }).length, added: rows.length - kept, removed: mine.length - kept };
  }

  // 一次寫入（「行程安排」按「確認」）：先新增尚未儲存的地點，再覆寫整個行程的排序
  // pois：[{ tmp_id: -1, item: {...} }]（網頁暫存的地點，tmp_id 為負數）
  // schedule：[{ poi_id | day_stop_id, day_no, hidden }]，poi_id 可以是 tmp_id
  function commitPlan(state, itineraryId, pois, schedule, now, days) {
    var idMap = {}, added = [], skipped = [];
    (pois || []).forEach(function (p) {
      var r = importPois(state, [p.item], now);
      var id = r.added.length ? r.added[0].poi_id : (r.skipped.length ? r.skipped[0].poi_id : null);
      if (id == null) fail('BAD_REQUEST', '地點「' + ((p.item && p.item.name) || '（未命名）') + '」缺少名稱');
      idMap[p.tmp_id] = id;
      if (r.added.length) added.push(r.added[0]); else skipped.push(r.skipped[0]);
    });
    var items = (schedule || []).map(function (s) {
      if (isStop(s)) return { day_stop_id: s.day_stop_id, day_no: s.day_no, hidden: isHidden(s) };
      var id = Number(s.poi_id) < 0 ? idMap[s.poi_id] : s.poi_id;
      if (id == null) fail('NOT_FOUND', '找不到要安排的地點');
      return { poi_id: id, day_no: s.day_no };
    });
    var replaced = scheduleReplace(state, itineraryId, items, now, days);
    return { added: added, skipped: skipped, idMap: idMap, schedule: replaced };
  }

  // 依指令執行（Apps Script 與網頁共用的入口）；執行後檢查位置限制（ctx.rules）
  function apply(state, op, ctx) {
    var now = ctx.now, itin = ctx.itineraryId, days = ctx.days, result;
    switch (op.type) {
      case 'importPois':      return importPois(state, op.items, now);
      case 'updatePoi':       return updatePoi(state, op.poi_id, op.patch, now);
      case 'deletePoi':       return deletePoi(state, op.poi_id);
      case 'scheduleAdd':     result = scheduleAdd(state, op.poi_id, itin, op.day_no, { move: !!op.move }, now, days); break;
      case 'scheduleRemove':  result = scheduleRemove(state, op.schedule_id); break;
      case 'scheduleRestore': result = scheduleRestore(state, op.schedule_id); break;
      case 'scheduleMove':    result = scheduleMove(state, op.schedule_id, op.day_no, days); break;
      case 'scheduleReorder': result = scheduleReorder(state, op.schedule_id, op.dir); break;
      case 'scheduleMoveTo':  result = scheduleMoveTo(state, op.schedule_id, op.position); break;
      case 'scheduleReplace': result = scheduleReplace(state, itin, op.items, now, days); break;
      case 'commitPlan':      result = commitPlan(state, itin, op.pois, op.schedule, now, days); break;
      default: fail('BAD_OP', '不支援的操作：' + op.type);
    }
    checkRules(state, itin, ctx);
    return result;
  }

  return { apply: apply, poiKey: poiKey, itemKey: itemKey, isStop: isStop, isHidden: isHidden, planFor: planFor,
           checkRules: checkRules, importPois: importPois, updatePoi: updatePoi, deletePoi: deletePoi,
           scheduleAdd: scheduleAdd, scheduleRemove: scheduleRemove, scheduleRestore: scheduleRestore,
           scheduleMove: scheduleMove, scheduleReorder: scheduleReorder, scheduleMoveTo: scheduleMoveTo,
           scheduleReplace: scheduleReplace, commitPlan: commitPlan };
})();

if (typeof module !== 'undefined') module.exports = PoiLogic;
