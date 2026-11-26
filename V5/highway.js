// ===== 有料区間の入口IC・出口IC・区間別ETC料金＆動的割引タイムライン (V5 / HERE対応) =====
let latestHwDetailHtml = "";
let latestMixDetailHtml = "";

const ROAD_NAME_RE = /([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|高速[0-9０-９号線]*|名二環|伊勢湾岸|セントレアライン|知多半島道路|知多横断道路|南知多道路|東海環状|東海北陸|新東名|新名神|東名高速|東名|名神高速|名神|中央道|北陸道|関越|東北道|常磐道|山陽道|中国道|九州道|圏央道|外環|首都高|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速))/g;

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
  if (s === "東名" || s === "東名高速") return "東名高速道路";
  if (s === "名神" || s === "名神高速") return "名神高速道路";
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
  // 「〇〇方面」「〇〇の表示」「〇〇へ進む」などの行き先・看板表記を除去してから走行路線を抽出
  let cleaned = String(inst)
    .replace(/[（(][^（）()]*?の表示[）)]/g, "")
    .replace(/[^\n\s/（）()、。]+?\s*方面(?:の|へ|に)?/g, "");

  // 「〜に入る」「〜に合流」「〜を進む」の直前にある路線名を最優先で取得
  const enterMatch = cleaned.match(/([一-龠ァ-ヶーA-Za-z0-9０-９]+?(?:自動車道|高速道路|有料道路|高速[0-9０-９号線]*|名二環|伊勢湾岸|セントレアライン|知多半島道路|知多横断道路|南知多道路|東海環状|東海北陸|新東名|新名神|東名高速|東名|名神高速|名神|中央道|北陸道|関越|東北道|常磐道|山陽道|中国道|九州道|圏央道|外環|首都高|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速))\s*(?:に|へ)?(?:入|合流|進)/);
  if (enterMatch) {
    return normalizeRoadName(enterMatch[1]);
  }

  const matches = cleaned.match(ROAD_NAME_RE);
  if (matches && matches.length > 0) {
    return normalizeRoadName(matches[matches.length - 1]);
  }
  return "";
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

  const signMatch = inst.match(/[（(]([^（）()/]+?)\s*の表示[）)]/);
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
    segments[0].toll = Math.round(totalLegToll);
    segments[0].isEstimated = false;
    return;
  }

  const weights = segments.map(s => Math.max(s.durationSec || 0, s.distanceKm || 0, 1));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;

  segments.forEach((seg, idx) => {
    if (idx === segments.length - 1) {
      seg.toll = Math.max(0, Math.round(totalLegToll - allocated));
    } else {
      const share = Math.round((totalLegToll * weights[idx]) / weightSum);
      seg.toll = share;
      allocated += share;
    }
    seg.isEstimated = true;
  });
}

function parseHighwaySegmentsFromHere(legResult, legStartTimeObj, legFromLabel, legToLabel, vehicleClass) {
  const actions = legResult.actions || [];
  const totalLegToll = Math.max(0, Math.round(Number(legResult.toll) || 0));
  const totalLegSec = Math.max(0, Number(legResult.durationSec) || 0);
  const totalLegKm = Math.max(0, Number(legResult.distanceKm) || 0);

  const segments = [];
  let current = null;
  let elapsedSec = 0;

  for (let i = 0; i < actions.length; i++) {
    const inst = actions[i].instruction || "";
    const isTollAction = /有料|高速|自動車道|IC|ＩＣ|JCT|ＪＣＴ|本線料金所|料金所/.test(inst);
    const road = extractDrivingRoad(inst);
    const op = road ? detectTollOperator(road) : null;

    if (!current && isTollAction && op) {
      current = {
        road: road || OPERATOR_LABELS[op] || "有料道路",
        roads: road ? [road] : [],
        operator: op,
        entryIc: extractFacilityName(inst, "entry") || `${legFromLabel}付近入口`,
        exitIc: null,
        startOffsetSec: elapsedSec,
        endOffsetSec: elapsedSec,
        durationSec: 0,
        distanceKm: 0,
        toll: 0,
        isEstimated: false
      };
    } else if (current) {
      const isExit = /出口|一般道|流出|降り/.test(inst);
      // 同じNEXCO同士のJCT接続（例：名神 → 東名）は1つの連続有料区間として統合
      const isOperatorSwitch = road && op && op !== current.operator && !/JCT|ＪＣＴ/.test(inst);

      if (isExit) {
        current.exitIc = extractFacilityName(inst, "exit") || `${legToLabel}付近出口`;
        current.endOffsetSec = elapsedSec;
        current.durationSec = Math.max(60, current.endOffsetSec - current.startOffsetSec);
        current.distanceKm = totalLegSec > 0 ? (totalLegKm * (current.durationSec / totalLegSec)) : 0;
        segments.push(current);
        current = null;
      } else if (isOperatorSwitch) {
        const switchIc = extractFacilityName(inst, "switch") || `${road}接続部`;
        current.exitIc = switchIc;
        current.endOffsetSec = elapsedSec;
        current.durationSec = Math.max(60, current.endOffsetSec - current.startOffsetSec);
        current.distanceKm = totalLegSec > 0 ? (totalLegKm * (current.durationSec / totalLegSec)) : 0;
        segments.push(current);

        current = {
          road: road,
          roads: [road],
          operator: op,
          entryIc: switchIc,
          exitIc: null,
          startOffsetSec: elapsedSec,
          endOffsetSec: elapsedSec,
          durationSec: 0,
          distanceKm: 0,
          toll: 0,
          isEstimated: false
        };
      } else if (road && op === current.operator && !current.roads.includes(road)) {
        current.roads.push(road);
        current.road = current.roads.join(" ➔ ");
      }
    }

    const stepSec = Math.max(15, Math.round(totalLegSec / Math.max(actions.length, 1)));
    elapsedSec += stepSec;
  }

  if (current) {
    current.exitIc = `${legToLabel}付近出口`;
    current.endOffsetSec = Math.max(current.startOffsetSec + 60, totalLegSec);
    current.durationSec = Math.max(60, current.endOffsetSec - current.startOffsetSec);
    current.distanceKm = totalLegSec > 0 ? (totalLegKm * (current.durationSec / totalLegSec)) : 0;
    segments.push(current);
  }

  if (segments.length === 0 && totalLegToll > 0) {
    segments.push({
      road: `${legFromLabel} ➔ ${legToLabel} 有料区間`,
      operator: "nexco",
      entryIc: `${legFromLabel}付近`,
      exitIc: `${legToLabel}付近`,
      startOffsetSec: 0,
      endOffsetSec: totalLegSec,
      durationSec: totalLegSec,
      distanceKm: totalLegKm,
      toll: totalLegToll,
      isEstimated: false
    });
  }

  allocateSegmentTolls(segments, totalLegToll);

  let discountedLegTotal = 0;
  segments.forEach(seg => {
    const segTime = new Date((legStartTimeObj ? legStartTimeObj.getTime() : Date.now()) + (seg.startOffsetSec || 0) * 1000);
    seg.startTimeFormatted = typeof formatHHMM === "function" ? formatHHMM(segTime) : "";
    if (typeof window.dynamicRulesEngine !== "undefined" && window.dynamicRulesEngine.evaluateDiscountForSegment) {
      const evalRes = window.dynamicRulesEngine.evaluateDiscountForSegment({
        baseToll: seg.toll,
        dateObj: segTime,
        operator: seg.operator,
        vehicleClass: vehicleClass || "standard"
      });
      seg.discountedToll = evalRes.finalToll;
      seg.discountAmount = evalRes.discountAmount;
      seg.discountLabel = evalRes.appliedLabel;
      seg.discountNote = evalRes.note;
    } else {
      seg.discountedToll = seg.toll;
      seg.discountAmount = 0;
      seg.discountLabel = "通常ETC料金";
      seg.discountNote = "";
    }
    discountedLegTotal += seg.discountedToll;
  });

  return {
    segments,
    baseTotalToll: totalLegToll,
    discountedTotalToll: discountedLegTotal
  };
}

