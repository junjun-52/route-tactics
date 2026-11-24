// ===== メイン制御・ルート検索・共通経由/ミックス専用経由分離・Yahoo!カーナビ連携 (v5-yahoo) =====
const API_KEY = "AIzaSyA-4TpNpWbRZMvQKvm2oP2KPi50KIvdvSA";
const TOMTOM_KEY_STORAGE = "route_tactics_tomtom_api_key_v1";
const MAX_COMMON_WAYPOINTS = 3; // 全ルート共通経由地（最大3ヶ所）
const MAX_WAYPOINTS = 5;        // ミックス専用経由地（最大5ヶ所）

let currentOrigin = "";
let currentDest = "";
let currentCommonWaypoints = []; // { name, coord }
let currentMixLegs = [];         // { from, to, avoidTolls, startCoord, endCoord }
let currentRouteCoords = {
  origin: null,
  dest: null,
};

let currentMapInstance = null;
let currentTrafficLayer = null;
let isTrafficLayerOn = true;

// ① 全ルート共通経由地
let commonWaypoints = []; // string[]

// ② ミックス専用経由地
let waypoints = []; // { name: "", modeAfter: "local" | "highway" }
let firstSegmentMode = "highway";

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== Yahoo!カーナビ (yjcarnavi://) URL生成＆起動ヘルパー =====
function buildYahooNaviUrl({ destCoord, destName, viaList = [] }) {
  if (!destCoord || typeof destCoord.latitude !== 'number' || typeof destCoord.longitude !== 'number') {
    return null;
  }
  const params = [
    `lat=${destCoord.latitude.toFixed(6)}`,
    `lon=${destCoord.longitude.toFixed(6)}`,
    `name=${encodeURIComponent(destName || '目的地')}`,
  ];

  const validVias = (viaList || [])
    .filter(v => v && v.coord && typeof v.coord.latitude === 'number' && typeof v.coord.longitude === 'number')
    .slice(0, 3);

  validVias.forEach((v, idx) => {
    const num = idx + 1;
    params.push(`via${num}_lat=${v.coord.latitude.toFixed(6)}`);
    params.push(`via${num}_lon=${v.coord.longitude.toFixed(6)}`);
    params.push(`via${num}_name=${encodeURIComponent(v.name || `経由地${num}`)}`);
  });

  return `yjcarnavi://navi/select?${params.join('&')}`;
}

function showYjToast(yahooUrl, fallbackGmapUrl, isDesktop) {
  const toast = document.getElementById('yjToast');
  const titleEl = document.getElementById('yjToastTitle');
  const urlEl = document.getElementById('yjToastUrl');
  const copyBtn = document.getElementById('btnCopyYjUrl');
  const gmapLink = document.getElementById('linkFallbackGmap');

  if (!toast) return;
  titleEl.innerText = isDesktop
    ? 'PCブラウザからはYahoo!カーナビを直接起動できません。URLをコピーするかスマホ・Googleマップをご利用ください。'
    : 'Yahoo!カーナビが起動しない場合は、アプリ未インストールか制限中の可能性があります。URLコピーまたはGoogleマップをご利用ください。';
  urlEl.innerText = yahooUrl;
  gmapLink.href = fallbackGmapUrl || 'https://www.google.com/maps';

  copyBtn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(yahooUrl);
      copyBtn.innerText = 'コピー完了 ✅';
      setTimeout(() => { copyBtn.innerText = 'URLコピー'; }, 2000);
    } catch (_) {
      copyBtn.innerText = 'コピー失敗';
    }
  };

  toast.style.display = 'block';
}

function closeYjToast() {
  const toast = document.getElementById('yjToast');
  if (toast) toast.style.display = 'none';
}

function launchYahooNavi(yahooUrl, fallbackGmapUrl) {
  if (!yahooUrl) {
    alert('目的地の座標が取得できていません。先にルート比較を実行してください。');
    return;
  }

  const ua = navigator.userAgent || '';
  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua);

  if (!isMobile) {
    showYjToast(yahooUrl, fallbackGmapUrl, true);
    return;
  }

  let appOpened = false;
  const onVisibilityChange = () => {
    if (document.hidden) appOpened = true;
  };
  document.addEventListener('visibilitychange', onVisibilityChange, { once: true });

  window.location.href = yahooUrl;

  setTimeout(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (!appOpened && !document.hidden) {
      showYjToast(yahooUrl, fallbackGmapUrl, false);
    }
  }, 1600);
}

function buildGoogleMapsDirUrl({ originText, destText, waypointTexts = [], avoidTolls = false }) {
  const origParam = formatForGoogleMapsUrl(originText);
  const destParam = formatForGoogleMapsUrl(destText);
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
  if (avoidTolls) url += `&avoid=tolls`;
  if (waypointTexts.length > 0) {
    url += `&waypoints=${encodeURIComponent(waypointTexts.map(w => formatForGoogleMapsUrl(w)).join('|'))}`;
  }
  return url;
}

function openYahooNaviNormal(avoidTolls) {
  const viaList = currentCommonWaypoints.map(cw => ({
    coord: cw.coord,
    name: formatDisplayOrigin(cw.name),
  }));

  const yahooUrl = buildYahooNaviUrl({
    destCoord: currentRouteCoords.dest,
    destName: formatDisplayOrigin(currentDest),
    viaList,
  });

  const gmapUrl = buildGoogleMapsDirUrl({
    originText: currentOrigin,
    destText: currentDest,
    waypointTexts: currentCommonWaypoints.map(cw => cw.name),
    avoidTolls,
  });

  launchYahooNavi(yahooUrl, gmapUrl);
}

function openYahooNaviMixAll() {
  const viaList = currentMixLegs
    .slice(0, currentMixLegs.length - 1)
    .map(leg => ({
      coord: leg.endCoord,
      name: formatDisplayOrigin(leg.to),
    }));

  const yahooUrl = buildYahooNaviUrl({
    destCoord: currentRouteCoords.dest,
    destName: formatDisplayOrigin(currentDest),
    viaList,
  });

  const allWpTexts = [
    ...currentCommonWaypoints.map(cw => cw.name),
    ...waypoints.map(w => w.name.trim()).filter(Boolean),
  ];

  const gmapUrl = buildGoogleMapsDirUrl({
    originText: currentOrigin,
    destText: currentDest,
    waypointTexts: allWpTexts,
    avoidTolls: false,
  });

  launchYahooNavi(yahooUrl, gmapUrl);
}

function openYahooNaviLeg(legIndex) {
  const leg = currentMixLegs[legIndex];
  if (!leg) return;

  const yahooUrl = buildYahooNaviUrl({
    destCoord: leg.endCoord,
    destName: formatDisplayOrigin(leg.to),
    viaList: [],
  });

  const gmapUrl = buildGoogleMapsDirUrl({
    originText: leg.from,
    destText: leg.to,
    avoidTolls: leg.avoidTolls,
  });

  launchYahooNavi(yahooUrl, gmapUrl);
}

// ===== TomTom APIキー管理 =====
function getTomtomApiKey() {
  return (localStorage.getItem(TOMTOM_KEY_STORAGE) || "").trim();
}

function toggleTomtomEditor() {
  const el = document.getElementById('tomtomEditor');
  el.style.display = (el.style.display === 'block') ? 'none' : 'block';
}

function updateTomtomButtonStatus() {
  const btn = document.getElementById('btnToggleTomtom');
  if (!btn) return;
  const hasKey = getTomtomApiKey().length > 0;
  btn.innerText = hasKey
    ? '🚦 渋滞精度向上（TomTom API連携：有効 ✅）'
    : '🚦 渋滞精度向上（TomTom APIキーを設定する）';
}

