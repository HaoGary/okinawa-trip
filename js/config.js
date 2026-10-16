/* ==========================================================================
   config.js — 全站設定與命名空間（最先載入）

   所有程式掛在 window.Trip 底下，避免全域變數互相衝突：
     Trip.config   設定值（本檔）
     Trip.geo      共用地理資料（由 loader.js 從 Apps Script 取得）
     Trip.days     每日行程資料（由 loader.js 從 Apps Script 取得，以 Trip.addDay() 加入）
     Trip.region   地區與全島小圖範圍、Trip.trip 行程代碼與名稱（同上）
     Trip.lib      功能模組（lib/*.js）
   ========================================================================== */
window.Trip = {
  config: {
    /** SVG 命名空間 */
    svgNS: 'http://www.w3.org/2000/svg',

    /** 路線地圖的 viewBox 寬度（高度由每日資料 map.height 決定） */
    mapWidth: 800,

    /** 約 1 公里對應的經度差（沖繩緯度約 26°），比例尺使用 */
    kmToLng: 0.01003,

    /** 地點標記半徑（viewBox 單位） */
    markerRadius: 12,

    /** 行程清單與地圖標記使用的字母 */
    stopLetters: 'ABCDEFGHIJ',

    /**
     * 小螢幕地圖文字放大：地圖顯示寬度小於 viewBox 寬 × ratio 時開始放大，
     * 最多放大到 max 倍。
     */
    labelScale: { ratio: 0.72, max: 1.9 },

    /**
     * 行程資料來源：Apps Script 網頁應用程式（okinawaTrip）
     *   url     部署後的網址（…/exec）—— 必填，行程資料全部由此取得
     *   code    預設行程代碼（試算表 itinerary.code）；網址加 ?code=… 可切換
     *   timeout 等待毫秒數；逾時會顯示錯誤與「重新載入」
     */
    api: {
      url: 'https://script.google.com/macros/s/AKfycbyiBNMO9t0r0hedxov19tg4oVZf_IfyFduasnUCXOxLwUq8v_ZgdqvUzQrjASzX70wt/exec',
      code: 'okinawa-5d',
      timeout: 45000,   // Apps Script 第一次啟動可能要 10～30 秒
      /** 地點管理的寫入密碼：與 Apps Script 指令碼屬性 WRITE_TOKEN 相同（未設定可留空） */
      writeToken: ''
    },

    /** 預設交通方式（Google 地圖 travelmode） */
    defaultTravelMode: 'driving',

    /** localStorage 鍵名（記住使用者上次的選擇） */
    storageKeys: {
      day:   'naha-day',
      mode:  'naha-mode',
      mini:  'naha-mini',
      theme: 'naha-theme'
    },

    /** 介面文字 */
    text: {
      menuTitle:     '{n} 天行程',   // {n} 會換成實際天數
      itinerary:     '行程與路段',
      areaEyebrow:   '活動範圍',
      areaKey:       '本日範圍',
      darkMode:      '深色模式',
      lightMode:     '淺色模式',
      collapseMenu:  '收合選單',
      expandMenu:    '展開選單',
      viewScene:     '查看景色',
      sceneNote:     '示意插圖，非實景照片',
      sceneLink:     '在 Google 地圖看實景 ↗',
      close:         '關閉'
    }
  },

  geo: {},
  days: [],
  lib: {},

  /** 登錄一天的行程（loader.js 使用） */
  addDay(day) {
    this.days.push(day);
    this.days.sort((a, b) => a.id - b.id);
  }
};
