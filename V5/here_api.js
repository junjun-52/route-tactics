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

  function buildDepartureTimeParam(baseDt, mode, durationSec) {
    if (!baseDt) return null;
    let targetDate = new Date(baseDt.getTime());
    if (mode === 'arrival' && durationSec) {
      targetDate = new Date(baseDt.getTime() - durationSec * 1000);
    }
    return targetDate.toISOString();
  }

  async function fetchHereRoute(originText, destText, options) {
    const opts = options || {};
    const apiKey = opts.apiKey;
    if (!apiKey) throw new Error('HERE APIキーが設定されていません');

    const avoidTolls = Boolean(opts.avoidTolls);
    const baseDt = opts.baseDt || new Date();
    const mode = opts.mode || 'departure';

    const origin = await geocodeWithHere(originText, apiKey);
    const dest = await geocodeWithHere(destText, apiKey);

    const params = new URLSearchParams({
      transportMode: 'car',
      origin: `${origin.lat},${origin.lng}`,
      destination: `${dest.lat},${dest.lng}`,
      return: 'summary,tolls,polyline,actions,instructions',
      lang: 'ja-JP',
      apiKey: apiKey
    });

    if (avoidTolls) {
      params.set('avoid[features]', 'tollRoad');
    }

    const depTime = buildDepartureTimeParam(baseDt, mode, 0);
    if (depTime) {
      params.set('departureTime', depTime);
    }

    const url = `${HERE_ROUTING_ENDPOINT}?${params.toString()}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || !data.routes || data.routes.length === 0) {
      const msg = data.title || data.error_description || `HEREルート取得エラー (${res.status})`;
      throw new Error(msg);
    }

    const route = data.routes[0];
    const sections = route.sections || [];
    let totalDistanceMeters = 0;
    let totalDurationSec = 0;
    let totalToll = 0;
    const seenFareIds = new Set();
    const allCoords = [];
    const actions = [];

    sections.forEach((sec) => {
      if (sec.summary) {
        totalDistanceMeters += sec.summary.length || 0;
        totalDurationSec += sec.summary.duration || 0;
      }

      if (sec.tolls && Array.isArray(sec.tolls)) {
        sec.tolls.forEach((tollItem) => {
          const fares = tollItem.fares || [];
          fares.forEach((fare) => {
            if (fare.id && seenFareIds.has(fare.id)) return;
            if (fare.id) seenFareIds.add(fare.id);

            const price = fare.price || {};
            const val = Number(price.value);
            if (!Number.isNaN(val)) {
              totalToll += val;
            }
          });
        });
      }

      if (sec.polyline && typeof global.decodeFlexiblePolyline === 'function') {
        const decoded = global.decodeFlexiblePolyline(sec.polyline);
        decoded.forEach((pt) => {
          allCoords.push([pt.lat, pt.lng]);
        });
      }

      if (sec.actions && Array.isArray(sec.actions)) {
        sec.actions.forEach((act) => {
          actions.push({
            instruction: act.instruction || '',
            offset: act.offset || 0
          });
        });
      }
    });

    return {
      distanceKm: totalDistanceMeters / 1000,
      durationSec: totalDurationSec,
      toll: Math.round(totalToll),
      coords: allCoords,
      actions: actions,
      originResolved: origin,
      destResolved: dest
    };
  }

  global.hereApi = {
    geocodeWithHere,
    fetchHereRoute
  };
})(typeof window !== 'undefined' ? window : globalThis);
