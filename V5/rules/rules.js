// ===== 動的ETC割引ルールセット取得・キャッシュ・判定エンジン (V5) =====
(function (global) {
  const RULES_CACHE_KEY = 'RT_DYNAMIC_RULES_CACHE_V5';
  const HOLIDAYS_CACHE_KEY = 'RT_HOLIDAYS_CACHE_V5';
  const DEFAULT_RULES_URL = './rules/etc_rules.json';

  let activeRules = null;
  let activeHolidays = {}; // { "YYYY-MM-DD": "祝日名" }
  let rulesStatusInfo = {
    loaded: false,
    source: '未取得',
    ruleVersion: '-',
    holidayCount: 0,
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

  function isDateInRange(ymd, ranges) {
    if (!Array.isArray(ranges)) return null;
    for (const r of ranges) {
      if (r.start && r.end && ymd >= r.start && ymd <= r.end) {
        return r.reason || '対象外期間';
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
      activeHolidays = hJson || {};
      setCachedJson(HOLIDAYS_CACHE_KEY, activeHolidays);
    } catch (e) {
      const hCached = getCachedJson(HOLIDAYS_CACHE_KEY);
      if (hCached) activeHolidays = hCached;
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
    const opPolicy = policies[operatorKey] || { holidayEligible: false, midnightEligible: false };

    const ymd = formatDateYMD(dt);
    const dayOfWeek = dt.getDay(); // 0:日, 6:土
    const hour = dt.getHours();
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
    const holidayName = activeHolidays ? activeHolidays[ymd] : null;
    const extraDates = rules.holidayDiscount?.extraEligibleDates || [];
    const isExtraHoliday = Array.isArray(extraDates) && extraDates.includes(ymd);
    const excludeReason = isDateInRange(ymd, rules.holidayDiscount?.excludeDateRanges);

    const holidayCfg = rules.holidayDiscount || {};
    const midnightCfg = rules.midnightDiscount || {};

    // 深夜割引判定（0時〜4時台）
    const isMidnightWindow = midnightCfg.enabled &&
      hour >= (midnightCfg.startHour ?? 0) &&
      hour < (midnightCfg.endHour ?? 4);
    const midnightClassOk = Array.isArray(midnightCfg.eligibleVehicleClasses)
      ? midnightCfg.eligibleVehicleClasses.includes(vehicleClass)
      : true;

    if (isMidnightWindow && opPolicy.midnightEligible && midnightClassOk) {
      const rate = Number(midnightCfg.rate) || 0.3;
      const finalToll = roundToTenYen(baseToll * (1 - rate));
      const discountAmount = Math.max(0, baseToll - finalToll);
      return {
        finalToll,
        discountAmount,
        discountRate: rate,
        appliedLabel: midnightCfg.label || '深夜割引',
        note: `${hour}時台走行`
      };
    }

    // 休日割引判定（土日祝または特例対象日、かつ除外期間外）
    const holidayClassOk = Array.isArray(holidayCfg.eligibleVehicleClasses)
      ? holidayCfg.eligibleVehicleClasses.includes(vehicleClass)
      : true;

    if (holidayCfg.enabled && opPolicy.holidayEligible && holidayClassOk) {
      if (excludeReason) {
        return {
          finalToll: baseToll,
          discountAmount: 0,
          discountRate: 0,
          appliedLabel: '休日割引対象外',
          note: excludeReason
        };
      }
      if (isWeekend || Boolean(holidayName) || isExtraHoliday) {
        const rate = Number(holidayCfg.rate) || 0.3;
        const finalToll = roundToTenYen(baseToll * (1 - rate));
        const discountAmount = Math.max(0, baseToll - finalToll);
        const dayLabel = holidayName ? `祝日（${holidayName}）` : (isExtraHoliday ? '特例対象日' : (dayOfWeek === 0 ? '日曜' : '土曜'));
        return {
          finalToll,
          discountAmount,
          discountRate: rate,
          appliedLabel: holidayCfg.label || '休日割引',
          note: dayLabel
        };
      }
    }

    return {
      finalToll: baseToll,
      discountAmount: 0,
      discountRate: 0,
      appliedLabel: '通常ETC料金',
      note: !opPolicy.holidayEligible && (isWeekend || holidayName) ? `${opPolicy.label || operatorKey}は休日割引対象外` : ''
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
      badge.innerText = `⚡ 動的ルール稼働中 (${rulesStatusInfo.ruleVersion} / 祝${rulesStatusInfo.holidayCount}件)`;
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