function saveAllSettingsV41() {
  const ttInput = document.getElementById('tomtomApiKeyInput');
  if (ttInput) {
    const val = ttInput.value.trim();
    if (val) {
      localStorage.setItem(TOMTOM_KEY_STORAGE, val);
    } else {
      localStorage.removeItem(TOMTOM_KEY_STORAGE);
    }
  }
  updateTomtomButtonStatus();
  updateSourceBadge();

  if (typeof saveUserSettings === 'function') {
    saveUserSettings();
  } else {
    const st = document.getElementById('saveStatus');
    if (st) {
      st.innerText = '設定を保存しました';
      setTimeout(() => { st.innerText = ''; }, 2500);
    }
  }
}

// ===== ① 共通経由地（全ルートに反映：MAX 3ヶ所）UI管理 =====
function addCommonWaypoint() {
  if (commonWaypoints.length >= MAX_COMMON_WAYPOINTS) return;
  commonWaypoints.push("");
  renderCommonWaypoints();
}

function removeCommonWaypoint(idx) {
  commonWaypoints.splice(idx, 1);
  renderCommonWaypoints();
}

function updateCommonWaypointName(idx, val) {
  commonWaypoints[idx] = val;
}

function renderCommonWaypoints() {
  const container = document.getElementById('commonWaypointsContainer');
  const addBtn = document.getElementById('btnAddCommonWaypoint');
  if (!container || !addBtn) return;

  container.innerHTML = '';
  commonWaypoints.forEach((wpName, idx) => {
    const box = document.createElement('div');
    box.className = 'common-wp-box';
    box.innerHTML = `
      <div class="common-wp-head">
        <label>📍 共通経由地 ${idx + 1}（全高速・ミックス・全下道すべて通過）</label>
        <button type="button" class="btn-remove-wp" onclick="removeCommonWaypoint(${idx})">✕ 削除</button>
      </div>
      <input type="text" style="margin-bottom:0;" value="${escapeHtml(wpName)}" placeholder="例：立ち寄り先・SA/PA・施設名など" oninput="updateCommonWaypointName(${idx}, this.value)">
    `;
    container.appendChild(box);
  });

  const remain = MAX_COMMON_WAYPOINTS - commonWaypoints.length;
  addBtn.disabled = remain <= 0;
  addBtn.innerText = remain > 0
    ? `＋ 共通経由地を追加（全ルートに反映・残り${remain}ヶ所）`
    : `共通経由地は最大${MAX_COMMON_WAYPOINTS}ヶ所までです`;
}

// ===== ② ミックス専用経由地（ミックスのみ反映：MAX 5ヶ所）UI管理 =====
function addWaypoint() {
  if (waypoints.length >= MAX_WAYPOINTS) return;
  waypoints.push({ name: "", modeAfter: "local" });
  renderWaypoints();
}

function removeWaypoint(idx) {
  waypoints.splice(idx, 1);
  renderWaypoints();
}

function updateWaypointName(idx, val) {
  waypoints[idx].name = val;
}

function updateWaypointMode(idx, val) {
  waypoints[idx].modeAfter = val;
}

function renderWaypoints() {
  const container = document.getElementById('waypointsContainer');
  const addBtn = document.getElementById('btnAddWaypoint');
  container.innerHTML = '';

  if (waypoints.length > 0) {
    const firstBox = document.createElement('div');
    firstBox.className = 'first-seg-box';
    firstBox.innerHTML = `
      <label style="color:var(--navy);">ミックス区間1：出発側 ➔ ミックス経由1 の走行モード</label>
      <select style="margin-bottom:0;" onchange="firstSegmentMode = this.value">
        <option value="highway" ${firstSegmentMode === 'highway' ? 'selected' : ''}>【高速】を利用</option>
        <option value="local" ${firstSegmentMode === 'local' ? 'selected' : ''}>【下道】のみ</option>
      </select>
    `;
    container.appendChild(firstBox);
  }

  waypoints.forEach((wp, idx) => {
    const nextLabel = (idx === waypoints.length - 1) ? '目的地' : `ミックス経由${idx + 2}`;
    const box = document.createElement('div');
    box.className = 'waypoint-box';
    box.innerHTML = `
      <div class="waypoint-head">
        <label>🔀 ミックス経由 ${idx + 1} / 乗り降りするIC名（ミックスのみ）</label>
        <button type="button" class="btn-remove-wp" onclick="removeWaypoint(${idx})">✕ 削除</button>
      </div>
      <input type="text" value="${escapeHtml(wp.name)}" placeholder="例：乗り降りするIC名や切替地点を入力" oninput="updateWaypointName(${idx}, this.value)">
      <label style="color:var(--orange-dark);">ミックス区間${idx + 2}：ミックス経由${idx + 1} ➔ ${nextLabel} の走行モード</label>
      <select style="margin-bottom:0;" onchange="updateWaypointMode(${idx}, this.value)">
        <option value="highway" ${wp.modeAfter === 'highway' ? 'selected' : ''}>【高速】を利用</option>
        <option value="local" ${wp.modeAfter === 'local' ? 'selected' : ''}>【下道】のみ</option>
      </select>
    `;
    container.appendChild(box);
  });

  const remain = MAX_WAYPOINTS - waypoints.length;
  addBtn.disabled = remain <= 0;
  addBtn.innerText = remain > 0
    ? `＋ ミックス経由を追加（ミックスのみ反映・残り${remain}ヶ所）`
    : `ミックス経由は最大${MAX_WAYPOINTS}ヶ所までです`;
}

// ===== 位置情報・日時・座標ヘルパー =====
function setLocationToField(fieldId) {
  if (!navigator.geolocation) {
    alert("お使いのブラウザは位置情報に対応していません");
    return;
  }
  const btn = document.getElementById('btnCurrentLoc');
  const origText = btn ? btn.innerText : '📍 現在地';
  if (btn) btn.innerText = "⏳ 取得中...";

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      document.getElementById(fieldId).value = `📍現在地 (${lat}, ${lng})`;
      if (btn) {
        btn.innerText = "✅ 現在地セット";
        setTimeout(() => { btn.innerText = origText; }, 2000);
      }
    },
    () => {
      if (btn) btn.innerText = origText;
      alert("現在地を取得できませんでした。位置情報の許可を確認してください。");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

function parseCoordsFromText(text) {
  if (!text) return null;
  const match = text.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (match) {
    return { latitude: parseFloat(match[1]), longitude: parseFloat(match[2]) };
  }
  return null;
}

function buildWaypointPayload(text) {
  const coords = parseCoordsFromText(text);
  if (coords) return { location: { latLng: coords } };
  return { address: text };
}

function formatForGoogleMapsUrl(text) {
  const coords = parseCoordsFromText(text);
  if (coords) return `${coords.latitude},${coords.longitude}`;
  return text;
}

function formatDisplayOrigin(text) {
  return parseCoordsFromText(text) ? "現在地" : text;
}

function setNowDateTime() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('travelDate').value = `${y}-${m}-${d}`;
  document.getElementById('travelTime').value = `${hh}:${mm}`;
  updateSourceBadge();
}

function getSelectedDateTime() {
  const dateVal = document.getElementById('travelDate').value;
  const timeVal = document.getElementById('travelTime').value || "08:00";
  if (!dateVal) return new Date();
  const [y, m, d] = dateVal.split('-').map(Number);
  const [hh, mm] = timeVal.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0);
}

function updateSourceBadge() {
  const baseDt = getSelectedDateTime();
  const mode = document.getElementById('timeMode').value;
  const isFuture = baseDt.getTime() > Date.now() + 120000;
  const hasTomtom = getTomtomApiKey().length > 0;
  const badge = document.getElementById('sourceInfoBadge');

  const sourcePrefix = hasTomtom
    ? '渋滞・時間根拠: Google Routes API × TomTom API（2社クロスチェック＋事故・規制解析）'
    : '渋滞・時間根拠: Google Routes API（渋滞考慮＋区間別混雑度解析）';

  if (mode === 'departure' && isFuture) {
    badge.innerText = `${sourcePrefix}｜指定出発日時の通常・悲観予測を参照`;
  } else if (mode === 'arrival') {
    badge.innerText = `${sourcePrefix}｜現在条件の所要時間から出発時刻を逆算`;
  } else {
    badge.innerText = `${sourcePrefix}｜リアルタイム渋滞・ETC料金を直接参照`;
  }
}

