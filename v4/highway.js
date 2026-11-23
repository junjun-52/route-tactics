// ===== 有料区間の入口IC・出口IC・料金切替抽出＆タイムライン表示 =====
let latestHwDetailHtml = "";
let latestMixDetailHtml = "";

const ROAD_NAME_RE = /([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|高速[0-9０-９号線]*|名二環|伊勢湾岸|セントレアライン|知多半島道路|東海環状|東海北陸|東名|名神|新東名|新名神|中央道|北陸道|首都高|阪神高速|名古屋高速))/;

function extractFacilityName(inst) {
  // 「〇〇 方面の」という進行方向表記を除去してから判定
  const cleaned = inst.replace(/[^\s\/（）()]+?\s*方面の\s*/g, "");

  // 1. 明示的なIC・JCT・料金所・出入口名を最優先で抽出
  const explicitRe = /([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:スマートIC|スマートＩＣ|IC|ＩＣ|JCT|ＪＣＴ|本線料金所|料金所|出入口))/g;
  const explicitMatches = cleaned.match(explicitRe);
  if (explicitMatches) {
    return { name: explicitMatches[0], isRoad: false };
  }

  // 2. 「黒川 出口」「一宮 入口」のようにスペース有無を含む固有名＋入口/出口を抽出
  const ioRe = /([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15})\s*(入口|出口)/g;
  let m;
  while ((m = ioRe.exec(cleaned)) !== null) {
    const prefix = m[1];
    // 助詞や一般語（「方面」「のランプ」など）は除外
    if (/(?:の|を|に|へ|方面|ランプ|車線|方向|右側|左側)$/.test(prefix)) continue;
    if (ROAD_NAME_RE.test(prefix)) {
      return { name: prefix, isRoad: true };
    }
    return { name: `${prefix}${m[2]}`, isRoad: false };
  }

  // 3. IC名が案内文に含まれない場合は有料道路・路線名を抽出
  const roadMatch = cleaned.match(ROAD_NAME_RE);
  if (roadMatch) {
    return { name: roadMatch[1], isRoad: true };
  }

  return null;
}

function extractHighwayEvents(route) {
  const events = [];
  if (!route || !Array.isArray(route.legs)) return events;

  const pushUnique = (type, badgeText, name) => {
    if (!name) return;
    const last = events[events.length - 1];
    if (last && last.name === name && last.type === type) return;
    events.push({ type, badgeText, name });
  };

  for (const leg of route.legs) {
    const steps = leg.steps || [];
    let inToll = false;
    let justExited = false;
    let currentRoad = "";

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const inst = (step?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim();
      const maneuver = step?.navigationInstruction?.maneuver || "";
      const isTollStep = /有料区間|有料道路/.test(inst);

      if (!isTollStep) {
        inToll = false;
        justExited = false;
        currentRoad = "";
        continue;
      }

      const extracted = extractFacilityName(inst);
      const name = extracted ? extracted.name : null;
      const isRoad = extracted ? extracted.isRoad : false;
      const isExit = maneuver.includes("OFF_RAMP") || /出口を|出口へ|降りる|出る/.test(inst);
      const isTollGate = /料金所/.test(inst);
      const isJct = /(JCT|ＪＣＴ|ジャンクション)/.test(inst);

      // 出口ICを通過した直後の一般道接続ステップは無視
      if (justExited) {
        const isNewEntry = name && !/国道|県道|市道/.test(inst) && (/入口|に入る|合流/.test(inst) || isRoad);
        if (!isNewEntry) continue;
        justExited = false;
      }

      // ① 有料区間の入口
      if (!inToll) {
        inToll = true;
        pushUnique("entry", "入口IC", name || "有料区間入口");
        if (isRoad && name) currentRoad = name;
        continue;
      }

      // ② 高速から別の有料道路への乗り継ぎ（例：名二環 ➔ 名古屋高速1号）
      if (isExit && isRoad && name) {
        if (currentRoad && !name.startsWith(currentRoad) && !currentRoad.startsWith(name)) {
          pushUnique("toll", "料金切替", name);
        }
        currentRoad = name;
        continue;
      }

      // ③ 一般道への出口IC
      if (isExit) {
        if (name) {
          pushUnique("exit", "出口IC", name);
        }
        inToll = false;
        justExited = true;
        currentRoad = "";
        continue;
      }

      // ④ 途中の料金所・JCT・路線切替（料金が変わるポイント）
      if (isTollGate && name) {
        pushUnique("toll", "料金切替", name);
      } else if (isJct && name) {
        pushUnique("jct", "JCT・切替", name);
      } else if (isRoad && name) {
        if (currentRoad && !name.startsWith(currentRoad) && !currentRoad.startsWith(name)) {
          pushUnique("toll", "料金切替", name);
        }
        currentRoad = name;
      }
    }
  }
  return events;
}

function buildTimelineHtml(events) {
  if (!events || events.length === 0) {
    return `<div class="hw-empty">有料区間のIC情報は検出されませんでした。</div>`;
  }
  const items = events.map(ev => `
    <div class="hw-event ${ev.type}">
      <span class="hw-event-dot"></span>
      <div>
        <span class="hw-badge ${ev.type}">${ev.badgeText}</span><b>${escapeHtml(ev.name)}</b>
      </div>
    </div>
  `).join('');
  return `<div class="hw-timeline">${items}</div>`;
}

function toggleHwDetailBody() {
  const body = document.getElementById('hwDetailBody');
  const toggle = document.getElementById('hwDetailToggleText');
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'block' : 'none';
  toggle.innerText = isHidden ? '▲ 閉じる' : '▼ 開く';
}

function switchHwDetailTab(tab) {
  const body = document.getElementById('hwDetailBody');
  const hasMix = latestMixDetailHtml !== "";
  if (!hasMix) {
    body.innerHTML = latestHwDetailHtml;
    return;
  }
  body.innerHTML = `
    <div class="hw-tabs">
      <button type="button" class="hw-tab-btn ${tab === 'mix' ? 'active mix-tab' : ''}" onclick="switchHwDetailTab('mix')">ミックスルート詳細</button>
      <button type="button" class="hw-tab-btn ${tab === 'hw' ? 'active' : ''}" onclick="switchHwDetailTab('hw')">全高速ルート詳細</button>
    </div>
    <div>${tab === 'mix' ? latestMixDetailHtml : latestHwDetailHtml}</div>
  `;
}
