// ===== 動的道路データ参照型 有料区間IC・JCT・ETCタイムライン (V4.1.7) =====
let latestHwDetailHtml = "", latestMixDetailHtml = "";
const ROAD_RE = /([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|連絡道路|高速[0-9０-９号線]*|名二環|伊勢湾岸|セントレアライン|知多半島道路|知多横断道路|南知多道路|東海環状|東海北陸|東名|名神|新東名|新名神|中央道|北陸道|関越|東北道|常磐道|山陽道|中国道|九州道|圏央道|外環|首都高|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速))/g;
const OP_LABELS = { urban_nagoya: "名古屋高速", urban_tokyo: "首都高速", urban_hanshin: "阪神高速", urban_fukuoka: "福岡・北九州高速", urban_hiroshima: "広島高速", public_aichi: "知多半島・セントレアライン", honshi: "本四高速", nexco: "NEXCO高速" };

function normRoad(s) {
  if (!s) return "";
  s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, "");
  if (/第二東海|新東名/.test(s)) return "新東名高速道路";
  if (/名二環/.test(s)) return "名古屋第二環状自動車道";
  if (/東京都自動車道/.test(s)) return "首都高速";
  return s;
}
function getOp(r) {
  if (!r) return "nexco";
  if (/名古屋高速/.test(r)) return "urban_nagoya";
  if (/首都高/.test(r)) return "urban_tokyo";
  if (/阪神高速/.test(r)) return "urban_hanshin";
  if (/福岡高速|北九州高速/.test(r)) return "urban_fukuoka";
  if (/広島高速/.test(r)) return "urban_hiroshima";
  if (/知多半島|セントレア|知多横断|南知多|連絡道路/.test(r)) return "public_aichi";
  if (/神戸淡路|瀬戸中央|西瀬戸|しまなみ/.test(r)) return "honshi";
  return "nexco";
}
function distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function decodeCumPath(encoded) {
  if (!encoded) return [];
  let pts = [];
  if (typeof google !== "undefined" && google.maps?.geometry?.encoding) {
    pts = google.maps.geometry.encoding.decodePath(encoded).map(p => ({ lat: p.lat(), lng: p.lng() }));
  } else {
    let i = 0, lat = 0, lng = 0;
    while (i < encoded.length) {
      let b, s = 0, r = 0;
      do { b = encoded.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
      lat += (r & 1) ? ~(r >> 1) : (r >> 1); s = 0; r = 0;
      do { b = encoded.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
      lng += (r & 1) ? ~(r >> 1) : (r >> 1);
      pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
  }
  let total = 0;
  return pts.map((p, idx) => {
    if (idx > 0) total += distM(pts[idx - 1].lat, pts[idx - 1].lng, p.lat, p.lng);
    return { lat: p.lat, lng: p.lng, d: total };
  });
}
function ptAtDist(cum, targetD) {
  if (!cum.length) return null;
  if (targetD <= 0) return cum[0];
  return cum.find(p => p.d >= targetD) || cum[cum.length - 1];
}
function cleanFacName(raw, role, allowBare = false) {
  if (!raw) return null;
  let n = String(raw).replace(/\s+/g, "").replace(/ＩＣ/g, "IC").replace(/ＪＣＴ/g, "JCT").replace(/インターチェンジ/g, "IC").replace(/ジャンクション/g, "JCT").replace(/[（(][^）)]*[）)]/g, "")
    .replace(/^(?:名古屋高速[0-9号一宮線小牧線清須線都心環状線大高線東山線万場線楠線黒川線東海線]*|首都高速[0-9号渋谷線新宿線池袋線上野線向島線深川線台場線湾岸線都心環状線]*|阪神高速[0-9号線]*|東名高速道路|名神高速道路|新東名高速道路|名古屋第二環状自動車道|伊勢湾岸自動車道|東海北陸自動車道|知多半島道路|セントレアライン|中部国際空港連絡道路)/, "");
  if (!n || n.length < 2 || n.length > 16 || /^(入口|出口|出入口|料金所|IC|JCT|ランプ|本線|上り|下り)$/.test(n) || /(駐車場|ビル|公園|駅|店|病院|ホテル|ターミナル)/.test(n)) return null;
  if (role === "entry" && /出口$/.test(n) && !/出入口$/.test(n)) return null;
  if (role === "exit" && /入口$/.test(n) && !/出入口$/.test(n)) return null;
  if (/(スマートIC|IC|JCT|入口|出口|出入口|料金所|ランプ)/.test(n)) return n;
  if (allowBare && !new RegExp(ROAD_RE.source).test(n)) return role === "entry" ? `${n}入口` : role === "exit" ? `${n}出口` : `${n}JCT`;
  return null;
}
function parseStepFac(inst, role) {
  if (!inst) return null;
  const m1 = inst.match(/([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15}?(?:スマートIC|スマートＩＣ|IC|ＩＣ|JCT|ＪＣＴ|本線料金所|料金所|出入口))/g);
  if (m1) for (const x of m1) { if (!/^(料金所|出入口)$/.test(x) && (role === "switch" || !/(JCT|ＪＣＴ)$/.test(x))) return x.replace(/ＩＣ/g, "IC").replace(/ＪＣＴ/g, "JCT"); }
  const m2 = inst.match(/([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15})\s*(入口|出口)/);
  if (m2 && !/(?:の|を|に|へ|から|まで|方面|ランプ|車線|方向|右側|左側|有料)$/.test(m2[1]) && !new RegExp(ROAD_RE.source).test(m2[1])) return `${m2[1]}${m2[2]}`;
  const m3 = inst.match(/[（(]([^（）()\/]+?)\s*の表示[）)]/);
  if (m3 && !new RegExp(ROAD_RE.source).test(m3[1]) && !/^(国道|県道|都道|府道|市道|市街|方面|一般道|有料)/.test(m3[1]) && m3[1].length >= 2 && m3[1].length <= 12) {
    return role === "entry" ? `${m3[1].trim()}入口` : role === "exit" ? `${m3[1].trim()}出口` : m3[1].trim();
  }
  return null;
}
async function fetchLiveOsmCorridor(cumPath) {
  if (!cumPath.length) return { junctions: [], motorways: [] };
  const totalD = cumPath[cumPath.length - 1].d, stepD = Math.max(1500, totalD / 28), pts = [];
  for (let d = 0; d <= totalD; d += stepD) { const p = ptAtDist(cumPath, d); if (p) pts.push(`${p.lat.toFixed(4)},${p.lng.toFixed(4)}`); }
  const lastP = cumPath[cumPath.length - 1];
  if (lastP) pts.push(`${lastP.lat.toFixed(4)},${lastP.lng.toFixed(4)}`);
  const polyStr = pts.join(",");
  const q = `[out:json][timeout:8];(node["highway"="motorway_junction"]["name"](around:350,${polyStr});way["highway"="motorway_link"]["name"](around:250,${polyStr});node["barrier"="toll_booth"]["name"](around:250,${polyStr});way["highway"="motorway"]["name"](around:120,${polyStr}););out center;`;
  for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    try {
      const res = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }, body: "data=" + encodeURIComponent(q) });
      if (!res.ok) continue;
      const data = await res.json(), junctions = [], motorways = [];
      for (const el of (data.elements || [])) {
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon, name = el.tags?.name || el.tags?.["name:ja"];
        if (typeof lat !== "number" || !name) continue;
        if (el.tags?.highway === "motorway") motorways.push({ name: normRoad(name), lat, lng });
        else junctions.push({ name, lat, lng, isToll: el.tags?.barrier === "toll_booth" });
      }
      return { junctions, motorways };
    } catch (e) {}
  }
  return { junctions: [], motorways: [] };
}
async function searchTomtomFallback(ptList, role, roadHint) {
  const ttKey = (typeof getTomtomApiKey === "function") ? getTomtomApiKey() : "";
  const pts = (Array.isArray(ptList) ? ptList : [ptList]).filter(Boolean);
  if (!ttKey || !pts.length) return null;
  const kws = [...(roadHint ? [roadHint] : []), ...(role === "entry" ? ["出入口", "IC"] : role === "exit" ? ["IC", "出口", "出入口"] : ["JCT", "料金所", "IC"])];
  try {
    const datas = await Promise.all(pts.slice(0, 2).flatMap(pt => kws.map(kw =>
      fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent(kw)}.json?key=${encodeURIComponent(ttKey)}&lat=${pt.lat}&lon=${pt.lng}&radius=1800&limit=15&language=ja-JP`).then(r => r.ok ? r.json() : null).catch(() => null)
    )));
    let best = null;
    for (const d of datas) for (const r of (d?.results || [])) {
      const valid = cleanFacName(r.poi?.name || r.address?.freeformAddress || "", role, false);
      if (valid && (!best || (r.dist ?? 999) < best.dist)) best = { name: valid, dist: r.dist ?? 999 };
    }
    return best ? best.name : null;
  } catch (e) { return null; }
}
function findBestOsmJunction(junctions, ptList, role, maxDistM = 1600) {
  let best = null;
  for (const pt of ptList) {
    if (!pt) continue;
    for (const j of junctions) {
      const valid = cleanFacName(j.name, role, true);
      if (!valid) continue;
      const d = distM(pt.lat, pt.lng, j.lat, j.lng);
      if (d > maxDistM) continue;
      const score = (role !== "switch" && /JCT$/.test(valid)) ? d + 3000 : d;
      if (!best || score < best.score) best = { name: valid, score };
    }
  }
  return best ? best.name : null;
}

function extractHighwayTimeline(route, legToll) {
  if (!route || !Array.isArray(route.legs)) return { items: [], cumPath: [], legToll };
  const cumPath = decodeCumPath(route.polyline?.encodedPolyline || "");
  let cumD = 0, inToll = false, tollStartD = null, tollEndD = null;
  const rawSteps = [];

  for (const leg of route.legs) {
    for (const step of (leg.steps || [])) {
      const inst = (step?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim();
      const man = step?.navigationInstruction?.maneuver || "";
      const d = step.distanceMeters || 0, sec = parseInt((step.staticDuration || "0s").replace("s", ""), 10) || 0;
      const sD = cumD; cumD += d;
      const isGeneral = /(国道|県道|府道|都道|市道|町道|通り|交差点)/.test(inst);
      const isExit = man.includes("OFF_RAMP") || /出口を|出口へ|降りる|出る/.test(inst);
      const isToll = /有料区間|有料道路/.test(inst) || (inToll && !isGeneral && !isExit);
      const roadMatch = inst.replace(/[^\s\/（）()]+?\s*方面の\s*/g, "").match(ROAD_RE) || inst.match(ROAD_RE);
      const road = roadMatch ? normRoad(roadMatch[roadMatch.length - 1]) : "";
      rawSteps.push({ inst, man, d, sec, sD, eD: cumD, isToll, isExit, road });
      if (isToll && tollStartD === null) tollStartD = sD;
      if (isToll || (inToll && isExit)) tollEndD = cumD;
      inToll = isToll && !isExit;
    }
  }
  return { rawSteps, cumPath, tollStartD, tollEndD, legToll };
}

async function resolveMissingFacilityNames(ctx) {
  if (!ctx || !ctx.rawSteps || ctx.tollStartD === null) return [];
  const { rawSteps, cumPath, tollStartD, tollEndD, legToll } = ctx;
  const osm = await fetchLiveOsmCorridor(cumPath);

  const entryStepIdx = rawSteps.findIndex(s => s.isToll);
  const entryStep = rawSteps[entryStepIdx];
  const prevStep = entryStepIdx > 0 ? rawSteps[entryStepIdx - 1] : null;
  let entryName = parseStepFac(entryStep.inst, "entry") || (prevStep ? parseStepFac(prevStep.inst, "entry") : null);
  if (!entryName) {
    const entryPts = [prevStep && prevStep.d < 1500 ? ptAtDist(cumPath, prevStep.sD) : null, ptAtDist(cumPath, Math.max(0, tollStartD - 250)), ptAtDist(cumPath, tollStartD), ptAtDist(cumPath, tollStartD + 300)].filter(Boolean);
    entryName = findBestOsmJunction(osm.junctions, entryPts, "entry", 1400) || await searchTomtomFallback(entryPts, "entry", entryStep.road);
  }

  const segments = [];
  let curSeg = null;
  const scanStep = 1500;
  for (let d = tollStartD; d < tollEndD; d += scanStep) {
    const segLen = Math.min(scanStep, tollEndD - d);
    const midPt = ptAtDist(cumPath, d + segLen / 2);
    const stepAtD = rawSteps.find(s => s.isToll && d >= s.sD && d < s.eD) || entryStep;
    let roadName = stepAtD.road;
    if (midPt && osm.motorways.length) {
      let bestMw = null;
      for (const mw of osm.motorways) {
        const dist = distM(midPt.lat, midPt.lng, mw.lat, mw.lng);
        if (dist < 180 && (!bestMw || dist < bestMw.dist)) bestMw = { name: mw.name, dist };
      }
      if (bestMw) roadName = bestMw.name;
    }
    const op = getOp(roadName);
    if (!curSeg) {
      curSeg = { roads: roadName ? [roadName] : [], distM: segLen, sec: stepAtD.d ? (stepAtD.sec * segLen / stepAtD.d) : 60, op, startD: d };
      segments.push(curSeg);
    } else if (curSeg.op !== op) {
      const swPt = ptAtDist(cumPath, d);
      const jctName = findBestOsmJunction(osm.junctions, [swPt], "switch", 1400) || await searchTomtomFallback([swPt], "switch", roadName);
      const trans = `${OP_LABELS[curSeg.op] || "高速"} ➔ ${OP_LABELS[op] || "高速"}`;
      curSeg.switchNode = jctName ? `${jctName}（${trans}）` : trans;
      curSeg = { roads: roadName ? [roadName] : [], distM: segLen, sec: stepAtD.d ? (stepAtD.sec * segLen / stepAtD.d) : 60, op, startD: d };
      segments.push(curSeg);
    } else {
      if (roadName && !curSeg.roads.includes(roadName)) curSeg.roads.push(roadName);
      curSeg.distM += segLen;
      curSeg.sec += stepAtD.d ? (stepAtD.sec * segLen / stepAtD.d) : 60;
    }
  }

  const exitSteps = [...rawSteps].reverse().filter(s => s.isToll || s.isExit).slice(0, 2);
  let exitName = exitSteps.map(s => parseStepFac(s.inst, "exit")).find(Boolean) || null;
  if (!exitName) {
    const totalD = cumPath.length ? cumPath[cumPath.length - 1].d : tollEndD;
    const exitPts = [ptAtDist(cumPath, tollEndD), ptAtDist(cumPath, Math.max(tollStartD, tollEndD - 450)), ptAtDist(cumPath, Math.max(0, totalD - 300)), ptAtDist(cumPath, totalD)].filter(Boolean);
    const lastRoad = curSeg?.roads?.[curSeg.roads.length - 1] || "";
    exitName = findBestOsmJunction(osm.junctions, exitPts, "exit", 1800) || await searchTomtomFallback(exitPts, "exit", lastRoad);
  }

  if (segments.length === 1) { segments[0].toll = legToll || 0; segments[0].isEst = false; }
  else if (segments.length > 1 && legToll > 0) {
    const w = segments.map(s => s.op.startsWith("urban_") ? Math.min(1320, Math.max(300, 300 + (s.distM / 1000) * 45)) : Math.max(250, 150 + (s.distM / 1000) * 25));
    const sum = w.reduce((a, b) => a + b, 0);
    let alloc = 0;
    segments.forEach((s, i) => { s.isEst = true; s.toll = (i === segments.length - 1) ? Math.max(0, legToll - alloc) : Math.round(((legToll * w[i]) / sum) / 10) * 10; alloc += s.toll; });
  } else { segments.forEach(s => { s.toll = 0; s.isEst = false; }); }

  const items = [{ kind: "node", type: "entry", badgeText: "入口", name: entryName || `${segments[0]?.roads?.[0] || "高速道路"} 入口ランプ` }];
  segments.forEach(s => {
    items.push({ kind: "seg", roads: s.roads, distM: s.distM, sec: s.sec, toll: s.toll, isEstimated: s.isEst });
    if (s.switchNode) items.push({ kind: "node", type: "switch", badgeText: "切替", name: s.switchNode });
  });
  const lastR = segments[segments.length - 1]?.roads?.slice(-1)[0] || "高速道路";
  items.push({ kind: "node", type: "exit", badgeText: "出口", name: exitName || `${lastR} 出口ランプ` });
  return items;
}

function buildTimelineHtml(items) {
  if (!items?.length) return `<div class="hw-empty">有料区間のIC情報は検出されませんでした。</div>`;
  return `<div class="hw-timeline">${items.map(item => item.kind === "node"
    ? `<div class="hw-node ${item.type}"><span class="hw-node-dot"></span><span class="hw-badge ${item.type}">${item.badgeText}</span><b>${escapeHtml(item.name)}</b></div>`
    : `<div class="hw-seg-box"><div class="hw-seg-info"><div class="hw-seg-road">${escapeHtml(item.roads.length ? item.roads.join(" ➔ ") : "有料道路区間")}</div><div class="hw-seg-meta">${(item.distM / 1000).toFixed(1)} km ／ 約${Math.max(1, Math.round(item.sec / 60))}分</div></div><div class="hw-seg-toll"><span class="hw-seg-toll-tag">${item.isEstimated ? "ETC目安" : "ETC"}</span><span class="hw-seg-toll-val">${(item.toll || 0).toLocaleString()}円</span></div></div>`
  ).join('')}</div>`;
}
function toggleHwDetailBody() {
  const b = document.getElementById('hwDetailBody'), t = document.getElementById('hwDetailToggleText');
  const h = b.style.display === 'none'; b.style.display = h ? 'block' : 'none'; t.innerText = h ? '▲ 閉じる' : '▼ 開く';
}
function switchHwDetailTab(tab) {
  const b = document.getElementById('hwDetailBody');
  if (!latestMixDetailHtml) { b.innerHTML = latestHwDetailHtml; return; }
  b.innerHTML = `<div class="hw-tabs"><button type="button" class="hw-tab-btn ${tab === 'mix' ? 'active mix-tab' : ''}" onclick="switchHwDetailTab('mix')">ミックスルート詳細</button><button type="button" class="hw-tab-btn ${tab === 'hw' ? 'active' : ''}" onclick="switchHwDetailTab('hw')">全高速ルート詳細</button></div><div>${tab === 'mix' ? latestMixDetailHtml : latestHwDetailHtml}</div>`;
}
