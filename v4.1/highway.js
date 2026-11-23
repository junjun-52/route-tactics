// ===== 高速レスポンス型 有料区間IC・JCT・ETCタイムライン (V4.1.8) =====
let latestHwDetailHtml = "", latestMixDetailHtml = "";
const ROAD_RE = /([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|連絡道路|高速[0-9０-９号線]*|名二環|伊勢湾岸|セントレアライン|知多半島道路|知多横断道路|南知多道路|東海環状|東海北陸|東名|名神|新東名|新名神|中央道|北陸道|関越|東北道|常磐道|山陽道|中国道|九州道|圏央道|外環|首都高|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速))/g;
const OP_LABELS = { urban_nagoya: "名古屋高速", urban_tokyo: "首都高速", urban_hanshin: "阪神高速", urban_fukuoka: "福岡・北九州高速", urban_hiroshima: "広島高速", public_aichi: "知多半島・セントレアライン", honshi: "本四高速", nexco: "NEXCO高速" };
const _facCache = new Map();

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
  if (/首都高|東京都自動車道/.test(r)) return "urban_tokyo";
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
function cleanFacName(raw, role) {
  if (!raw) return null;
  let n = String(raw).replace(/\s+/g, "").replace(/ＩＣ/g, "IC").replace(/ＪＣＴ/g, "JCT").replace(/インターチェンジ/g, "IC").replace(/ジャンクション/g, "JCT").replace(/[（(][^）)]*[）)]/g, "")
    .replace(/^(?:名古屋高速[0-9号一宮線小牧線清須線都心環状線大高線東山線万場線楠線黒川線東海線]*|首都高速[0-9号渋谷線新宿線池袋線上野線向島線深川線台場線湾岸線都心環状線]*|阪神高速[0-9号線]*|東名高速道路|名神高速道路|新東名高速道路|名古屋第二環状自動車道|伊勢湾岸自動車道|東海北陸自動車道|知多半島道路|セントレアライン|中部国際空港連絡道路)/, "");
  if (!n || n.length < 2 || n.length > 16 || /^(入口|出口|出入口|料金所|IC|JCT|ランプ|本線|上り|下り)$/.test(n) || /(駐車場|ビル|公園|駅|店|病院|ホテル|ターミナル)/.test(n)) return null;
  if (role === "entry" && /出口$/.test(n) && !/出入口$/.test(n)) return null;
  if (role === "exit" && /入口$/.test(n) && !/出入口$/.test(n)) return null;
  return /(スマートIC|IC|JCT|入口|出口|出入口|料金所|ランプ)/.test(n) ? n : null;
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

async function fetchWithTimeout(url, opts = {}, ms = 2200) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(id); }
}

