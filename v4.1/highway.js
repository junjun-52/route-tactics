// ===== 有料区間の入口IC・出口IC・区間別ETC料金タイムライン (V4.1.3) =====
let latestHwDetailHtml = "";
let latestMixDetailHtml = "";

const ROAD_NAME_RE = /([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|高速[0-9０-９号線]*|名二環|伊勢湾岸|セントレアライン|知多半島道路|知多横断道路|南知多道路|東海環状|東海北陸|東名|名神|新東名|新名神|中央道|北陸道|関越|東北道|常磐道|山陽道|中国道|九州道|圏央道|外環|首都高|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速))/g;
const OPERATOR_LABELS = {
  urban_nagoya: "名古屋高速", urban_tokyo: "首都高速", urban_hanshin: "阪神高速",
  urban_fukuoka: "福岡・北九州高速", urban_hiroshima: "広島高速",
  public_aichi: "知多半島・セントレアライン", honshi: "本四高速", nexco: "NEXCO高速"
};

function normalizeRoadName(name) {
  if (!name) return "";
  const s = name.replace(/[０-９Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  if (s === "第二東海自動車道" || s === "新東名") return "新東名高速道路";
  if (s === "名二環") return "名古屋第二環状自動車道";
  if (s === "東京都自動車道") return "首都高速";
  return s;
}

function detectTollOperator(roadName) {
  if (!roadName) return null;
  if (/名古屋高速/.test(roadName)) return "urban_nagoya";
  if (/首都高|東京都自動車道/.test(roadName)) return "urban_tokyo";
  if (/阪神高速/.test(roadName)) return "urban_hanshin";
  if (/福岡高速|北九州高速/.test(roadName)) return "urban_fukuoka";
  if (/広島高速/.test(roadName)) return "urban_hiroshima";
  if (/知多半島道路|セントレアライン|知多横断道路|南知多道路/.test(roadName)) return "public_aichi";
  if (/神戸淡路鳴門|瀬戸中央|西瀬戸|しまなみ/.test(roadName)) return "honshi";
  return "nexco";
}

function extractDrivingRoad(inst) {
  if (!inst) return "";
  const withoutDir = inst.replace(/[^\s\/（）()]+?\s*方面の\s*/g, "");
  const m = withoutDir.match(ROAD_NAME_RE) || inst.match(ROAD_NAME_RE);
  return (m && m.length > 0) ? normalizeRoadName(m[m.length - 1]) : "";
}

function extractFacilityName(inst, role) {
  if (!inst) return null;
  const explicit = inst.match(/([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15}?(?:スマートIC|スマートＩＣ|IC|ＩＣ|JCT|ＪＣＴ|本線料金所|料金所|出入口))/g);
  if (explicit) {
    for (const m of explicit) {
      if (/^(料金所|出入口)$/.test(m)) continue;
      if (role !== "switch" && /(JCT|ＪＣＴ)$/.test(m)) continue;
      return m.replace(/ＩＣ/g, "IC").replace(/ＪＣＴ/g, "JCT");
    }
  }
  const ioRe = /([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15})\s*(入口|出口)/g;
  let m;
  while ((m = ioRe.exec(inst)) !== null) {
    if (/(?:の|を|に|へ|から|まで|方面|ランプ|車線|方向|右側|左側|有料区間|有料道路)$/.test(m[1])) continue;
    if (new RegExp(ROAD_NAME_RE.source).test(m[1])) continue;
    return `${m[1]}${m[2]}`;
  }
  const signMatch = inst.match(/[（(]([^（）()\/]+?)\s*の表示[）)]/);
  if (signMatch) {
    const t = signMatch[1].trim();
    if (!new RegExp(ROAD_NAME_RE.source).test(t) && !/^(国道|県道|都道|府道|市道|市街|方面|一般道|有料)/.test(t) && t.length >= 2 && t.length <= 12) {
      if (role === "entry" && !/(入口|IC)$/.test(t)) return `${t}入口`;
      if (role === "exit" && !/(出口|IC)$/.test(t)) return `${t}出口`;
      return t;
    }
  }
  if (role === "exit") {
    const exitDir = inst.match(/出口を\s*([一-龠ァ-ヶーA-Za-z0-9０-９]{2,12}?)\s*方面/);
    if (exitDir && !new RegExp(ROAD_NAME_RE.source).test(exitDir[1]) && !/^(市街|方面|国道|県道)/.test(exitDir[1])) {
      return `${exitDir[1]}出口`;
    }
  }
  return null;
}

function calcNodeDistMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildCumulativePath(encoded) {
  if (!encoded) return [];
  let pts = [];
  if (typeof google !== "undefined" && google.maps?.geometry?.encoding) {
    pts = google.maps.geometry.encoding.decodePath(encoded).map(p => ({ latitude: p.lat(), longitude: p.lng() }));
  } else {
    let idx = 0, lat = 0, lng = 0;
    while (idx < encoded.length) {
      let b, shift = 0, res = 0;
      do { b = encoded.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (res & 1) ? ~(res >> 1) : (res >> 1); shift = 0; res = 0;
      do { b = encoded.charCodeAt(idx++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (res & 1) ? ~(res >> 1) : (res >> 1);
      pts.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }
  }
  if (!pts.length) return [];
  const cum = [{ latitude: pts[0].latitude, longitude: pts[0].longitude, distM: 0 }];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += calcNodeDistMeters(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
    cum.push({ latitude: pts[i].latitude, longitude: pts[i].longitude, distM: total });
  }
  return cum;
}

function getCoordsAtDistance(cumPath, targetDistM) {
  if (!cumPath.length) return null;
  if (targetDistM <= 0) return { latitude: cumPath[0].latitude, longitude: cumPath[0].longitude };
  const last = cumPath[cumPath.length - 1];
  if (targetDistM >= last.distM) return { latitude: last.latitude, longitude: last.longitude };
  const found = cumPath.find(p => p.distM >= targetDistM) || last;
  return { latitude: found.latitude, longitude: found.longitude };
}

function cleanAndValidateFacility(rawName, role, allowBareName = false) {
  if (!rawName) return null;
  let name = String(rawName).replace(/\s+/g, "").replace(/ＩＣ/g, "IC").replace(/ＪＣＴ/g, "JCT")
    .replace(/インターチェンジ/g, "IC").replace(/ジャンクション/g, "JCT")
    .replace(/^(?:名古屋高速[0-9号一宮線小牧線清須線都心環状線大高線東山線万場線楠線黒川線東海線]*|首都高速[0-9号渋谷線新宿線池袋線上野線向島線深川線台場線湾岸線都心環状線]*|阪神高速[0-9号線]*|東名高速道路|名神高速道路|新東名高速道路|名古屋第二環状自動車道|伊勢湾岸自動車道|東海北陸自動車道)/, "");
  if (!name || name.length < 2 || name.length > 18 || /^(入口|出口|出入口|料金所|IC|JCT|ランプ)$/.test(name)) return null;
  if (role === "entry" && /出口$/.test(name) && !/出入口$/.test(name)) return null;
  if (role === "exit" && /入口$/.test(name) && !/出入口$/.test(name)) return null;
  if (/(スマートIC|IC|JCT|入口|出口|出入口|料金所|ランプ)/.test(name)) return name;
  if (allowBareName && !new RegExp(ROAD_NAME_RE.source).test(name)) {
    return role === "entry" ? `${name}入口` : role === "exit" ? `${name}出口` : `${name}IC/JCT`;
  }
  return null;
}

async function searchOsmMotorwayJunction(lat, lng, role, radiusM = 1100) {
  try {
    const q = `[out:json][timeout:6];(node["highway"="motorway_junction"]["name"](around:${radiusM},${lat},${lng});way["highway"="motorway_link"]["name"](around:${radiusM},${lat},${lng});node["barrier"="toll_booth"]["name"](around:${radiusM},${lat},${lng}););out center;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: "data=" + encodeURIComponent(q)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const candidates = [];
    for (const el of (data.elements || [])) {
      const eLat = el.lat ?? el.center?.lat, eLon = el.lon ?? el.center?.lon;
      if (typeof eLat !== "number" || typeof eLon !== "number") continue;
      const valid = cleanAndValidateFacility(el.tags?.name || el.tags?.["name:ja"] || "", role, true);
      if (!valid) continue;
      const dist = calcNodeDistMeters(lat, lng, eLat, eLon);
      const score = (role !== "switch" && /JCT$/.test(valid)) ? dist + 2000 : dist;
      candidates.push({ name: valid, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.length ? candidates[0].name : null;
  } catch (e) { return null; }
}

async function searchTomtomFacility(lat, lng, role) {
  const ttKey = (typeof getTomtomApiKey === "function") ? getTomtomApiKey() : "";
  if (!ttKey) return null;
  const kwMap = { entry: ["入口", "IC", "出入口"], exit: ["出口", "IC", "出入口"], switch: ["JCT", "料金所", "IC"] };
  try {
    const [revData, ...sDatas] = await Promise.all([
      fetch(`https://api.tomtom.com/search/2/reverseGeocode/${lat},${lng}.json?key=${encodeURIComponent(ttKey)}&language=ja-JP&radius=300`).then(r => r.ok ? r.json() : null).catch(() => null),
      ...(kwMap[role] || ["IC", "JCT"]).map(kw =>
        fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent(kw)}.json?key=${encodeURIComponent(ttKey)}&lat=${lat}&lon=${lng}&radius=1200&limit=8&language=ja-JP`).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    ]);
    let best = null;
    for (const d of sDatas) {
      for (const r of (d?.results || [])) {
        const valid = cleanAndValidateFacility(r.poi?.name || r.address?.freeformAddress || "", role, false);
        if (valid && (!best || (r.dist ?? 999) < best.dist)) best = { name: valid, dist: r.dist ?? 999 };
      }
    }
    if (best) return best.name;
    for (const item of (revData?.addresses || [])) {
      const a = item.address || {};
      for (const c of [a.streetName, a.freeformAddress, a.localName]) {
        const m = c && String(c).match(/([一-龠ァ-ヶーA-Za-z0-9]{2,12}(?:スマートIC|IC|JCT|入口|出口|出入口|料金所))/);
        const valid = m && cleanAndValidateFacility(m[1], role, false);
        if (valid) return valid;
      }
    }
  } catch (e) {}
  return null;
}

async function lookupNearestFacilityByCoords(coordList, role) {
  const coords = (Array.isArray(coordList) ? coordList : [coordList]).filter(c => c && typeof c.latitude === "number");
  if (!coords.length) return null;
  const [osmHits, ttHit] = await Promise.all([
    Promise.all(coords.map(c => searchOsmMotorwayJunction(c.latitude, c.longitude, role, 1100))),
    searchTomtomFacility(coords[0].latitude, coords[0].longitude, role)
  ]);
  return osmHits.find(Boolean) || ttHit || null;
}

async function resolveMissingFacilityNames(items) {
  if (!Array.isArray(items) || !items.length) return items;
  await Promise.all(items.map(async (item) => {
    if (item.kind !== "node" || !item.needsLookup) return;
    const resolved = await lookupNearestFacilityByCoords(item.coordCandidates || item.latLng, item.type);
    if (resolved) {
      item.name = (item.type === "switch" && item.switchTransition) ? `${resolved}（${item.switchTransition}）` : resolved;
    } else if (item.type === "entry") {
      item.name = item.roadHint ? `${item.roadHint} 進入ランプ` : "有料区間 進入IC";
    } else if (item.type === "exit") {
      item.name = item.roadHint ? `${item.roadHint} 流出ランプ` : "有料区間 流出IC";
    } else {
      item.name = item.switchTransition || "路線切替・料金所";
    }
    delete item.needsLookup;
  }));
  return items;
}

function allocateSegmentTolls(segments, totalLegToll) {
  if (!segments?.length) return;
  if (!totalLegToll || totalLegToll <= 0) { segments.forEach(s => { s.toll = 0; s.isEstimated = false; }); return; }
  if (segments.length === 1) { segments[0].toll = totalLegToll; segments[0].isEstimated = false; return; }
  const weights = segments.map(seg => {
    const km = seg.distM / 1000;
    if (seg.operator?.startsWith("urban_")) return Math.min(1320, Math.max(300, 300 + km * 45));
    if (seg.operator === "public_aichi") return Math.max(200, 150 + km * 28);
    return Math.max(300, 150 + km * 24.6);
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let alloc = 0;
  segments.forEach((seg, i) => {
    seg.isEstimated = true;
    if (i === segments.length - 1) seg.toll = Math.max(0, totalLegToll - alloc);
    else { seg.toll = Math.round(((totalLegToll * weights[i]) / sum) / 10) * 10; alloc += seg.toll; }
  });
}

function extractHighwayTimeline(route, legToll) {
  const items = [];
  if (!route || !Array.isArray(route.legs)) return items;
  const cumPath = buildCumulativePath(route.polyline?.encodedPolyline || "");
  let cumDistM = 0;
  const segments = [];
  let currentSeg = null, lastEndedSeg = null, currentOperator = null, currentRoad = "";

  const startNewSegment = (roadName, operator) => {
    currentSeg = { kind: "seg", roads: roadName ? [roadName] : [], distM: 0, sec: 0, operator: operator || "nexco", toll: 0, isEstimated: false };
    segments.push(currentSeg);
    items.push(currentSeg);
  };

  for (const leg of route.legs) {
    const steps = leg.steps || [];
    let inToll = false, exitingToll = false;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const inst = (step?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim();
      const maneuver = step?.navigationInstruction?.maneuver || "";
      const distM = step.distanceMeters || 0;
      const sec = parseInt((step.staticDuration || "0s").replace("s", ""), 10) || 0;
      const stepStartDist = cumDistM;
      cumDistM += distM;
      const stepLatLng = step.startLocation?.latLng || getCoordsAtDistance(cumPath, stepStartDist);

      const hasTollTag = /有料区間|有料道路/.test(inst);
      const stepRoad = extractDrivingRoad(inst);
      const isGeneralRoad = /(国道|県道|府道|都道|市道|町道|通り|交差点)/.test(inst);
      const isExitManeuver = maneuver.includes("OFF_RAMP") || /出口を|出口へ|降りる|出る/.test(inst);
      const isTollStep = hasTollTag || (inToll && !isGeneralRoad && !isExitManeuver);

      if (!isTollStep) {
        if (inToll) {
          let exitName = extractFacilityName(inst, "exit") || (i > 0 ? extractFacilityName((steps[i - 1]?.navigationInstruction?.instructions || "").replace(/\n+/g, " "), "exit") : null);
          const prevDist = i > 0 ? (steps[i - 1]?.distanceMeters || 0) : 0;
          items.push({
            kind: "node", type: "exit", badgeText: "出口",
            name: exitName || (currentRoad ? `${currentRoad}（流出IC）` : "有料区間出口"),
            needsLookup: !exitName, coordCandidates: [getCoordsAtDistance(cumPath, Math.max(0, stepStartDist - prevDist)), stepLatLng], roadHint: currentRoad
          });
        }
        inToll = false; exitingToll = false; currentSeg = null; lastEndedSeg = null; currentOperator = null; currentRoad = "";
        continue;
      }

      const effectiveRoad = stepRoad || currentRoad;
      const stepOp = detectTollOperator(effectiveRoad) || currentOperator || "nexco";
      const isTollGate = /本線料金所|料金所/.test(inst);

      if (exitingToll) {
        if (!(/入口|に入る|合流/.test(inst) && !isExitManeuver && !isTollGate && !isGeneralRoad)) {
          if (lastEndedSeg) { lastEndedSeg.distM += distM; lastEndedSeg.sec += sec; }
          continue;
        }
        exitingToll = false;
      }

      if (!inToll) {
        inToll = true; currentRoad = effectiveRoad; currentOperator = stepOp;
        let entryName = extractFacilityName(inst, "entry");
        const coordCandidates = [stepLatLng];
        if (i > 0) {
          const prevStep = steps[i - 1], prevInst = (prevStep?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim(), prevDist = prevStep?.distanceMeters || 0;
          if (!entryName) entryName = extractFacilityName(prevInst, "entry");
          if (prevDist < 1500) {
            const rampCoord = prevStep?.startLocation?.latLng || getCoordsAtDistance(cumPath, Math.max(0, stepStartDist - prevDist));
            if (rampCoord) coordCandidates.unshift(rampCoord);
          }
        }
        for (let b = 2; b <= 3 && !entryName && (i - b) >= 0; b++) {
          entryName = extractFacilityName((steps[i - b]?.navigationInstruction?.instructions || "").replace(/\n+/g, " "), "entry");
        }
        items.push({
          kind: "node", type: "entry", badgeText: "入口",
          name: entryName || (effectiveRoad ? `${effectiveRoad}（進入IC）` : "有料区間入口"),
          needsLookup: !entryName, coordCandidates, roadHint: effectiveRoad
        });
        startNewSegment(effectiveRoad, stepOp);
        currentSeg.distM += distM; currentSeg.sec += sec;
        continue;
      }

      const nextInst = (i + 1 < steps.length) ? (steps[i + 1]?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim() : "";
      const nextIsToll = /有料区間|有料道路/.test(nextInst) || Boolean(extractDrivingRoad(nextInst));
      if ((currentOperator && stepOp && currentOperator !== stepOp) || (isExitManeuver && nextIsToll && !isGeneralRoad) || (isTollGate && !isExitManeuver)) {
        const pointName = extractFacilityName(inst, "switch") || extractFacilityName(nextInst, "switch") || (i > 0 ? extractFacilityName((steps[i - 1]?.navigationInstruction?.instructions || "").replace(/\n+/g, " "), "switch") : null);
        const nextRoad = extractDrivingRoad(nextInst) || effectiveRoad;
        const nextOp = detectTollOperator(nextRoad) || stepOp;
        const opTransition = (currentOperator && nextOp && currentOperator !== nextOp) ? `${OPERATOR_LABELS[currentOperator] || "高速"} ➔ ${OPERATOR_LABELS[nextOp] || "高速"}` : "料金所通過";
        items.push({
          kind: "node", type: "switch", badgeText: "切替",
          name: pointName ? `${pointName}（${opTransition}）` : opTransition,
          needsLookup: !pointName, coordCandidates: [stepLatLng, getCoordsAtDistance(cumPath, stepStartDist + Math.min(distM, 400))], roadHint: nextRoad, switchTransition: opTransition
        });
        currentOperator = nextOp; currentRoad = nextRoad;
        startNewSegment(nextRoad, nextOp);
        currentSeg.distM += distM; currentSeg.sec += sec;
        continue;
      }

      if (effectiveRoad) {
        currentRoad = effectiveRoad;
        if (currentSeg && !currentSeg.roads.includes(effectiveRoad)) currentSeg.roads.push(effectiveRoad);
      }
      if (currentSeg) { currentSeg.distM += distM; currentSeg.sec += sec; }

      if (isExitManeuver) {
        const exitName = extractFacilityName(inst, "exit") || extractFacilityName(nextInst, "exit");
        items.push({
          kind: "node", type: "exit", badgeText: "出口",
          name: exitName || (effectiveRoad ? `${effectiveRoad}（流出IC）` : "有料区間出口"),
          needsLookup: !exitName, coordCandidates: [stepLatLng, getCoordsAtDistance(cumPath, cumDistM)], roadHint: effectiveRoad
        });
        lastEndedSeg = currentSeg; currentSeg = null; inToll = false; exitingToll = true; currentOperator = null; currentRoad = "";
      }
    }
  }
  allocateSegmentTolls(segments, legToll);
  return items;
}

function buildTimelineHtml(items) {
  if (!items?.length) return `<div class="hw-empty">有料区間のIC情報は検出されませんでした。</div>`;
  const html = items.map(item => item.kind === "node"
    ? `<div class="hw-node ${item.type}"><span class="hw-node-dot"></span><span class="hw-badge ${item.type}">${item.badgeText}</span><b>${escapeHtml(item.name)}</b></div>`
    : `<div class="hw-seg-box"><div class="hw-seg-info"><div class="hw-seg-road">${escapeHtml(item.roads.length ? item.roads.join(" ➔ ") : "有料道路区間")}</div><div class="hw-seg-meta">${(item.distM / 1000).toFixed(1)} km ／ 約${Math.max(1, Math.round(item.sec / 60))}分</div></div><div class="hw-seg-toll"><span class="hw-seg-toll-tag">${item.isEstimated ? "ETC目安" : "ETC"}</span><span class="hw-seg-toll-val">${item.toll.toLocaleString()}円</span></div></div>`
  ).join('');
  return `<div class="hw-timeline">${html}</div>`;
}

function toggleHwDetailBody() {
  const body = document.getElementById('hwDetailBody'), toggle = document.getElementById('hwDetailToggleText');
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  toggle.innerText = isHidden ? '▲ 閉じる' : '▼ 開く';
}

function switchHwDetailTab(tab) {
  const body = document.getElementById('hwDetailBody');
  if (!latestMixDetailHtml) { body.innerHTML = latestHwDetailHtml; return; }
  body.innerHTML = `<div class="hw-tabs"><button type="button" class="hw-tab-btn ${tab === 'mix' ? 'active mix-tab' : ''}" onclick="switchHwDetailTab('mix')">ミックスルート詳細</button><button type="button" class="hw-tab-btn ${tab === 'hw' ? 'active' : ''}" onclick="switchHwDetailTab('hw')">全高速ルート詳細</button></div><div>${tab === 'mix' ? latestMixDetailHtml : latestHwDetailHtml}</div>`;
}
