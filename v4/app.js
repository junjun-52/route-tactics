// ===== メイン制御・ルート検索・コスト計算・地図描画 =====
// ※外部公開する場合は Google Cloud Console で HTTPリファラー制限・API制限を設定してください
const API_KEY = "AIzaSyA-4TpNpWbRZMvQKvm2oP2KPi50KIvdvSA";
const MAX_WAYPOINTS = 5;

let currentOrigin = "";
let currentDest = "";
let currentMixLegs = []; // { from, to, avoidTolls }

// 経由地データ（最大5ヶ所）
let waypoints = []; // { name: "", modeAfter: "local" | "highway" }
let firstSegmentMode = "highway"; // 出発地 ➔ 経由地1 のモード

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ===== 経由地（MAX 5ヶ所）UI管理 =====
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
  const isFuture = baseDt.getTime() > Date.now() + 60000;
  const badge = document.getElementById('sourceInfoBadge');

  if (mode === 'departure' && isFuture) {
    badge.innerText = '料金・時間根拠: Google Routes API（指定出発日時の渋滞予測・ETC料金を直接参照）';
  } else if (mode === 'arrival') {
    badge.innerText = '料金・時間根拠: Google Routes API（現在条件の所要時間・ETC料金を参照し出発時刻を逆算）';
  } else {
    badge.innerText = '料金・時間根拠: Google Routes API（リアルタイム渋滞・ETC料金を直接参照）';
  }
}

