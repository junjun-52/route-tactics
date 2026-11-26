
highway.js
100%
// ===== 有料区間の入口IC・出口IC・区間別ETC料金＆動的割引タイムライン (V5 / HERE対応) =====
let latestHwDetailHtml = "";
let latestMixDetailHtml = "";

const ROAD_NAME_RE = /([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|高速[0-9０-９号線]*|名二環|伊勢湾岸|セントレアライン|知多半島道路|知多横断道路|南知多道路|東海環状|東海北陸|東名|名神|新東名|新名神|中央道|北陸道|関越|東北道|常磐道|山陽道|中国道|九州道|圏央道|外環|首都高|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速))/g;

const OPERATOR_LABELS = {
  urban_nagoya: "名古屋高速",
  urban_tokyo: "首都高速",
  urban_hanshin: "阪神高速",
  urban_fukuoka: "福岡・北九州高速",
  urban_hiroshima: "広島高速",
  public_aichi: "知多半島・セントレアライン",
  honshi: "本四高速",
  nexco: "NEXCO高速"
};

function normalizeRoadName(name) {
  if (!name) return "";
  let s = String(name).replace(/[０-９Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
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
  const matches = withoutDir.match(ROAD_NAME_RE);
  if (matches && matches.length > 0) {
    return normalizeRoadName(matches[matches.length - 1]);
  }
  const fallback = inst.match(ROAD_NAME_RE);
  return (fallback && fallback.length > 0) ? normalizeRoadName(fallback[fallback.length - 1]) : "";
}

function extractFacilityName(inst, role) {
  if (!inst) return null;

  const pattern = (role === "switch")
    ? /([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15}?(?:スマートIC|スマートＩＣ|IC|ＩＣ|JCT|ＪＣＴ|本線料金所|料金所|出入口))/g
    : /([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15}?(?:スマートIC|スマートＩＣ|IC|ＩＣ|本線料金所|料金所|出入口))/g;

  const explicitMatches = inst.match(pattern);
  if (explicitMatches) {
    for (const m of explicitMatches) {
      if (/^(料金所|出入口)$/.test(m)) continue;
      return m.replace(/ＩＣ/g, "IC").replace(/ＪＣＴ/g, "JCT");
    }
  }

  const ioRe = /([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15})\s*(入口|出口)/g;
  let m;
  while ((m = ioRe.exec(inst)) !== null) {
    const prefix = m[1];
    if (/(?:の|を|に|へ|から|まで|方面|ランプ|車線|方向|右側|左側|有料区間|有料道路)$/.test(prefix)) continue;
    if (new RegExp(ROAD_NAME_RE.source).test(prefix)) continue;
    return `${prefix}${m[2]}`;
  }

  const signMatch = inst.match(/[（(]([^（）()\/]+?)\s*の表示[）)]/);
  if (signMatch) {
    const signText = signMatch[1].trim();
    const isRoad = new RegExp(ROAD_NAME_RE.source).test(signText);
    const isGeneral = /^(国道|県道|都道|府道|市道|市街|方面|一般道|有料)/.test(signText);
    if (!isRoad && !isGeneral && signText.length >= 2 && signText.length <= 12) {
      if (role === "entry" && !/(入口|IC)$/.test(signText)) return `${signText}入口`;
      if (role === "exit" && !/(出口|IC)$/.test(signText)) return `${signText}出口`;
      return signText;
    }
  }

  return null;
}

function allocateSegmentTolls(segments, totalLegToll) {
  if (!segments || segments.length === 0) return;
  if (!totalLegToll || totalLegToll <= 0) {
    segments.forEach(s => { s.toll = 0; s.isEstimated = false; });
    return;
  }
  if (segments.length === 1) {
    segments[0].toll = totalLegToll;
    segments[0].isEstimated = false;
    return;
  }

  const weights = segments.map(seg => {
    const km = seg.distM / 1000;
    if (seg.operator && seg.operator.startsWith("urban_")) {
      return Math.min(1320, Math.max(300, 300 + km * 45));
    }
    if (seg.operator === "public_aichi") {
      return Math.max(200, 150 + km * 28);
    }
    return Math.max(300, 150 + km * 24.6);
  });

  const weightSum = weights.reduce((a, b) => a + b, 0);
  let allocatedSum = 0;

  for (let i = 0; i < segments.length; i++) {
    segments[i].isEstimated = true;
    if (i === segments.length - 1) {
      segments[i].toll = Math.max(0, totalLegToll - allocatedSum);
    } else {
      const raw = (totalLegToll * weights[i]) / weightSum;
      const rounded = Math.round(raw / 10) * 10;
      segments[i].toll = rounded;
      allocatedSum += rounded;
    }
  }
}

/**
 * HERE Routing v8 の section.actions / section.spans から有料区間タイムラインを抽出
 */
function extractHighwayTimelineFromHere(route, totalBaseToll, vehicleClass, baseStartDate) {
  const items = [];
  if (!route || !Array.isArray(route.sections)) {
    return { items, segments: [], discountSummary: { totalBase: 0, totalDiscounted: 0, totalSavings: 0, appliedLabels: [], notes: [] } };
  }

  const segments = [];
  let currentSeg = null;
  let lastEndedSeg = null;
  let currentOperator = null;
  let currentRoad = "";

  const startNewSegment = (roadName, operator) => {
    currentSeg = {
      kind: "seg",
      roads: roadName ? [roadName] : [],
      distM: 0,
      sec: 0,
      operator: operator || "nexco",
      toll: 0,
      baseToll: 0,
      discountedToll: 0,
      discountLabel: "",
      discountSavings: 0,
      isEstimated: false
    };
    segments.push(currentSeg);
    items.push(currentSeg);
  };

  const addRoadToCurrentSeg = (roadName) => {
    if (!currentSeg || !roadName) return;
    if (!currentSeg.roads.includes(roadName)) {
      currentSeg.roads.push(roadName);
    }
  };

  for (const section of route.sections) {
    const actions = section.actions || [];
    // spans から有料区間が存在するか確認
    const hasTollSpans = Array.isArray(section.spans) && section.spans.some(
      sp => Array.isArray(sp.carAttributes) && sp.carAttributes.includes("tollRoad")
    );

    let inToll = false;
    let exitingToll = false;

    for (let i = 0; i < actions.length; i++) {
      const act = actions[i];
      const inst = (act.instruction || "").replace(/\n+/g, " ").trim();
      const actionType = act.action || "";
      const distM = act.length || 0;
      const sec = act.duration || 0;

      const stepRoad = extractDrivingRoad(inst);
      const hasTollHint = /有料|高速|自動車道|ランプ|インター|IC|JCT/.test(inst) || Boolean(stepRoad);
      const isGeneralRoad = /(国道|県道|府道|都道|市道|町道|通り|交差点)/.test(inst) && !stepRoad;
      const isExitAction = actionType === "exit" || actionType === "ramp" && /出口|降りる|出る/.test(inst) || /出口を|出口へ|降りる/.test(inst);

      const isTollStep = (hasTollHint && !isGeneralRoad) || (inToll && !isGeneralRoad && !isExitAction);

      if (!isTollStep) {
        if (inToll) {
          let exitName = extractFacilityName(inst, "exit") || (act.exitSign?.text ? act.exitSign.text : null);
          if (!exitName && i > 0) {
            exitName = extractFacilityName(actions[i - 1]?.instruction || "", "exit");
          }
          items.push({
            kind: "node",
            type: "exit",
            badgeText: "出口",
            name: exitName || (currentRoad ? `${currentRoad} 出口` : "有料区間出口")
          });
        }
        inToll = false;
        exitingToll = false;
        currentSeg = null;
        lastEndedSeg = null;
        currentOperator = null;
        currentRoad = "";
        continue;
      }

      const effectiveRoad = stepRoad || currentRoad;
      const stepOp = detectTollOperator(effectiveRoad) || currentOperator || "nexco";
      const isTollGate = /本線料金所|料金所/.test(inst);

      if (exitingToll) {
        const isReEntry = /入口|に入る|合流/.test(inst) && !isExitAction && !isTollGate && !isGeneralRoad;
        if (!isReEntry) {
          if (lastEndedSeg) {
            lastEndedSeg.distM += distM;
            lastEndedSeg.sec += sec;
          }
          continue;
        }
        exitingToll = false;
      }

      if (!inToll) {
        inToll = true;
        currentRoad = effectiveRoad;
        currentOperator = stepOp;

        let entryName = extractFacilityName(inst, "entry");
        for (let back = 1; back <= 2 && !entryName && (i - back) >= 0; back++) {
          entryName = extractFacilityName(actions[i - back]?.instruction || "", "entry");
        }

        items.push({
          kind: "node",
          type: "entry",
          badgeText: "入口",
          name: entryName || (effectiveRoad ? `${effectiveRoad} 入口` : "有料区間入口")
        });
        startNewSegment(effectiveRoad, stepOp);
        currentSeg.distM += distM;
        currentSeg.sec += sec;
        continue;
      }

      const nextInst = (i + 1 < actions.length) ? (actions[i + 1]?.instruction || "").replace(/\n+/g, " ").trim() : "";
      const nextIsToll = /有料|高速|自動車道/.test(nextInst) || Boolean(extractDrivingRoad(nextInst));
      const isOperatorSwitch = currentOperator && stepOp && currentOperator !== stepOp;
      const isHighwayTransferExit = isExitAction && nextIsToll && !isGeneralRoad;

      if (isOperatorSwitch || isHighwayTransferExit || (isTollGate && !isExitAction)) {
        let pointName = extractFacilityName(inst, "switch")
          || (nextInst ? extractFacilityName(nextInst, "switch") : null)
          || (i > 0 ? extractFacilityName(actions[i - 1]?.instruction || "", "switch") : null);

        const nextRoad = extractDrivingRoad(nextInst) || effectiveRoad;
        const nextOp = detectTollOperator(nextRoad) || stepOp;
        const opChanged = currentOperator && nextOp && currentOperator !== nextOp;

        const opTransition = opChanged
          ? `${OPERATOR_LABELS[currentOperator] || "高速"} ➔ ${OPERATOR_LABELS[nextOp] || "高速"}`
          : "料金所通過";
        const switchLabel = pointName ? `${pointName}（${opTransition}）` : opTransition;

        items.push({
          kind: "node",
          type: "switch",
          badgeText: "切替",
          name: switchLabel
        });

        currentOperator = nextOp;
        currentRoad = nextRoad;
        startNewSegment(nextRoad, nextOp);
        currentSeg.distM += distM;
        currentSeg.sec += sec;
        continue;
      }

      if (effectiveRoad) {
        currentRoad = effectiveRoad;
        addRoadToCurrentSeg(effectiveRoad);
      }
      if (currentSeg) {
        currentSeg.distM += distM;
        currentSeg.sec += sec;
      }

      if (isExitAction) {
        let exitName = extractFacilityName(inst, "exit") || (nextInst ? extractFacilityName(nextInst, "exit") : null);
        items.push({
          kind: "node",
          type: "exit",
          badgeText: "出口",
          name: exitName || (effectiveRoad ? `${effectiveRoad} 出口` : "有料区間出口")
        });
        lastEndedSeg = currentSeg;
        currentSeg = null;
        inToll = false;
        exitingToll = true;
        currentOperator = null;
        currentRoad = "";
      }
    }

    // actionsから有料区間が取れなかったが、料金・tollRoadスパンが存在する場合のフォールバック
    if (segments.length === 0 && (totalBaseToll > 0 || hasTollSpans)) {
      const sum = section.summary || {};
      items.push({ kind: "node", type: "entry", badgeText: "入口", name: "有料道路入口" });
      startNewSegment("有料道路区間", "nexco");
      currentSeg.distM = sum.length || 0;
      currentSeg.sec = sum.duration || 0;
      items.push({ kind: "node", type: "exit", badgeText: "出口", name: "有料道路出口" });
    }
  }

  allocateSegmentTolls(segments, totalBaseToll);

  let discountSummary = { totalBase: totalBaseToll, totalDiscounted: totalBaseToll, totalSavings: 0, appliedLabels: [], notes: [] };
  if (typeof applyDiscountsToSegments === "function" && segments.length > 0) {
    discountSummary = applyDiscountsToSegments(segments, vehicleClass, baseStartDate);
  }

  return { items, segments, discountSummary };
}

function buildTimelineHtml(items) {
  if (!items || items.length === 0) {
    return `<div class="hw-empty">有料区間のIC情報は検出されませんでした。</div>`;
  }

  const html = items.map(item => {
    if (item.kind === "node") {
      return `
        <div class="hw-node ${item.type}">
          <span class="hw-node-dot"></span>
          <span class="hw-badge ${item.type}">${item.badgeText}</span><b>${escapeHtml(item.name)}</b>
        </div>
      `;
    } else {
      const roadLabel = item.roads.length > 0 ? item.roads.join(" ➔ ") : "有料道路区間";
      const km = (item.distM / 1000).toFixed(1);
      const min = Math.max(1, Math.round(item.sec / 60));
      const hasDiscount = item.discountSavings > 0;
      const tollTag = hasDiscount ? "割引後ETC" : (item.isEstimated ? "ETC目安" : "ETC");
      const displayToll = hasDiscount ? item.discountedToll : item.toll;
      const origHtml = hasDiscount
        ? `<div class="hw-seg-toll-orig">通常 ${item.baseToll.toLocaleString()}円</div>`
        : "";
      return `
        <div class="hw-seg-box">
          <div class="hw-seg-info">
            <div class="hw-seg-road">${escapeHtml(roadLabel)}</div>
            <div class="hw-seg-meta">${km} km ／ 約${min}分${hasDiscount ? ` ／ <span class="disc-inline">${escapeHtml(item.discountLabel)}</span>` : ""}</div>
          </div>
          <div class="hw-seg-toll ${hasDiscount ? 'discounted' : ''}">
            <span class="hw-seg-toll-tag">${tollTag}</span>
            <span class="hw-seg-toll-val">${displayToll.toLocaleString()}円</span>
            ${origHtml}
          </div>
        </div>
      `;
    }
  }).join('');

  return `<div class="hw-timeline">${html}</div>`;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    extractHighwayTimelineFromHere,
    allocateSegmentTolls,
    detectTollOperator,
    normalizeRoadName
  };
}
1 / 2 ページ