// ===== Google Routes API（単体＆経由地一括取得対応） =====
async function fetchRoute(originText, destinationText, avoidTolls, departureDate, trafficModel = null, intermediateTexts = []) {
  try {
    const isFuture = departureDate && departureDate.getTime() > Date.now() + 120000;
    const useOptimal = isFuture && trafficModel;

    const payload = {
      origin: buildWaypointPayload(originText),
      destination: buildWaypointPayload(destinationText),
      travelMode: 'DRIVE',
      routingPreference: useOptimal ? 'TRAFFIC_AWARE_OPTIMAL' : 'TRAFFIC_AWARE',
      routeModifiers: avoidTolls
        ? { avoidTolls: true }
        : { avoidTolls: false, tollPasses: ['JP_ETC'] },
      extraComputations: avoidTolls
        ? ['TRAFFIC_ON_POLYLINE']
        : ['TOLLS', 'TRAFFIC_ON_POLYLINE'],
      languageCode: 'ja',
      regionCode: 'JP'
    };

    if (Array.isArray(intermediateTexts) && intermediateTexts.length > 0) {
      payload.intermediates = intermediateTexts.map(t => buildWaypointPayload(t));
    }

    if (isFuture) {
      payload.departureTime = departureDate.toISOString();
      if (useOptimal) {
        payload.trafficModel = trafficModel;
      }
    }

    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo,routes.travelAdvisory.speedReadingIntervals,routes.legs.duration,routes.legs.staticDuration,routes.legs.distanceMeters,routes.legs.polyline.encodedPolyline,routes.legs.startLocation,routes.legs.endLocation,routes.legs.steps.startLocation,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration'
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.routes || data.routes.length === 0) return null;
    return data.routes[0];
  } catch (e) {
    return null;
  }
}

