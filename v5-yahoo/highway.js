// ===== 路線別ランプ照合対応 有料区間タイムライン＋全国有料道路網羅＋ICワンタップコピー (v5-yahoo) =====
let latestHwDetailHtml = "", latestMixDetailHtml = "";

// 全国の高速道路・都市高速・一般有料道路パターン
const ROAD_CORE_PATTERN = [
  "[一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|連絡道路|横断道路|縦貫道路|都市高速|高速[0-9０-９号線]*)",
  // 都市高速・大動脈・略称高速（全国）
  "名二環|伊勢湾岸|東海環状|東海北陸|東名|新東名|名神|新名神|中央道|長野道|中部横断道",
  "道央道|札樽道|道東道|後志道|深川留萌道|日高道|旭川紋別道",
  "東北道|八戸道|秋田道|山形道|釜石道|磐越道|日本海東北道|東北中央道|三陸道|仙台東部道路|仙台北部道路|仙台南部道路",
  "関越道|上信越道|北関東道|常磐道|東関東道|館山道|圏央道|外環道|外環",
  "北陸道|能越道|伊豆縦貫道|伊勢道|紀勢道|阪和道|京奈和道|舞鶴若狭道|播磨道|京都縦貫道|山陰近畿道",
  "山陽道|中国道|岡山道|米子道|広島道|浜田道|松江道|山陰道",
  "徳島道|松山道|高松道|高知道|今治小松道|しまなみ海道|瀬戸中央道|神戸淡路鳴門道",
  "九州道|東九州道|長崎道|大分道|宮崎道|西九州道|南九州道|沖縄道",
  "首都高|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速",
  // 全国の主な一般有料道路・バイパス・トンネル・大橋（〜道路・〜ライン等）
  "東京湾アクアライン|アクアライン|第三京浜道路|第三京浜|横浜新道|横浜横須賀道路|横横道|京葉道路|千葉東金道路|富津館山道路",
  "小田原厚木道路|西湘バイパス|箱根新道|東富士五湖道路|伊豆スカイライン|箱根ターンパイク|富士山スカイライン|安房峠道路",
  "知多半島道路|知多横断道路|南知多道路|セントレアライン|猿投グリーンロード|衣浦豊田道路|名古屋瀬戸道路|衣浦トンネル|伊勢志摩スカイライン",
  "第二神明道路|第二神明|京滋バイパス|琵琶湖大橋|湯浅御坊道路|奈良奥山ドライブウェイ|信貴生駒スカイライン",
  "関門トンネル|関門橋|指宿スカイライン"
].join("|");

const ROAD_RE = new RegExp(`(${ROAD_CORE_PATTERN})`, "g");
// 有料区間ステップ内でのみ使うフォールバック（一般道の「〇〇トンネル」「〇〇バイパス」誤爆を防止）
const TOLL_ONLY_ROAD_RE = new RegExp(`(${ROAD_CORE_PATTERN}|[一-龠ァ-ヶーA-Za-z0-9０-９]{2,14}?(?:バイパス|スカイライン|グリーンロード|トンネル|大橋|道路))`, "g");

const OP_LABELS = {
  urban_nagoya: "名古屋高速",
  urban_tokyo: "首都高速",
  urban_hanshin: "阪神高速",
  urban_fukuoka: "福岡・北九州高速",
  urban_hiroshima: "広島高速",
  honshi: "本四高速",
  aqualine: "東京湾アクアライン",
  public_aichi: "愛知県道路公社",
  public_kanto: "関東有料・道路公社",
  public_kansai: "関西有料・道路公社",
  public_local: "地方道路公社・有料道路",
  nexco: "NEXCO高速"
};

const _facCache = new Map();