async function fastLookupFacility(pt, role, roadHint) {
  if (!pt) return null;
  const cacheKey = `${role}_${pt.lat.toFixed(3)}_${pt.lng.toFixed(3)}`;
  if (_facCache.has(cacheKey)) return _facCache.get(cacheKey);

  const ttKey = (typeof getTomtomApiKey === "function") ? getTomtomApiKey() : "";
  if (!ttKey) return null;

  const q = role === "entry" ? "出入口 IC 入口" : role === "exit" ? "出入口 IC 出口" : "JCT 料金所 IC";
  try {
    const [sRes, rRes] = await Promise.all([
      fetchWithTimeout(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${encodeURIComponent(ttKey)}&lat=${pt.lat}&lon=${pt.lng}&radius=1600&limit=15&language=ja-JP`, {}, 2000).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchWithTimeout(`https://api.tomtom.com/search/2/reverseGeocode/${pt.lat},${pt.lng}.json?key=${encodeURIComponent(ttKey)}&language=ja-JP&radius=350`, {}, 2000).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);

    let best = null;
    for (const r of (sRes?.results || [])) {
      const valid = cleanFacName(r.poi?.name || r.address?.freeformAddress || "", role);
      if (!valid) continue;
      const dist = r.dist ?? 999;
      const score = (role !== "switch" && /JCT$/.test(valid)) ? dist + 2500 : dist;
      if (!best || score < best.score) best = { name: valid, score };
    }
    if (best) { _facCache.set(cacheKey, best.name); return best.name; }

    for (const item of (rRes?.addresses || [])) {
      const a = item.address || {};
      for (const c of [a.streetName, a.freeformAddress, a.localName]) {
        const m = c && String(c).match(/([一-龠ァ-ヶーA-Za-z0-9]{2,12}(?:スマートIC|IC|JCT|入口|出口|出入口|料金所))/);
        const valid = m && cleanFacName(m[1], role);
        if (valid) { _facCache.set(cacheKey, valid); return valid; }
      }
    }
  } catch (e) {}
  _facCache.set(cacheKey, null);
  return null;
}

function extractHighwayTimeline(route, legToll) {
  if (!route || !Array.isArray(route.legs)) return { rawSteps: [], cumPath: [], tollStartD: null, tollEndD: null, legToll };
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

  // 1. ステップ情報から即座に区間分割＆候補名抽出（待ち時間0ms）
  const entryStepIdx = rawSteps.findIndex(s => s.isToll);
  const entryStep = rawSteps[entryStepIdx];
  const prevStep = entryStepIdx > 0 ? rawSteps[entryStepIdx - 1] : null;
  let entryName = parseStepFac(entryStep.inst, "entry") || (prevStep ? parseStepFac(prevStep.inst, "entry") : null);
  const entryPt = (prevStep && prevStep.d < 1500) ? ptAtDist(cumPath, prevStep.sD) : ptAtDist(cumPath, Math.max(0, tollStartD - 200));

  const segments = [];
  let curSeg = null;
  for (const s of rawSteps) {
    if (!s.isToll) continue;
    const roadName = s.road || curSeg?.roads?.slice(-1)[0] || "";
    const op = getOp(roadName);
    if (!curSeg) {
      curSeg = { roads: roadName ? [roadName] : [], distM: s.d, sec: s.sec, op, startD: s.sD };
      segments.push(curSeg);
    } else if (curSeg.op !== op) {
      const swName = parseStepFac(s.inst, "switch");
      curSeg.switchPt = ptAtDist(cumPath, s.sD);
      curSeg.switchKnown = swName;
      curSeg.switchTrans = `${OP_LABELS[curSeg.op] || "高速"} ➔ ${OP_LABELS[op] || "高速"}`;
      curSeg = { roads: roadName ? [roadName] : [], distM: s.d, sec: s.sec, op, startD: s.sD };
      segments.push(curSeg);
    } else {
      if (roadName && !curSeg.roads.includes(roadName)) curSeg.roads.push(roadName);
      curSeg.distM += s.d;
      curSeg.sec += s.sec;
    }
  }

  const exitSteps = [...rawSteps].reverse().filter(s => s.isToll || s.isExit).slice(0, 2);
  let exitName = exitSteps.map(s => parseStepFac(s.inst, "exit")).find(Boolean) || null;
  const totalD = cumPath.length ? cumPath[cumPath.length - 1].d : tollEndD;
  const exitPt = ptAtDist(cumPath, Math.max(tollStartD, Math.min(tollEndD, totalD - 250)));

  // 2. 不足しているIC名だけをTomTomで全並列取得（最大2秒タイムアウト）
  const [resolvedEntry, resolvedExit, ...resolvedSwitches] = await Promise.all([
    entryName ? Promise.resolve(entryName) : fastLookupFacility(entryPt, "entry", entryStep.road),
    exitName ? Promise.resolve(exitName) : fastLookupFacility(exitPt, "exit", curSeg?.roads?.slice(-1)[0] || ""),
    ...segments.map(s => (!s.switchPt || s.switchKnown) ? Promise.resolve(s.switchKnown || null) : fastLookupFacility(s.switchPt, "switch", ""))
  ]);

  entryName = resolvedEntry;
  exitName = resolvedExit;
  segments.forEach((s, idx) => {
    if (s.switchTrans) {
      const jName = resolvedSwitches[idx];
      s.switchNode = jName ? `${jName}（${s.switchTrans}）` : s.switchTrans;
    }
  });

  // 3. ETC料金按分＆タイムライン構築
  if (segments.length === 1) { segments[0].toll = legToll || 0; segments[0].isEst = false; }
  else if (segments.length > 1 && legToll > 0) {
    const w = segments.map(s => s.op.startsWith("urban_") ? Math.min(1320, Math.max(300, 300 + (s.distM / 1000) * 45)) : Math.max(250, 150 + (s.distM / 1000) * 25));
    const sum = w.reduce((a, b) => a + b, 0);
    let alloc = 0;
    segments.forEach((s, i) => { s.isEst = true; s.toll = (i === segments.length - 1) ? Math.max(0, legToll - alloc) : Math.round(((legToll * w[i]) / sum) / 10) * 10; alloc += s.toll; });
  } else { segments.forEach(s => { s.toll = 0; s.isEst = false; }); }

  const items = [{ kind: "node", type: "entry", badgeText: "入口", name: entryName || `${segments[0]?.roads?.[0] || "高速道路"} 進入IC` }];
  segments.forEach(s => {
    items.push({ kind: "seg", roads: s.roads, distM: s.distM, sec: s.sec, toll: s.toll, isEstimated: s.isEst });
    if (s.switchNode) items.push({ kind: "node", type: "switch", badgeText: "切替", name: s.switchNode });
  });
  const lastR = segments[segments.length - 1]?.roads?.slice(-1)[0] || "高速道路";
  items.push({ kind: "node", type: "exit", badgeText: "出口", name: exitName || `${lastR} 流出IC` });
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