// ===== TomTom Routing API =====
async function fetchTomtomRouteSec(latLngPoints, avoidTolls, departureDate) {
  const ttKey = getTomtomApiKey();
  if (!ttKey || !Array.isArray(latLngPoints) || latLngPoints.length < 2) return null;

  try {
    const locStr = latLngPoints
      .map(pt => `${pt.latitude.toFixed(6)},${pt.longitude.toFixed(6)}`)
      .join(':');

    const params = new URLSearchParams({
      key: ttKey,
      traffic: 'true',
      routeType: 'fastest',
      travelMode: 'car'
    });

    if (avoidTolls) {
      params.append('avoid', 'tollRoads');
    }

    if (departureDate && departureDate.getTime() > Date.now() + 120000) {
      params.append('departAt', departureDate.toISOString());
    }

    const url = `https://api.tomtom.com/routing/1/calculateRoute/${locStr}/json?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    if (!summary || typeof summary.travelTimeInSeconds !== 'number') return null;

    return {
      sec: summary.travelTimeInSeconds,
      delaySec: summary.trafficDelayInSeconds || 0
    };
  } catch (e) {
    return null;
  }
}

// ===== TomTom Traffic Incidents API v5 =====
function decodeEncodedPathSafe(encoded) {
  if (!encoded) return [];
  if (typeof google !== 'undefined' && google.maps?.geometry?.encoding) {
    return google.maps.geometry.encoding.decodePath(encoded).map(p => ({
      lat: p.lat(),
      lng: p.lng()
    }));
  }
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return coords;
}

function approxDistMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getTomtomIconLabel(cat) {
  const map = {
    1: { label: '事故', cls: 'inc-accident', emoji: '💥' },
    2: { label: '濃霧・視界不良', cls: 'inc-weather', emoji: '🌫️' },
    3: { label: '危険物・落下物', cls: 'inc-warn', emoji: '⚠️' },
    4: { label: '雨天・路面注意', cls: 'inc-weather', emoji: '🌧️' },
    5: { label: '凍結・積雪', cls: 'inc-weather', emoji: '❄️' },
    6: { label: '渋滞', cls: 'inc-jam', emoji: '🚗' },
    7: { label: '車線規制', cls: 'inc-work', emoji: '🚧' },
    8: { label: '通行止め', cls: 'inc-closed', emoji: '⛔' },
    9: { label: '道路工事', cls: 'inc-work', emoji: '🚧' },
    10: { label: '悪天候', cls: 'inc-weather', emoji: '⛈️' },
    11: { label: '故障車', cls: 'inc-warn', emoji: '🚙' },
    14: { label: '故障車', cls: 'inc-warn', emoji: '🚙' }
  };
  return map[cat] || { label: '交通規制', cls: 'inc-warn', emoji: '⚠️' };
}

async function fetchTomtomIncidentsAlongPolylines(encodedPolylines) {
  const ttKey = getTomtomApiKey();
  if (!ttKey || !Array.isArray(encodedPolylines) || encodedPolylines.length === 0) return [];

  try {
    const allPts = [];
    encodedPolylines.forEach(enc => {
      const pts = decodeEncodedPathSafe(enc);
      const step = Math.max(1, Math.floor(pts.length / 180));
      for (let i = 0; i < pts.length; i += step) {
        allPts.push(pts[i]);
      }
      if (pts.length > 0) allPts.push(pts[pts.length - 1]);
    });

    if (allPts.length === 0) return [];

    const chunkCount = Math.min(4, Math.max(1, Math.ceil(allPts.length / 60)));
    const chunkSize = Math.ceil(allPts.length / chunkCount);
    const bboxes = [];

    for (let c = 0; c < chunkCount; c++) {
      const slice = allPts.slice(c * chunkSize, (c + 1) * chunkSize);
      if (slice.length === 0) continue;
      let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
      slice.forEach(p => {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      });
      const pad = 0.02;
      bboxes.push(`${(minLng - pad).toFixed(5)},${(minLat - pad).toFixed(5)},${(maxLng + pad).toFixed(5)},${(maxLat + pad).toFixed(5)}`);
    }

    const fields = '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description,code},from,to,roadNumbers,delay}}}';

    const responses = await Promise.all(bboxes.map(async (bbox) => {
      const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(ttKey)}&bbox=${bbox}&fields=${encodeURIComponent(fields)}&language=ja-JP&timeValidityFilter=present`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.incidents) ? data.incidents : [];
    }));

    const merged = responses.flat();
    const seenKeys = new Set();
    const filtered = [];

    for (const inc of merged) {
      const props = inc.properties || {};
      const cat = props.iconCategory || 0;
      if (cat === 6 && (props.magnitudeOfDelay || 0) < 2) continue;

      let coord = null;
      if (inc.geometry?.type === 'Point' && Array.isArray(inc.geometry.coordinates)) {
        coord = { lng: inc.geometry.coordinates[0], lat: inc.geometry.coordinates[1] };
      } else if (inc.geometry?.type === 'LineString' && Array.isArray(inc.geometry.coordinates?.[0])) {
        const mid = inc.geometry.coordinates[Math.floor(inc.geometry.coordinates.length / 2)];
        coord = { lng: mid[0], lat: mid[1] };
      }
      if (!coord) continue;

      let nearRoute = false;
      for (let i = 0; i < allPts.length; i++) {
        if (approxDistMeters(coord.lat, coord.lng, allPts[i].lat, allPts[i].lng) <= 600) {
          nearRoute = true;
          break;
        }
      }
      if (!nearRoute) continue;

      const road = (props.roadNumbers && props.roadNumbers.length > 0) ? props.roadNumbers.join(' / ') : '';
      const fromText = props.from || '';
      const toText = props.to || '';
      const desc = (props.events && props.events.length > 0)
        ? props.events.map(e => e.description).filter(Boolean).join('・')
        : '';
      const dedupKey = `${cat}_${road}_${fromText}_${desc}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      const meta = getTomtomIconLabel(cat);
      filtered.push({
        lat: coord.lat,
        lng: coord.lng,
        category: cat,
        label: meta.label,
        cls: meta.cls,
        emoji: meta.emoji,
        road,
        from: fromText,
        to: toText,
        desc: desc || meta.label,
        delayMin: props.delay ? Math.round(props.delay / 60) : 0
      });
    }

    const priority = { 8: 1, 1: 2, 7: 3, 9: 4, 3: 5, 11: 6, 14: 6, 6: 7 };
    filtered.sort((a, b) => (priority[a.category] || 9) - (priority[b.category] || 9));
    return filtered.slice(0, 15);
  } catch (e) {
    return [];
  }
}

function buildTrafficBadgeHtml({ googleSec, staticSec, pessimisticSec, tomtomSec, isFuture }) {
  const delayMin = Math.max(0, Math.round((googleSec - staticSec) / 60));

  let statusText = '🟢 スムーズ';
  let statusCls = 'tr-smooth';
  if (delayMin >= 15) {
    statusText = `🔴 渋滞 (+${delayMin}分)`;
    statusCls = 'tr-jam';
  } else if (delayMin >= 5) {
    statusText = `🟡 やや混雑 (+${delayMin}分)`;
    statusCls = 'tr-slow';
  }

  let subNote = '';
  let maxRiskSec = googleSec;

  if (pessimisticSec && pessimisticSec > googleSec + 180) {
    maxRiskSec = Math.max(maxRiskSec, pessimisticSec);
  }
  if (tomtomSec && tomtomSec > googleSec + 180) {
    maxRiskSec = Math.max(maxRiskSec, tomtomSec);
  }

  if (tomtomSec !== null && tomtomSec !== undefined) {
    const diffMin = Math.round((tomtomSec - googleSec) / 60);
    const absDiff = Math.abs(diffMin);
    if (absDiff <= 5) {
      subNote = '信頼度: 高（Google・TomTom一致）';
    } else if (absDiff <= 14) {
      const sign = diffMin > 0 ? `+${diffMin}` : `${diffMin}`;
      subNote = `信頼度: 中（TomTom比 ${sign}分差）`;
    } else {
      const sign = diffMin > 0 ? `+${diffMin}` : `${diffMin}`;
      subNote = `⚠️ 変動リスク（TomTom比 ${sign}分差）`;
    }
  } else if (isFuture && pessimisticSec) {
    const worstExtraMin = Math.max(0, Math.round((pessimisticSec - googleSec) / 60));
    subNote = worstExtraMin >= 5
      ? `予測ブレ幅: 最大 +${worstExtraMin}分リスク`
      : '予測ブレ幅: 小（安定予測）';
  } else {
    subNote = delayMin > 0
      ? `通常時より +${delayMin}分の遅延発生中`
      : 'リアルタイム渋滞なし・順調';
  }

  return {
    html: `
      <div class="traffic-badge ${statusCls}">
        <span class="tr-main">${statusText}</span>
        <span class="tr-sub">${escapeHtml(subNote)}</span>
      </div>
    `,
    maxRiskSec
  };
}

function extractApiToll(route, avoidTolls) {
  if (avoidTolls) {
    return { toll: 0, sourceLabel: '一般道優先（有料道路回避）' };
  }

  const prices = route?.travelAdvisory?.tollInfo?.estimatedPrice;
  if (!Array.isArray(prices) || prices.length === 0) {
    return { toll: 0, sourceLabel: '根拠: Google Routes API（有料区間なし／料金データなし）' };
  }

  let totalJpy = 0;
  let hasJpy = false;
  for (const p of prices) {
    if (p.currencyCode === 'JPY') {
      hasJpy = true;
      const units = parseInt(p.units || '0', 10);
      const nanos = p.nanos ? Math.round(p.nanos / 1e9) : 0;
      totalJpy += units + nanos;
    }
  }

  if (!hasJpy) {
    return { toll: 0, sourceLabel: '根拠: Google Routes API（日本円料金データなし）' };
  }

  return {
    toll: totalJpy,
    sourceLabel: '根拠: Google Routes API（ETC参照）'
  };
}

function formatDuration(sec) {
  const totalMin = Math.round(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

function formatShortDurationFromMin(totalMin) {
  const absMin = Math.abs(totalMin);
  const h = Math.floor(absMin / 60);
  const m = absMin % 60;
  if (h > 0 && m > 0) return `${h}時間${m}分`;
  if (h > 0) return `${h}時間`;
  return `${m}分`;
}

function formatHHMM(dateObj) {
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const mm = String(dateObj.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function calcStartEndTime(baseDt, mode, durationSec, maxRiskSec = null) {
  const hasRange = maxRiskSec && (maxRiskSec - durationSec >= 300);
  if (mode === 'departure') {
    const start = new Date(baseDt.getTime());
    const end = new Date(baseDt.getTime() + durationSec * 1000);
    if (hasRange) {
      const worstEnd = new Date(baseDt.getTime() + maxRiskSec * 1000);
      return { start, end, text: `${formatHHMM(start)}発 ➔ ${formatHHMM(end)}〜${formatHHMM(worstEnd)}着` };
    }
    return { start, end, text: `${formatHHMM(start)}発 ➔ ${formatHHMM(end)}着` };
  } else {
    const end = new Date(baseDt.getTime());
    const start = new Date(baseDt.getTime() - durationSec * 1000);
    if (hasRange) {
      const earlyStart = new Date(baseDt.getTime() - maxRiskSec * 1000);
      return { start, end, text: `${formatHHMM(earlyStart)}〜${formatHHMM(start)}発 ➔ ${formatHHMM(end)}着` };
    }
    return { start, end, text: `${formatHHMM(start)}発 ➔ ${formatHHMM(end)}着` };
  }
}

function buildRoiRowsHtml(routeTotal, routeSec, loTotal, loSec, isBaseLocal) {
  if (isBaseLocal) {
    return `
      <div class="metric-row roi-row"><span>下道比</span><b>基準ルート</b></div>
      <div class="metric-row roi-row"><span>時間コスパ</span><b class="roi-good">コスト最安</b></div>
    `;
  }

  const savedMin = Math.round((loSec - routeSec) / 60);
  const extraCost = routeTotal - loTotal;

  if (savedMin > 0 && extraCost > 0) {
    const perHourCost = Math.round((extraCost / savedMin) * 60);
    const rateClass = perHourCost <= 2500 ? 'roi-good' : (perHourCost <= 4000 ? 'roi-warn' : 'roi-bad');
    return `
      <div class="metric-row roi-row">
        <span>下道比</span>
        <b>-${formatShortDurationFromMin(savedMin)} (+${extraCost.toLocaleString()}円)</b>
      </div>
      <div class="metric-row roi-row">
        <span>時間コスパ</span>
        <b class="${rateClass}">${perHourCost.toLocaleString()}円 / 1h短縮</b>
      </div>
    `;
  }

  if (savedMin > 0 && extraCost <= 0) {
    return `
      <div class="metric-row roi-row">
        <span>下道比</span>
        <b class="roi-good">-${formatShortDurationFromMin(savedMin)} (${extraCost.toLocaleString()}円)</b>
      </div>
      <div class="metric-row roi-row">
        <span>時間コスパ</span>
        <b class="roi-good">時間・費用とも有利</b>
      </div>
    `;
  }

  const costText = extraCost >= 0 ? `+${extraCost.toLocaleString()}円` : `${extraCost.toLocaleString()}円`;
  return `
    <div class="metric-row roi-row">
      <span>下道比</span>
      <b class="roi-bad">短縮なし (${costText})</b>
    </div>
    <div class="metric-row roi-row">
      <span>時間コスパ</span>
      <b class="roi-bad">効果薄（下道推奨）</b>
    </div>
  `;
}

function toggleIncidentBody() {
  const body = document.getElementById('incidentBody');
  const txt = document.getElementById('incidentToggleText');
  if (body.style.display === 'none') {
    body.style.display = 'block';
    txt.innerText = '▲ 閉じる';
  } else {
    body.style.display = 'none';
    txt.innerText = '▼ 開く';
  }
}

function renderIncidentsPanel(incidents, hasTomtom) {
  const wrap = document.getElementById('incidentWrap');
  const titleEl = document.getElementById('incidentWrapTitle');
  const bodyEl = document.getElementById('incidentBody');

  if (!hasTomtom) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  if (!incidents || incidents.length === 0) {
    titleEl.innerText = '✅ ルート周辺の事故・工事・規制情報（0件）';
    bodyEl.innerHTML = '<div class="hw-empty">現在、ルート周辺で重大な事故・通行止め・工事規制は報告されていません（TomTom Traffic調べ）。</div>';
    return;
  }

  titleEl.innerText = `🚨 ルート周辺の事故・工事・規制情報（${incidents.length}件検出）`;
  bodyEl.innerHTML = incidents.map(inc => {
    const locTitle = [inc.road, inc.from && inc.to ? `${inc.from} 〜 ${inc.to}` : (inc.from || inc.to)]
      .filter(Boolean)
      .join('｜');
    const delayBadge = inc.delayMin > 0 ? `<span class="inc-delay">+${inc.delayMin}分遅延</span>` : '';
    return `
      <div class="inc-item">
        <div class="inc-head">
          <span class="inc-tag ${inc.cls}">${inc.emoji} ${escapeHtml(inc.label)}</span>
          <span class="inc-road">${escapeHtml(locTitle || 'ルート周辺区間')}</span>
          ${delayBadge}
        </div>
        <div class="inc-desc">${escapeHtml(inc.desc)}</div>
      </div>
    `;
  }).join('');
}

// ===== 比較実行（共通経由地は全ルート反映・ミックス経由地はミックスのみ反映） =====
async function calculateAll() {
  let origin = document.getElementById('origin').value.trim();
  const dest = document.getElementById('destination').value.trim();
  const eff = parseFloat(document.getElementById('fuelEfficiency').value) || 15;
  const gas = parseFloat(document.getElementById('gasPrice').value) || 160;
  const timeMode = document.getElementById('timeMode').value;
  const baseDt = getSelectedDateTime();
  const isFuture = (timeMode === 'departure') && (baseDt.getTime() > Date.now() + 120000);
  const apiDepartureDt = (timeMode === 'departure') ? baseDt : null;
  const hasTomtom = getTomtomApiKey().length > 0;

  if (!origin || !dest) return alert('出発地と目的地を入力してください');

  if (origin === '現在地' && navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      );
      const lat = pos.coords.latitude.toFixed(5);
      const lng = pos.coords.longitude.toFixed(5);
      origin = `📍現在地 (${lat}, ${lng})`;
      document.getElementById('origin').value = origin;
    } catch (e) {
      return alert('現在地の取得に失敗しました。位置情報の許可を確認してください。');
    }
  }

  currentOrigin = origin;
  currentDest = dest;
  currentCommonWaypoints = [];
  currentMixLegs = [];
  currentRouteCoords = { origin: null, dest: null };

  const validCommonWps = commonWaypoints
    .map(name => name.trim())
    .filter(name => name !== "");

  const validMixWps = waypoints
    .map(w => ({ name: w.name.trim(), modeAfter: w.modeAfter }))
    .filter(w => w.name !== "");

  const resultArea = document.getElementById('resultArea');
  const compareGrid = document.getElementById('compareGrid');
  const diffBanner = document.getElementById('diffBanner');
  const summaryBar = document.getElementById('trafficSummaryBar');
  const navButtons = document.getElementById('navButtons');
  const hwDetailWrap = document.getElementById('hwDetailWrap');
  const incidentWrap = document.getElementById('incidentWrap');

  resultArea.style.display = 'block';
  diffBanner.innerHTML = hasTomtom
    ? 'Google Routes × TomTom API から渋滞・ETC料金・IC詳細を高速解析中...'
    : 'Google Routes API からルート・渋滞状況・ETC料金を取得中...';
  summaryBar.style.display = 'none';
  compareGrid.innerHTML = '';
  navButtons.style.display = 'none';
  hwDetailWrap.style.display = 'none';
  incidentWrap.style.display = 'none';

  // ミックスルート用の区間定義
  const legDefs = [];
  if (validMixWps.length > 0) {
    if (validCommonWps.length > 0) {
      let prev = origin;
      validCommonWps.forEach((cwName) => {
        legDefs.push({ from: prev, to: cwName, avoidTolls: firstSegmentMode === 'local', isCommonLeg: true });
        prev = cwName;
      });
      legDefs.push({ from: prev, to: validMixWps[0].name, avoidTolls: firstSegmentMode === 'local', isCommonLeg: false });
    } else {
      legDefs.push({ from: origin, to: validMixWps[0].name, avoidTolls: firstSegmentMode === 'local', isCommonLeg: false });
    }

    for (let i = 0; i < validMixWps.length; i++) {
      const to = (i === validMixWps.length - 1) ? dest : validMixWps[i + 1].name;
      legDefs.push({ from: validMixWps[i].name, to, avoidTolls: validMixWps[i].modeAfter === 'local', isCommonLeg: false });
    }
  }

  const allMixIntermediates = [...validCommonWps, ...validMixWps.map(w => w.name)];

  // 全高速・全下道は「共通経由地のみ」を渡す
  const [hwRoute, localRoute, hwPessRoute, loPessRoute] = await Promise.all([
    fetchRoute(origin, dest, false, apiDepartureDt, isFuture ? 'BEST_GUESS' : null, validCommonWps),
    fetchRoute(origin, dest, true, apiDepartureDt, isFuture ? 'BEST_GUESS' : null, validCommonWps),
    isFuture ? fetchRoute(origin, dest, false, apiDepartureDt, 'PESSIMISTIC', validCommonWps) : Promise.resolve(null),
    isFuture ? fetchRoute(origin, dest, true, apiDepartureDt, 'PESSIMISTIC', validCommonWps) : Promise.resolve(null)
  ]);

  if (!hwRoute || !localRoute) {
    diffBanner.innerHTML = 'ルートの取得に失敗しました。地名または通信状況を確認してください。';
    return;
  }

  const startLatLng = hwRoute.legs?.[0]?.startLocation?.latLng;
  const destLatLng = hwRoute.legs?.[hwRoute.legs.length - 1]?.endLocation?.latLng;

  if (startLatLng) {
    currentRouteCoords.origin = {
      latitude: startLatLng.latitude,
      longitude: startLatLng.longitude,
      name: formatDisplayOrigin(origin)
    };
  }
  if (destLatLng) {
    currentRouteCoords.dest = {
      latitude: destLatLng.latitude,
      longitude: destLatLng.longitude,
      name: formatDisplayOrigin(dest)
    };
  }

  if (validCommonWps.length > 0 && Array.isArray(hwRoute.legs)) {
    validCommonWps.forEach((cwName, idx) => {
      const legEnd = hwRoute.legs[idx]?.endLocation?.latLng || null;
      currentCommonWaypoints.push({
        name: cwName,
        coord: legEnd,
      });
    });
  }

  const commonLatLngSeq = [
    startLatLng,
    ...currentCommonWaypoints.map(cw => cw.coord).filter(Boolean),
    destLatLng
  ].filter(Boolean);

  const weatherPromise = destLatLng
    ? fetchDestinationWeatherData(destLatLng.latitude, destLatLng.longitude)
    : Promise.resolve(null);

  const ttHwPromise = (hasTomtom && commonLatLngSeq.length >= 2)
    ? fetchTomtomRouteSec(commonLatLngSeq, false, apiDepartureDt)
    : Promise.resolve(null);

  const ttLoPromise = (hasTomtom && commonLatLngSeq.length >= 2)
    ? fetchTomtomRouteSec(commonLatLngSeq, true, apiDepartureDt)
    : Promise.resolve(null);

  const hwDist = hwRoute.distanceMeters / 1000;
  const hwSec = parseInt(hwRoute.duration.replace('s', ''), 10);
  const hwStaticSec = hwRoute.staticDuration ? parseInt(hwRoute.staticDuration.replace('s', ''), 10) : hwSec;
  const hwPessSec = hwPessRoute?.duration ? parseInt(hwPessRoute.duration.replace('s', ''), 10) : null;
  const hwGas = Math.round((hwDist / eff) * gas);
  const hwTollObj = extractApiToll(hwRoute, false);
  const hwToll = hwTollObj.toll;
  const hwTotal = hwGas + hwToll;

  const loDist = localRoute.distanceMeters / 1000;
  const loSec = parseInt(localRoute.duration.replace('s', ''), 10);
  const loStaticSec = localRoute.staticDuration ? parseInt(localRoute.staticDuration.replace('s', ''), 10) : loSec;
  const loPessSec = loPessRoute?.duration ? parseInt(loPessRoute.duration.replace('s', ''), 10) : null;
  const loGas = Math.round((loDist / eff) * gas);
  const loTotal = loGas;

  const hwHeadLabel = validCommonWps.length > 0
    ? `${formatDisplayOrigin(origin)} ➔ ${validCommonWps.map(formatDisplayOrigin).join(' ➔ ')} ➔ ${dest}`
    : `${formatDisplayOrigin(origin)} ➔ ${dest}`;

  const hwTimelineItems = extractHighwayTimeline(hwRoute, hwToll);
  const hwTimelinePromise = resolveMissingFacilityNames(hwTimelineItems).then(resolvedItems => {
    latestHwDetailHtml = `
      <div class="hw-leg-block">
        <div class="hw-leg-head">${escapeHtml(hwHeadLabel)}</div>
        ${buildTimelineHtml(resolvedItems)}
      </div>
    `;
  });
  latestMixDetailHtml = "";

  // ミックスルート集計（各区間の指定モード avoidTolls を厳密に適用）
  let mixData = null;
  const allEncodedPolysForIncidents = [
    hwRoute.polyline?.encodedPolyline,
    localRoute.polyline?.encodedPolyline
  ].filter(Boolean);

  if (validMixWps.length > 0) {
    // 各区間を個別に取得（下道指定区間が高速へ再流入するのを完全に防止）
    const legRoutes = await Promise.all(
      legDefs.map(leg => fetchRoute(leg.from, leg.to, leg.avoidTolls, apiDepartureDt, null))
    );

    const allOk = legRoutes.every(r => r && r.legs && r.legs[0]);
    if (allOk) {
      let totalDist = 0;
      let totalSec = 0;
      let totalStaticSec = 0;
      let totalToll = 0;
      let hasAnyHighwayInMix = false;
      const polylines = [];
      const modeLabels = [];
      const resolvedLegs = [];

      const mixLegDetailBlocks = await Promise.all(legDefs.map(async (leg, i) => {
        const r = legRoutes[i];
        const l0 = r.legs[0];
        const dKm = (r.distanceMeters || l0.distanceMeters || 0) / 1000;
        const sec = parseInt((r.duration || l0.duration || '0s').replace('s', ''), 10) || 0;
        const stSec = parseInt((r.staticDuration || l0.staticDuration || r.duration || '0s').replace('s', ''), 10) || 0;
        const poly = r.polyline?.encodedPolyline || l0.polyline?.encodedPolyline || '';

        const tollObj = extractApiToll(r, leg.avoidTolls);
        let legToll = tollObj.toll;

        // 高速指定区間なのに終点IC手前判定で0円になった場合の距離比例フォールバック
        if (!leg.avoidTolls) {
          hasAnyHighwayInMix = true;
          if (legToll === 0 && hwToll > 0 && hwDist > 0) {
            const ratio = Math.min(1, Math.max(0.25, dKm / hwDist));
            legToll = Math.round((hwToll * ratio) / 10) * 10;
          }
        }

        totalDist += dKm;
        totalSec += sec;
        totalStaticSec += stSec;
        totalToll += legToll;

        const legStart = l0.startLocation?.latLng || null;
        const legEnd = l0.endLocation?.latLng || null;

        resolvedLegs.push({
          ...leg,
          startCoord: legStart,
          endCoord: legEnd,
        });

        if (poly) {
          allEncodedPolysForIncidents.push(poly);
          polylines.push({
            poly,
            color: leg.avoidTolls ? '#f36c21' : '#14233c',
            intervals: r.travelAdvisory?.speedReadingIntervals || []
          });
        }
        modeLabels.push(leg.avoidTolls ? '下道' : '高速');

        const modeTag = leg.avoidTolls ? '下道' : '高速';
        if (leg.avoidTolls) {
          return `
            <div class="hw-leg-block">
              <div class="hw-leg-head">区間${i + 1} [${modeTag}]：${escapeHtml(formatDisplayOrigin(leg.from))} ➔ ${escapeHtml(formatDisplayOrigin(leg.to))}</div>
              <div class="hw-empty">一般道区間（${dKm.toFixed(1)}km / ${formatDuration(sec)}）</div>
            </div>
          `;
        }

        const legItems = await resolveMissingFacilityNames(
          extractHighwayTimeline(r, legToll),
          { entryHint: leg.from, exitHint: leg.to }
        );
        return `
          <div class="hw-leg-block">
            <div class="hw-leg-head">区間${i + 1} [${modeTag}]：${escapeHtml(formatDisplayOrigin(leg.from))} ➔ ${escapeHtml(formatDisplayOrigin(leg.to))}</div>
            ${buildTimelineHtml(legItems)}
          </div>
        `;
      }));

      currentMixLegs = resolvedLegs;
      latestMixDetailHtml = mixLegDetailBlocks.join('');
      const totalGas = Math.round((totalDist / eff) * gas);

      mixData = {
        dist: totalDist,
        sec: totalSec,
        staticSec: totalStaticSec,
        pessSec: null,
        tomtomSec: null,
        gas: totalGas,
        toll: totalToll,
        sourceLabel: hasAnyHighwayInMix ? '根拠: Google Routes API（ETC参照）' : '全区間 一般道優先（有料道路回避）',
        total: totalGas + totalToll,
        modeSummary: modeLabels.join('➔'),
        polylines,
        mixWpNames: validMixWps.map(w => w.name)
      };
    }
  }

  const [weatherData, ttHwRes, ttLoRes, incidents] = await Promise.all([
    weatherPromise,
    ttHwPromise,
    ttLoPromise,
    hasTomtom ? fetchTomtomIncidentsAlongPolylines(allEncodedPolysForIncidents) : Promise.resolve([]),
    hwTimelinePromise
  ]);

  const hwTrafficInfo = buildTrafficBadgeHtml({
    googleSec: hwSec,
    staticSec: hwStaticSec,
    pessimisticSec: hwPessSec,
    tomtomSec: ttHwRes ? ttHwRes.sec : null,
    isFuture
  });

  const loTrafficInfo = buildTrafficBadgeHtml({
    googleSec: loSec,
    staticSec: loStaticSec,
    pessimisticSec: loPessSec,
    tomtomSec: ttLoRes ? ttLoRes.sec : null,
    isFuture
  });

  const hwTimes = calcStartEndTime(baseDt, timeMode, hwSec, hwTrafficInfo.maxRiskSec);
  const loTimes = calcStartEndTime(baseDt, timeMode, loSec, loTrafficInfo.maxRiskSec);

  const hwWeatherHtml = getArrivalWeatherBadgeHtml(weatherData, hwTimes.end);
  const loWeatherHtml = getArrivalWeatherBadgeHtml(weatherData, loTimes.end);

  const hwRoiHtml = buildRoiRowsHtml(hwTotal, hwSec, loTotal, loSec, false);
  const loRoiHtml = buildRoiRowsHtml(loTotal, loSec, loTotal, loSec, true);

  const activeSources = ['Google Routes'];
  if (ttHwRes || ttLoRes) activeSources.push('TomTom Routing');
  if (hasTomtom) activeSources.push(`TomTom Traffic (${incidents.length}件検出)`);
  summaryBar.style.display = 'flex';
  summaryBar.innerHTML = `
    <span>📡 参照ソース: <b>${activeSources.join(' ＋ ')}</b></span>
    ${!hasTomtom ? '<span class="summary-tip" onclick="toggleTomtomEditor()">＋TomTom追加で精度UP</span>' : ''}
  `;

  renderIncidentsPanel(incidents, hasTomtom);

  const commonBadgeText = validCommonWps.length > 0
    ? `共通経由: ${validCommonWps.map(escapeHtml).join('・')}`
    : '';

  if (!mixData) {
    const timeDiffMin = Math.round((loSec - hwSec) / 60);
    const costDiff = hwTotal - loTotal;

    const mainBanner = timeDiffMin > 0
      ? `高速利用で ${formatShortDurationFromMin(timeDiffMin)}短縮（コスト差 ＋${costDiff.toLocaleString()}円）`
      : `一般道でも所要時間はほぼ同等（${Math.abs(costDiff).toLocaleString()}円コスト削減）`;
    diffBanner.innerHTML = commonBadgeText ? `${mainBanner}｜${commonBadgeText}` : mainBanner;

    compareGrid.className = 'compare-grid grid-2';
    compareGrid.innerHTML = `
      <div class="card highway">
        <div class="card-title"><span>全高速優先</span></div>
        <div class="time-schedule">${hwTimes.text}</div>
        ${hwTrafficInfo.html}
        ${hwWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${hwDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>所要時間</span><b>${formatDuration(hwSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${hwGas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速料金</span><b>${hwToll.toLocaleString()}円</b></div>
        ${hwRoiHtml}
        <div class="sub-info">${hwTollObj.sourceLabel}</div>
        <div class="price-big">計 ${hwTotal.toLocaleString()}円</div>
      </div>
      <div class="card local">
        <div class="card-title"><span>一般道（下道）</span></div>
        <div class="time-schedule">${loTimes.text}</div>
        ${loTrafficInfo.html}
        ${loWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${loDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>所要時間</span><b>${formatDuration(loSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${loGas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速料金</span><b>0円</b></div>
        ${loRoiHtml}
        <div class="sub-info">一般道優先（有料道路回避）</div>
        <div class="price-big">計 ${loTotal.toLocaleString()}円</div>
      </div>
    `;

    drawMap([
      {
        poly: hwRoute.polyline.encodedPolyline,
        color: '#14233c',
        intervals: hwRoute.travelAdvisory?.speedReadingIntervals || []
      },
      {
        poly: localRoute.polyline.encodedPolyline,
        color: '#1e7e48',
        intervals: localRoute.travelAdvisory?.speedReadingIntervals || []
      }
    ], incidents);

    const gmapHwUrl = buildGoogleMapsDirUrl({
      originText: currentOrigin,
      destText: currentDest,
      waypointTexts: validCommonWps,
      avoidTolls: false,
    });
    const gmapLoUrl = buildGoogleMapsDirUrl({
      originText: currentOrigin,
      destText: currentDest,
      waypointTexts: validCommonWps,
      avoidTolls: true,
    });

    const commonViaNote = validCommonWps.length > 0 ? `（共通経由${validCommonWps.length}ヶ所セット）` : '';

    navButtons.innerHTML = `
      <div class="nav-group-label">▼ Yahoo!カーナビで起動（yjcarnavi://）</div>
      <button type="button" class="btn-yahoo" onclick="openYahooNaviNormal(false)">🚗 Yahoo!カーナビ（全高速）でナビ開始${commonViaNote}</button>
      <button type="button" class="btn-yahoo btn-yahoo-local" onclick="openYahooNaviNormal(true)">🚗 Yahoo!カーナビ（全下道・一般優先推奨）でナビ開始${commonViaNote}</button>
      <div class="nav-group-label">▼ Googleマップ併用</div>
      <div class="sub-nav-grid">
        <a class="btn-sub-nav" href="${gmapHwUrl}" target="_blank" rel="noopener noreferrer">Googleマップ（高速）↗</a>
        <a class="btn-sub-nav" href="${gmapLoUrl}" target="_blank" rel="noopener noreferrer">Googleマップ（下道）↗</a>
      </div>
    `;

    hwDetailWrap.style.display = 'block';
    document.getElementById('hwDetailBody').style.display = 'block';
    document.getElementById('hwDetailToggleText').innerText = '▲ 閉じる';
    switchHwDetailTab('hw');

  } else {
    const wpSummary = mixData.mixWpNames.map(n => escapeHtml(n)).join(' ➔ ');
    const mixTrafficInfo = buildTrafficBadgeHtml({
      googleSec: mixData.sec,
      staticSec: mixData.staticSec,
      pessimisticSec: mixData.pessSec,
      tomtomSec: mixData.tomtomSec,
      isFuture
    });
    const mixTimes = calcStartEndTime(baseDt, timeMode, mixData.sec, mixTrafficInfo.maxRiskSec);
    const mixWeatherHtml = getArrivalWeatherBadgeHtml(weatherData, mixTimes.end);
    const mixRoiHtml = buildRoiRowsHtml(mixData.total, mixData.sec, loTotal, loSec, false);

    diffBanner.innerHTML = `3ルート戦略比較（ミックス経由${mixData.mixWpNames.length}ヶ所: ${wpSummary}${commonBadgeText ? ` / ${commonBadgeText}` : ''}）`;
    compareGrid.className = 'compare-grid grid-3';
    compareGrid.innerHTML = `
      <div class="card highway">
        <div class="card-title"><span>全高速</span></div>
        <div class="time-schedule">${hwTimes.text}</div>
        ${hwTrafficInfo.html}
        ${hwWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${hwDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(hwSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${hwGas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速代</span><b>${hwToll.toLocaleString()}円</b></div>
        ${hwRoiHtml}
        <div class="sub-info">${hwTollObj.sourceLabel}</div>
        <div class="price-big">計 ${hwTotal.toLocaleString()}円</div>
      </div>
      <div class="card mix">
        <div class="card-title"><span style="color:var(--orange-dark);">ミックス (${mixData.modeSummary})</span></div>
        <div class="time-schedule">${mixTimes.text}</div>
        ${mixTrafficInfo.html}
        ${mixWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${mixData.dist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(mixData.sec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${mixData.gas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速代</span><b>${mixData.toll.toLocaleString()}円</b></div>
        ${mixRoiHtml}
        <div class="sub-info" style="color:var(--orange-dark);">${mixData.sourceLabel}</div>
        <div class="price-big">計 ${mixData.total.toLocaleString()}円</div>
      </div>
      <div class="card local">
        <div class="card-title"><span style="color:var(--green);">全下道</span></div>
        <div class="time-schedule">${loTimes.text}</div>
        ${loTrafficInfo.html}
        ${loWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${loDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(loSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${loGas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速代</span><b>0円</b></div>
        ${loRoiHtml}
        <div class="sub-info">一般道優先（有料道路回避）</div>
        <div class="price-big">計 ${loTotal.toLocaleString()}円</div>
      </div>
    `;

    drawMap([
      ...mixData.polylines,
      {
        poly: localRoute.polyline.encodedPolyline,
        color: '#1e7e48',
        intervals: localRoute.travelAdvisory?.speedReadingIntervals || []
      }
    ], incidents);

    const legButtonsHtml = currentMixLegs.map((leg, idx) => {
      const fromLabel = escapeHtml(formatDisplayOrigin(leg.from));
      const toLabel = escapeHtml(formatDisplayOrigin(leg.to));
      const modeTag = leg.avoidTolls ? '下道・一般優先推奨' : '高速';
      const cls = (idx % 2 === 0) ? 'btn-yahoo btn-yahoo-seg' : 'btn-yahoo btn-yahoo-seg-alt';
      return `<button type="button" class="${cls}" onclick="openYahooNaviLeg(${idx})">🚗 区間${idx + 1} [${modeTag}] Yahoo!カーナビ（${fromLabel} ➔ ${toLabel}）</button>`;
    }).join('');

    const totalViaCount = Math.min(3, allMixIntermediates.length);
    const viaNote = allMixIntermediates.length > 3
      ? `※経由地が4ヶ所以上のため先頭3ヶ所をセット`
      : `経由地${totalViaCount}ヶ所セット`;

    const commonViaNote = validCommonWps.length > 0 ? `・共通経由${validCommonWps.length}ヶ所` : '';

    const gmapMixUrl = buildGoogleMapsDirUrl({
      originText: currentOrigin,
      destText: currentDest,
      waypointTexts: allMixIntermediates,
      avoidTolls: false,
    });
    const gmapHwUrl = buildGoogleMapsDirUrl({
      originText: currentOrigin,
      destText: currentDest,
      waypointTexts: validCommonWps,
      avoidTolls: false,
    });

    navButtons.innerHTML = `
      <div class="nav-group-label">▼ ミックスルート Yahoo!カーナビ起動（${currentMixLegs.length}区間）</div>
      <button type="button" class="btn-yahoo" onclick="openYahooNaviMixAll()">🚗 Yahoo!カーナビで一括開始（${viaNote}）</button>
      ${legButtonsHtml}
      <div class="nav-group-label">▼ 全高速 / 全下道 Yahoo!カーナビ起動（ミックス経由は除外）</div>
      <button type="button" class="btn-yahoo" style="background:var(--navy);" onclick="openYahooNaviNormal(false)">🚗 Yahoo!カーナビ（全高速${commonViaNote}）で開始</button>
      <button type="button" class="btn-yahoo btn-yahoo-local" onclick="openYahooNaviNormal(true)">🚗 Yahoo!カーナビ（全下道${commonViaNote}・一般優先推奨）で開始</button>
      <div class="nav-group-label">▼ Googleマップ併用</div>
      <div class="sub-nav-grid">
        <a class="btn-sub-nav" href="${gmapMixUrl}" target="_blank" rel="noopener noreferrer">Googleマップ（ミックス一括）↗</a>
        <a class="btn-sub-nav" href="${gmapHwUrl}" target="_blank" rel="noopener noreferrer">Googleマップ（全高速${commonViaNote}）↗</a>
      </div>
    `;

    hwDetailWrap.style.display = 'block';
    document.getElementById('hwDetailBody').style.display = 'block';
    document.getElementById('hwDetailToggleText').innerText = '▲ 閉じる';
    switchHwDetailTab('mix');
  }

  navButtons.style.display = 'block';
}

// ===== 地図・渋滞色分けポリライン・インシデントピン描画 =====
function toggleTrafficLayer() {
  if (!currentMapInstance || !currentTrafficLayer) return;
  isTrafficLayerOn = !isTrafficLayerOn;
  currentTrafficLayer.setMap(isTrafficLayerOn ? currentMapInstance : null);
  const btn = document.getElementById('btnTrafficLayer');
  if (btn) {
    btn.classList.toggle('active', isTrafficLayerOn);
    btn.innerText = isTrafficLayerOn ? '🚦 リアルタイム渋滞線 ON' : '🚦 リアルタイム渋滞線 OFF';
  }
}

function drawPolylineWithTraffic(map, path, baseColor, intervals) {
  new google.maps.Polyline({
    path: path,
    geodesic: true,
    strokeColor: baseColor,
    strokeOpacity: 0.85,
    strokeWeight: 5,
    zIndex: 1,
    map: map
  });

  if (!Array.isArray(intervals) || intervals.length === 0) return;

  intervals.forEach(iv => {
    const speed = iv.speed;
    if (speed !== 'SLOW' && speed !== 'TRAFFIC_JAM') return;
    const startIdx = iv.startPolylinePointIndex || 0;
    const endIdx = Math.min(path.length - 1, iv.endPolylinePointIndex || 0);
    if (endIdx <= startIdx) return;

    const segPath = path.slice(startIdx, endIdx + 1);
    const segColor = (speed === 'TRAFFIC_JAM') ? '#dc2626' : '#f59e0b';

    new google.maps.Polyline({
      path: segPath,
      geodesic: true,
      strokeColor: segColor,
      strokeOpacity: 0.98,
      strokeWeight: 6,
      zIndex: speed === 'TRAFFIC_JAM' ? 3 : 2,
      map: map
    });
  });
}

function drawMap(polylines, incidents = []) {
  const mapWrap = document.getElementById('mapWrap');
  const mapDiv = document.getElementById('map');
  mapWrap.style.display = 'block';
  mapDiv.style.display = 'block';

  if (typeof google === 'undefined' || !google.maps) {
    mapDiv.innerHTML = '<div style="padding:20px; text-align:center; font-size:12px; color:#64748b;">地図の読み込み中またはAPI制限中です</div>';
    return;
  }

  const decodedList = polylines
    .filter(item => item.poly)
    .map(item => ({
      path: google.maps.geometry.encoding.decodePath(item.poly),
      color: item.color,
      intervals: item.intervals || []
    }))
    .filter(item => item.path.length > 0);

  if (decodedList.length === 0) return;

  const map = new google.maps.Map(mapDiv, {
    zoom: 11,
    center: decodedList[0].path[0]
  });
  currentMapInstance = map;

  const trafficLayer = new google.maps.TrafficLayer();
  if (isTrafficLayerOn) {
    trafficLayer.setMap(map);
  }
  currentTrafficLayer = trafficLayer;

  const bounds = new google.maps.LatLngBounds();

  decodedList.forEach(item => {
    drawPolylineWithTraffic(map, item.path, item.color, item.intervals);
    item.path.forEach(pt => bounds.extend(pt));
  });

  const infoWindow = new google.maps.InfoWindow();
  incidents.forEach(inc => {
    const marker = new google.maps.Marker({
      position: { lat: inc.lat, lng: inc.lng },
      map: map,
      title: `${inc.label}: ${inc.desc}`,
      label: {
        text: inc.emoji,
        fontSize: '14px'
      }
    });
    marker.addListener('click', () => {
      const title = [inc.road, inc.from].filter(Boolean).join(' ');
      infoWindow.setContent(`
        <div style="font-size:12px; line-height:1.4; max-width:220px;">
          <strong style="color:#dc2626;">${escapeHtml(inc.label)}</strong> ${title ? `(${escapeHtml(title)})` : ''}<br>
          <span>${escapeHtml(inc.desc)}</span>
        </div>
      `);
      infoWindow.open(map, marker);
    });
  });

  map.fitBounds(bounds);
}

// ===== 起動時初期化 =====
(function initApp() {
  const savedActive = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (savedActive) activeProfileName = savedActive;
  loadActiveProfile();

  const savedTtKey = getTomtomApiKey();
  const ttInput = document.getElementById('tomtomApiKeyInput');
  if (ttInput && savedTtKey) ttInput.value = savedTtKey;
  updateTomtomButtonStatus();

  renderCommonWaypoints();
  renderWaypoints();
  setNowDateTime();
})();
