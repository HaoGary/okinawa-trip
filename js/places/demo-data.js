/* ==========================================================================
   places/demo-data.js — 示範資料（模擬，非 Google Maps 即時資料）

   沒有 Google Maps API 金鑰、或 Apps Script 尚未設定時使用，讓頁面流程可以操作。
   - 景點名稱與大致位置取自公開資訊；評分與評分數是「模擬值」，不是 Google 的評分
   - google_place_id 以 demo- 開頭，不是真正的 Place ID
   - 畫面上一律標示「示範資料」
   ========================================================================== */
(function (Trip) {
  'use strict';

  const D = (id, name, address, lat, lng, rating, count, category, typeLabel) => ({
    google_place_id: 'demo-' + id, name, address, lat, lng, rating, rating_count: count,
    category, type_label: typeLabel, primary_type: null,
    maps_url: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + ' ' + address),
    photo: null, source: 'demo',
  });

  Trip.placesDemo = {
    note: '示範資料：評分與評分數為模擬值，不是 Google Maps 即時資料',
    regionWords: ['沖繩', '沖縄', 'okinawa', '那霸', '那覇', 'naha'],
    places: [
      D('churaumi',   '沖繩美麗海水族館',       '沖縄県国頭郡本部町石川424',      26.6943, 127.8779, 4.6, 52000, 'attraction', '水族館'),
      D('shurijo',    '首里城公園',             '沖縄県那覇市首里金城町1-2',      26.2170, 127.7195, 4.3, 38000, 'heritage',   '歷史古蹟'),
      D('kokusai',    '國際通',                 '沖縄県那覇市牧志',              26.2155, 127.6880, 4.1, 30000, 'attraction', '商店街'),
      D('kouri',      '古宇利大橋',             '沖縄県国頭郡今帰仁村古宇利',      26.6880, 128.0150, 4.6, 12000, 'nature',     '景觀橋'),
      D('manzamo',    '萬座毛',                 '沖縄県国頭郡恩納村恩納',         26.5048, 127.8505, 4.2, 15000, 'nature',     '海岬'),
      D('cape-hedo',  '邊戶岬',                 '沖縄県国頭郡国頭村辺戸',         26.8710, 128.2650, 4.5, 6000,  'nature',     '海岬'),
      D('nakijin',    '今歸仁城跡',             '沖縄県国頭郡今帰仁村今泊5101',    26.6915, 127.9290, 4.4, 7000,  'heritage',   '城跡'),
      D('seifa',      '齋場御嶽',               '沖縄県南城市知念久手堅',          26.1730, 127.8270, 4.4, 8000,  'heritage',   '世界遺產'),
      D('naminoue',   '波上宮',                 '沖縄県那覇市若狭1-25-11',        26.2203, 127.6713, 4.3, 9000,  'heritage',   '神社'),
      D('american',   '美國村',                 '沖縄県中頭郡北谷町美浜',          26.3160, 127.7570, 4.1, 20000, 'shopping',   '購物商圈'),
      D('aeon-rycom', 'AEON MALL 沖繩來客夢',   '沖縄県中頭郡北中城村アワセ土地区画整理事業区域内4街区', 26.3080, 127.7980, 4.2, 25000, 'shopping', '購物中心'),
      D('ashibinaa',  'Outlet Mall Ashibinaa', '沖縄県豊見城市豊崎1-188',        26.1590, 127.6600, 3.9, 11000, 'shopping',   '暢貨中心'),
      D('senaga',     '瀨長島 Umikaji Terrace', '沖縄県豊見城市瀬長174-6',        26.1760, 127.6430, 4.2, 14000, 'attraction', '海景商店街'),
      D('gyokusendo', '沖繩世界・玉泉洞',       '沖縄県南城市玉城前川1336',        26.1408, 127.7480, 4.1, 9000,  'nature',     '鐘乳石洞'),
      D('emerald',    '翡翠海灘',               '沖縄県国頭郡本部町石川',          26.6960, 127.8760, 4.4, 5000,  'nature',     '海灘'),
      D('nameless',   '某海邊觀景台（無評分範例）', '沖縄県国頭郡本部町',          26.6900, 127.8800, null, 0,   'nature',     '觀景台'),
    ],
  };
})(window.Trip);
