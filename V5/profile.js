// ===== 車両・自宅・登録地・API/ルール設定・ローカルプロフィール管理 (V5) =====
const PROFILES_STORAGE_KEY = "RT_LOCAL_PROFILES_V3";
const ACTIVE_PROFILE_KEY = "RT_ACTIVE_PROFILE_V3";
const V5_SETTINGS_KEY = "RT_SETTINGS_V5";

let activeProfileName = "デフォルト";

function getDefaultProfile() {
  return {
    fuelEfficiency: "15.0",
    gasPrice: "160",
    vehicleClass: "standard",
    homePlace: "",
    places: [
      { name: "", address: "" },
      { name: "", address: "" },
      { name: "", address: "" },
      { name: "", address: "" },
      { name: "", address: "" }
    ]
  };
}

function getProfilesDb() {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveProfilesDb(db) {
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(db));
  } catch (e) {}
}

function getV5Settings() {
  try {
    const raw = localStorage.getItem(V5_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { hereApiKey: "", customRulesUrl: "" };
  } catch (e) {
    return { hereApiKey: "", customRulesUrl: "" };
  }
}

function saveV5Settings(settings) {
  try {
    localStorage.setItem(V5_SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {}
}

function loadV5SettingsToUi() {
  const s = getV5Settings();
  const keyEl = document.getElementById('hereApiKeyInput');
  const urlEl = document.getElementById('customRulesUrlInput');
  if (keyEl) keyEl.value = s.hereApiKey || "";
  if (urlEl) urlEl.value = s.customRulesUrl || "";
  updateApiKeyBadge();
}

function updateApiKeyBadge() {
  const s = getV5Settings();
  const badge = document.getElementById('apiStatusBadge');
  if (!badge) return;
  if (s.hereApiKey && s.hereApiKey.trim()) {
    badge.className = 'api-badge ok';
    badge.innerText = '🔑 HERE APIキー設定済';
  } else {
    badge.className = 'api-badge warn';
    badge.innerText = '⚠️ HERE APIキー未設定（設定から入力）';
  }
}

function loadActiveProfile() {
  const db = getProfilesDb();
  if (!db[activeProfileName]) {
    db[activeProfileName] = getDefaultProfile();
    saveProfilesDb(db);
  }
  const prof = db[activeProfileName];

  document.getElementById('currentUserBadge').innerText = `👤 ${activeProfileName}`;
  document.getElementById('fuelEfficiency').value = prof.fuelEfficiency || "15.0";
  document.getElementById('gasPrice').value = prof.gasPrice || "160";
  document.getElementById('vehicleClass').value = prof.vehicleClass || "standard";
  document.getElementById('homePlace').value = prof.homePlace || "";

  const places = prof.places || [];
  for (let i = 0; i < 5; i++) {
    const p = places[i] || { name: "", address: "" };
    document.getElementById(`placeName${i}`).value = p.name || "";
    document.getElementById(`placeAddr${i}`).value = p.address || "";
  }

  refreshOriginSelect();
  refreshDestSelect();
  updateSourceBadge();
}

function saveCurrentProfileData() {
  const db = getProfilesDb();
  const places = [];
  for (let i = 0; i < 5; i++) {
    places.push({
      name: document.getElementById(`placeName${i}`).value.trim(),
      address: document.getElementById(`placeAddr${i}`).value.trim()
    });
  }
  db[activeProfileName] = {
    fuelEfficiency: document.getElementById('fuelEfficiency').value || "15.0",
    gasPrice: document.getElementById('gasPrice').value || "160",
    vehicleClass: document.getElementById('vehicleClass').value || "standard",
    homePlace: document.getElementById('homePlace').value.trim(),
    places
  };
  saveProfilesDb(db);
  refreshOriginSelect();
  refreshDestSelect();
}

function saveApiSettingsAndReloadRules() {
  const keyVal = document.getElementById('hereApiKeyInput').value.trim();
  const urlVal = document.getElementById('customRulesUrlInput').value.trim();
  saveV5Settings({ hereApiKey: keyVal, customRulesUrl: urlVal });
  updateApiKeyBadge();
  closeApiModal();
  if (window.dynamicRulesEngine && typeof window.dynamicRulesEngine.initDynamicRules === 'function') {
    window.dynamicRulesEngine.initDynamicRules(urlVal);
  }
}

function refreshOriginSelect() {
  const sel = document.getElementById('originSelect');
  const prev = sel.value;
  const prof = getProfilesDb()[activeProfileName] || getDefaultProfile();

  sel.innerHTML = `<option value="">-- 登録地から出発地を選択 --</option>`;
  if (prof.homePlace) {
    const opt = document.createElement('option');
    opt.value = prof.homePlace;
    opt.textContent = `🏠 自宅 (${prof.homePlace})`;
    sel.appendChild(opt);
  }
  (prof.places || []).forEach((p, idx) => {
    if (p.address) {
      const opt = document.createElement('option');
      opt.value = p.address;
      opt.textContent = `⭐ ${p.name || `登録地${idx + 1}`} (${p.address})`;
      sel.appendChild(opt);
    }
  });
  if (prev) sel.value = prev;
}

function refreshDestSelect() {
  const sel = document.getElementById('destSelect');
  const prev = sel.value;
  const prof = getProfilesDb()[activeProfileName] || getDefaultProfile();

  sel.innerHTML = `<option value="">-- 登録地から目的地を選択 --</option>`;
  if (prof.homePlace) {
    const opt = document.createElement('option');
    opt.value = prof.homePlace;
    opt.textContent = `🏠 自宅 (${prof.homePlace})`;
    sel.appendChild(opt);
  }
  (prof.places || []).forEach((p, idx) => {
    if (p.address) {
      const opt = document.createElement('option');
      opt.value = p.address;
      opt.textContent = `⭐ ${p.name || `登録地${idx + 1}`} (${p.address})`;
      sel.appendChild(opt);
    }
  });
  if (prev) sel.value = prev;
}

function applyOriginSelect() {
  const val = document.getElementById('originSelect').value;
  if (val) {
    document.getElementById('originInput').value = val;
  }
}

function applyDestSelect() {
  const val = document.getElementById('destSelect').value;
  if (val) {
    document.getElementById('destInput').value = val;
  }
}

function openProfileModal() {
  const db = getProfilesDb();
  const names = Object.keys(db);
  const area = document.getElementById('savedProfilesArea');
  const chips = document.getElementById('savedProfileChips');
  chips.innerHTML = '';

  if (names.length > 0) {
    area.style.display = 'block';
    names.forEach(name => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'profile-chip' + (name === activeProfileName ? ' active' : '');
      btn.innerText = name;
      btn.onclick = () => switchToProfile(name);
      chips.appendChild(btn);
    });
  } else {
    area.style.display = 'none';
  }
  document.getElementById('newProfileName').value = '';
  document.getElementById('profileErrorMsg').innerText = '';
  document.getElementById('profileModal').classList.add('open');
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('open');
}

function createAndSwitchProfile() {
  const nameInput = document.getElementById('newProfileName');
  const errEl = document.getElementById('profileErrorMsg');
  const name = nameInput.value.trim();
  if (!name) {
    errEl.innerText = '表示名または車両名を入力してください。';
    return;
  }
  const db = getProfilesDb();
  if (!db[name]) {
    db[name] = getDefaultProfile();
    saveProfilesDb(db);
  }
  activeProfileName = name;
  localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileName);
  loadActiveProfile();
  closeProfileModal();
}

function switchToProfile(name) {
  activeProfileName = name;
  localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileName);
  loadActiveProfile();
  closeProfileModal();
}

function openApiModal() {
  loadV5SettingsToUi();
  document.getElementById('apiModal').classList.add('open');
}

function closeApiModal() {
  document.getElementById('apiModal').classList.remove('open');
}

function toggleSection(bodyId, arrowId) {
  const body = document.getElementById(bodyId);
  const arrow = document.getElementById(arrowId);
  if (!body) return;
  const isOpen = body.classList.toggle('open');
  if (arrow) {
    arrow.innerText = isOpen ? '▲ 閉じる' : '▼ 開く';
  }
}
