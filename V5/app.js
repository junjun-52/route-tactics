// ===== メイン制御・HEREルート検索・動的割引＆ROI算出・Leaflet地図描画 (V5) =====
const MAX_WAYPOINTS = 5;

let currentOrigin = "";
let currentDest = "";
let currentMixLegs = []; // { from, to, avoidTolls }
let leafletMapInstance = null;

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
      <label style="color:var(--navy);">区間1：出発地 ➔ 経由地1 の走行モード</label>
      <select style="margin-bottom:0;" onchange="firstSegmentMode = this.value">
        <option value="highway" ${firstSegmentMode === 'highway' ? 'selected' : ''}>【高速】を利用</option>
        <option value="local" ${firstSegmentMode === 'local' ? 'selected' : ''}>【下道】のみ</option>
      </select>
    `;
    container.appendChild(firstBox);
  }

  waypoints.forEach((wp, idx) => {
    const nextLabel = (idx === waypoints.length - 1) ? '目的地' : `経由地${idx + 2}`;
    const box = document.createElement('div');
    box.className = 'waypoint-box';
    box.innerHTML = `
      <div class="waypoint-head">
        <label>経由地 ${idx + 1} / 乗り降りするIC名</label>
        <button type="button" class="btn-remove-wp" onclick="removeWaypoint(${idx})">✕ 削除</button>
      </div>
      <input type="text" value="${escapeHtml(wp.name)}" placeholder="例：経由するIC名や地名を入力" oninput="updateWaypointName(${idx}, this.value)">
      <label style="color:var(--orange-dark);">区間${idx + 2}：経由地${idx + 1} ➔ ${nextLabel} の走行モード</label>
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
    ? `＋ 経由地・乗降ICを追加（残り${remain}ヶ所）`
    : `経由地は最大${MAX_WAYPOINTS}ヶ所までです`;
}

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

