

// ===== HERE Geocoding & Routing API v8 統合モジュール (V5) =====
(function (global) {
  const HERE_GEOCODE_ENDPOINT = 'https://geocode.search.hereapi.com/v1/geocode';
  const HERE_ROUTING_ENDPOINT = 'https://router.hereapi.com/v8/routes';

  function parseCoords(text) {
    if (!text) return null;
    const match = String(text).match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (match) {
      return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    }
    return null;
  }

  async function geocodeWithHere(queryText, apiKey) {
    const coords = parseCoords(queryText);
    if (coords) return coords;
    if (!apiKey) throw new Error('HERE APIキーが設定されていません');

    const url = `${HERE_GEOCODE_ENDPOINT}?q=${encodeURIComponent(queryText)}&in=countryCode:JPN&lang=ja&limit=1&apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.items || data.items.length === 0) {
      throw new Error(`場所を特定できませんでした: ${queryText}`);
    }
    return {
      lat: data.items[0].position.lat,
      lng: data.items[0].position.lng,
      title: data.items[0].title
    };
  }

  /**
   * HERE Routing API v8 でルートと標準ETC料金を取得
   */
  async function fetchHereRoute(originText, destText, options) {
    const opts = options || {};
    const apiKey = opts.apiKey;
    if (!apiKey) throw new Error('HERE APIキーが設定されていません');

    const avoidTolls = Boolean(opts.avoidTolls);
    const vehicleClass = opts.vehicleClass || 'standard';
    const timeMode = opts.timeMode || 'departure';
    const targetDate = opts.targetDate instanceof Date ? opts.targetDate : null;

    const [origPos, destPos] = await Promise.all([
      geocodeWithHere(originText, apiKey),
      geocodeWithHere(destText, apiKey)
    ]);

    const vehSpec = (typeof getRulesState === 'function' && getRulesState().rules?.vehicleClasses?.[vehicleClass]) || { hereMode: 'car' };
    const transportMode = vehSpec.hereMode || 'car';

    const params = new URLSearchParams();
    params.set('origin', `${origPos.lat},${origPos.lng}`);
    params.set('destination', `${destPos.lat},${destPos.lng}`);
    params.set('transportMode', transportMode);
    params.set('currency', 'JPY');
    params.set('lang', 'ja-JP');
    params.set('spans', 'carAttributes,names,routeNumbers,length,duration');

    if (transportMode === 'truck') {
      if (vehSpec.axleCount) params.set('vehicle[axleCount]', String(vehSpec.axleCount));
      if (vehSpec.grossWeight) params.set('vehicle[grossWeight]', String(vehSpec.grossWeight));
    }

    if (avoidTolls) {
      params.set('avoid[features]', 'tollRoad');
      params.set('avoid[tollTransponders]', 'all');
      params.set('return', 'summary,travelSummary,polyline,actions,instructions');
    } else {
      params.set('tolls[transponders]', 'all');
      params.set('return', 'summary,travelSummary,tolls,polyline,actions,instructions');
    }

    if (targetDate) {
      const iso = targetDate.toISOString();
      if (timeMode === 'arrival') {
        params.set('arrivalTime', iso);
      } else {
        params.set('departureTime', iso);
      }
    }

    const url = `${HERE_ROUTING_ENDPOINT}?${params.toString()}&apiKey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || !data.routes || data.routes.length === 0) {
      const msg = data?.title || data?.error_description || 'ルートが見つかりませんでした';
      throw new Error(msg);
    }

    const route = data.routes[0];
    return {
      route,
      origPos,
      destPos
    };
  }

  /**
   * HERE Routing v8 の tolls レスポンスから標準ETC料金を集計
   * （複数セクションにまたがる同一 fares[].id の重複計上を防止）
   */
  function extractHereTolls(route, avoidTolls) {
    if (avoidTolls || !route || !Array.isArray(route.sections)) {
      return { totalJpy: 0, systemBreakdown: [], sourceLabel: '一般道優先（有料道路回避）' };
    }

    const seenFareIds = new Set();
    const systemMap = new Map();
    let totalJpy = 0;

    for (const sec of route.sections) {
      const tolls = sec.tolls || [];
      for (const toll of tolls) {
        const sysName = toll.tollSystem || '日本高速道路';
        const fares = toll.fares || [];

        // 1つの tollSystem 内で ETC(transponder) 優先、なければ現金料金を参照
        const etcFares = fares.filter(f => Array.isArray(f.paymentMethods) && f.paymentMethods.includes('transponder'));
        const targetFares = etcFares.length > 0 ? etcFares : fares;

        for (const fare of targetFares) {
          if (fare.id && seenFareIds.has(fare.id)) continue;
          if (fare.id) seenFareIds.add(fare.id);

          const priceObj = (fare.convertedPrice && fare.convertedPrice.currency === 'JPY')
            ? fare.convertedPrice
            : fare.price;

          if (!priceObj || priceObj.currency !== 'JPY') continue;
          const val = Math.round(Number(priceObj.value) || 0);
          if (val <= 0) continue;

          totalJpy += val;
          systemMap.set(sysName, (systemMap.get(sysName) || 0) + val);
        }
      }
    }

    const systemBreakdown = Array.from(systemMap.entries()).map(([system, toll]) => ({ system, toll }));
    const sourceLabel = totalJpy > 0
      ? '根拠: HERE Routing API v8（ETC標準料金）'
      : '根拠: HERE Routing API v8（有料区間なし）';

    return {
      totalJpy,
      systemBreakdown,
      sourceLabel
    };
  }

  function aggregateHereRouteStats(route) {
    let lengthM = 0;
    let durationSec = 0;
    const polylines = [];

    for (const sec of (route.sections || [])) {
      const sum = sec.summary || sec.travelSummary || {};
      lengthM += sum.length || 0;
      durationSec += sum.duration || 0;
      if (sec.polyline) polylines.push(sec.polyline);
    }

    return { lengthM, durationSec, polylines };
  }

  const exported = {
    geocodeWithHere,
    fetchHereRoute,
    extractHereTolls,
    aggregateHereRouteStats
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
  Object.assign(global, exported);
})(typeof window !== 'undefined' ? window : globalThis);
1 / 2 ページ