function buildHighwayDetailHtml(titleText, legEntries, vehicleClass) {
  if (!legEntries || legEntries.length === 0) {
    return `<div class="hw-empty">有料区間データは検出されませんでした。</div>`;
  }

  let html = `<div class="hw-detail-wrap"><div class="hw-detail-title">${escapeHtml(titleText)}</div>`;
  let grandBase = 0;
  let grandDiscounted = 0;

  legEntries.forEach((entry, idx) => {
    const parsed = parseHighwaySegmentsFromHere(entry.res, entry.startDt, entry.fromLabel, entry.toLabel, vehicleClass);
    grandBase += parsed.baseTotalToll;
    grandDiscounted += parsed.discountedTotalToll;

    html += `<div class="hw-leg-block">`;
    html += `<div class="hw-leg-head">区間${idx + 1}：${escapeHtml(entry.fromLabel)} ➔ ${escapeHtml(entry.toLabel)}（標準ETC ¥${parsed.baseTotalToll.toLocaleString()} / 割引判定後 ¥${parsed.discountedTotalToll.toLocaleString()}）</div>`;

    if (parsed.segments.length === 0) {
      html += `<div class="hw-seg-none">この区間に有料高速区間はありません</div>`;
    } else {
      parsed.segments.forEach(seg => {
        const estTag = seg.isEstimated ? ` <span class="hw-est-badge">区間按分目安</span>` : ``;
        const discBadge = seg.discountAmount > 0
          ? `<span class="hw-disc-badge">✅ ${escapeHtml(seg.discountLabel)} (-¥${seg.discountAmount.toLocaleString()})</span>`
          : `<span class="hw-norm-badge">${escapeHtml(seg.discountLabel)}${seg.discountNote ? `（${escapeHtml(seg.discountNote)}）` : ""}</span>`;

        html += `
          <div class="hw-seg-card">
            <div class="hw-seg-top">
              <strong>${escapeHtml(seg.road)}</strong>
              <span>${seg.startTimeFormatted ? `${seg.startTimeFormatted}頃〜` : ""}</span>
            </div>
            <div class="hw-seg-ic">${escapeHtml(seg.entryIc)} ➔ ${escapeHtml(seg.exitIc)}</div>
            <div class="hw-seg-price">
              <span>標準: <strong>¥${seg.toll.toLocaleString()}</strong>${estTag}</span>
              <span>判定後: <strong style="color:var(--orange-dark);">¥${seg.discountedToll.toLocaleString()}</strong></span>
            </div>
            <div class="hw-seg-disc">${discBadge}</div>
          </div>
        `;
      });
    }
    html += `</div>`;
  });

  const totalSaved = Math.max(0, grandBase - grandDiscounted);
  html += `
    <div class="hw-summary-bar">
      <span>合計 標準ETC: <strong>¥${grandBase.toLocaleString()}</strong></span>
      <span>割引判定後: <strong style="color:var(--green);">¥${grandDiscounted.toLocaleString()}</strong>${totalSaved > 0 ? `（-¥${totalSaved.toLocaleString()}）` : ""}</span>
    </div>
  </div>`;

  return html;
}