function formatForNavUrl(text) {
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
  const isFuture = baseDt.getTime() > Date.now() + 60000;
  const badge = document.getElementById('sourceInfoBadge');
  if (!badge) return;

  if (mode === 'departure' && isFuture) {
    badge.innerText = '料金・時間根拠: HERE Routing API v8（指定出発日時の渋滞・通常ETC料金）＋ 動的割引ルール判定';
  } else if (mode === 'arrival') {
    badge.innerText = '料金・時間根拠: HERE Routing API v8（指定到着時刻ベース）＋ 動的割引ルール判定';
  } else {
    badge.innerText = '料金・時間根拠: HERE Routing API v8（リアルタイム交通・通常ETC料金）＋ 動的割引ルール判定';
  }
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

function calcStartEndTime(baseDt, mode, durationSec) {
  if (mode === 'departure') {
    const start = new Date(baseDt.getTime());
    const end = new Date(baseDt.getTime() + durationSec * 1000);
    return { start, end, text: `${formatHHMM(start)}発 ➔ ${formatHHMM(end)}着` };
  } else {
    const end = new Date(baseDt.getTime());
    const start = new Date(baseDt.getTime() - durationSec * 1000);
    return { start, end, text: `${formatHHMM(start)}発 ➔ ${formatHHMM(end)}着` };
  }
}

function buildRoiRowsHtml(routeTotal, routeSec, loTotal, loSec, labelPrefix) {
  const extraCost = Math.round(routeTotal - loTotal);
  const savedMin = Math.round((loSec - routeSec) / 60);

  if (savedMin > 0 && extraCost > 0) {
    const perHour = Math.round((extraCost / savedMin) * 60);
    const perMin = (extraCost / savedMin).toFixed(1);
    return `
      <div class="roi-row"><span>${escapeHtml(labelPrefix)}追加コスト（差額）</span><strong>+¥${extraCost.toLocaleString()}</strong></div>
      <div class="roi-row"><span>短縮できる時間</span><strong>${formatShortDurationFromMin(savedMin)}短縮</strong></div>
      <div class="roi-row"><span>1時間短縮あたりのコスト</span><strong class="roi-highlight">¥${perHour.toLocaleString()} / 時間（約¥${perMin}/分）</strong></div>
    `;
  } else if (savedMin > 0 && extraCost <= 0) {
    return `
      <div class="roi-row"><span>${escapeHtml(labelPrefix)}差額</span><strong class="roi-good">¥${extraCost.toLocaleString()}（追加費用なし！）</strong></div>
      <div class="roi-row"><span>短縮できる時間</span><strong class="roi-good">${formatShortDurationFromMin(savedMin)}短縮</strong></div>
      <div class="roi-row"><span>結論</span><strong class="roi-good">安くて速いベスト選択です</strong></div>
    `;
  } else if (savedMin <= 0 && extraCost > 0) {
    return `
      <div class="roi-row"><span>${escapeHtml(labelPrefix)}追加コスト</span><strong>+¥${extraCost.toLocaleString()}</strong></div>
      <div class="roi-row"><span>時間差</span><strong>${formatShortDurationFromMin(Math.abs(savedMin))}遅い</strong></div>
      <div class="roi-row"><span>結論</span><strong class="roi-warn">今回は時間・料金ともに下道有利です</strong></div>
    `;
  } else {
    return `
      <div class="roi-row"><span>${escapeHtml(labelPrefix)}差額</span><strong>¥${extraCost.toLocaleString()}</strong></div>
      <div class="roi-row"><span>時間差</span><strong>ほぼ同等</strong></div>
    `;
  }
}

function renderLeafletMap(routeCoords, localCoords) {
  const mapCard = document.getElementById('mapCard');
  if (!mapCard || typeof L === 'undefined') return;
  mapCard.style.display = 'block';

  if (!leafletMapInstance) {
    leafletMapInstance = L.map('mapCanvas');
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 18
    }).addTo(leafletMapInstance);
  }

  leafletMapInstance.eachLayer((layer) => {
    if (layer instanceof L.Polyline) {
      leafletMapInstance.removeLayer(layer);
    }
  });

  const boundsPoints = [];
  if (Array.isArray(localCoords) && localCoords.length > 0) {
    const localLine = L.polyline(localCoords, { color: '#1e7e48', weight: 4, opacity: 0.7, dashArray: '6,6' }).addTo(leafletMapInstance);
    boundsPoints.push(...localLine.getLatLngs());
  }
  if (Array.isArray(routeCoords) && routeCoords.length > 0) {
    const mainLine = L.polyline(routeCoords, { color: '#f36c21', weight: 5, opacity: 0.9 }).addTo(leafletMapInstance);
    boundsPoints.push(...mainLine.getLatLngs());
  }

  if (boundsPoints.length > 0) {
    leafletMapInstance.fitBounds(L.latLngBounds(boundsPoints), { padding: [24, 24] });
  }
  setTimeout(() => {
    if (leafletMapInstance) leafletMapInstance.invalidateSize();
  }, 150);
}

