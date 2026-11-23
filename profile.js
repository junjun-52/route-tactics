// ===== 車両・自宅・登録地・ローカルプロフィール管理 =====
const PROFILES_STORAGE_KEY = "RT_LOCAL_PROFILES_V3";
const ACTIVE_PROFILE_KEY = "RT_ACTIVE_PROFILE_V3";

let activeProfileName = "デフォルト";

function getDefaultProfile() {
  return {
    fuelEfficiency: "15.0",
    gasPrice: "160",
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
  document.getElementById('homePlaceInput').value = prof.homePlace || "";

  const places = prof.places || getDefaultProfile().places;
  for (let i = 0; i < 5; i++) {
    const p = places[i] || { name: "", address: "" };
    document.getElementById(`placeName${i}`).value = p.name;
    document.getElementById(`placeAddr${i}`).value = p.address;
  }

  if (prof.homePlace && prof.homePlace.trim() !== "") {
    document.getElementById('origin').value = prof.homePlace.trim();
  }

  renderQuickChips(prof.homePlace, places);
}

function renderQuickChips(homePlace, places) {
  const originContainer = document.getElementById('originChips');
  const destContainer = document.getElementById('destChips');
  originContainer.innerHTML = '';
  destContainer.innerHTML = '';

  const gpsBtn = document.createElement('button');
  gpsBtn.type = 'button';
  gpsBtn.className = 'chip chip-gps';
  gpsBtn.id = 'btnCurrentLoc';
  gpsBtn.innerText = '📍 現在地';
  gpsBtn.onclick = () => setLocationToField('origin');
  originContainer.appendChild(gpsBtn);

  if (homePlace && homePlace.trim() !== "") {
    const hBtnOrig = document.createElement('button');
    hBtnOrig.type = 'button';
    hBtnOrig.className = 'chip chip-home';
    hBtnOrig.innerText = '🏠 自宅';
    hBtnOrig.onclick = () => { document.getElementById('origin').value = homePlace.trim(); };
    originContainer.appendChild(hBtnOrig);

    const hBtnDest = document.createElement('button');
    hBtnDest.type = 'button';
    hBtnDest.className = 'chip chip-home';
    hBtnDest.innerText = '🏠 自宅';
    hBtnDest.onclick = () => { document.getElementById('destination').value = homePlace.trim(); };
    destContainer.appendChild(hBtnDest);
  }

  places.forEach((p, idx) => {
    const label = (p.name && p.name.trim()) ? p.name.trim() : ((p.address && p.address.trim()) ? `登録地${idx + 1}` : "");
    const addr = (p.address && p.address.trim()) ? p.address.trim() : "";
    if (!addr) return;

    const btnOrig = document.createElement('button');
    btnOrig.type = 'button';
    btnOrig.className = 'chip';
    btnOrig.innerText = label;
    btnOrig.onclick = () => { document.getElementById('origin').value = addr; };
    originContainer.appendChild(btnOrig);

    const btnDest = document.createElement('button');
    btnDest.type = 'button';
    btnDest.className = 'chip';
    btnDest.innerText = label;
    btnDest.onclick = () => { document.getElementById('destination').value = addr; };
    destContainer.appendChild(btnDest);
  });
}

function togglePlacesEditor() {
  const box = document.getElementById('placesEditor');
  box.style.display = (box.style.display === 'block') ? 'none' : 'block';
}

function saveUserSettings() {
  const db = getProfilesDb();

  const updatedPlaces = [];
  for (let i = 0; i < 5; i++) {
    updatedPlaces.push({
      name: document.getElementById(`placeName${i}`).value.trim(),
      address: document.getElementById(`placeAddr${i}`).value.trim()
    });
  }

  db[activeProfileName] = {
    fuelEfficiency: document.getElementById('fuelEfficiency').value,
    gasPrice: document.getElementById('gasPrice').value,
    homePlace: document.getElementById('homePlaceInput').value.trim(),
    places: updatedPlaces
  };

  saveProfilesDb(db);
  renderQuickChips(db[activeProfileName].homePlace, updatedPlaces);

  const status = document.getElementById('saveStatus');
  status.innerText = `✅「${activeProfileName}」の設定をこのスマホ内に保存しました`;
  setTimeout(() => { status.innerText = ''; }, 3000);
}

function openProfileModal() {
  document.getElementById('profileErrorMsg').innerText = '';
  document.getElementById('newProfileName').value = '';
  renderSavedProfileChips();

  const delBtn = document.getElementById('btnDeleteProfile');
  delBtn.style.display = (activeProfileName !== 'デフォルト') ? 'block' : 'none';

  document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
}

function renderSavedProfileChips() {
  const db = getProfilesDb();
  const names = Object.keys(db);
  const area = document.getElementById('savedProfilesArea');
  const container = document.getElementById('savedProfileChips');
  container.innerHTML = '';

  if (names.length > 0) {
    area.style.display = 'block';
    names.forEach(name => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (name === activeProfileName ? ' chip-home' : '');
      chip.innerText = `👤 ${name}`;
      chip.onclick = () => {
        activeProfileName = name;
        localStorage.setItem(ACTIVE_PROFILE_KEY, name);
        loadActiveProfile();
        closeProfileModal();
      };
      container.appendChild(chip);
    });
  } else {
    area.style.display = 'none';
  }
}

function createAndSwitchProfile() {
  const name = document.getElementById('newProfileName').value.trim();
  const errEl = document.getElementById('profileErrorMsg');

  if (!name) {
    errEl.innerText = '表示名を入力してください';
    return;
  }

  const db = getProfilesDb();
  if (!db[name]) {
    db[name] = getDefaultProfile();
    saveProfilesDb(db);
  }

  activeProfileName = name;
  localStorage.setItem(ACTIVE_PROFILE_KEY, name);
  loadActiveProfile();
  closeProfileModal();
}

function deleteCurrentProfile() {
  if (activeProfileName === 'デフォルト') return;
  if (!confirm(`「${activeProfileName}」の保存データ（自宅・登録地含む）をこの端末から削除しますか？`)) return;

  const db = getProfilesDb();
  delete db[activeProfileName];
  saveProfilesDb(db);

  activeProfileName = 'デフォルト';
  localStorage.setItem(ACTIVE_PROFILE_KEY, 'デフォルト');
  loadActiveProfile();
  closeProfileModal();
}
