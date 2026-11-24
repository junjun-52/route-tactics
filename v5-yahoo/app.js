/**
 * app.js
 * ROUTE TACTICS v5-yahoo 画面制御・オーケストレーション
 * - 地点名・住所からの自動ジオコーディング（TomTom Search -> Google -> Nominatim -> 国土地理院）対応
 */
(() => {
  const { STORAGE_KEYS, DEFAULT_VEHICLE_SETTINGS } = RouteTacticsConfig;

  const state = {
    activeTargetField: 'dest', // 'origin' | 'dest' （クイック地点チップ押下時の反映先）
    lastComparison: null,
    lastWeathers: {},
  };

  // DOM要素キャッシュ
  const els = {
    btnToggleSettings: document.getElementById('btn-toggle-settings'),
    settingsPanel: document.getElementById('settings-panel'),
    inputGoogleKey: document.getElementById('input-google-key'),
    inputTomtomKey: document.getElementById('input-tomtom-key'),
    btnSaveApiKeys: document.getElementById('btn-save-api-keys'),

    homeName: document.getElementById('home-name'),
    homeLat: document.getElementById('home-lat'),
    homeLon: document.getElementById('home-lon'),
    btnSaveHome: document.getElementById('btn-save-home'),

    placeName: document.getElementById('place-name'),
    placeLat: document.getElementById('place-lat'),
    placeLon: document.getElementById('place-lon'),
    btnAddPlace: document.getElementById('btn-add-place'),
    savedPlaceRemain: document.getElementById('saved-place-remain'),
    savedPlacesList: document.getElementById('saved-places-list'),

    profileSelect: document.getElementById('profile-select'),
    quickLocationChips: document.getElementById('quick-location-chips'),

    originName: document.getElementById('origin-name'),
    originLat: document.getElementById('origin-lat'),
    originLon: document.getElementById('origin-lon'),
    btnGpsOrigin: document.getElementById('btn-gps-origin'),
    btnSwapLocations: document.getElementById('btn-swap-locations'),

    destName: document.getElementById('dest-name'),
    destLat: document.getElementById('dest-lat'),
    destLon: document.getElementById('dest-lon'),

    fuelEff: document.getElementById('fuel-eff'),
    fuelPrice: document.getElementById('fuel-price'),
    refFuelPrice: document.getElementById('ref-fuel-price'),
    departureTime: document.getElementById('departure-time'),

    btnCalculate: document.getElementById('btn-calculate'),
    statusMessage: document.getElementById('status-message'),

    summaryBanner: document.getElementById('summary-banner'),
    routesContainer: document.getElementById('routes-container'),
    routeCanvas: document.getElementById('route-canvas'),
    mapCaption: document.getElementById('map-caption'),

    schemeToast: document.getElementById('scheme-toast'),
    schemeToastTitle: document.getElementById('scheme-toast-title'),
    schemeToastUrl: document.getElementById('scheme-toast-url'),
    btnCopyScheme: document.getElementById('btn-copy-scheme'),
    btnFallbackGmap: document.getElementById('btn-fallback-gmap'),
    btnCloseToast: document.getElementById('btn-close-toast'),
  };

  function setStatus(msg, isError = false) {
    els.statusMessage.textContent = msg;
    els.statusMessage.style.color = isError ? '#dc2626' : '#1d4ed8';
  }

  function formatDuration(seconds) {
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    const hrs = Math.floor(sec / 3600);
    const mins = Math.round((sec % 3600) / 60);
    if (hrs > 0) return `${hrs}時間${mins}分`;
    return `${mins}分`;
  }

  function formatYen(amount) {
    return `${Math.round(Number(amount) || 0).toLocaleString()}円`;
  }

  function toLocalDatetimeInputValue(dateObj = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(
      dateObj.getDate()
    )}T${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}`;
  }

  /**
   * 座標入力値の厳密なパース（空文字は NaN にし、0 誤認を防ぐ）
   */
  function parseCoordInput(val) {
    const str = String(val ?? '').trim();
    if (str === '') return NaN;
    const num = Number(str);
    return Number.isFinite(num) ? num : NaN;
  }

  function isValidCoordPair(lat, lon) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180 &&
      !(lat === 0 && lon === 0)
    );
  }

  /**
   * 地点名・住所から緯度経度を自動取得
   * 優先順位：TomTom Search API -> Google Geocoding API -> OpenStreetMap Nominatim -> 国土地理院
   */
  async function geocodePlaceName(query, apiKeys = {}) {
    const q = String(query || '').trim();
    if (!q) {
      throw new Error('地点名または住所を入力してください。');
    }

    const { googleMapsKey = '', tomtomKey = '' } = apiKeys;

    // 1. TomTom Search API（日本の駅名・施設名・住所に非常に強い）
    if (tomtomKey) {
      try {
        const ttUrl = `https://api.tomtom.com/search/2/search/${encodeURIComponent(
          q
        )}.json?key=${encodeURIComponent(tomtomKey)}&countrySet=JP&language=ja-JP&limit=1`;
        const res = await fetch(ttUrl);
        if (res.ok) {
          const data = await res.json();
          const hit = data && Array.isArray(data.results) && data.results[0];
          if (hit && hit.position && isValidCoordPair(hit.position.lat, hit.position.lon)) {
            return {
              lat: Number(Number(hit.position.lat).toFixed(6)),
              lon: Number(Number(hit.position.lon).toFixed(6)),
              resolvedAddress:
                (hit.address && hit.address.freeformAddress) ||
                (hit.poi && hit.poi.name) ||
                q,
              source: 'TomTom',
            };
          }
        }
      } catch (e) {
        console.warn('[Geocode] TomTom Search スキップ:', e.message);
      }
    }

    // 2. Google Geocoding API（有効な場合）
    if (googleMapsKey) {
      try {
        const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          q
        )}&language=ja&region=jp&key=${encodeURIComponent(googleMapsKey)}`;
        const res = await fetch(gUrl);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'OK' && Array.isArray(data.results) && data.results[0]) {
            const loc = data.results[0].geometry.location;
            return {
              lat: Number(loc.lat.toFixed(6)),
              lon: Number(loc.lng.toFixed(6)),
              resolvedAddress: data.results[0].formatted_address || q,
              source: 'Google',
            };
          }
        }
      } catch (e) {
        console.warn('[Geocode] Google Geocoding スキップ:', e.message);
      }
    }

    // 3. OpenStreetMap Nominatim（無料・キー不要・駅名や施設名にも対応）
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&q=${encodeURIComponent(
        q
      )}`;
      const res = await fetch(nomUrl, {
        headers: { 'Accept-Language': 'ja' },
      });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0) {
          const lat = Number(list[0].lat);
          const lon = Number(list[0].lon);
          if (isValidCoordPair(lat, lon)) {
            return {
              lat: Number(lat.toFixed(6)),
              lon: Number(lon.toFixed(6)),
              resolvedAddress: list[0].display_name || q,
              source: 'OpenStreetMap',
            };
          }
        }
      }
    } catch (e) {
      console.warn('[Geocode] Nominatim スキップ:', e.message);
    }

    // 4. 国土地理院 住所検索API（最終フォールバック：住所向け）
    try {
      const gsiUrl = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(
        q
      )}`;
      const res = await fetch(gsiUrl);
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list.length > 0 && list[0].geometry && list[0].geometry.coordinates) {
          const [lon, lat] = list[0].geometry.coordinates;
          if (isValidCoordPair(Number(lat), Number(lon))) {
            return {
              lat: Number(Number(lat).toFixed(6)),
              lon: Number(Number(lon).toFixed(6)),
              resolvedAddress: (list[0].properties && list[0].properties.title) || q,
              source: '国土地理院',
            };
          }
        }
      }
    } catch (e) {
      console.warn('[Geocode] 国土地理院API スキップ:', e.message);
    }

    throw new Error(`「${q}」の座標を取得できませんでした。都道府県名などを付けて再試行してください。`);
  }

  /**
   * 画面の出発地・目的地入力へ座標セット
   */
  function applyLocationToField(target, loc) {
    if (!loc) return;
    if (target === 'origin') {
      els.originName.value = loc.name || '';
      els.originLat.value = loc.lat ?? '';
      els.originLon.value = loc.lon ?? '';
    } else {
      els.destName.value = loc.name || '';
      els.destLat.value = loc.lat ?? '';
      els.destLon.value = loc.lon ?? '';
    }
    persistLastFormState();
  }

  /**
   * 現在の入力フォーム状態から出発地・目的地・車両設定を取得
   */
  function readFormInputs() {
    const origin = {
      name: els.originName.value.trim(),
      lat: parseCoordInput(els.originLat.value),
      lon: parseCoordInput(els.originLon.value),
    };
    const destination = {
      name: els.destName.value.trim(),
      lat: parseCoordInput(els.destLat.value),
      lon: parseCoordInput(els.destLon.value),
    };
    const vehicle = {
      fuelEfficiencyKmPerL: Math.max(
        0.1,
        Number(els.fuelEff.value) || DEFAULT_VEHICLE_SETTINGS.fuelEfficiencyKmPerL
      ),
      fuelPriceYenPerL: Math.max(
        0,
        Number(els.fuelPrice.value) || DEFAULT_VEHICLE_SETTINGS.fuelPriceYenPerL
      ),
      referenceFuelPriceYenPerL: Math.max(
        0,
        Number(els.refFuelPrice.value) || DEFAULT_VEHICLE_SETTINGS.referenceFuelPriceYenPerL
      ),
      etcDiscountRate: ProfileManager.getActiveProfile().etcDiscountRate || 0,
    };

    const depRaw = els.departureTime.value;
    const departureDate = depRaw ? new Date(depRaw) : new Date();

    return { origin, destination, vehicle, departureDate };
  }

  function persistLastFormState() {
    try {
      const payload = {
        originName: els.originName.value,
        originLat: els.originLat.value,
        originLon: els.originLon.value,
        destName: els.destName.value,
        destLat: els.destLat.value,
        destLon: els.destLon.value,
        fuelEff: els.fuelEff.value,
        fuelPrice: els.fuelPrice.value,
        refFuelPrice: els.refFuelPrice.value,
      };
      localStorage.setItem(STORAGE_KEYS.LAST_STATE, JSON.stringify(payload));
    } catch (_) {}
  }

  function restoreLastFormState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.LAST_STATE);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.originName != null) els.originName.value = s.originName;
      if (s.originLat != null) els.originLat.value = s.originLat;
      if (s.originLon != null) els.originLon.value = s.originLon;
      if (s.destName != null) els.destName.value = s.destName;
      if (s.destLat != null) els.destLat.value = s.destLat;
      if (s.destLon != null) els.destLon.value = s.destLon;
      if (s.fuelEff != null) els.fuelEff.value = s.fuelEff;
      if (s.fuelPrice != null) els.fuelPrice.value = s.fuelPrice;
      if (s.refFuelPrice != null) els.refFuelPrice.value = s.refFuelPrice;
    } catch (_) {}
  }

  /**
   * プロファイルセレクタ描画＆適用
   */
  function renderProfileSelect() {
    const profiles = ProfileManager.getProfiles();
    const active = ProfileManager.getActiveProfile();
    els.profileSelect.innerHTML = '';

    profiles.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === active.id) opt.selected = true;
      els.profileSelect.appendChild(opt);
    });

    els.fuelEff.value = active.fuelEfficiencyKmPerL;
    els.fuelPrice.value = active.fuelPriceYenPerL;
  }

  /**
   * 自宅＆登録地5件の描画（クイックチップ＋管理リスト）
   */
  function renderLocationsUI() {
    const home = ProfileManager.getHomeLocation();
    const savedPlaces = ProfileManager.getSavedPlaces();

    if (home) {
      els.homeName.value = home.name;
      els.homeLat.value = home.lat;
      els.homeLon.value = home.lon;
    }

    els.savedPlaceRemain.textContent = String(Math.max(0, 5 - savedPlaces.length));
    els.savedPlacesList.innerHTML = '';

    savedPlaces.forEach((place) => {
      const li = document.createElement('li');
      li.className = 'saved-place-item';

      const info = document.createElement('span');
      info.textContent = `${place.name} (${place.lat}, ${place.lon})`;

      const actions = document.createElement('div');
      actions.className = 'saved-place-actions';

      const toOriginBtn = document.createElement('button');
      toOriginBtn.type = 'button';
      toOriginBtn.className = 'btn-ghost';
      toOriginBtn.textContent = '出発地へ';
      toOriginBtn.onclick = () => applyLocationToField('origin', place);

      const toDestBtn = document.createElement('button');
      toDestBtn.type = 'button';
      toDestBtn.className = 'btn-ghost';
      toDestBtn.textContent = '目的地へ';
      toDestBtn.onclick = () => applyLocationToField('dest', place);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-ghost';
      delBtn.textContent = '削除';
      delBtn.onclick = () => {
        ProfileManager.removeSavedPlace(place.id);
        renderLocationsUI();
      };

      actions.append(toOriginBtn, toDestBtn, delBtn);
      li.append(info, actions);
      els.savedPlacesList.appendChild(li);
    });

    // クイックチップ（自宅 + 登録地最大5件）
    const { all } = ProfileManager.getAllQuickLocations();
    els.quickLocationChips.innerHTML = '';

    all.forEach((loc) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'quick-chip';
      chip.textContent = loc.id === 'home' ? `🏠 ${loc.name}` : `📌 ${loc.name}`;
      chip.title = `${loc.name} (${loc.lat}, ${loc.lon}) を入力`;
      chip.onclick = () => {
        applyLocationToField(state.activeTargetField, loc);
        setStatus(
          `${loc.name} を${state.activeTargetField === 'origin' ? '出発地' : '目的地'}にセットしました`
        );
      };
      els.quickLocationChips.appendChild(chip);
    });
  }

  /**
   * Yahoo!カーナビ起動フォールバックトースト表示
   */
  function showFallbackToast({ yahooUrl, googleMapsUrl, isLikelyDesktop }) {
    els.schemeToastTitle.textContent = isLikelyDesktop
      ? 'PCブラウザからはアプリを直接開けません。URLをコピーするかスマホ実機・Googleマップをご利用ください。'
      : 'Yahoo!カーナビを起動できませんでした。インストール状況を確認するかGoogleマップをご利用ください。';
    els.schemeToastUrl.textContent = yahooUrl;
    els.btnFallbackGmap.href = googleMapsUrl || 'https://www.google.com/maps';
    els.schemeToast.classList.remove('is-hidden');
  }

  /**
   * ルート比較カードの描画
   */
  function renderRouteCards(comparison, weathersByStrategy) {
    els.routesContainer.innerHTML = '';
    if (!comparison || !Array.isArray(comparison.routes)) return;

    comparison.routes.forEach((route) => {
      const card = document.createElement('article');
      card.className = 'route-card';
      card.dataset.strategy = route.strategy;

      // ヘッダー
      const header = document.createElement('div');
      header.className = 'route-card-header';
      header.innerHTML = `
        <h3 class="route-strategy-title">${route.label}</h3>
        <div class="route-total-cost">${formatYen(route.cost.totalCostYen)}</div>
      `;

      // 主要メトリクス
      const crossCheckText =
        typeof route.tomtomDurationSeconds === 'number'
          ? `Google ${formatDuration(route.googleDurationSeconds)} / TomTom ${formatDuration(
              route.tomtomDurationSeconds
            )}`
          : 'Google Routes 基準';

      const metrics = document.createElement('div');
      metrics.className = 'metrics-list';
      metrics.innerHTML = `
        <div class="metric-box">
          <span class="metric-label">所要時間</span>
          <strong>${formatDuration(route.durationSeconds)}</strong>
        </div>
        <div class="metric-box">
          <span class="metric-label">走行距離</span>
          <strong>${route.distanceKm.toFixed(1)} km</strong>
        </div>
        <div class="metric-box">
          <span class="metric-label">ETC料金</span>
          <strong>${formatYen(route.cost.tollYen)}</strong>
        </div>
        <div class="metric-box">
          <span class="metric-label">燃料費 (${route.cost.litersUsed}L)</span>
          <strong>${formatYen(route.cost.fuelCostYen)}</strong>
        </div>
      `;

      // 時間コスパバッジ
      const cospa = document.createElement('div');
      cospa.className = 'cospa-pill';
      cospa.textContent = `⏱️ ${route.timeCospa ? route.timeCospa.summary : ''}（${crossCheckText}）`;

      // 到着予定時刻の天気
      const w = weathersByStrategy[route.strategy];
      const weatherEl = document.createElement('div');
      weatherEl.className = 'weather-box';
      if (w && w.available) {
        const tempStr = w.temperatureC != null ? `${w.temperatureC}℃` : '-';
        const popStr = w.precipitationProb != null ? `降水${w.precipitationProb}%` : '';
        weatherEl.textContent = `${w.icon} ${w.etaLabel}：${w.label} / ${tempStr} ${popStr}`;
      } else {
        weatherEl.textContent = '🌤️ 到着時刻の天気情報を取得できませんでした';
      }

      card.append(header, metrics, cospa, weatherEl);

      // TomTom 交通規制情報（存在する場合）
      if (route.incidents && route.incidents.count > 0) {
        const incEl = document.createElement('div');
        incEl.className = 'incidents-box';
        const topIncident = route.incidents.incidents[0];
        const sampleDesc = topIncident ? topIncident.description : '';
        incEl.textContent = `⚠️ 周辺規制・情報 ${route.incidents.count}件${
          sampleDesc ? `（${sampleDesc}）` : ''
        }`;
        card.appendChild(incEl);
      }

      // ナビ起動アクション（Yahoo!カーナビ yjcarnavi:// ＋ Googleマップ併用）
      const naviBox = document.createElement('div');
      naviBox.className = 'navi-actions';

      // ミックスルートは経由地（最大3ヶ所）を付与、全高速・全下道は目的地指定
      const yahooWaypoints = route.strategy === 'mix' ? route.waypoints || [] : [];
      const yahooUrl = NaviLauncher.buildYahooNaviUrl({
        destination: route.destination,
        waypoints: yahooWaypoints,
        useCurrentLocation: true,
      });

      const gmapUrl = NaviLauncher.buildGoogleMapsUrl({
        origin: route.origin,
        destination: route.destination,
        waypoints: yahooWaypoints,
        avoidTolls: route.strategy === 'local',
      });

      const btnYahoo = document.createElement('button');
      btnYahoo.type = 'button';
      btnYahoo.className = 'btn-yahoo';
      btnYahoo.textContent =
        route.strategy === 'local'
          ? '🚗 Yahoo!カーナビで開く（「一般優先」切替推奨）'
          : '🚗 Yahoo!カーナビで開く';
      btnYahoo.onclick = () => {
        NaviLauncher.launchYahooNavi(yahooUrl, {
          googleMapsUrl: gmapUrl,
          onFallback: showFallbackToast,
        });
      };
      naviBox.appendChild(btnYahoo);

      // ミックスルートの場合：一般道区間を確実に「一般優先」で切り替えるための区間別起動ボタン
      if (route.strategy === 'mix' && Array.isArray(route.waypoints) && route.waypoints.length > 0) {
        const segBox = document.createElement('div');
        segBox.className = 'segment-box';

        const segTitle = document.createElement('p');
        segTitle.className = 'segment-title';
        segTitle.textContent = '区間別起動（下道区間はYahoo!カーナビ側で「一般優先」を選択）：';
        segBox.appendChild(segTitle);

        const segBtns = document.createElement('div');
        segBtns.className = 'segment-buttons';

        const targets = [
          ...route.waypoints.map((wp, i) => ({
            lat: wp.lat,
            lon: wp.lon,
            name: wp.name || `ポイント${i + 1}`,
          })),
          route.destination,
        ];

        targets.forEach((tgt, idx) => {
          const sBtn = document.createElement('button');
          sBtn.type = 'button';
          sBtn.className = 'btn-segment';
          sBtn.textContent = `${idx + 1}. ${tgt.name}`;
          sBtn.onclick = () => {
            const singleUrl = NaviLauncher.buildYahooNaviUrl({ destination: tgt });
            const singleGmap = NaviLauncher.buildGoogleMapsUrl({ destination: tgt });
            NaviLauncher.launchYahooNavi(singleUrl, {
              googleMapsUrl: singleGmap,
              onFallback: showFallbackToast,
            });
          };
          segBtns.appendChild(sBtn);
        });

        segBox.appendChild(segBtns);
        naviBox.appendChild(segBox);
      }

      // Googleマップ併用＆スキームURLコピー行
      const subRow = document.createElement('div');
      subRow.className = 'sub-navi-row';

      const gmapLink = document.createElement('a');
      gmapLink.className = 'btn-gmap-link';
      gmapLink.href = gmapUrl;
      gmapLink.target = '_blank';
      gmapLink.rel = 'noopener noreferrer';
      gmapLink.textContent = 'Googleマップで開く ↗';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-ghost';
      copyBtn.textContent = 'URLコピー';
      copyBtn.onclick = async () => {
        const ok = await NaviLauncher.copyUrlToClipboard(yahooUrl);
        setStatus(ok ? 'yjcarnavi:// URL をコピーしました' : 'コピーに失敗しました');
      };

      subRow.append(gmapLink, copyBtn);
      naviBox.appendChild(subRow);

      card.appendChild(naviBox);
      els.routesContainer.appendChild(card);
    });
  }

  /**
   * サマリーバナー更新
   */
  function renderSummaryBanner(comparison) {
    if (!comparison || !Array.isArray(comparison.routes) || comparison.routes.length === 0) {
      els.summaryBanner.classList.add('is-hidden');
      return;
    }

    const cheapest = [...comparison.routes].sort(
      (a, b) => a.cost.totalCostYen - b.cost.totalCostYen
    )[0];
    const fastest = [...comparison.routes].sort(
      (a, b) => a.durationSeconds - b.durationSeconds
    )[0];

    els.summaryBanner.innerHTML = `
      <div><strong>直線距離：</strong>約 ${comparison.directDistanceKm.toFixed(1)} km</div>
      <div><strong>最安コスト：</strong>${cheapest.label}（${formatYen(cheapest.cost.totalCostYen)}）</div>
      <div><strong>最速到着：</strong>${fastest.label}（${formatDuration(fastest.durationSeconds)}）</div>
    `;
    els.summaryBanner.classList.remove('is-hidden');
  }

  /**
   * Canvas 上へ3戦略のポリラインとTomTom規制ポイントを描画
   */
  function renderRouteCanvas(comparison) {
    const canvas = els.routeCanvas;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width || 960));
    const height = Math.max(200, Math.floor(rect.height || 320));

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!comparison || !Array.isArray(comparison.routes)) return;

    const allPoints = [];
    comparison.routes.forEach((r) => {
      if (Array.isArray(r.path)) {
        r.path.forEach((pt) => allPoints.push(pt));
      }
    });

    if (allPoints.length < 2) {
      els.mapCaption.textContent = '描画可能な軌跡データがありません。';
      return;
    }

    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    allPoints.forEach((pt) => {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lon < minLon) minLon = pt.lon;
      if (pt.lon > maxLon) maxLon = pt.lon;
    });

    const pad = 28;
    const spanLon = Math.max(1e-5, maxLon - minLon);
    const spanLat = Math.max(1e-5, maxLat - minLat);

    const toXY = (lat, lon) => {
      const x = pad + ((lon - minLon) / spanLon) * (width - pad * 2);
      const y = height - pad - ((lat - minLat) / spanLat) * (height - pad * 2);
      return { x, y };
    };

    const colorMap = {
      local: { stroke: '#059669', width: 3 },
      mix: { stroke: '#d97706', width: 3.5 },
      highway: { stroke: '#2563eb', width: 4 },
    };

    // 下道 -> ミックス -> 高速 の順に重ねて視認性を確保
    ['local', 'mix', 'highway'].forEach((strat) => {
      const route = comparison.routes.find((r) => r.strategy === strat);
      if (!route || !Array.isArray(route.path) || route.path.length < 2) return;

      const style = colorMap[strat];
      ctx.beginPath();
      route.path.forEach((pt, idx) => {
        const { x, y } = toXY(pt.lat, pt.lon);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    });

    // TomTom 交通規制・事故ポイント描画
    comparison.routes.forEach((route) => {
      const incList = (route.incidents && route.incidents.incidents) || [];
      incList.forEach((inc) => {
        if (typeof inc.lat === 'number' && typeof inc.lon === 'number') {
          const { x, y } = toXY(inc.lat, inc.lon);
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#dc2626';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
        }
      });
    });

    // 出発地・目的地マーカー
    const firstRoute = comparison.routes[0];
    if (firstRoute) {
      const oXY = toXY(firstRoute.origin.lat, firstRoute.origin.lon);
      const dXY = toXY(firstRoute.destination.lat, firstRoute.destination.lon);

      ctx.beginPath();
      ctx.arc(oXY.x, oXY.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(dXY.x, dXY.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ff0033';
      ctx.fill();
    }

    els.mapCaption.textContent =
      '黒丸：出発地 / 赤丸：目的地 / 赤点：TomTom交通規制・事故情報ポイント';
  }

  /**
   * 試算実行メインハンドラ（緯度経度が空欄なら地点名から自動取得）
   */
  async function handleCalculate() {
    const { origin, destination, vehicle, departureDate } = readFormInputs();
    const apiKeys = RouteTacticsConfig.getApiKeys();

    if (!apiKeys.googleMapsKey) {
      setStatus('先に「⚙️ API・地点設定」から Google Maps APIキーを保存してください。', true);
      els.settingsPanel.classList.remove('is-hidden');
      return;
    }

    els.btnCalculate.disabled = true;

    try {
      let resolvedOriginLabel = origin.name;
      let resolvedDestLabel = destination.name;

      // 出発地の座標が未入力なら地点名から自動ジオコーディング
      if (!isValidCoordPair(origin.lat, origin.lon)) {
        if (!origin.name) {
          throw new Error('出発地の地点名・住所を入力してください。');
        }
        setStatus(`出発地「${origin.name}」の座標を検索中...`);
        const geoOrigin = await geocodePlaceName(origin.name, apiKeys);
        origin.lat = geoOrigin.lat;
        origin.lon = geoOrigin.lon;
        els.originLat.value = origin.lat;
        els.originLon.value = origin.lon;
        resolvedOriginLabel = `${origin.name}（${geoOrigin.resolvedAddress}）`;
      }

      // 目的地の座標が未入力なら地点名から自動ジオコーディング
      if (!isValidCoordPair(destination.lat, destination.lon)) {
        if (!destination.name) {
          throw new Error('目的地の地点名・住所を入力してください。');
        }
        setStatus(`目的地「${destination.name}」の座標を検索中...`);
        const geoDest = await geocodePlaceName(destination.name, apiKeys);
        destination.lat = geoDest.lat;
        destination.lon = geoDest.lon;
        els.destLat.value = destination.lat;
        els.destLon.value = destination.lon;
        resolvedDestLabel = `${destination.name}（${geoDest.resolvedAddress}）`;
      }

      origin.name = origin.name || '出発地';
      destination.name = destination.name || '目的地';

      persistLastFormState();
      setStatus('Google Routes API / TomTom API / Open-Meteo で試算中...');

      const comparison = await RouteEngine.compareRouteStrategies({
        origin,
        destination,
        vehicle,
        departureTime: departureDate,
        apiKeys,
      });

      // 各戦略の到着予定時刻における目的地天気を取得
      const weathersByStrategy = {};
      await Promise.all(
        comparison.routes.map(async (route) => {
          try {
            weathersByStrategy[route.strategy] = await WeatherManager.getArrivalWeather({
              lat: destination.lat,
              lon: destination.lon,
              departureTime: departureDate,
              durationSeconds: route.durationSeconds,
            });
          } catch (err) {
            console.warn(`[App:${route.strategy}] 天気取得失敗:`, err.message);
            weathersByStrategy[route.strategy] = { available: false };
          }
        })
      );

      state.lastComparison = comparison;
      state.lastWeathers = weathersByStrategy;

      renderSummaryBanner(comparison);
      renderRouteCards(comparison, weathersByStrategy);
      renderRouteCanvas(comparison);

      setStatus(
        `試算完了：${resolvedOriginLabel} → ${resolvedDestLabel}`
      );
    } catch (err) {
      console.error('[App] 試算エラー:', err);
      setStatus(`試算エラー: ${err.message}`, true);
    } finally {
      els.btnCalculate.disabled = false;
    }
  }

  /**
   * イベントリスナー登録
   */
  function bindEvents() {
    els.btnToggleSettings.onclick = () => {
      els.settingsPanel.classList.toggle('is-hidden');
    };

    els.btnSaveApiKeys.onclick = () => {
      RouteTacticsConfig.saveApiKeys({
        googleMapsKey: els.inputGoogleKey.value,
        tomtomKey: els.inputTomtomKey.value,
      });
      setStatus('APIキーをブラウザに保存しました。');
    };

    els.btnSaveHome.onclick = async () => {
      try {
        const name = els.homeName.value.trim() || '自宅';
        let lat = parseCoordInput(els.homeLat.value);
        let lon = parseCoordInput(els.homeLon.value);

        if (!isValidCoordPair(lat, lon)) {
          setStatus(`「${name}」の座標を検索中...`);
          const geo = await geocodePlaceName(name, RouteTacticsConfig.getApiKeys());
          lat = geo.lat;
          lon = geo.lon;
        }

        ProfileManager.setHomeLocation({ name, lat, lon });
        renderLocationsUI();
        setStatus('自宅地点を保存しました。');
      } catch (err) {
        setStatus(err.message, true);
      }
    };

    els.btnAddPlace.onclick = async () => {
      try {
        const name = els.placeName.value.trim();
        let lat = parseCoordInput(els.placeLat.value);
        let lon = parseCoordInput(els.placeLon.value);

        if (!isValidCoordPair(lat, lon)) {
          if (!name) throw new Error('登録地名を入力してください。');
          setStatus(`「${name}」の座標を検索中...`);
          const geo = await geocodePlaceName(name, RouteTacticsConfig.getApiKeys());
          lat = geo.lat;
          lon = geo.lon;
        }

        ProfileManager.upsertSavedPlace({ name, lat, lon });
        els.placeName.value = '';
        els.placeLat.value = '';
        els.placeLon.value = '';
        renderLocationsUI();
        setStatus('登録地を追加しました。');
      } catch (err) {
        setStatus(err.message, true);
      }
    };

    els.profileSelect.onchange = () => {
      ProfileManager.setActiveProfile(els.profileSelect.value);
      renderProfileSelect();
      setStatus(`プロファイルを「${ProfileManager.getActiveProfile().name}」に切り替えました。`);
    };

    // フォーカスした側（出発地/目的地）をクイックチップの反映先に記憶
    [els.originName, els.originLat, els.originLon].forEach((el) => {
      el.addEventListener('focus', () => {
        state.activeTargetField = 'origin';
      });
    });
    [els.destName, els.destLat, els.destLon].forEach((el) => {
      el.addEventListener('focus', () => {
        state.activeTargetField = 'dest';
      });
    });

    // 地点名を書き換えたら、古い緯度経度をクリアして再検索されるようにする
    els.originName.addEventListener('input', () => {
      els.originLat.value = '';
      els.originLon.value = '';
    });
    els.destName.addEventListener('input', () => {
      els.destLat.value = '';
      els.destLon.value = '';
    });

    els.btnSwapLocations.onclick = () => {
      const tmpName = els.originName.value;
      const tmpLat = els.originLat.value;
      const tmpLon = els.originLon.value;

      els.originName.value = els.destName.value;
      els.originLat.value = els.destLat.value;
      els.originLon.value = els.destLon.value;

      els.destName.value = tmpName;
      els.destLat.value = tmpLat;
      els.destLon.value = tmpLon;
      persistLastFormState();
    };

    els.btnGpsOrigin.onclick = () => {
      if (!navigator.geolocation) {
        setStatus('このブラウザは現在地取得に対応していません。', true);
        return;
      }
      setStatus('現在地を取得中...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          applyLocationToField('origin', {
            name: '現在地',
            lat: Number(pos.coords.latitude.toFixed(6)),
            lon: Number(pos.coords.longitude.toFixed(6)),
          });
          setStatus('出発地に現在地をセットしました。');
        },
        (err) => {
          setStatus(`現在地取得エラー: ${err.message}`, true);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };

    els.btnCalculate.onclick = handleCalculate;

    els.btnCloseToast.onclick = () => {
      els.schemeToast.classList.add('is-hidden');
    };

    els.btnCopyScheme.onclick = async () => {
      const urlText = els.schemeToastUrl.textContent;
      const ok = await NaviLauncher.copyUrlToClipboard(urlText);
      setStatus(ok ? 'スキームURLをコピーしました。' : 'コピーに失敗しました。');
    };

    window.addEventListener('resize', () => {
      if (state.lastComparison) {
        renderRouteCanvas(state.lastComparison);
      }
    });
  }

  /**
   * 初期化
   */
  function init() {
    const keys = RouteTacticsConfig.getApiKeys();
    els.inputGoogleKey.value = keys.googleMapsKey;
    els.inputTomtomKey.value = keys.tomtomKey;

    els.departureTime.value = toLocalDatetimeInputValue(new Date());

    renderProfileSelect();
    renderLocationsUI();
    restoreLastFormState();
    bindEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