async function calculateRoutes() {
  saveCurrentProfileData();
  const v5Settings = getV5Settings();
  const apiKey = v5Settings.hereApiKey ? v5Settings.hereApiKey.trim() : "";
  if (!apiKey) {
    alert("HERE APIキーが設定されていません。画面右上の「⚙️」からHERE APIキーを入力してください。");
    openApiModal();
    return;
  }

  const origin = document.getElementById('originInput').value.trim();
  const dest = document.getElementById('destInput').value.trim();
  if (!origin || !dest) {
    alert("出発地と目的地の両方を入力してください。");
    return;
  }

  const fuelEff = Math.max(1, parseFloat(document.getElementById('fuelEfficiency').value) || 15.0);
  const gasPrice = Math.max(1, parseFloat(document.getElementById('gasPrice').value) || 160);
  const vehicleClass = document.getElementById('vehicleClass').value || "standard";
  const baseDt = getSelectedDateTime();
  const timeMode = document.getElementById('timeMode').value || "departure";

  currentOrigin = origin;
  currentDest = dest;

  const btn = document.getElementById('btnCalc');
  btn.disabled = true;
  btn.innerText = "⏳ HERE APIでルート・割引判定を計算中...";

  try {
    const cleanWps = waypoints.filter(w => w.name && w.name.trim()).map(w => ({
      name: w.name.trim(),
      modeAfter: w.modeAfter || "local"
    }));

    const points = [origin, ...cleanWps.map(w => w.name), dest];
    const legModes = [];
    if (cleanWps.length === 0) {
      legModes.push(false);
    } else {
      legModes.push(firstSegmentMode === "local");
      for (let i = 0; i < cleanWps.length; i++) {
        legModes.push(cleanWps[i].modeAfter === "local");
      }
    }

    const hwLegs = [];
    const localLegs = [];
    let hwDist = 0, hwSec = 0, hwBaseToll = 0, hwDiscToll = 0;
    let loDist = 0, loSec = 0;
    const hwCoords = [];
    const loCoords = [];
    const hwDetailEntries = [];

    let cursorTime = new Date(baseDt.getTime());

    for (let i = 0; i < points.length - 1; i++) {
      const fromPt = points[i];
      const toPt = points[i + 1];

      const [resHw, resLo] = await Promise.all([
        window.hereApi.fetchHereRoute(fromPt, toPt, { apiKey, avoidTolls: false, baseDt: cursorTime, mode: timeMode }),
        window.hereApi.fetchHereRoute(fromPt, toPt, { apiKey, avoidTolls: true, baseDt: cursorTime, mode: timeMode })
      ]);

      const parsedHw = parseHighwaySegmentsFromHere(resHw, cursorTime, formatDisplayOrigin(fromPt), formatDisplayOrigin(toPt), vehicleClass);
      hwDist += resHw.distanceKm;
      hwSec += resHw.durationSec;
      hwBaseToll += parsedHw.baseTotalToll;
      hwDiscToll += parsedHw.discountedTotalToll;
      hwCoords.push(...resHw.coords);

      hwDetailEntries.push({
        res: resHw,
        startDt: new Date(cursorTime.getTime()),
        fromLabel: formatDisplayOrigin(fromPt),
        toLabel: formatDisplayOrigin(toPt)
      });

      loDist += resLo.distanceKm;
      loSec += resLo.durationSec;
      loCoords.push(...resLo.coords);

      const avoidTollForMix = legModes[i] === true;
      const chosenRes = avoidTollForMix ? resLo : resHw;
      const chosenParsed = avoidTollForMix ? { baseTotalToll: 0, discountedTotalToll: 0 } : parsedHw;

      hwLegs.push({
        from: formatDisplayOrigin(fromPt),
        to: formatDisplayOrigin(toPt),
        avoidTolls: avoidTollForMix,
        res: chosenRes,
        parsed: chosenParsed,
        startDt: new Date(cursorTime.getTime())
      });

      localLegs.push({ from: fromPt, to: toPt, avoidTolls: true });
      cursorTime = new Date(cursorTime.getTime() + chosenRes.durationSec * 1000);
    }

    currentMixLegs = localLegs;

    let mixDist = 0, mixSec = 0, mixBaseToll = 0, mixDiscToll = 0;
    const mixDetailEntries = [];
    hwLegs.forEach(item => {
      mixDist += item.res.distanceKm;
      mixSec += item.res.durationSec;
      mixBaseToll += item.parsed.baseTotalToll;
      mixDiscToll += item.parsed.discountedTotalToll;
      if (!item.avoidTolls) {
        mixDetailEntries.push({
          res: item.res,
          startDt: item.startDt,
          fromLabel: item.from,
          toLabel: item.to
        });
      }
    });

    const hwFuel = Math.round((hwDist / fuelEff) * gasPrice);
    const mixFuel = Math.round((mixDist / fuelEff) * gasPrice);
    const loFuel = Math.round((loDist / fuelEff) * gasPrice);

    const hwTotal = hwFuel + hwDiscToll;
    const mixTotal = mixFuel + mixDiscToll;
    const loTotal = loFuel;

    const hwTimeInfo = calcStartEndTime(baseDt, timeMode, hwSec);
    const mixTimeInfo = calcStartEndTime(baseDt, timeMode, mixSec);
    const loTimeInfo = calcStartEndTime(baseDt, timeMode, loSec);

    document.getElementById('hwTimeRange').innerText = hwTimeInfo.text;
    document.getElementById('hwTotal').innerText = `¥${hwTotal.toLocaleString()}`;
    document.getElementById('hwBreakdown').innerText = `ガソリン約¥${hwFuel.toLocaleString()} + ETC判定後¥${hwDiscToll.toLocaleString()}（標準¥${hwBaseToll.toLocaleString()}）`;
    document.getElementById('hwMeta').innerText = `約${hwDist.toFixed(1)}km / ${formatDuration(hwSec)}`;

    document.getElementById('mixTimeRange').innerText = mixTimeInfo.text;
    document.getElementById('mixTotal').innerText = `¥${mixTotal.toLocaleString()}`;
    document.getElementById('mixBreakdown').innerText = `ガソリン約¥${mixFuel.toLocaleString()} + ETC判定後¥${mixDiscToll.toLocaleString()}（標準¥${mixBaseToll.toLocaleString()}）`;
    document.getElementById('mixMeta').innerText = `約${mixDist.toFixed(1)}km / ${formatDuration(mixSec)}`;

    document.getElementById('loTimeRange').innerText = loTimeInfo.text;
    document.getElementById('loTotal').innerText = `¥${loTotal.toLocaleString()}`;
    document.getElementById('loBreakdown').innerText = `ガソリン約¥${loFuel.toLocaleString()} + 高速代¥0`;
    document.getElementById('loMeta').innerText = `約${loDist.toFixed(1)}km / ${formatDuration(loSec)}`;

    document.getElementById('roiCard').style.display = 'block';
    document.getElementById('roiHighwayBox').innerHTML = buildRoiRowsHtml(hwTotal, hwSec, loTotal, loSec, "高速優先 ");
    document.getElementById('roiMixBox').innerHTML = buildRoiRowsHtml(mixTotal, mixSec, loTotal, loSec, "経由・乗降指定 ");

    latestHwDetailHtml = buildHighwayDetailHtml("高速優先ルート 区間別ETC・動的割引判定", hwDetailEntries, vehicleClass);
    latestMixDetailHtml = buildHighwayDetailHtml("経由・乗降指定ルート 区間別ETC・動的割引判定", mixDetailEntries, vehicleClass);

    document.getElementById('hwIcDetailBox').innerHTML = latestHwDetailHtml;
    document.getElementById('mixIcDetailBox').innerHTML = latestMixDetailHtml;

    const weatherEl = document.getElementById('arrivalWeatherInfo');
    if (weatherEl && typeof fetchArrivalWeather === 'function') {
      const lastRes = hwLegs[hwLegs.length - 1]?.res;
      const destLat = lastRes?.destResolved?.lat;
      const destLng = lastRes?.destResolved?.lng;
      const wInfo = await fetchArrivalWeather(destLat, destLng, hwTimeInfo.end);
      weatherEl.innerText = wInfo ? `到着時天気（${wInfo.timeLabel}）: ${wInfo.label}` : '';
    }

    renderLeafletMap(hwCoords, loCoords);
    document.getElementById('resultsArea').style.display = 'block';
    updateSourceBadge();
  } catch (err) {
    alert(`ルート計算エラー: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerText = "🚀 3ルート一括比較・料金＆割引判定を計算";
  }
}

function openGoogleMapsRoute(modeType) {
  if (!currentOrigin || !currentDest) return;
  const originEnc = encodeURIComponent(formatForNavUrl(currentOrigin));
  const destEnc = encodeURIComponent(formatForNavUrl(currentDest));
  const cleanWps = waypoints.filter(w => w.name && w.name.trim()).map(w => encodeURIComponent(formatForNavUrl(w.name.trim())));
  let url = `https://www.google.com/maps/dir/?api=1&origin=${originEnc}&destination=${destEnc}&travelmode=driving`;
  if (cleanWps.length > 0) {
    url += `&waypoints=${cleanWps.join('%7C')}`;
  }
  if (modeType === 'local') {
    url += `&avoid=highways`;
  }
  window.open(url, '_blank', 'noopener');
}

function openYahooNaviRoute() {
  if (!currentOrigin || !currentDest) return;
  const originEnc = encodeURIComponent(formatForNavUrl(currentOrigin));
  const destEnc = encodeURIComponent(formatForNavUrl(currentDest));
  const url = `https://map.yahoo.co.jp/route/car?from=${originEnc}&to=${destEnc}`;
  window.open(url, '_blank', 'noopener');
}

window.addEventListener('DOMContentLoaded', () => {
  const savedActive = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (savedActive) {
    activeProfileName = savedActive;
  }
  setNowDateTime();
  loadActiveProfile();
  loadV5SettingsToUi();
  renderWaypoints();

  const v5Settings = getV5Settings();
  if (window.dynamicRulesEngine && typeof window.dynamicRulesEngine.initDynamicRules === 'function') {
    window.dynamicRulesEngine.initDynamicRules(v5Settings.customRulesUrl || "");
  }
});
