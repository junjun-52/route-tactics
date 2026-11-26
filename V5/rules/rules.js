// ===== 動的ETC割引ルールセット取得・キャッシュ・判定エンジン (V5 / 連休自動判定対応) =====
(function (global) {
  const RULES_CACHE_KEY = 'RT_DYNAMIC_RULES_CACHE_V5';
  const HOLIDAYS_CACHE_KEY = 'RT_HOLIDAYS_CACHE_V5';
  const DEFAULT_RULES_URL = './rules/etc_rules.json';

  // API未取得・オフライン時用の最低限フォールバック祝日（2026-2027）
  const FALLBACK_HOLIDAYS = {
    '2026-01-01': '元日',
    '2026-01-12': '成人の日',
    '2026-02-11': '建国記念の日',
    '2026-02-23': '天皇誕生日',
    '2026-03-20': '春分の日',
    '2026-04-29': '昭和の日',
    '2026-05-03': '憲法記念日',
    '2026-05-04': 'みどりの日',
    '2026-05-05': 'こどもの日',
    '2026-05-06': '休日',
    '2026-07-20': '海の日',
    '2026-08-11': '山の日',
    '2026-09-21': '敬老の日',
    '2026-09-22': '休日',
    '2026-09-23': '秋分の日',
    '2026-10-12': 'スポーツの日',
    '2026-11-03': '文化の日',
    '2026-11-23': '勤労感謝の日',
    '2027-01-01': '元日',
    '2027-01-11': '成人の日',
    '2027-02-11': '建国記念の日',
    '2027-02-23': '天皇誕生日',
    '2027-03-21': '春分の日',
    '2027-03-22': '休日',
    '2027-04-29': '昭和の日',
    '2027-05-03': '憲法記念日',
    '2027-05-04': 'みどりの日',
    '2027-05-05': 'こどもの日'
  };

  let activeRules = null;
  let activeHolidays = { ...FALLBACK_HOLIDAYS }; // { "YYYY-MM-DD": "祝日名" }
  let rulesStatusInfo = {
    loaded: false,
    source: '未取得',
    ruleVersion: '-',
    holidayCount: Object.keys(FALLBACK_HOLIDAYS).length,
    fetchedAt: null,
    error: null
  };

  function getCachedJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setCachedJson(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  function formatDateYMD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function addDays(dateObj, offsetDays) {
    return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() + offsetDays);
  }

  function isOffDay(dateObj) {
    const dow = dateObj.getDay();
    if (dow === 0 || dow === 6) return true;
    const ymd = formatDateYMD(dateObj);
    return Boolean(activeHolidays && activeHolidays[ymd]);
  }

  function isDateInRange(ymd, ranges) {
    if (!Array.isArray(ranges)) return null;
    for (const r of ranges) {
      if (r.start && r.end && ymd >= r.start && ymd <= r.end) {
        return r.reason || '対象外期間';
      }
    }
    return null;
  }

  /**
   * 祝日APIとカレンダーから大型連休・3連休以上を自動判定（毎年自動更新）
   * 1. JSONの明示除外期間（excludeDateRanges）
   * 2. 毎年固定の特定大型連休（GW: 4/29〜5/6、お盆: 8/8〜8/16、年末年始: 12/26〜1/4）
   * 3. 土日＋祝日が連続する3連休以上の期間（2026年度以降のNEXCO基準）
   */
  function detectHolidayExclusionReason(dateObj, rules) {
    const ymd = formatDateYMD(dateObj);
    const month = dateObj.getMonth() + 1;
    const day = dateObj.getDate();

    // 1. JSONの明示指定期間があれば最優先
    const explicitReason = isDateInRange(ymd, rules.holidayDiscount?.excludeDateRanges);
    if (explicitReason) return explicitReason;

    // 2. 毎年固定の大型連休（GW・お盆・年末年始）
    if ((month === 4 && day >= 29) || (month === 5 && day <= 6)) {
      return 'GW特定期間（自動判定・休日割引適用除外）';
    }
    if (month === 8 && day >= 8 && day <= 16) {
      return 'お盆特定期間（自動判定・休日割引適用除外）';
    }
    if ((month === 12 && day >= 26) || (month === 1 && day <= 4)) {
      return '年末年始特定期間（自動判定・休日割引適用除外）';
    }

    // 3. 土日・祝日が3日以上連続する3連休以上を自動検出
    if (isOffDay(dateObj)) {
      let streak = 1;
      let holidayNames = [];
      const selfHoliday = activeHolidays ? activeHolidays[ymd] : null;
      if (selfHoliday) holidayNames.push(selfHoliday);

      for (let i = 1; i <= 7; i++) {
        const prev = addDays(dateObj, -i);
        if (!isOffDay(prev)) break;
        streak++;
        const h = activeHolidays ? activeHolidays[formatDateYMD(prev)] : null;
        if (h && !holidayNames.includes(h)) holidayNames.push(h);
      }
      for (let i = 1; i <= 7; i++) {
        const next = addDays(dateObj, i);
        if (!isOffDay(next)) break;
        streak++;
        const h = activeHolidays ? activeHolidays[formatDateYMD(next)] : null;
        if (h && !holidayNames.includes(h)) holidayNames.push(h);
      }

      if (streak >= 3) {
        const title = holidayNames.length > 0 ? `（${holidayNames.join('・')}）` : '';
        return `${streak}連休${title}（自動判定・休日割引適用除外）`;
      }
    }

    return null;
  }

  // NEXCO等のETC割引端数処理に合わせて10円単位（10円未満四捨五入）に丸める
  function roundToTenYen(amount) {
    return Math.max(0, Math.round(Number(amount) / 10) * 10);
  }

  async function initDynamicRules(customRulesUrl) {
    const targetUrl = (customRulesUrl && customRulesUrl.trim()) ? customRulesUrl.trim() : DEFAULT_RULES_URL;
    const cacheBuster = (targetUrl.includes('?') ? '&' : '?') + '_v=' + Date.now();

    try {
      const res = await fetch(targetUrl + cacheBuster, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      activeRules = json;
      setCachedJson(RULES_CACHE_KEY, json);
      rulesStatusInfo.source = targetUrl === DEFAULT_RULES_URL ? '動的JSON (rules/etc_rules.json)' : `外部JSON (${targetUrl})`;
      rulesStatusInfo.ruleVersion = json.ruleVersion || 'unknown';
      rulesStatusInfo.error = null;
    } catch (e) {
      const cached = getCachedJson(RULES_CACHE_KEY);
      if (cached) {
        activeRules = cached;
        rulesStatusInfo.source = 'ローカルキャッシュ（オフラインフォールバック）';
        rulesStatusInfo.ruleVersion = cached.ruleVersion || 'cached';
        rulesStatusInfo.error = `最新取得失敗のためキャッシュ利用: ${e.message}`;
      } else {
        rulesStatusInfo.error = `ルール取得失敗: ${e.message}`;
      }
    }

    const holidayUrl = activeRules?.holidayApiUrl || 'https://holidays-jp.github.io/api/v1/date.json';
    try {
      const hRes = await fetch(holidayUrl, { cache: 'no-store' });
      if (!hRes.ok) throw new Error(`HTTP ${hRes.status}`);
      const hJson = await hRes.json();
      if (hJson && typeof hJson === 'object' && Object.keys(hJson).length > 0) {
        activeHolidays = { ...FALLBACK_HOLIDAYS, ...hJson };
        setCachedJson(HOLIDAYS_CACHE_KEY, activeHolidays);
      }
    } catch (e) {
      const hCached = getCachedJson(HOLIDAYS_CACHE_KEY);
      if (hCached) {
        activeHolidays = { ...FALLBACK_HOLIDAYS, ...hCached };
      }
    }

    rulesStatusInfo.loaded = Boolean(activeRules);
    rulesStatusInfo.holidayCount = Object.keys(activeHolidays || {}).length;
    rulesStatusInfo.fetchedAt = new Date().toISOString();

    if (typeof document !== 'undefined') {
      renderRulesStatusBadge();
    }
    return rulesStatusInfo;
  }

  function evaluateDiscountForSegment(options) {
    const opts = options || {};
    const baseToll = Math.max(0, Math.round(Number(opts.baseToll) || 0));
    const dt = opts.dateObj instanceof Date ? opts.dateObj : new Date();
    const operatorKey = opts.operator || 'nexco';
    const vehicleClass = opts.vehicleClass || 'standard';

    if (!baseToll || baseToll <= 0) {
      return {
        finalToll: 0,
        discountAmount: 0,
        discountRate: 0,
        appliedLabel: '無料 / 料金なし',
        note: ''
      };
    }

    const rules = activeRules || {};
    const policies = rules.operatorPolicies || {};
    const opPolicy = policies[operatorKey] || {
      label: operatorKey,
      holidayEligible: false,
      midnightEligible: false
    };
    const opLabel = opPolicy.label || operatorKey;

    const ymd = formatDateYMD(dt);
    const dayOfWeek = dt.getDay(); // 0:日, 6:土
    const hour = dt.getHours();
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const holidayName = activeHolidays ? activeHolidays[ymd] : null;
    const extraDates = rules.holidayDiscount?.extraEligibleDates || [];
    const isExtraHoliday = Array.isArray(extraDates) && extraDates.includes(ymd);
    const excludeReason = detectHolidayExclusionReason(dt, rules);

    const holidayCfg = rules.holidayDiscount || {};
    const midnightCfg = rules.midnightDiscount || {};

    // 1. 深夜割引判定（0時〜4時台・大型連休中も適用・事業者別の非対称適用）
    const isMidnightWindow = midnightCfg.enabled &&
      hour >= (midnightCfg.startHour ?? 0) &&
      hour < (midnightCfg.endHour ?? 4);
    const midnightClassOk = Array.isArray(midnightCfg.eligibleVehicleClasses)
      ? midnightCfg.eligibleVehicleClasses.includes(vehicleClass)
      : true;

    if (isMidnightWindow) {
      if (opPolicy.midnightEligible && midnightClassOk) {
        const rate = Number(midnightCfg.rate) || 0.3;
        const finalToll = roundToTenYen(baseToll * (1 - rate));
        const discountAmount = Math.max(0, baseToll - finalToll);
        const dayHint = holidayName ? `・祝日(${holidayName})` : (isWeekend ? '・土日' : '');
        return {
          finalToll,
          discountAmount,
          discountRate: rate,
          appliedLabel: midnightCfg.label || '深夜割引',
          note: `${opLabel} / ${hour}時台走行${dayHint}（重複割引なし）`
        };
      }
      if (!opPolicy.midnightEligible) {
        return {
          finalToll: baseToll,
          discountAmount: 0,
          discountRate: 0,
          appliedLabel: '深夜割引対象外（非対称）',
          note: `${opLabel}はNEXCO深夜割引の適用外`
        };
      }
    }

    // 2. 休日割引判定（土日祝または特例対象日・事業者＆車種非対称・連休自動除外）
    const isHolidayOrWeekend = isWeekend || Boolean(holidayName) || isExtraHoliday;
    const holidayClassOk = Array.isArray(holidayCfg.eligibleVehicleClasses)
      ? holidayCfg.eligibleVehicleClasses.includes(vehicleClass)
      : true;

    if (holidayCfg.enabled && isHolidayOrWeekend) {
      if (!opPolicy.holidayEligible) {
        const dayLabel = holidayName ? `祝日（${holidayName}）` : (dayOfWeek === 0 ? '日曜' : '土曜');
        return {
          finalToll: baseToll,
          discountAmount: 0,
          discountRate: 0,
          appliedLabel: '休日割引対象外（非対称）',
          note: `${dayLabel}だが${opLabel}は休日割引なし`
        };
      }
      if (!holidayClassOk) {
        const dayLabel = holidayName ? `祝日（${holidayName}）` : (dayOfWeek === 0 ? '日曜' : '土曜');
        return {
          finalToll: baseToll,
          discountAmount: 0,
          discountRate: 0,
          appliedLabel: '休日割引対象外（車種）',
          note: `${dayLabel}だが普通車・軽等以外は対象外`
        };
      }
      if (excludeReason) {
        return {
          finalToll: baseToll,
          discountAmount: 0,
          discountRate: 0,
          appliedLabel: '休日割引対象外',
          note: excludeReason
        };
      }

      const rate = Number(holidayCfg.rate) || 0.3;
      const finalToll = roundToTenYen(baseToll * (1 - rate));
      const discountAmount = Math.max(0, baseToll - finalToll);
      const dayLabel = holidayName
        ? `祝日（${holidayName}）`
        : (isExtraHoliday ? '特例対象日' : (dayOfWeek === 0 ? '日曜' : '土曜'));
      return {
        finalToll,
        discountAmount,
        discountRate: rate,
        appliedLabel: holidayCfg.label || '休日割引',
        note: `${opLabel} / ${dayLabel}`
      };
    }

    return {
      finalToll: baseToll,
      discountAmount: 0,
      discountRate: 0,
      appliedLabel: '通常ETC料金',
      note: `${opLabel}・平日昼間帯`
    };
  }

  function getRulesState() {
    return {
      rules: activeRules,
      holidays: activeHolidays,
      status: rulesStatusInfo
    };
  }

  function renderRulesStatusBadge() {
    const badge = document.getElementById('rulesStatusBadge');
    if (!badge) return;
    if (rulesStatusInfo.loaded) {
      badge.className = 'rules-badge ok';
      badge.innerText = `⚡ 動的ルール稼働中 (${rulesStatusInfo.ruleVersion} / 祝${rulesStatusInfo.holidayCount}件・連休自動判定)`;
    } else {
      badge.className = 'rules-badge warn';
      badge.innerText = '⚠️ 動的ルール未取得';
    }
  }

  global.dynamicRulesEngine = {
    initDynamicRules,
    evaluateDiscountForSegment,
    getRulesState,
    renderRulesStatusBadge
  };
})(typeof window !== 'undefined' ? window : globalThis);
