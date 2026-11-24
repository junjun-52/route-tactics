/**
 * weather.js
 * ROUTE TACTICS v5-yahoo Open-Meteo API による到着予定時刻の目的地天気取得
 */
const WeatherManager = (() => {
  const { API_ENDPOINTS, REQUEST_TIMEOUT_MS } = RouteTacticsConfig;

  // WMO Weather interpretation codes (WW) の日本語ラベル・アイコンマッピング
  const WMO_CODE_MAP = {
    0: { label: '快晴', icon: '☀️' },
    1: { label: '晴れ', icon: '🌤️' },
    2: { label: '一部曇り', icon: '⛅' },
    3: { label: '曇り', icon: '☁️' },
    45: { label: '霧', icon: '🌫️' },
    48: { label: '着氷性の霧', icon: '🌫️' },
    51: { label: '弱い霧雨', icon: '🌦️' },
    53: { label: '霧雨', icon: '🌦️' },
    55: { label: '強い霧雨', icon: '🌧️' },
    56: { label: '弱い着氷性霧雨', icon: '🌧️' },
    57: { label: '強い着氷性霧雨', icon: '🌧️' },
    61: { label: '弱い雨', icon: '🌧️' },
    63: { label: '雨', icon: '🌧️' },
    65: { label: '強い雨', icon: '⛈️' },
    66: { label: '弱い着氷性の雨', icon: '🌧️' },
    67: { label: '強い着氷性の雨', icon: '⛈️' },
    71: { label: '弱い雪', icon: '🌨️' },
    73: { label: '雪', icon: '❄️' },
    75: { label: '強い雪', icon: '❄️' },
    77: { label: '霧雪', icon: '🌨️' },
    80: { label: 'にわか雨（弱）', icon: '🌦️' },
    81: { label: 'にわか雨', icon: '🌧️' },
    82: { label: '激しいにわか雨', icon: '⛈️' },
    85: { label: 'にわか雪（弱）', icon: '🌨️' },
    86: { label: 'にわか雪（強）', icon: '❄️' },
    95: { label: '雷雨', icon: '⛈️' },
    96: { label: 'ひょうを伴う雷雨（弱）', icon: '⛈️' },
    99: { label: 'ひょうを伴う雷雨（強）', icon: '⛈️' },
  };

  /**
   * タイムアウト付き fetch
   */
  async function fetchWithTimeout(url, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Open-Meteo HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timerId);
    }
  }

  /**
   * WMOコードから表示情報を取得
   */
  function describeWeatherCode(code) {
    const num = Number(code);
    return WMO_CODE_MAP[num] || { label: `天気コード(${num})`, icon: '🌡️' };
  }

  /**
   * Dateオブジェクトを "YYYY-MM-DDTHH:00" 形式（JST/指定タイムゾーン基準）に整形
   * Open-Meteo の timezone=Asia%2FTokyo で返る hourly.time ("2026-11-24T22:00") と比較しやすくする
   */
  function toTokyoHourString(dateObj) {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(dateObj);

    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    return `${map.year}-${map.month}-${map.day}T${map.hour}:00`;
  }

  /**
   * 到着予定時刻に最も近い hourly インデックスを探す
   */
  function findClosestHourIndex(hourlyTimes, etaDate) {
    if (!Array.isArray(hourlyTimes) || hourlyTimes.length === 0) return -1;

    const targetEpoch = etaDate.getTime();
    let bestIdx = 0;
    let bestDiff = Infinity;

    hourlyTimes.forEach((isoStr, idx) => {
      // Open-Meteo の "YYYY-MM-DDTHH:MM" を JST (+09:00) として解釈して差分計算
      const normalized = isoStr.length === 16 ? `${isoStr}:00+09:00` : isoStr;
      const parsedMs = Date.parse(normalized);
      if (!Number.isNaN(parsedMs)) {
        const diff = Math.abs(parsedMs - targetEpoch);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = idx;
        }
      }
    });

    return bestIdx;
  }

  /**
   * 目的地・出発日時・所要時間から、到着予定時刻のピンポイント天気を取得
   * @param {Object} params
   * @param {number} params.lat - 目的地緯度
   * @param {number} params.lon - 目的地経度
   * @param {Date|string|number} [params.departureTime] - 出発日時（未指定時は現在時刻）
   * @param {number} [params.durationSeconds=0] - ルート所要時間（秒）
   * @returns {Promise<Object>} 到着時刻天気サマリー
   */
  async function getArrivalWeather({ lat, lon, departureTime = new Date(), durationSeconds = 0 }) {
    const numLat = Number(lat);
    const numLon = Number(lon);
    if (!Number.isFinite(numLat) || !Number.isFinite(numLon)) {
      throw new Error('目的地の緯度経度が不正です');
    }

    const depDate = departureTime instanceof Date ? departureTime : new Date(departureTime);
    const validDepDate = Number.isNaN(depDate.getTime()) ? new Date() : depDate;
    const safeDurationSec = Math.max(0, Number(durationSeconds) || 0);
    const etaDate = new Date(validDepDate.getTime() + safeDurationSec * 1000);

    const params = new URLSearchParams({
      latitude: numLat.toFixed(6),
      longitude: numLon.toFixed(6),
      hourly: [
        'temperature_2m',
        'precipitation_probability',
        'precipitation',
        'weather_code',
        'wind_speed_10m',
      ].join(','),
      timezone: 'Asia/Tokyo',
      forecast_days: '7',
    });

    const url = `${API_ENDPOINTS.OPEN_METEO}?${params.toString()}`;
    const data = await fetchWithTimeout(url);

    const hourly = data && data.hourly ? data.hourly : {};
    const times = Array.isArray(hourly.time) ? hourly.time : [];
    const idx = findClosestHourIndex(times, etaDate);

    if (idx < 0) {
      return {
        available: false,
        etaDate,
        etaLabel: formatEtaLabel(etaDate),
        lat: numLat,
        lon: numLon,
        weatherCode: null,
        label: '予報対象外',
        icon: '❓',
        temperatureC: null,
        precipitationProb: null,
        precipitationMm: null,
        windSpeedKmh: null,
      };
    }

    const code = Array.isArray(hourly.weather_code) ? hourly.weather_code[idx] : null;
    const desc = describeWeatherCode(code);

    return {
      available: true,
      etaDate,
      etaLabel: formatEtaLabel(etaDate),
      forecastSlotTime: times[idx],
      lat: numLat,
      lon: numLon,
      weatherCode: code,
      label: desc.label,
      icon: desc.icon,
      temperatureC:
        Array.isArray(hourly.temperature_2m) && hourly.temperature_2m[idx] != null
          ? Number(hourly.temperature_2m[idx])
          : null,
      precipitationProb:
        Array.isArray(hourly.precipitation_probability) &&
        hourly.precipitation_probability[idx] != null
          ? Number(hourly.precipitation_probability[idx])
          : null,
      precipitationMm:
        Array.isArray(hourly.precipitation) && hourly.precipitation[idx] != null
          ? Number(hourly.precipitation[idx])
          : null,
      windSpeedKmh:
        Array.isArray(hourly.wind_speed_10m) && hourly.wind_speed_10m[idx] != null
          ? Number(hourly.wind_speed_10m[idx])
          : null,
    };
  }

  /**
   * 到着予定時刻の表示用文字列（例: "11/24 22:15頃着"）
   */
  function formatEtaLabel(dateObj) {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(dateObj);

    const map = {};
    parts.forEach((p) => {
      if (p.type !== 'literal') map[p.type] = p.value;
    });
    return `${map.month}/${map.day} ${map.hour}:${map.minute}頃着`;
  }

  return {
    getArrivalWeather,
    describeWeatherCode,
    toTokyoHourString,
    formatEtaLabel,
  };
})();