(function injectIcCopyStyles() {
  if (typeof document === "undefined" || document.getElementById("rt-ic-copy-style")) return;
  const style = document.createElement("style");
  style.id = "rt-ic-copy-style";
  style.textContent = `
    .hw-node-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
    }
    .hw-node-main {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      min-width: 0;
      flex: 1;
    }
    .btn-ic-copy {
      flex-shrink: 0;
      width: auto !important;
      padding: 4px 8px !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      line-height: 1.2;
      color: var(--navy, #14233c);
      background: #ffffff;
      border: 1px solid #cbd5e1 !important;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .btn-ic-copy:hover {
      background: #f1f5f9;
      border-color: var(--navy, #14233c) !important;
    }
    .btn-ic-copy.is-copied {
      background: #dcfce7 !important;
      color: #166534 !important;
      border-color: #86efac !important;
    }
  `;
  document.head.appendChild(style);
})();

// 略称や表記ゆれを正式名称へ統一（同一路線の分断を防止）
function normRoad(s) {
  if (!s) return "";
  s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, "");

  if (/第二東海|新東名/.test(s)) return "新東名高速道路";
  if (/第一東海|^東名(?:高速)?$/.test(s)) return "東名高速道路";
  if (/新名神/.test(s)) return "新名神高速道路";
  if (/^名神(?:高速)?$/.test(s)) return "名神高速道路";
  if (/名二環/.test(s)) return "名古屋第二環状自動車道";
  if (/伊勢湾岸/.test(s)) return "伊勢湾岸自動車道";
  if (/東海環状/.test(s)) return "東海環状自動車道";
  if (/東海北陸/.test(s)) return "東海北陸自動車道";
  if (/東京都自動車道|首都高/.test(s)) return s.startsWith("首都高速") ? s : s.replace(/^首都高/, "首都高速");
  if (/アクアライン/.test(s)) return "東京湾アクアライン";
  if (/第三京浜/.test(s)) return "第三京浜道路";
  if (/横横|横浜横須賀/.test(s)) return "横浜横須賀道路";
  if (/第二神明/.test(s)) return "第二神明道路";
  if (/西瀬戸|しまなみ/.test(s)) return "西瀬戸自動車道（しまなみ海道）";
  if (/神戸淡路/.test(s)) return "神戸淡路鳴門自動車道";
  if (/瀬戸中央/.test(s)) return "瀬戸中央自動車道";
  if (/外環/.test(s)) return "東京外環自動車道";
  if (/圏央/.test(s)) return "首都圏中央連絡自動車道（圏央道）";

  // 「〇〇道」略称を「〇〇自動車道」へ統一
  const shortToFullMap = {
    "道央道": "道央自動車道",
    "札樽道": "札樽自動車道",
    "道東道": "道東自動車道",
    "後志道": "後志自動車道",
    "深川留萌道": "深川留萌自動車道",
    "日高道": "日高自動車道",
    "旭川紋別道": "旭川紋別自動車道",
    "東北道": "東北自動車道",
    "八戸道": "八戸自動車道",
    "秋田道": "秋田自動車道",
    "山形道": "山形自動車道",
    "釜石道": "釜石自動車道",
    "磐越道": "磐越自動車道",
    "日本海東北道": "日本海東北自動車道",
    "東北中央道": "東北中央自動車道",
    "三陸道": "三陸自動車道",
    "関越道": "関越自動車道",
    "上信越道": "上信越自動車道",
    "北関東道": "北関東自動車道",
    "常磐道": "常磐自動車道",
    "東関東道": "東関東自動車道",
    "館山道": "館山自動車道",
    "長野道": "長野自動車道",
    "中部横断道": "中部横断自動車道",
    "北陸道": "北陸自動車道",
    "能越道": "能越自動車道",
    "伊豆縦貫道": "伊豆縦貫自動車道",
    "伊勢道": "伊勢自動車道",
    "紀勢道": "紀勢自動車道",
    "阪和道": "阪和自動車道",
    "京奈和道": "京奈和自動車道",
    "舞鶴若狭道": "舞鶴若狭自動車道",
    "播磨道": "播磨自動車道",
    "京都縦貫道": "京都縦貫自動車道",
    "山陰近畿道": "山陰近畿自動車道",
    "山陽道": "山陽自動車道",
    "中国道": "中国自動車道",
    "岡山道": "岡山自動車道",
    "米子道": "米子自動車道",
    "広島道": "広島自動車道",
    "浜田道": "浜田自動車道",
    "松江道": "松江自動車道",
    "山陰道": "山陰自動車道",
    "徳島道": "徳島自動車道",
    "松山道": "松山自動車道",
    "高松道": "高松自動車道",
    "高知道": "高知自動車道",
    "今治小松道": "今治小松自動車道",
    "九州道": "九州自動車道",
    "東九州道": "東九州自動車道",
    "長崎道": "長崎自動車道",
    "大分道": "大分自動車道",
    "宮崎道": "宮崎自動車道",
    "西九州道": "西九州自動車道",
    "南九州道": "南九州自動車道",
    "沖縄道": "沖縄自動車道"
  };

  if (shortToFullMap[s]) return shortToFullMap[s];
  return s;
}

