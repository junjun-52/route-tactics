/**
 * config.js
 * ROUTE TACTICS v5-yahoo 設定・定数定義
 */
const RouteTacticsConfig = (() => {
  const STORAGE_KEYS = {
    API_KEYS: 'rt_v5_yahoo_api_keys',
    PROFILES: 'rt_v5_yahoo_profiles',
    ACTIVE_PROFILE_ID: 'rt_v5_yahoo_active_profile_id',
    HOME_LOCATION: 'rt_v5_yahoo_home_location',
    SAVED_PLACES: 'rt_v5_yahoo_saved_places',
    LAST_STATE: 'rt_v5_yahoo_last_state',
  };

  const API_ENDPOINTS = {
    // Google Routes API (computeRoutes)
    GOOGLE_ROUTES: 'https://routes.googleapis.com/directions/v2:computeRoutes',
    // TomTom Routing API & Traffic Incident Details
    TOMTOM_ROUTE: 'https://api.tomtom.com/routing/1/calculateRoute',
    TOMTOM_INCIDENTS: 'https://api.tomtom.com/traffic/services/5/incidentDetails',
    // Open-Meteo Forecast API (無料・キー不要)
    OPEN_METEO: 'https://api.open-meteo.com/v1/forecast',
  };

  // デフォルト車両・コスト計算パラメータ
  const DEFAULT_VEHICLE_SETTINGS = {
    fuelEfficiencyKmPerL: 12.0,     // 燃費 (km/L)
    fuelPriceYenPerL: 175,          // ガソリン単価 (円/L)
    etcDiscountRate: 0.0,           // 任意割引補正係数 (0.0 = そのまま, 例: 0.3 で30%引試算用)
    referenceFuelPriceYenPerL: 175, // 基準SS比較用の基準単価 (円/L)
    referenceStationName: '基準SS', // 基準給油所ラベル
  };

  // デフォルトプロファイル定義
  const DEFAULT_PROFILES = [
    {
      id: 'prof_default_commute',
      name: '通常・通勤',
      fuelEfficiencyKmPerL: 12.0,
      fuelPriceYenPerL: 175,
      etcDiscountRate: 0.0,
      preferredStrategy: 'mix', // 'highway' | 'mix' | 'local'
    },
    {
      id: 'prof_family_drive',
      name: '家族・長距離',
      fuelEfficiencyKmPerL: 13.5,
      fuelPriceYenPerL: 175,
      etcDiscountRate: 0.0,
      preferredStrategy: 'highway',
    },
  ];

  // 登録地最大件数（自宅1件とは別に5件）
  const MAX_SAVED_PLACES = 5;

  // Yahoo!カーナビ URLスキーム上限
  const YAHOO_NAVI_MAX_WAYPOINTS = 3;

  // 外部APIのタイムアウト (ms)
  const REQUEST_TIMEOUT_MS = 12000;

  /**
   * APIキー群を取得（localStorage優先、未設定時は空文字）
   */
  function getApiKeys() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.API_KEYS);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        googleMapsKey: typeof parsed.googleMapsKey === 'string' ? parsed.googleMapsKey.trim() : '',
        tomtomKey: typeof parsed.tomtomKey === 'string' ? parsed.tomtomKey.trim() : '',
      };
    } catch (e) {
      console.warn('[Config] APIキーの読み込みに失敗しました:', e);
      return { googleMapsKey: '', tomtomKey: '' };
    }
  }

  /**
   * APIキー群を保存
   */
  function saveApiKeys({ googleMapsKey = '', tomtomKey = '' }) {
    const payload = {
      googleMapsKey: String(googleMapsKey || '').trim(),
      tomtomKey: String(tomtomKey || '').trim(),
    };
    localStorage.setItem(STORAGE_KEYS.API_KEYS, JSON.stringify(payload));
    return payload;
  }

  return {
    STORAGE_KEYS,
    API_ENDPOINTS,
    DEFAULT_VEHICLE_SETTINGS,
    DEFAULT_PROFILES,
    MAX_SAVED_PLACES,
    YAHOO_NAVI_MAX_WAYPOINTS,
    REQUEST_TIMEOUT_MS,
    getApiKeys,
    saveApiKeys,
  };
})();