// ===== Google Routes API =====
async function fetchRoute(originText, destinationText, avoidTolls, departureDate) {
  try {
    const payload = {
      origin: buildWaypointPayload(originText),
      destination: buildWaypointPayload(destinationText),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      routeModifiers: avoidTolls
        ? { avoidTolls: true }
        : { avoidTolls: false, tollPasses: ['JP_ETC'] },
      languageCode: 'ja',
      regionCode: 'JP'
    };

    if (!avoidTolls) {
      payload.extraComputations = ['TOLLS'];
    }

    if (departureDate && departureDate.getTime() > Date.now() + 60000) {
      payload.departureTime = departureDate.toISOString();
    }

    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.tollInfo,routes.legs.endLocation,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration'
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

// ===== 比較実行 =====
async function calculateAll() {
  let origin = document.getElementById('origin').value.trim();
  const dest = document.getElementById('destination').value.trim();
  const eff = parseFloat(document.getElementById('fuelEfficiency').value) || 15;
  const gas = parseFloat(document.getElementById('gasPrice').value) || 160;
  const timeMode = document.getElementById('timeMode').value;
  const baseDt = getSelectedDateTime();
  const apiDepartureDt = (timeMode === 'departure') ? baseDt : null;

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
  currentMixLegs = [];

  const validWps = waypoints
    .map(w => ({ name: w.name.trim(), modeAfter: w.modeAfter }))
    .filter(w => w.name !== "");

  const resultArea = document.getElementById('resultArea');
  const compareGrid = document.getElementById('compareGrid');
  const diffBanner = document.getElementById('diffBanner');
  const navButtons = document.getElementById('navButtons');
  const hwDetailWrap = document.getElementById('hwDetailWrap');

  resultArea.style.display = 'block';
  diffBanner.innerHTML = 'Google Routes API からルートとETC料金・IC詳細を取得中...';
  compareGrid.innerHTML = '';
  navButtons.style.display = 'none';
  hwDetailWrap.style.display = 'none';

  const [hwRoute, localRoute] = await Promise.all([
    fetchRoute(origin, dest, false, apiDepartureDt),
    fetchRoute(origin, dest, true, apiDepartureDt)
  ]);

  if (!hwRoute || !localRoute) {
    diffBanner.innerHTML = 'ルートの取得に失敗しました。地名または通信状況を確認してください。';
    return;
  }

  // 目的地の緯度・経度から天気予報を1回だけ取得（高速・下道・ミックスで共用）
  const destLatLng = hwRoute.legs?.[hwRoute.legs.length - 1]?.endLocation?.latLng;
  const weatherPromise = destLatLng
    ? fetchDestinationWeatherData(destLatLng.latitude, destLatLng.longitude)
    : Promise.resolve(null);

  const hwDist = hwRoute.distanceMeters / 1000;
  const hwSec = parseInt(hwRoute.duration.replace('s', ''), 10);
  const hwTimes = calcStartEndTime(baseDt, timeMode, hwSec);
  const hwGas = Math.round((hwDist / eff) * gas);
  const hwTollObj = extractApiToll(hwRoute, false);
  const hwToll = hwTollObj.toll;
  const hwTotal = hwGas + hwToll;

  const loDist = localRoute.distanceMeters / 1000;
  const loSec = parseInt(localRoute.duration.replace('s', ''), 10);
  const loTimes = calcStartEndTime(baseDt, timeMode, loSec);
  const loGas = Math.round((loDist / eff) * gas);
  const loTotal = loGas;

  // 全高速ルートの詳細HTML生成
  const hwEvents = extractHighwayEvents(hwRoute);
  latestHwDetailHtml = `
    <div class="hw-leg-block">
      <div class="hw-leg-head">
        <span>${escapeHtml(formatDisplayOrigin(origin))} ➔ ${escapeHtml(dest)}</span>
        <span class="hw-leg-toll">ETC料金: ${hwToll.toLocaleString()}円</span>
      </div>
      ${buildTimelineHtml(hwEvents)}
    </div>
  `;
  latestMixDetailHtml = "";

  let mixData = null;
  if (validWps.length > 0) {
    const legDefs = [];
    legDefs.push({ from: origin, to: validWps[0].name, avoidTolls: firstSegmentMode === 'local' });
    for (let i = 0; i < validWps.length; i++) {
      const to = (i === validWps.length - 1) ? dest : validWps[i + 1].name;
      legDefs.push({ from: validWps[i].name, to, avoidTolls: validWps[i].modeAfter === 'local' });
    }

    let totalDist = 0;
    let totalSec = 0;
    let totalToll = 0;
    let runningDt = apiDepartureDt ? new Date(apiDepartureDt.getTime()) : null;
    const polylines = [];
    const modeLabels = [];
    const mixLegDetailBlocks = [];
    let allSuccess = true;
    let hasHighwayLeg = false;

    for (let i = 0; i < legDefs.length; i++) {
      const leg = legDefs[i];
      const route = await fetchRoute(leg.from, leg.to, leg.avoidTolls, runningDt);
      if (!route) {
        allSuccess = false;
        break;
      }
      const d = route.distanceMeters / 1000;
      const s = parseInt(route.duration.replace('s', ''), 10);
      const tObj = extractApiToll(route, leg.avoidTolls);

      totalDist += d;
      totalSec += s;
      totalToll += tObj.toll;
      if (!leg.avoidTolls) hasHighwayLeg = true;
      if (runningDt) runningDt = new Date(runningDt.getTime() + s * 1000);

      polylines.push({
        poly: route.polyline.encodedPolyline,
        color: leg.avoidTolls ? '#f36c21' : '#14233c'
      });
      modeLabels.push(leg.avoidTolls ? '下道' : '高速');

      const modeTag = leg.avoidTolls ? '下道' : '高速';
      const legEvents = leg.avoidTolls ? [] : extractHighwayEvents(route);
      mixLegDetailBlocks.push(`
        <div class="hw-leg-block">
          <div class="hw-leg-head">
            <span>区間${i + 1} [${modeTag}]：${escapeHtml(formatDisplayOrigin(leg.from))} ➔ ${escapeHtml(formatDisplayOrigin(leg.to))}</span>
            <span class="hw-leg-toll">${leg.avoidTolls ? '0円' : `ETC: ${tObj.toll.toLocaleString()}円`}</span>
          </div>
          ${leg.avoidTolls
            ? `<div class="hw-empty">一般道区間（${d.toFixed(1)}km / ${formatDuration(s)}）</div>`
            : buildTimelineHtml(legEvents)}
        </div>
      `);
    }

    if (allSuccess) {
      currentMixLegs = legDefs;
      latestMixDetailHtml = mixLegDetailBlocks.join('');
      const mixTimes = calcStartEndTime(baseDt, timeMode, totalSec);
      const totalGas = Math.round((totalDist / eff) * gas);
      mixData = {
        dist: totalDist,
        sec: totalSec,
        timeText: mixTimes.text,
        endDate: mixTimes.end,
        gas: totalGas,
        toll: totalToll,
        sourceLabel: hasHighwayLeg ? '根拠: Google Routes API（ETC参照）' : '全区間 一般道優先（有料道路回避）',
        total: totalGas + totalToll,
        modeSummary: modeLabels.join('➔'),
        polylines,
        wpNames: validWps.map(w => w.name)
      };
    }
  }

  const weatherData = await weatherPromise;
  const hwWeatherHtml = getArrivalWeatherBadgeHtml(weatherData, hwTimes.end);
  const loWeatherHtml = getArrivalWeatherBadgeHtml(weatherData, loTimes.end);
  const mixWeatherHtml = mixData ? getArrivalWeatherBadgeHtml(weatherData, mixData.endDate) : '';

  if (!mixData) {
    const timeDiffMin = Math.round((loSec - hwSec) / 60);
    const costDiff = hwTotal - loTotal;

    diffBanner.innerHTML = timeDiffMin > 0
      ? `高速利用で ${timeDiffMin}分短縮（コスト差 ＋${costDiff.toLocaleString()}円）`
      : `一般道でも所要時間はほぼ同等（${Math.abs(costDiff).toLocaleString()}円コスト削減）`;

    compareGrid.className = 'compare-grid grid-2';
    compareGrid.innerHTML = `
      <div class="card highway">
        <div class="card-title"><span>全高速優先</span></div>
        <div class="time-schedule">${hwTimes.text}</div>
        ${hwWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${hwDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>所要時間</span><b>${formatDuration(hwSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><span>約${hwGas.toLocaleString()}円</span></div>
        <div class="metric-row"><span>高速料金</span><b>${hwToll.toLocaleString()}円</b></div>
        <div class="sub-info">${hwTollObj.sourceLabel}</div>
        <div class="price-big">計 ${hwTotal.toLocaleString()}円</div>
      </div>
      <div class="card local">
        <div class="card-title"><span>一般道（下道）</span></div>
        <div class="time-schedule">${loTimes.text}</div>
        ${loWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${loDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>所要時間</span><b>${formatDuration(loSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><span>約${loGas.toLocaleString()}円</span></div>
        <div class="metric-row"><span>高速料金</span><b>0円</b></div>
        <div class="sub-info">一般道優先（有料道路回避）</div>
        <div class="price-big">計 ${loTotal.toLocaleString()}円</div>
      </div>
    `;

    drawMap([
      { poly: hwRoute.polyline.encodedPolyline, color: '#14233c' },
      { poly: localRoute.polyline.encodedPolyline, color: '#1e7e48' }
    ]);

    navButtons.innerHTML = `
      <button class="btn-map" onclick="openGoogleMapsNormal(false)">Googleマップ（高速優先）でナビ開始</button>
      <button class="btn-map" style="background:var(--green);" onclick="openGoogleMapsNormal(true)">Googleマップ（一般道優先）でナビ開始</button>
    `;

    hwDetailWrap.style.display = 'block';
    document.getElementById('hwDetailBody').style.display = 'block';
    document.getElementById('hwDetailToggleText').innerText = '▲ 閉じる';
    switchHwDetailTab('hw');

  } else {
    const wpSummary = mixData.wpNames.map(n => escapeHtml(n)).join(' ➔ ');

    diffBanner.innerHTML = `3ルート戦略比較（経由地${mixData.wpNames.length}ヶ所: ${wpSummary}）`;
    compareGrid.className = 'compare-grid grid-3';
    compareGrid.innerHTML = `
      <div class="card highway">
        <div class="card-title"><span>全高速</span></div>
        <div class="time-schedule">${hwTimes.text}</div>
        ${hwWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${hwDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(hwSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><span>約${hwGas.toLocaleString()}円</span></div>
        <div class="metric-row"><span>高速代</span><b>${hwToll.toLocaleString()}円</b></div>
        <div class="sub-info">${hwTollObj.sourceLabel}</div>
        <div class="price-big">計 ${hwTotal.toLocaleString()}円</div>
      </div>
      <div class="card mix">
        <div class="card-title"><span style="color:var(--orange-dark);">ミックス (${mixData.modeSummary})</span></div>
        <div class="time-schedule">${mixData.timeText}</div>
        ${mixWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${mixData.dist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(mixData.sec)}</b></div>
        <div class="metric-row"><span>燃料費</span><span>約${mixData.gas.toLocaleString()}円</span></div>
        <div class="metric-row"><span>高速代</span><b>${mixData.toll.toLocaleString()}円</b></div>
        <div class="sub-info" style="color:var(--orange-dark);">${mixData.sourceLabel}</div>
        <div class="price-big">計 ${mixData.total.toLocaleString()}円</div>
      </div>
      <div class="card local">
        <div class="card-title"><span style="color:var(--green);">全下道</span></div>
        <div class="time-schedule">${loTimes.text}</div>
        ${loWeatherHtml}
        <div class="metric-row"><span>距離</span><b>${loDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(loSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><span>約${loGas.toLocaleString()}円</span></div>
        <div class="metric-row"><span>高速代</span><b>0円</b></div>
        <div class="sub-info">一般道優先（有料道路回避）</div>
        <div class="price-big">計 ${loTotal.toLocaleString()}円</div>
      </div>
    `;

    drawMap([
      ...mixData.polylines,
      { poly: localRoute.polyline.encodedPolyline, color: '#1e7e48' }
    ]);

    const legButtonsHtml = currentMixLegs.map((leg, idx) => {
      const fromLabel = escapeHtml(formatDisplayOrigin(leg.from));
      const toLabel = escapeHtml(formatDisplayOrigin(leg.to));
      const modeTag = leg.avoidTolls ? '下道' : '高速';
      const bg = (idx % 2 === 0) ? 'var(--orange)' : 'var(--orange-dark)';
      return `<button class="btn-map" style="background:${bg};" onclick="openGoogleMapsLeg(${idx})">区間${idx + 1} [${modeTag}] を開始（${fromLabel} ➔ ${toLabel}）</button>`;
    }).join('');

    navButtons.innerHTML = `
      <div class="nav-group-label">▼ ミックスルート 区間別ナビ開始（${currentMixLegs.length}区間）</div>
      ${legButtonsHtml}
      <button class="btn-map" style="background:var(--navy-light);" onclick="openGoogleMapsAllWaypoints()">全経由地まとめてGoogleマップで開く</button>
      <div class="nav-group-label">▼ 通常ルート 一括ナビ開始</div>
      <button class="btn-map" onclick="openGoogleMapsNormal(false)">全高速優先でナビ開始</button>
      <button class="btn-map" style="background:var(--green);" onclick="openGoogleMapsNormal(true)">全下道優先でナビ開始</button>
    `;

    hwDetailWrap.style.display = 'block';
    document.getElementById('hwDetailBody').style.display = 'block';
    document.getElementById('hwDetailToggleText').innerText = '▲ 閉じる';
    switchHwDetailTab('mix');
  }

  navButtons.style.display = 'block';
}

// ===== 地図・外部ナビ遷移 =====
function drawMap(polylines) {
  const mapDiv = document.getElementById('map');
  mapDiv.style.display = 'block';
  if (typeof google === 'undefined' || !google.maps) {
    mapDiv.innerHTML = '<div style="padding:20px; text-align:center; font-size:12px; color:#64748b;">地図の読み込み中またはAPI制限中です</div>';
    return;
  }

  const decodedList = polylines
    .filter(item => item.poly)
    .map(item => ({
      path: google.maps.geometry.encoding.decodePath(item.poly),
      color: item.color
    }))
    .filter(item => item.path.length > 0);

  if (decodedList.length === 0) return;

  const map = new google.maps.Map(mapDiv, {
    zoom: 11,
    center: decodedList[0].path[0]
  });
  const bounds = new google.maps.LatLngBounds();

  decodedList.forEach(item => {
    new google.maps.Polyline({
      path: item.path,
      geodesic: true,
      strokeColor: item.color,
      strokeOpacity: 0.9,
      strokeWeight: 5,
      map: map
    });
    item.path.forEach(pt => bounds.extend(pt));
  });
  map.fitBounds(bounds);
}

function openGoogleMapsNormal(avoidTolls) {
  const origParam = formatForGoogleMapsUrl(currentOrigin);
  const destParam = formatForGoogleMapsUrl(currentDest);
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
  if (avoidTolls) url += `&avoid=tolls`;
  window.open(url, '_blank');
}

function openGoogleMapsLeg(legIndex) {
  const leg = currentMixLegs[legIndex];
  if (!leg) return;
  const origin = formatForGoogleMapsUrl(leg.from);
  const destination = formatForGoogleMapsUrl(leg.to);
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  if (leg.avoidTolls) url += `&avoid=tolls`;
  window.open(url, '_blank');
}

function openGoogleMapsAllWaypoints() {
  const origParam = formatForGoogleMapsUrl(currentOrigin);
  const destParam = formatForGoogleMapsUrl(currentDest);
  const wpParams = waypoints
    .map(w => w.name.trim())
    .filter(n => n !== "")
    .map(n => formatForGoogleMapsUrl(n));
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
  if (wpParams.length > 0) {
    url += `&waypoints=${encodeURIComponent(wpParams.join('|'))}`;
  }
  window.open(url, '_blank');
}

// ===== 起動時初期化 =====
(function initApp() {
  const savedActive = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (savedActive) activeProfileName = savedActive;
  loadActiveProfile();
  renderWaypoints();
  setNowDateTime();
})();