// 全国の運営会社・道路公社区分判定
function getOp(r) {
  if (!r) return "nexco";
  if (/名古屋高速/.test(r)) return "urban_nagoya";
  if (/首都高|東京都自動車道/.test(r)) return "urban_tokyo";
  if (/阪神高速/.test(r)) return "urban_hanshin";
  if (/福岡高速|北九州高速/.test(r)) return "urban_fukuoka";
  if (/広島高速/.test(r)) return "urban_hiroshima";
  if (/神戸淡路|瀬戸中央|西瀬戸|しまなみ/.test(r)) return "honshi";
  if (/アクアライン/.test(r)) return "aqualine";

  // 愛知県道路公社・周辺有料
  if (/知多半島|セントレア|知多横断|南知多|中部国際空港連絡|猿投グリーンロード|衣浦豊田|名古屋瀬戸|衣浦トンネル/.test(r)) {
    return "public_aichi";
  }

  // 関東有料・地方公社（第三京浜・京葉道路はNEXCO管理だが料金体系が別のため分離）
  if (/第三京浜|横浜新道|横浜横須賀|京葉道路|千葉東金|富津館山|小田原厚木|西湘バイパス|箱根新道|東富士五湖|伊豆スカイライン|箱根ターンパイク|富士山スカイライン/.test(r)) {
    return "public_kanto";
  }

  // 関西有料・地方公社
  if (/第二神明|京滋バイパス|京都縦貫|山陰近畿|琵琶湖大橋|湯浅御坊|奈良奥山|信貴生駒/.test(r)) {
    return "public_kansai";
  }

  // その他地方道路公社・観光有料道路
  if (/伊勢志摩スカイライン|安房峠|指宿スカイライン|有料道路|バイパス|スカイライン|グリーンロード|トンネル|大橋/.test(r)) {
    return "public_local";
  }

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
  let n = String(raw)
    .replace(/\s+/g, "")
    .replace(/ＩＣ/g, "IC")
    .replace(/ＪＣＴ/g, "JCT")
    .replace(/インターチェンジ/g, "IC")
    .replace(/ジャンクション/g, "JCT")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(new RegExp(`^(?:${ROAD_CORE_PATTERN})`), "");

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
async function fetchWithTimeout(url, opts = {}, ms = 1000) {
  const ctrl = new AbortController(), id = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); } finally { clearTimeout(id); }
}

