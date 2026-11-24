/**
 * route-engine.js
 * ROUTE TACTICS v5-yahoo Google Routes API (JP_ETC対応) + TomTom API 統合ルート試算エンジン
 * - 経由地が指定されたときのみ「ミックス」ルートを計算（未指定時は全高速・全下道の2ルート比較）
 */
const RouteEngine = (() => {
  const { API_ENDPOINTS, DEFAULT_VEHICLE_SETTINGS, REQUEST_TIMEOUT_MS } = RouteTacticsConfig;

  async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (_) {
        json = null;
      }
      if (!response.ok) {
        const detail =
          (json && json.error && json.error.message) ||
          (json && json.detailedError && json.detailedError.message) ||
          text.slice(0, 200) ||
          `HTTP ${response.status}`;
        throw new Error(detail);
      }
      return json;
    } finally {
      clearTimeout(timerId);
    }
  }

  function decodePolyline(encoded) {
    if (!encoded || typeof encoded !== 'string') return [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lon = 0;
    const coords = [];

    while (index < len) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlon = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
      lon += dlon;

      coords.push({
        lat: Number((lat * 1e-5).toFixed(6)),
        lon: Number((lon * 1e-5).toFixed(6)),
      });
    }
    return coords;
  }

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function extractGoogleTollYen(routeObj, discountRate = 0) {
    let rawToll = 0;
    const travelAdvisory = routeObj && routeObj.travelAdvisory;
    const tollInfo = travelAdvisory && travelAdvisory.tollInfo;
    const estimatedPrices =
      tollInfo && Array.isArray(tollInfo.estimatedPrice) ? tollInfo.estimatedPrice : [];

    estimatedPrices.forEach((money) => {
      if (!money) return;
      const units = Number(money.units || 0);
      const nanos = Number(money.nanos || 0) / 1e9;
      rawToll += units + nanos;
    });

    const rate = Math.min(0.9, Math.max(0, Number(discountRate) || 0));
    return Math.round(rawToll * (1 - rate));
  }

  async function fetchGoogleRoute({
    apiKey,
    origin,
    destination,
    waypoints = [],
    avoidTolls = false,
    departureTimeIso = null,
    etcDiscountRate = 0,
  }) {
    if (!apiKey) {
      throw new Error('Google Maps APIキーが未設定です');
    }

    const body = {
      origin: {
        location: { latLng: { latitude: Number(origin.lat), longitude: Number(origin.lon) } },
      },
      destination: {
        location: {
          latLng: { latitude: Number(destination.lat), longitude: Number(destination.lon) },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      extraComputations: ['TOLLS'],
      computeAlternativeRoutes: false,
      languageCode: 'ja-JP',
      units: 'METRIC',
      routeModifiers: {
        avoidTolls: Boolean(avoidTolls),
        avoidHighways: false,
        avoidFerries: false,
        vehicleInfo: {
          emissionType: 'GASOLINE',
        },
        tollPasses: avoidTolls ? [] : ['JP_ETC'],
      },
    };

    if (departureTimeIso) {
      const depMs = Date.parse(departureTimeIso);
      if (!Number.isNaN(depMs) && depMs > Date.now() + 10000) {
        body.departureTime = new Date(depMs).toISOString();
      }
    }

    if (Array.isArray(waypoints) && waypoints.length > 0) {
      body.intermediates = waypoints.map((wp) => ({
        location: { latLng: { latitude: Number(wp.lat), longitude: Number(wp.lon) } },
      }));
    }

    const url = `${API_ENDPOINTS.GOOGLE_ROUTES}?key=${encodeURIComponent(apiKey)}`;
    const data = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo',
      },
      body: JSON.stringify(body),
    });

    const route = data && Array.isArray(data.routes) && data.routes[0];
    if (!route) {
      throw new Error('Google Routes API からルートを取得できませんでした');
    }

    const distanceMeters = Number(route.distanceMeters || 0);
    const durationSec = parseInt(String(route.duration || '0s').replace('s', ''), 10) || 0;
    const encodedPolyline =
      route.polyline && route.polyline.encodedPolyline ? route.polyline.encodedPolyline : '';
    const path = decodePolyline(encodedPolyline);
    const tollYen = avoidTolls ? 0 : extractGoogleTollYen(route, etcDiscountRate);

    return {
      source: 'google',
      distanceKm: Number((distanceMeters / 1000).toFixed(2)),
      durationSeconds: durationSec,
      tollYen,
      encodedPolyline,
      path,
    };
  }

  async function fetchTomTomRouteCrossCheck({
    apiKey,
    origin,
    destination,
    waypoints = [],
    avoidTolls = false,
    departureTimeIso = null,
  }) {
    if (!apiKey) {
      return null;
    }

    const points = [origin, ...(Array.isArray(waypoints) ? waypoints : []), destination]
      .map((pt) => `${Number(pt.lat).toFixed(6)},${Number(pt.lon).toFixed(6)}`)
      .join(':');

    const encodedPoints = encodeURIComponent(points);
    const params = new URLSearchParams({
      key: apiKey,
      traffic: 'true',
      computeTravelTimeFor: 'all',
      sectionType: 'toll',
    });

    if (avoidTolls) {
      params.set('avoid', 'tollRoads');
    }

    if (departureTimeIso) {
      const depMs = Date.parse(departureTimeIso);
      if (!Number.isNaN(depMs) && depMs > Date.now() + 10000) {
        params.set('departAt', new Date(depMs).toISOString());
      }
    }

    const url = `${API_ENDPOINTS.TOMTOM_ROUTE}/${encodedPoints}/json?${params.toString()}`;
    const data = await fetchWithTimeout(url, { method: 'GET' });

    const summary = data && Array.isArray(data.routes) && data.routes[0] && data.routes[0].summary;
    if (!summary) {
      return null;
    }

    return {
      source: 'tomtom',
      distanceKm: Number(((Number(summary.lengthInMeters) || 0) / 1000).toFixed(2)),
      durationSeconds: Number(summary.travelTimeInSeconds) || 0,
      trafficDelaySeconds: Number(summary.trafficDelayInSeconds) || 0,
    };
  }

  async function fetchTomTomIncidentsAlongPath({ apiKey, path = [] }) {
    if (!apiKey || !Array.isArray(path) || path.length === 0) {
      return { count: 0, incidents: [] };
    }

    let minLat = 90;
    let maxLat = -90;
    let minLon = 180;
    let maxLon = -180;

    path.forEach((pt) => {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lon < minLon) minLon = pt.lon;
      if (pt.lon > maxLon) maxLon = pt.lon;
    });

    const pad = 0.05;
    const bbox = `${(minLon - pad).toFixed(5)},${(minLat - pad).toFixed(5)},${(
      maxLon + pad
    ).toFixed(5)},${(maxLat + pad).toFixed(5)}`;

    const params = new URLSearchParams({
      key: apiKey,
      bbox,
      fields:
        '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},from,to,roadNumbers}}}',
      language: 'ja-JP',
    });

    const url = `${API_ENDPOINTS.TOMTOM_INCIDENTS}?${params.toString()}`;
    const data = await fetchWithTimeout(url, { method: 'GET' });
    const rawList = data && Array.isArray(data.incidents) ? data.incidents : [];

    const incidents = rawList.slice(0, 15).map((item) => {
      const props = item.properties || {};
      const firstEvent = Array.isArray(props.events) && props.events[0] ? props.events[0] : {};
      const coords =
        item.geometry && Array.isArray(item.geometry.coordinates)
          ? item.geometry.coordinates
          : null;
      let ptLat = null;
      let ptLon = null;
      if (Array.isArray(coords)) {
        const flatPt = Array.isArray(coords[0]) ? coords[0] : coords;
        if (typeof flatPt[1] === 'number' && typeof flatPt[0] === 'number') {
          ptLat = flatPt[1];
          ptLon = flatPt[0];
        }
      }

      return {
        id: props.id || '',
        description: firstEvent.description || '交通規制・情報あり',
        roadNumbers: Array.isArray(props.roadNumbers) ? props.roadNumbers : [],
        from: props.from || '',
        to: props.to || '',
        delaySeconds: Number(props.magnitudeOfDelay) || 0,
        lat: ptLat,
        lon: ptLon,
      };
    });

    return {
      count: rawList.length,
      incidents,
    };
  }

  function calculateCosts({
    distanceKm,
    tollYen,
    fuelEfficiencyKmPerL,
    fuelPriceYenPerL,
    referenceFuelPriceYenPerL = DEFAULT_VEHICLE_SETTINGS.referenceFuelPriceYenPerL,
  }) {
    const safeEff = Math.max(
      0.1,
      Number(fuelEfficiencyKmPerL) || DEFAULT_VEHICLE_SETTINGS.fuelEfficiencyKmPerL
    );
    const safePrice = Math.max(
      0,
      Number(fuelPriceYenPerL) || DEFAULT_VEHICLE_SETTINGS.fuelPriceYenPerL
    );
    const safeRefPrice = Math.max(0, Number(referenceFuelPriceYenPerL) || safePrice);
    const safeDist = Math.max(0, Number(distanceKm) || 0);
    const safeToll = Math.max(0, Math.round(Number(tollYen) || 0));

    const litersUsed = safeDist / safeEff;
    const fuelCostYen = Math.round(litersUsed * safePrice);
    const referenceFuelCostYen = Math.round(litersUsed * safeRefPrice);
    const fuelPriceDiffYen = fuelCostYen - referenceFuelCostYen;
    const totalCostYen = safeToll + fuelCostYen;

    return {
      litersUsed: Number(litersUsed.toFixed(2)),
      fuelCostYen,
      referenceFuelCostYen,
      fuelPriceDiffYen,
      tollYen: safeToll,
      totalCostYen,
    };
  }

  function attachTimeCostPerformance(candidates) {
    const baseline =
      candidates.find((c) => c.strategy === 'local') || candidates[candidates.length - 1];
    if (!baseline) return candidates;

    return candidates.map((item) => {
      const savedSeconds = baseline.durationSeconds - item.durationSeconds;
      const savedMinutes = Math.round(savedSeconds / 60);
      const extraCostYen = item.cost.totalCostYen - baseline.cost.totalCostYen;

      let costPerHourSavedYen = null;
      let costPerMinuteSavedYen = null;
      let timeCospaSummary = '基準ルート';

      if (item.strategy === baseline.strategy) {
        timeCospaSummary = '比較基準（下道）';
      } else if (savedSeconds > 60 && extraCostYen <= 0) {
        costPerHourSavedYen = 0;
        costPerMinuteSavedYen = 0;
        timeCospaSummary = `${savedMinutes}分短縮 ＆ ${Math.abs(extraCostYen).toLocaleString()}円お得`;
      } else if (savedSeconds > 60 && extraCostYen > 0) {
        const savedHours = savedSeconds / 3600;
        costPerHourSavedYen = Math.round(extraCostYen / savedHours);
        costPerMinuteSavedYen = Math.round(extraCostYen / (savedSeconds / 60));
        timeCospaSummary = `${savedMinutes}分短縮 / +${extraCostYen.toLocaleString()}円（約${costPerHourSavedYen.toLocaleString()}円/h）`;
      } else if (savedSeconds <= 0 && extraCostYen > 0) {
        timeCospaSummary = `短縮効果なし / +${extraCostYen.toLocaleString()}円`;
      } else {
        timeCospaSummary = `所要差 ${savedMinutes}分 / ${extraCostYen.toLocaleString()}円`;
      }

      return {
        ...item,
        timeCospa: {
          baselineStrategy: baseline.strategy,
          savedSeconds,
          savedMinutes,
          extraCostYen,
          costPerHourSavedYen,
          costPerMinuteSavedYen,
          summary: timeCospaSummary,
        },
      };
    });
  }

  async function evaluateSingleStrategy({
    strategy,
    label,
    origin,
    destination,
    waypoints = [],
    avoidTolls = false,
    apiKeys,
    vehicle,
    departureTimeIso,
    includeIncidents = true,
  }) {
    const googleRes = await fetchGoogleRoute({
      apiKey: apiKeys.googleMapsKey,
      origin,
      destination,
      waypoints,
      avoidTolls,
      departureTimeIso,
      etcDiscountRate: vehicle.etcDiscountRate,
    });

    let tomtomCrossCheck = null;
    if (apiKeys.tomtomKey) {
      try {
        tomtomCrossCheck = await fetchTomTomRouteCrossCheck({
          apiKey: apiKeys.tomtomKey,
          origin,
          destination,
          waypoints,
          avoidTolls,
          departureTimeIso,
        });
      } catch (err) {
        console.warn(`[RouteEngine:${strategy}] TomTom クロスチェック失敗:`, err.message);
      }
    }

    let incidentsInfo = { count: 0, incidents: [] };
    if (apiKeys.tomtomKey && includeIncidents && googleRes.path.length > 0) {
      try {
        incidentsInfo = await fetchTomTomIncidentsAlongPath({
          apiKey: apiKeys.tomtomKey,
          path: googleRes.path,
        });
      } catch (err) {
        console.warn(`[RouteEngine:${strategy}] TomTom 規制情報取得失敗:`, err.message);
      }
    }

    const googleDurationSec = googleRes.durationSeconds;
    const tomtomDurationSec = tomtomCrossCheck ? tomtomCrossCheck.durationSeconds : null;
    const diffSeconds =
      typeof tomtomDurationSec === 'number' ? tomtomDurationSec - googleDurationSec : null;

    const effectiveDurationSeconds =
      typeof tomtomDurationSec === 'number' && tomtomDurationSec > 0
        ? Math.max(googleDurationSec, tomtomDurationSec)
        : googleDurationSec;

    const effectiveDistanceKm = googleRes.distanceKm;

    const cost = calculateCosts({
      distanceKm: effectiveDistanceKm,
      tollYen: googleRes.tollYen,
      fuelEfficiencyKmPerL: vehicle.fuelEfficiencyKmPerL,
      fuelPriceYenPerL: vehicle.fuelPriceYenPerL,
      referenceFuelPriceYenPerL: vehicle.referenceFuelPriceYenPerL,
    });

    return {
      strategy,
      label,
      origin: { lat: Number(origin.lat), lon: Number(origin.lon), name: origin.name || '出発地' },
      destination: {
        lat: Number(destination.lat),
        lon: Number(destination.lon),
        name: destination.name || '目的地',
      },
      waypoints,
      distanceKm: effectiveDistanceKm,
      durationSeconds: effectiveDurationSeconds,
      googleDurationSeconds: googleDurationSec,
      tomtomDurationSeconds: tomtomDurationSec,
      durationDiffSeconds: diffSeconds,
      trafficDelaySeconds: tomtomCrossCheck ? tomtomCrossCheck.trafficDelaySeconds : 0,
      incidents: incidentsInfo,
      encodedPolyline: googleRes.encodedPolyline,
      path: googleRes.path,
      cost,
    };
  }

  /**
   * ルート比較試算
   * - customMixWaypoints が1件以上ある場合のみ「ミックス」を算出（全高速・ミックス・全下道の3ルート）
   * - customMixWaypoints が空の場合は「全高速」「全下道」の2ルート比較を返す
   */
  async function compareRouteStrategies({
    origin,
    destination,
    customMixWaypoints = [],
    vehicle = DEFAULT_VEHICLE_SETTINGS,
    departureTime = null,
    apiKeys = RouteTacticsConfig.getApiKeys(),
  }) {
    const depDate = departureTime ? new Date(departureTime) : null;
    const departureTimeIso =
      depDate && !Number.isNaN(depDate.getTime()) ? depDate.toISOString() : null;
    const directDistanceKm = haversineKm(origin, destination);

    const highwayRoute = await evaluateSingleStrategy({
      strategy: 'highway',
      label: '全高速',
      origin,
      destination,
      waypoints: [],
      avoidTolls: false,
      apiKeys,
      vehicle,
      departureTimeIso,
      includeIncidents: true,
    });

    const localRoute = await evaluateSingleStrategy({
      strategy: 'local',
      label: '全下道',
      origin,
      destination,
      waypoints: [],
      avoidTolls: true,
      apiKeys,
      vehicle,
      departureTimeIso,
      includeIncidents: true,
    });

    const mixWaypoints = Array.isArray(customMixWaypoints)
      ? customMixWaypoints.slice(0, 3)
      : [];

    let mixRoute = null;
    if (mixWaypoints.length > 0) {
      mixRoute = await evaluateSingleStrategy({
        strategy: 'mix',
        label: 'ミックス（経由地指定）',
        origin,
        destination,
        waypoints: mixWaypoints,
        avoidTolls: false,
        apiKeys,
        vehicle,
        departureTimeIso,
        includeIncidents: false,
      });
    }

    const rawCandidates = [highwayRoute, ...(mixRoute ? [mixRoute] : []), localRoute];
    const routes = attachTimeCostPerformance(rawCandidates);

    return {
      calculatedAt: new Date().toISOString(),
      directDistanceKm: Number(directDistanceKm.toFixed(2)),
      departureTimeIso,
      routes,
      byStrategy: {
        highway: routes.find((r) => r.strategy === 'highway') || null,
        mix: routes.find((r) => r.strategy === 'mix') || null,
        local: routes.find((r) => r.strategy === 'local') || null,
      },
    };
  }

  return {
    decodePolyline,
    haversineKm,
    calculateCosts,
    attachTimeCostPerformance,
    fetchGoogleRoute,
    fetchTomTomRouteCrossCheck,
    fetchTomTomIncidentsAlongPath,
    compareRouteStrategies,
  };
})();
