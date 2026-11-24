
/**
 * navi-launcher.js
 * ROUTE TACTICS v5-yahoo Yahoo!カーナビ (yjcarnavi://) 連携＆併用ナビ制御
 */
const NaviLauncher = (() => {
  const { YAHOO_NAVI_MAX_WAYPOINTS } = RouteTacticsConfig;

  /**
   * 座標オブジェクトを検証して数値化
   */
  function sanitizeCoord(pt, fallbackName = '') {
    if (!pt) return null;
    const lat = Number(pt.lat);
    const lon = Number(pt.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return {
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      name: pt.name ? String(pt.name).trim() : fallbackName,
    };
  }

  /**
   * Yahoo!カーナビ起動用 URLスキーム (yjcarnavi://) を生成
   * - 経由地なし: yjcarnavi://navi/select?lat={lat}&lon={lon}&name={name}
   * - 経由地あり（最大3ヶ所）: yjcarnavi://navi/select?point=current&point={lat},{lon},...
   * @param {Object} params
   * @param {Object} params.destination - { lat, lon, name? }
   * @param {Array<Object>} [params.waypoints=[]] - [{ lat, lon, name? }, ...] (最大3ヶ所)
   * @param {boolean} [params.useCurrentLocation=true] - 経由地あり時に現在地を出発点にするか
   * @returns {string}
   */
  function buildYahooNaviUrl({ destination, waypoints = [], useCurrentLocation = true }) {
    const dest = sanitizeCoord(destination, '目的地');
    if (!dest) {
      throw new Error('Yahoo!カーナビ起動に必要な目的地座標が不正です');
    }

    const validWaypoints = Array.isArray(waypoints)
      ? waypoints
          .map((wp, idx) => sanitizeCoord(wp, `経由地${idx + 1}`))
          .filter(Boolean)
          .slice(0, YAHOO_NAVI_MAX_WAYPOINTS)
      : [];

    if (validWaypoints.length > 0) {
      const points = [];
      if (useCurrentLocation) {
        points.push('point=current');
      }
      validWaypoints.forEach((wp) => {
        points.push(`point=${wp.lat},${wp.lon},`);
      });
      points.push(`point=${dest.lat},${dest.lon},`);
      return `yjcarnavi://navi/select?${points.join('&')}`;
    }

    const query = new URLSearchParams({
      lat: dest.lat.toString(),
      lon: dest.lon.toString(),
    });
    if (dest.name) {
      query.set('name', dest.name);
    }
    return `yjcarnavi://navi/select?${query.toString()}`;
  }

  /**
   * Googleマップ起動用 URLを生成（併用・PC確認・フォールバック用）
   * @param {Object} params
   * @param {Object} [params.origin] - 任意出発地 { lat, lon }
   * @param {Object} params.destination - { lat, lon }
   * @param {Array<Object>} [params.waypoints=[]] - [{ lat, lon }, ...]
   * @param {boolean} [params.avoidTolls=false] - 有料道路回避
   * @returns {string}
   */
  function buildGoogleMapsUrl({ origin = null, destination, waypoints = [], avoidTolls = false }) {
    const dest = sanitizeCoord(destination, '目的地');
    if (!dest) {
      throw new Error('Googleマップ起動に必要な目的地座標が不正です');
    }

    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', `${dest.lat},${dest.lon}`);
    url.searchParams.set('travelmode', 'driving');

    const validOrigin = sanitizeCoord(origin);
    if (validOrigin) {
      url.searchParams.set('origin', `${validOrigin.lat},${validOrigin.lon}`);
    }

    if (Array.isArray(waypoints) && waypoints.length > 0) {
      const wpStr = waypoints
        .map((wp) => sanitizeCoord(wp))
        .filter(Boolean)
        .map((wp) => `${wp.lat},${wp.lon}`)
        .join('|');
      if (wpStr) {
        url.searchParams.set('waypoints', wpStr);
      }
    }

    if (avoidTolls) {
      url.searchParams.set('avoid', 'tolls');
    }

    return url.toString();
  }

  /**
   * クリップボードへURLをコピー（PCデバッグやスキーム共有用）
   */
  async function copyUrlToClipboard(text) {
    if (!text) return false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {
      // フォールバックへ進む
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Yahoo!カーナビを起動し、起動しなかった場合（PCブラウザや未インストール時）にフォールバックを実行
   * @param {string} yahooUrl - buildYahooNaviUrl() で生成したURL
   * @param {Object} [options]
   * @param {Function} [options.onFallback] - ({ yahooUrl, googleMapsUrl, isLikelyDesktop }) => void
   * @param {string} [options.googleMapsUrl] - フォールバック案内時に併記できるGoogleマップURL
   * @param {number} [options.detectDelayMs=1500] - アプリ遷移判定までの待機時間
   */
  function launchYahooNavi(yahooUrl, options = {}) {
    const { onFallback = null, googleMapsUrl = '', detectDelayMs = 1500 } = options;

    if (!yahooUrl || !yahooUrl.startsWith('yjcarnavi://')) {
      throw new Error('有効な yjcarnavi:// URL を指定してください');
    }

    const startMs = Date.now();
    let switchedAway = false;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        switchedAway = true;
      }
    };

    const handlePageHide = () => {
      switchedAway = true;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange, { once: true });
    window.addEventListener('pagehide', handlePageHide, { once: true });

    // スキーム遷移を実行
    window.location.href = yahooUrl;

    setTimeout(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);

      const elapsed = Date.now() - startMs;
      if (!switchedAway && elapsed < detectDelayMs + 1200) {
        const isLikelyDesktop = !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (typeof onFallback === 'function') {
          onFallback({ yahooUrl, googleMapsUrl, isLikelyDesktop });
        } else {
          const envNote = isLikelyDesktop
            ? 'PCブラウザからはアプリを直接開けません。スマホ実機で開くか、Googleマップをご利用ください。\n'
            : 'Yahoo!カーナビが起動しませんでした。インストール状況を確認するか、Googleマップをご利用ください。\n';
          alert(`${envNote}\nスキームURL:\n${yahooUrl}`);
        }
      }
    }, detectDelayMs);
  }

  return {
    sanitizeCoord,
    buildYahooNaviUrl,
    buildGoogleMapsUrl,
    copyUrlToClipboard,
    launchYahooNavi,
  };
})();