// Overpass API 高速タイムアウト（900ms）で沿線ランプを照合
async function searchRoadJunctions(pt, role, roadName) {
  if (!pt || !roadName) return null;
  const rKey = roadName.replace(/(高速道路|自動車道|有料道路|バイパス|道路|線)$/, "");
  const q = `[out:json][timeout:2];(node["highway"="motorway_junction"](around:2200,${pt.lat},${pt.lng});way["highway"="motorway_link"](around:1800,${pt.lat},${pt.lng});node["barrier"="toll_booth"](around:1800,${pt.lat},${pt.lng}););out center;`;
  try {
    const res = await fetchWithTimeout("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: "data=" + encodeURIComponent(q)
    }, 900);
    if (!res.ok) return null;
    const data = await res.json();
    let best = null;
    for (const el of (data.elements || [])) {
      const eLat = el.lat ?? el.center?.lat, eLon = el.lon ?? el.center?.lon;
      if (typeof eLat !== "number") continue;
      const tags = el.tags || {};
      const rawName = tags.name || tags["name:ja"] || "";
      const refText = `${tags.ref || ""} ${tags.destination || ""} ${tags["destination:ref"] || ""}`;
      const matchesRoad = rKey && (rawName.includes(rKey) || refText.includes(rKey));
      const valid = cleanFacName(rawName, role, true);
      if (!valid) continue;
      const d = distM(pt.lat, pt.lng, eLat, eLon);
      const score = (matchesRoad ? d * 0.4 : d + 800) + ((role !== "switch" && /JCT$/.test(valid)) ? 3000 : 0);
      if (!best || score < best.score) best = { name: valid, score };
    }
    if (best) return best.name;
  } catch (e) {}
  return null;
}

async function searchTomtomPinpoint(pt, role, roadName = "") {
  const ttKey = (typeof getTomtomApiKey === "function") ? getTomtomApiKey() : "";
  if (!ttKey) return null;
  const q = roadName
    ? `${roadName.replace(/(高速道路|自動車道|有料道路)$/, "")} ${role === "entry" ? "入口" : role === "exit" ? "出口" : "JCT"}`
    : (role === "entry" ? "出入口 IC 入口" : role === "exit" ? "出入口 IC 出口" : "JCT 料金所 IC");
  try {
    const [sRes, rRes] = await Promise.all([
      fetchWithTimeout(`https://api.tomtom.com/search/2/search/${encodeURIComponent(q)}.json?key=${encodeURIComponent(ttKey)}&lat=${pt.lat}&lon=${pt.lng}&radius=2200&limit=10&language=ja-JP`, {}, 1100).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchWithTimeout(`https://api.tomtom.com/search/2/reverseGeocode/${pt.lat},${pt.lng}.json?key=${encodeURIComponent(ttKey)}&language=ja-JP&radius=300`, {}, 1100).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    let best = null;
    for (const r of (sRes?.results || [])) {
      const valid = cleanFacName(r.poi?.name || r.address?.freeformAddress || "", role, false);
      if (!valid) continue;
      const dist = r.dist ?? 999;
      const score = (role !== "switch" && /JCT$/.test(valid)) ? dist + 3000 : dist;
      if (!best || score < best.score) best = { name: valid, score };
    }
    if (best) return best.name;
    const addr = rRes?.addresses?.[0]?.address;
    if (addr) {
      const area = (addr.municipalitySubdivision || addr.localName || addr.municipality || "").replace(/[0-9０-９丁目番地号\-−]/g, "").trim();
      if (area.length >= 2) return role === "entry" ? `${area}付近 入口` : role === "exit" ? `${area}付近 出口` : `${area}付近 切替`;
    }
  } catch (e) {}
  return null;
}

async function fastLookupFacility(pt, role, roadName = "") {
  if (!pt) return null;
  const key = `${role}_${roadName}_${pt.lat.toFixed(3)}_${pt.lng.toFixed(3)}`;
  if (_facCache.has(key)) return _facCache.get(key);
  const [osmName, ttName] = await Promise.all([searchRoadJunctions(pt, role, roadName), searchTomtomPinpoint(pt, role, roadName)]);
  const hit = osmName || ttName || null;
  _facCache.set(key, hit);
  return hit;
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

      const cleanedInst = inst.replace(/[^\s\/（）()]+?\s*方面の\s*/g, "");
      const activeRegex = isToll ? TOLL_ONLY_ROAD_RE : ROAD_RE;
      const roadMatch = cleanedInst.match(activeRegex) || inst.match(activeRegex);
      const road = roadMatch ? normRoad(roadMatch[roadMatch.length - 1]) : "";

      rawSteps.push({ inst, man, d, sec, sD, eD: cumD, isToll, isExit, road });
      if (isToll && tollStartD === null) tollStartD = sD;
      if (isToll || (inToll && isExit)) tollEndD = cumD;
      inToll = isToll && !isExit;
    }
  }
  return { rawSteps, cumPath, tollStartD, tollEndD, legToll };
}

