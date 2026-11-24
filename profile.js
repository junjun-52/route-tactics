/**
 * profile.js
 * ROUTE TACTICS v5-yahoo プロファイル＆地点（自宅＋登録地最大5ヶ所）管理
 */
const ProfileManager = (() => {
  const { STORAGE_KEYS, DEFAULT_PROFILES, DEFAULT_VEHICLE_SETTINGS, MAX_SAVED_PLACES } =
    RouteTacticsConfig;

  /**
   * 緯度経度オブジェクトの正規化・検証
   */
  function normalizeLocation(loc, fallbackName = '指定地点') {
    if (!loc || typeof loc !== 'object') return null;
    const lat = Number(loc.lat);
    const lon = Number(loc.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    const name = String(loc.name || '').trim() || fallbackName;
    return {
      id: loc.id || `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      memo: loc.memo ? String(loc.memo).trim() : '',
    };
  }

  /**
   * プロファイル一覧を取得（初回はデフォルトを生成）
   */
  function getProfiles() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROFILES);
      if (!raw) {
        localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(DEFAULT_PROFILES));
        return [...DEFAULT_PROFILES];
      }
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || list.length === 0) {
        return [...DEFAULT_PROFILES];
      }
      return list.map((p, idx) => ({
        id: p.id || `prof_${idx}`,
        name: String(p.name || `プロファイル${idx + 1}`).trim(),
        fuelEfficiencyKmPerL:
          Number(p.fuelEfficiencyKmPerL) > 0
            ? Number(p.fuelEfficiencyKmPerL)
            : DEFAULT_VEHICLE_SETTINGS.fuelEfficiencyKmPerL,
        fuelPriceYenPerL:
          Number(p.fuelPriceYenPerL) >= 0
            ? Number(p.fuelPriceYenPerL)
            : DEFAULT_VEHICLE_SETTINGS.fuelPriceYenPerL,
        etcDiscountRate:
          Number.isFinite(Number(p.etcDiscountRate)) ? Number(p.etcDiscountRate) : 0,
        preferredStrategy: ['highway', 'mix', 'local'].includes(p.preferredStrategy)
          ? p.preferredStrategy
          : 'mix',
      }));
    } catch (e) {
      console.warn('[ProfileManager] プロファイル読み込みエラー:', e);
      return [...DEFAULT_PROFILES];
    }
  }

  /**
   * プロファイル一覧を保存
   */
  function saveProfiles(profiles) {
    const sanitized = Array.isArray(profiles) && profiles.length > 0 ? profiles : DEFAULT_PROFILES;
    localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(sanitized));
    return sanitized;
  }

  /**
   * 現在アクティブなプロファイルIDを取得
   */
  function getActiveProfileId() {
    const profiles = getProfiles();
    const savedId = localStorage.getItem(STORAGE_KEYS.ACTIVE_PROFILE_ID);
    if (savedId && profiles.some((p) => p.id === savedId)) {
      return savedId;
    }
    return profiles[0].id;
  }

  /**
   * アクティブプロファイルを切り替え
   */
  function setActiveProfile(profileId) {
    const profiles = getProfiles();
    const target = profiles.find((p) => p.id === profileId) || profiles[0];
    localStorage.setItem(STORAGE_KEYS.ACTIVE_PROFILE_ID, target.id);
    return target;
  }

  /**
   * 現在アクティブなプロファイルオブジェクトを取得
   */
  function getActiveProfile() {
    const profiles = getProfiles();
    const activeId = getActiveProfileId();
    return profiles.find((p) => p.id === activeId) || profiles[0];
  }

  /**
   * プロファイルの追加または更新
   */
  function upsertProfile(profileData) {
    const profiles = getProfiles();
    const normalized = {
      id: profileData.id || `prof_${Date.now()}`,
      name: String(profileData.name || 'カスタム').trim() || 'カスタム',
      fuelEfficiencyKmPerL: Math.max(0.1, Number(profileData.fuelEfficiencyKmPerL) || 12.0),
      fuelPriceYenPerL: Math.max(0, Number(profileData.fuelPriceYenPerL) || 175),
      etcDiscountRate: Math.min(0.9, Math.max(0, Number(profileData.etcDiscountRate) || 0)),
      preferredStrategy: ['highway', 'mix', 'local'].includes(profileData.preferredStrategy)
        ? profileData.preferredStrategy
        : 'mix',
    };

    const idx = profiles.findIndex((p) => p.id === normalized.id);
    if (idx >= 0) {
      profiles[idx] = normalized;
    } else {
      profiles.push(normalized);
    }
    saveProfiles(profiles);
    return normalized;
  }

  /**
   * 自宅地点を取得（未設定時は null）
   */
  function getHomeLocation() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HOME_LOCATION);
      if (!raw) return null;
      return normalizeLocation(JSON.parse(raw), '自宅');
    } catch (e) {
      console.warn('[ProfileManager] 自宅地点読み込みエラー:', e);
      return null;
    }
  }

  /**
   * 自宅地点を保存
   */
  function setHomeLocation(loc) {
    const normalized = normalizeLocation(loc, '自宅');
    if (!normalized) {
      throw new Error('自宅の名称または緯度経度が正しくありません。');
    }
    normalized.id = 'home';
    localStorage.setItem(STORAGE_KEYS.HOME_LOCATION, JSON.stringify(normalized));
    return normalized;
  }

  /**
   * 登録地一覧（最大5件）を取得
   */
  function getSavedPlaces() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SAVED_PLACES);
      if (!raw) return [];
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list
        .map((item, i) => normalizeLocation(item, `登録地${i + 1}`))
        .filter(Boolean)
        .slice(0, MAX_SAVED_PLACES);
    } catch (e) {
      console.warn('[ProfileManager] 登録地読み込みエラー:', e);
      return [];
    }
  }

  /**
   * 登録地を追加（ID指定時は更新）。最大5件制限。
   */
  function upsertSavedPlace(placeData) {
    const places = getSavedPlaces();
    const normalized = normalizeLocation(placeData, `登録地${places.length + 1}`);
    if (!normalized) {
      throw new Error('登録地の名称または緯度経度が正しくありません。');
    }

    const existingIdx = places.findIndex((p) => p.id === normalized.id);
    if (existingIdx >= 0) {
      places[existingIdx] = normalized;
    } else {
      if (places.length >= MAX_SAVED_PLACES) {
        throw new Error(`登録地は最大${MAX_SAVED_PLACES}件まで保存できます。既存を削除してから追加してください。`);
      }
      places.push(normalized);
    }

    localStorage.setItem(STORAGE_KEYS.SAVED_PLACES, JSON.stringify(places));
    return places;
  }

  /**
   * 登録地を削除
   */
  function removeSavedPlace(placeId) {
    const places = getSavedPlaces().filter((p) => p.id !== placeId);
    localStorage.setItem(STORAGE_KEYS.SAVED_PLACES, JSON.stringify(places));
    return places;
  }

  /**
   * 自宅＋登録地5件をワンタップ選択用にまとめて返す
   */
  function getAllQuickLocations() {
    const home = getHomeLocation();
    const saved = getSavedPlaces();
    return {
      home,
      savedPlaces: saved,
      all: home ? [home, ...saved] : [...saved],
    };
  }

  return {
    getProfiles,
    saveProfiles,
    getActiveProfileId,
    setActiveProfile,
    getActiveProfile,
    upsertProfile,
    getHomeLocation,
    setHomeLocation,
    getSavedPlaces,
    upsertSavedPlace,
    removeSavedPlace,
    getAllQuickLocations,
  };
})();
