
app.js
100%
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

// ===== 高速の費用対効果（下道比・時間コスパ）HTML生成 =====
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

function buildDiscountHtml(discountSummary, baseToll) {
  if (!baseToll || baseToll <= 0) return '';
  if (discountSummary.totalSavings > 0) {
    const labels = discountSummary.appliedLabels.map(l => escapeHtml(l)).join(' / ');
    return `
      <div class="discount-pill ok">
        🏷️ ${labels}（-${discountSummary.totalSavings.toLocaleString()}円）
      </div>
    `;
  }
  const excludeNote = discountSummary.notes.find(n => n.includes('除外') || n.includes('対象外'));
  if (excludeNote) {
    return `<div class="discount-pill warn">${escapeHtml(excludeNote)}</div>`;
  }
  return '';
}

// ===== 比較実行 =====
async function calculateAll() {
  const settings = getV5Settings();
  const apiKey = (settings.hereApiKey || '').trim();
  if (!apiKey) {
    alert('HERE APIキーが未設定です。右上の「API・ルール設定」からHERE APIキーを入力してください。');
    openApiModal();
    return;
  }

  let origin = document.getElementById('origin').value.trim();
  const dest = document.getElementById('destination').value.trim();
  const eff = parseFloat(document.getElementById('fuelEfficiency').value) || 15;
  const gas = parseFloat(document.getElementById('gasPrice').value) || 160;
  const vehicleClass = document.getElementById('vehicleClass')?.value || 'standard';
  const timeMode = document.getElementById('timeMode').value;
  const baseDt = getSelectedDateTime();

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
  diffBanner.innerHTML = 'HERE API からルート・標準ETC料金を取得し、動的割引ルールを計算中...';
  compareGrid.innerHTML = '';
  navButtons.style.display = 'none';
  hwDetailWrap.style.display = 'none';

  let hwRes, localRes;
  try {
    [hwRes, localRes] = await Promise.all([
      fetchHereRoute(origin, dest, { apiKey, avoidTolls: false, vehicleClass, timeMode, targetDate: baseDt }),
      fetchHereRoute(origin, dest, { apiKey, avoidTolls: true, vehicleClass, timeMode, targetDate: baseDt })
    ]);
  } catch (err) {
    diffBanner.innerHTML = `ルート取得エラー: ${escapeHtml(err.message)}`;
    return;
  }

  // 目的地の緯度・経度から到着時天気予報を1回だけ取得
  const weatherPromise = hwRes.destPos
    ? fetchDestinationWeatherData(hwRes.destPos.lat, hwRes.destPos.lng)
    : Promise.resolve(null);

  const hwStats = aggregateHereRouteStats(hwRes.route);
  const hwDist = hwStats.lengthM / 1000;
  const hwSec = hwStats.durationSec;
  const hwTimes = calcStartEndTime(baseDt, timeMode, hwSec);
  const hwGas = Math.round((hwDist / eff) * gas);
  const hwTollObj = extractHereTolls(hwRes.route, false);
  const hwTimeline = extractHighwayTimelineFromHere(hwRes.route, hwTollObj.totalJpy, vehicleClass, hwTimes.start);
  const hwEffectiveToll = hwTimeline.discountSummary.totalDiscounted;
  const hwTotal = hwGas + hwEffectiveToll;

  const loStats = aggregateHereRouteStats(localRes.route);
  const loDist = loStats.lengthM / 1000;
  const loSec = loStats.durationSec;
  const loTimes = calcStartEndTime(baseDt, timeMode, loSec);
  const loGas = Math.round((loDist / eff) * gas);
  const loTotal = loGas;

  latestHwDetailHtml = `
    <div class="hw-leg-block">
      <div class="hw-leg-head">${escapeHtml(formatDisplayOrigin(origin))} ➔ ${escapeHtml(dest)}</div>
      ${buildTimelineHtml(hwTimeline.items)}
    </div>
  `;
  latestMixDetailHtml = "";

  // ミックスルート計算
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
    let totalBaseToll = 0;
    let totalDiscountedToll = 0;
    let runningDt = new Date(baseDt.getTime());
    const polylines = [];
    const modeLabels = [];
    const mixLegDetailBlocks = [];
    const mixAppliedLabels = new Set();
    const mixNotes = new Set();
    let allSuccess = true;
    let hasHighwayLeg = false;

    for (let i = 0; i < legDefs.length; i++) {
      const leg = legDefs[i];
      try {
        const legRes = await fetchHereRoute(leg.from, leg.to, {
          apiKey,
          avoidTolls: leg.avoidTolls,
          vehicleClass,
          timeMode: 'departure',
          targetDate: runningDt
        });
        const st = aggregateHereRouteStats(legRes.route);
        const d = st.lengthM / 1000;
        const s = st.durationSec;
        const tObj = extractHereTolls(legRes.route, leg.avoidTolls);

        let legEffToll = 0;
        let legTimelineItems = [];
        if (!leg.avoidTolls) {
          hasHighwayLeg = true;
          const tl = extractHighwayTimelineFromHere(legRes.route, tObj.totalJpy, vehicleClass, runningDt);
          legTimelineItems = tl.items;
          legEffToll = tl.discountSummary.totalDiscounted;
          tl.discountSummary.appliedLabels.forEach(l => mixAppliedLabels.add(l));
          tl.discountSummary.notes.forEach(n => mixNotes.add(n));
        }

        totalDist += d;
        totalSec += s;
        totalBaseToll += tObj.totalJpy;
        totalDiscountedToll += legEffToll;
        runningDt = new Date(runningDt.getTime() + s * 1000);

        st.polylines.forEach(p => {
          polylines.push({
            poly: p,
            color: leg.avoidTolls ? '#f36c21' : '#14233c'
          });
        });
        modeLabels.push(leg.avoidTolls ? '下道' : '高速');

        const modeTag = leg.avoidTolls ? '下道' : '高速';
        mixLegDetailBlocks.push(`
          <div class="hw-leg-block">
            <div class="hw-leg-head">区間${i + 1} [${modeTag}]：${escapeHtml(formatDisplayOrigin(leg.from))} ➔ ${escapeHtml(formatDisplayOrigin(leg.to))}</div>
            ${leg.avoidTolls
              ? `<div class="hw-empty">一般道区間（${d.toFixed(1)}km / ${formatDuration(s)}）</div>`
              : buildTimelineHtml(legTimelineItems)}
          </div>
        `);
      } catch (e) {
        allSuccess = false;
        break;
      }
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
        baseToll: totalBaseToll,
        toll: totalDiscountedToll,
        discountSummary: {
          totalBase: totalBaseToll,
          totalDiscounted: totalDiscountedToll,
          totalSavings: Math.max(0, totalBaseToll - totalDiscountedToll),
          appliedLabels: Array.from(mixAppliedLabels),
          notes: Array.from(mixNotes)
        },
        sourceLabel: hasHighwayLeg ? '根拠: HERE Routing v8 ＋ 動的ETC割引' : '全区間 一般道優先（有料道路回避）',
        total: totalGas + totalDiscountedToll,
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

  const hwRoiHtml = buildRoiRowsHtml(hwTotal, hwSec, loTotal, loSec, false);
  const loRoiHtml = buildRoiRowsHtml(loTotal, loSec, loTotal, loSec, true);
  const hwDiscountHtml = buildDiscountHtml(hwTimeline.discountSummary, hwTollObj.totalJpy);

  const hwTollDisplay = hwTimeline.discountSummary.totalSavings > 0
    ? `<span class="strike-price">${hwTollObj.totalJpy.toLocaleString()}円</span> ➔ ${hwEffectiveToll.toLocaleString()}円`
    : `${hwEffectiveToll.toLocaleString()}円`;

  if (!mixData) {
    const timeDiffMin = Math.round((loSec - hwSec) / 60);
    const costDiff = hwTotal - loTotal;

    diffBanner.innerHTML = timeDiffMin > 0
      ? `高速利用で ${formatShortDurationFromMin(timeDiffMin)}短縮（コスト差 ＋${costDiff.toLocaleString()}円）`
      : `一般道でも所要時間はほぼ同等（${Math.abs(costDiff).toLocaleString()}円コスト削減）`;

    compareGrid.className = 'compare-grid grid-2';
    compareGrid.innerHTML = `
      <div class="card highway">
        <div class="card-title"><span>全高速優先</span></div>
        <div class="time-schedule">${hwTimes.text}</div>
        ${hwWeatherHtml}
        ${hwDiscountHtml}
        <div class="metric-row"><span>距離</span><b>${hwDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>所要時間</span><b>${formatDuration(hwSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${hwGas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速料金</span><b>${hwTollDisplay}</b></div>
        ${hwRoiHtml}
        <div class="sub-info">${hwTollObj.sourceLabel}</div>
        <div class="price-big">計 ${hwTotal.toLocaleString()}円</div>
      </div>
      <div class="card local">
        <div class="card-title"><span>一般道（下道）</span></div>
        <div class="time-schedule">${loTimes.text}</div>
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
      ...hwStats.polylines.map(p => ({ poly: p, color: '#14233c' })),
      ...loStats.polylines.map(p => ({ poly: p, color: '#1e7e48' }))
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
    const mixRoiHtml = buildRoiRowsHtml(mixData.total, mixData.sec, loTotal, loSec, false);
    const mixDiscountHtml = buildDiscountHtml(mixData.discountSummary, mixData.baseToll);
    const mixTollDisplay = mixData.discountSummary.totalSavings > 0
      ? `<span class="strike-price">${mixData.baseToll.toLocaleString()}円</span> ➔ ${mixData.toll.toLocaleString()}円`
      : `${mixData.toll.toLocaleString()}円`;

    diffBanner.innerHTML = `3ルート戦略比較（経由地${mixData.wpNames.length}ヶ所: ${wpSummary}）`;
    compareGrid.className = 'compare-grid grid-3';
    compareGrid.innerHTML = `
      <div class="card highway">
        <div class="card-title"><span>全高速</span></div>
        <div class="time-schedule">${hwTimes.text}</div>
        ${hwWeatherHtml}
        ${hwDiscountHtml}
        <div class="metric-row"><span>距離</span><b>${hwDist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(hwSec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${hwGas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速代</span><b>${hwTollDisplay}</b></div>
        ${hwRoiHtml}
        <div class="sub-info">${hwTollObj.sourceLabel}</div>
        <div class="price-big">計 ${hwTotal.toLocaleString()}円</div>
      </div>
      <div class="card mix">
        <div class="card-title"><span style="color:var(--orange-dark);">ミックス (${mixData.modeSummary})</span></div>
        <div class="time-schedule">${mixData.timeText}</div>
        ${mixWeatherHtml}
        ${mixDiscountHtml}
        <div class="metric-row"><span>距離</span><b>${mixData.dist.toFixed(1)} km</b></div>
        <div class="metric-row"><span>時間</span><b>${formatDuration(mixData.sec)}</b></div>
        <div class="metric-row"><span>燃料費</span><b>約${mixData.gas.toLocaleString()}円</b></div>
        <div class="metric-row"><span>高速代</span><b>${mixTollDisplay}</b></div>
        ${mixRoiHtml}
        <div class="sub-info" style="color:var(--orange-dark);">${mixData.sourceLabel}</div>
        <div class="price-big">計 ${mixData.total.toLocaleString()}円</div>
      </div>
      <div class="card local">
        <div class="card-title"><span style="color:var(--green);">全下道</span></div>
        <div class="time-schedule">${loTimes.text}</div>
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
      ...loStats.polylines.map(p => ({ poly: p, color: '#1e7e48' }))
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

// ===== Leaflet地図描画（HERE Flexible Polyline使用） =====
function drawMap(polylines) {
  const mapDiv = document.getElementById('map');
  mapDiv.style.display = 'block';

  if (typeof L === 'undefined' || typeof decodeFlexiblePolyline !== 'function') {
    mapDiv.innerHTML = '<div style="padding:20px; text-align:center; font-size:12px; color:#64748b;">地図ライブラリ読込中...</div>';
    return;
  }

  if (leafletMapInstance) {
    leafletMapInstance.remove();
    leafletMapInstance = null;
  }

  leafletMapInstance = L.map('map');
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(leafletMapInstance);

  const bounds = L.latLngBounds([]);
  let hasPoints = false;

  polylines.forEach(item => {
    if (!item.poly) return;
    try {
      const pts = decodeFlexiblePolyline(item.poly).map(c => [c.lat, c.lng]);
      if (pts.length > 0) {
        hasPoints = true;
        L.polyline(pts, { color: item.color, weight: 5, opacity: 0.88 }).addTo(leafletMapInstance);
        pts.forEach(pt => bounds.extend(pt));
      }
    } catch (e) {}
  });

  if (hasPoints) {
    leafletMapInstance.fitBounds(bounds, { padding: [20, 20] });
  }
}

function openGoogleMapsNormal(avoidTolls) {
  const origParam = formatForNavUrl(currentOrigin);
  const destParam = formatForNavUrl(currentDest);
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
  if (avoidTolls) url += `&avoid=tolls`;
  window.open(url, '_blank');
}

function openGoogleMapsLeg(legIndex) {
  const leg = currentMixLegs[legIndex];
  if (!leg) return;
  const origin = formatForNavUrl(leg.from);
  const destination = formatForNavUrl(leg.to);
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  if (leg.avoidTolls) url += `&avoid=tolls`;
  window.open(url, '_blank');
}

function openGoogleMapsAllWaypoints() {
  const origParam = formatForNavUrl(currentOrigin);
  const destParam = formatForNavUrl(currentDest);
  const wpParams = waypoints
    .map(w => w.name.trim())
    .filter(n => n !== "")
    .map(n => formatForNavUrl(n));
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origParam)}&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
  if (wpParams.length > 0) {
    url += `&waypoints=${encodeURIComponent(wpParams.join('|'))}`;
  }
  window.open(url, '_blank');
}

// ===== 起動時初期化 =====
(async function initApp() {
  const savedActive = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (savedActive) activeProfileName = savedActive;
  loadActiveProfile();
  loadV5SettingsToUi();
  renderWaypoints();
  setNowDateTime();

  const settings = getV5Settings();
  if (typeof initDynamicRules === 'function') {
    await initDynamicRules(settings.customRulesUrl);
  }
})();
1 / 2 ページ