function extractExplicitIcHint(text) {
  if (!text) return null;
  const normalized = String(text).replace(/ＩＣ/g, "IC").replace(/ＪＣＴ/g, "JCT").trim();
  if (/(スマートIC|IC|JCT|出入口|入口|出口|料金所)$/.test(normalized)) {
    return normalized;
  }
  return null;
}

// 運営区分ごとの料金重み計算（複数路線跨ぎのETC目安按分用）
function estimateSegmentWeight(seg) {
  const km = seg.distM / 1000;
  if (seg.op.startsWith("urban_")) {
    return Math.min(1320, Math.max(300, 300 + km * 45));
  }
  if (seg.op === "honshi" || seg.op === "aqualine") {
    return Math.max(800, 650 + km * 60);
  }
  if (seg.op.startsWith("public_")) {
    return Math.max(200, 150 + km * 30);
  }
  return Math.max(250, 150 + km * 25);
}

async function resolveMissingFacilityNames(ctx, hints = {}) {
  if (!ctx || !ctx.rawSteps || ctx.tollStartD === null) return [];
  const { rawSteps, cumPath, tollStartD, tollEndD, legToll } = ctx;

  const explicitEntry = extractExplicitIcHint(hints.entryHint);
  const explicitExit = extractExplicitIcHint(hints.exitHint);

  const entryStepIdx = rawSteps.findIndex(s => s.isToll);
  const entryStep = rawSteps[entryStepIdx];
  const prevStep = entryStepIdx > 0 ? rawSteps[entryStepIdx - 1] : null;
  let entryName = explicitEntry || parseStepFac(entryStep.inst, "entry") || (prevStep ? parseStepFac(prevStep.inst, "entry") : null);
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
      curSeg.switchPt = ptAtDist(cumPath, s.sD);
      curSeg.switchKnown = parseStepFac(s.inst, "switch");
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
  let exitName = explicitExit || exitSteps.map(s => parseStepFac(s.inst, "exit")).find(Boolean) || null;
  const totalD = cumPath.length ? cumPath[cumPath.length - 1].d : tollEndD;
  const exitPt = ptAtDist(cumPath, Math.max(tollStartD, Math.min(tollEndD, totalD - 200)));
  const lastRoad = curSeg?.roads?.slice(-1)[0] || entryStep.road || "";

  const [resolvedEntry, resolvedExit, ...resolvedSwitches] = await Promise.all([
    entryName ? Promise.resolve(entryName) : fastLookupFacility(entryPt, "entry", entryStep.road),
    exitName ? Promise.resolve(exitName) : fastLookupFacility(exitPt, "exit", lastRoad),
    ...segments.map(s => (!s.switchPt || s.switchKnown) ? Promise.resolve(s.switchKnown || null) : fastLookupFacility(s.switchPt, "switch", s.roads?.slice(-1)[0] || ""))
  ]);

  entryName = resolvedEntry;
  exitName = resolvedExit;
  segments.forEach((s, idx) => {
    if (s.switchTrans) {
      const jName = resolvedSwitches[idx];
      s.switchNode = jName ? `${jName}（${s.switchTrans}）` : s.switchTrans;
    }
  });

  if (segments.length === 1) {
    segments[0].toll = legToll || 0;
    segments[0].isEst = false;
  } else if (segments.length > 1 && legToll > 0) {
    const w = segments.map(estimateSegmentWeight);
    const sum = w.reduce((a, b) => a + b, 0);
    let alloc = 0;
    segments.forEach((s, i) => {
      s.isEst = true;
      s.toll = (i === segments.length - 1)
        ? Math.max(0, legToll - alloc)
        : Math.round(((legToll * w[i]) / sum) / 10) * 10;
      alloc += s.toll;
    });
  } else {
    segments.forEach(s => { s.toll = 0; s.isEst = false; });
  }

  const items = [{ kind: "node", type: "entry", badgeText: "入口", name: entryName || `${segments[0]?.roads?.[0] || "高速道路"} 進入IC` }];
  segments.forEach(s => {
    items.push({ kind: "seg", roads: s.roads, distM: s.distM, sec: s.sec, toll: s.toll, isEstimated: s.isEst });
    if (s.switchNode) items.push({ kind: "node", type: "switch", badgeText: "切替", name: s.switchNode });
  });
  const lastR = segments[segments.length - 1]?.roads?.slice(-1)[0] || "高速道路";
  items.push({ kind: "node", type: "exit", badgeText: "出口", name: exitName || `${lastR} 流出IC` });
  return items;
}

