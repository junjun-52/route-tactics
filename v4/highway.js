// ===== 有料区間の入口IC・出口IC・区間別ETC料金タイムライン =====
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

function detectTollOperator(roadName) {
  if (!roadName) return null;
  if (/名古屋高速/.test(roadName)) return "urban_nagoya";
  if (/首都高/.test(roadName)) return "urban_tokyo";
  if (/阪神高速/.test(roadName)) return "urban_hanshin";
  if (/福岡高速|北九州高速/.test(roadName)) return "urban_fukuoka";
  if (/広島高速/.test(roadName)) return "urban_hiroshima";
  if (/知多半島道路|セントレアライン|知多横断道路|南知多道路/.test(roadName)) return "public_aichi";
  if (/神戸淡路鳴門|瀬戸中央|西瀬戸|しまなみ/.test(roadName)) return "honshi";
  return "nexco";
}

function extractDrivingRoad(inst) {
  const withoutDir = inst.replace(/[^\s\/（）()]+?\s*方面の\s*/g, "");
  const matches = withoutDir.match(ROAD_NAME_RE);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1];
  }
  const fallback = inst.match(ROAD_NAME_RE);
  return (fallback && fallback.length > 0) ? fallback[fallback.length - 1] : "";
}

function extractFacilityName(inst, mode) {
  if (!inst) return null;

  // 1. 明示的なIC・スマートIC・料金所・出入口名を最優先（JCTは除外）
  const explicitRe = /([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15}?(?:スマートIC|スマートＩＣ|IC|ＩＣ|本線料金所|料金所|出入口))/g;
  const explicitMatches = inst.match(explicitRe);
  if (explicitMatches) {
    for (const m of explicitMatches) {
      if (/^(料金所|出入口)$/.test(m)) continue;
      return m;
    }
  }

  // 2. 「黒川 出口」「一宮中 入口」のようにスペース有無を含む固有名＋入口/出口
  const ioRe = /([一-龠ァ-ヶーA-Za-z0-9０-９]{2,15})\s*(入口|出口)/g;
  let m;
  while ((m = ioRe.exec(inst)) !== null) {
    const prefix = m[1];
    if (/(?:の|を|に|へ|から|まで|方面|ランプ|車線|方向|右側|左側|有料区間|有料道路)$/.test(prefix)) continue;
    if (new RegExp(ROAD_NAME_RE.source).test(prefix)) continue;
    return `${prefix}${m[2]}`;
  }

  // 3. 出口案内で「出口を 新潟西 方面の〜」のように方面名しか出ない場合の補完
  if (mode === "exit") {
    const exitDir = inst.match(/出口を\s*([一-龠ァ-ヶーA-Za-z0-9０-９]{2,12}?)\s*方面/);
    if (exitDir) {
      const place = exitDir[1];
      if (!new RegExp(ROAD_NAME_RE.source).test(place) && !/^(市街|方面|国道|県道)/.test(place)) {
        return `${place}出口`;
      }
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

function extractHighwayTimeline(route, legToll) {
  const items = [];
  if (!route || !Array.isArray(route.legs)) return items;

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

  for (const leg of route.legs) {
    const steps = leg.steps || [];
    let inToll = false;
    let exitingToll = false;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const inst = (step?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim();
      const maneuver = step?.navigationInstruction?.maneuver || "";
      const distM = step.distanceMeters || 0;
      const sec = parseInt((step.staticDuration || "0s").replace("s", ""), 10) || 0;
      const isTollStep = /有料区間|有料道路/.test(inst);
      const isExit = maneuver.includes("OFF_RAMP") || /出口を|出口へ|降りる|出る/.test(inst);

      // 有料区間から一般道へ出た瞬間（「有料区間」の文字が消えた出口ステップもここで出口として拾う）
      if (!isTollStep) {
        if (inToll) {
          let exitName = extractFacilityName(inst, "exit");
          if (!exitName && i > 0) {
            const prevInst = (steps[i - 1]?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim();
            exitName = extractFacilityName(prevInst, "exit");
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

      const stepRoad = extractDrivingRoad(inst) || currentRoad;
      const stepOp = detectTollOperator(stepRoad) || currentOperator || "nexco";
      const isTollGate = /本線料金所|料金所/.test(inst);

      // 出口ICを通過した直後のランプ・出口料金所ステップは直前区間に吸収
      if (exitingToll) {
        const isReEntry = /入口|に入る|合流/.test(inst) && !isExit && !isTollGate && !/国道|県道|市道/.test(inst);
        if (!isReEntry) {
          if (lastEndedSeg) {
            lastEndedSeg.distM += distM;
            lastEndedSeg.sec += sec;
          }
          continue;
        }
        exitingToll = false;
      }

      // ① 有料区間の入口（現在または最大2ステップ手前の一般道案内からIC名を探索）
      if (!inToll) {
        inToll = true;
        currentRoad = stepRoad;
        currentOperator = stepOp;

        let entryName = extractFacilityName(inst, "entry");
        for (let back = 1; back <= 2 && !entryName && (i - back) >= 0; back++) {
          const prevInst = (steps[i - back]?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim();
          entryName = extractFacilityName(prevInst, "entry");
        }

        items.push({
          kind: "node",
          type: "entry",
          badgeText: "入口",
          name: entryName || (stepRoad ? `${stepRoad} 入口` : "有料区間入口")
        });
        startNewSegment(stepRoad, stepOp);
        currentSeg.distM += distM;
        currentSeg.sec += sec;
        continue;
      }

      // ② 料金体系（事業者）が変わる乗り継ぎ または 本線料金所
      const isOperatorSwitch = currentOperator && stepOp && currentOperator !== stepOp;
      if (isOperatorSwitch || (isTollGate && !isExit)) {
        const facilityName = extractFacilityName(inst, "switch");
        const opTransition = isOperatorSwitch
          ? `${OPERATOR_LABELS[currentOperator] || "高速"} ➔ ${OPERATOR_LABELS[stepOp] || "高速"}`
          : "料金所通過";
        const switchLabel = facilityName ? `${facilityName}（${opTransition}）` : opTransition;

        items.push({
          kind: "node",
          type: "switch",
          badgeText: "切替",
          name: switchLabel
        });
        currentOperator = stepOp;
        currentRoad = stepRoad;
        startNewSegment(stepRoad, stepOp);
        currentSeg.distM += distM;
        currentSeg.sec += sec;
        continue;
      }

      // 現在の区間に距離・時間・路線名を加算
      if (stepRoad) {
        currentRoad = stepRoad;
        addRoadToCurrentSeg(stepRoad);
      }
      if (currentSeg) {
        currentSeg.distM += distM;
        currentSeg.sec += sec;
      }

      // ③ 有料区間ステップ内で出口ICが検出された場合
      if (isExit) {
        let exitName = extractFacilityName(inst, "exit");
        if (!exitName && i + 1 < steps.length) {
          const nextInst = (steps[i + 1]?.navigationInstruction?.instructions || "").replace(/\n+/g, " ").trim();
          exitName = extractFacilityName(nextInst, "exit");
        }

        items.push({
          kind: "node",
          type: "exit",
          badgeText: "出口",
          name: exitName || (stepRoad ? `${stepRoad} 出口` : "有料区間出口")
        });
        lastEndedSeg = currentSeg;
        currentSeg = null;
        inToll = false;
        exitingToll = true;
        currentOperator = null;
        currentRoad = "";
      }
    }
  }

  allocateSegmentTolls(segments, legToll);
  return items;
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
      const tollTag = item.isEstimated ? "ETC目安" : "ETC";
      return `
        <div class="hw-seg-box">
          <div class="hw-seg-info">
            <div class="hw-seg-road">${escapeHtml(roadLabel)}</div>
            <div class="hw-seg-meta">${km} km ／ 約${min}分</div>
          </div>
          <div class="hw-seg-toll">
            <span class="hw-seg-toll-tag">${tollTag}</span>
            <span class="hw-seg-toll-val">${item.toll.toLocaleString()}円</span>
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