function getCleanIcCopyText(rawName) {
  if (!rawName) return "";
  return String(rawName).replace(/[（(][^）)]*[）)]/g, "").trim();
}

async function copyIcName(btnEl, encodedText) {
  const text = decodeURIComponent(encodedText || "");
  if (!text) return;

  let ok = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (_) {}

  if (!ok) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 99999);
      ok = document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (_) {}
  }

  if (btnEl) {
    const origHtml = btnEl.getAttribute("data-orig-label") || "📋 コピー";
    if (!btnEl.getAttribute("data-orig-label")) {
      btnEl.setAttribute("data-orig-label", origHtml);
    }
    btnEl.innerText = ok ? "✅ コピー済" : "❌ 失敗";
    if (ok) btnEl.classList.add("is-copied");
    setTimeout(() => {
      btnEl.innerText = origHtml;
      btnEl.classList.remove("is-copied");
    }, 1500);
  }
}

function buildTimelineHtml(items) {
  if (!items?.length) return `<div class="hw-empty">有料区間のIC情報は検出されませんでした。</div>`;
  return `<div class="hw-timeline">${items.map(item => {
    if (item.kind === "node") {
      const cleanCopyText = getCleanIcCopyText(item.name);
      const showCopy = (item.type === "entry" || item.type === "exit" || /(IC|JCT|入口|出口|出入口|料金所)/.test(cleanCopyText));
      const copyBtnHtml = showCopy
        ? `<button type="button" class="btn-ic-copy" onclick="event.stopPropagation(); copyIcName(this, '${encodeURIComponent(cleanCopyText)}')" title="${escapeHtml(cleanCopyText)} をコピー">📋 コピー</button>`
        : "";
      return `<div class="hw-node ${item.type}"><span class="hw-node-dot"></span><div class="hw-node-row"><div class="hw-node-main"><span class="hw-badge ${item.type}">${item.badgeText}</span><b>${escapeHtml(item.name)}</b></div>${copyBtnHtml}</div></div>`;
    }
    return `<div class="hw-seg-box"><div class="hw-seg-info"><div class="hw-seg-road">${escapeHtml(item.roads.length ? item.roads.join(" ➔ ") : "有料道路区間")}</div><div class="hw-seg-meta">${(item.distM / 1000).toFixed(1)} km ／ 約${Math.max(1, Math.round(item.sec / 60))}分</div></div><div class="hw-seg-toll"><span class="hw-seg-toll-tag">${item.isEstimated ? "ETC目安" : "ETC"}</span><span class="hw-seg-toll-val">${(item.toll || 0).toLocaleString()}円</span></div></div>`;
  }).join('')}</div>`;
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
