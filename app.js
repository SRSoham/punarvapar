/* ============================================================
   Punarvapar - offline-first collector app
   Storage: IndexedDB (lots, priceboard cache, recycler cache)
   Sync: queued lots/handovers pushed to backend on reconnect
   ============================================================ */

const DEFAULT_API_BASE = "http://127.0.0.1:8000";
let API_BASE = DEFAULT_API_BASE;
let lang = localStorage.getItem("lang") || "mr";
let collectorId = localStorage.getItem("collector_id") || null;
let currentLot = null;       // in-progress new lot draft
let currentLotDetail = null; // lot id being viewed
let userCoords = null;

// ---------------- IndexedDB ----------------
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("punarvapar", 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("lots")) d.createObjectStore("lots", { keyPath: "client_local_id" });
      if (!d.objectStoreNames.contains("cache")) d.createObjectStore("cache", { keyPath: "key" });
      if (!d.objectStoreNames.contains("actions")) d.createObjectStore("actions", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode = "readonly") { return db.transaction(store, mode).objectStore(store); }
function idbGetAll(store) {
  return new Promise((res) => { const r = tx(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
}
function idbPut(store, val) {
  return new Promise((res) => { const r = tx(store, "readwrite").put(val); r.onsuccess = () => res(true); r.onerror = () => res(false); });
}
function idbGet(store, key) {
  return new Promise((res) => { const r = tx(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
}
function idbDelete(store, key) {
  return new Promise((res) => { const r = tx(store, "readwrite").delete(key); r.onsuccess = () => res(true); r.onerror = () => res(false); });
}
async function cacheSet(key, value) { return idbPut("cache", { key, value }); }
async function cacheGet(key) { const r = await idbGet("cache", key); return r ? r.value : null; }

function uuid() { return "loc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

// ---------------- Networking helpers ----------------
async function apiFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = localStorage.getItem("auth_token");
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (!res.ok) {
    let detail = "HTTP " + res.status;
    try { const body = await res.json(); detail = body.detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

async function submitMultipart(path, formData) {
  const token = localStorage.getItem("auth_token");
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API_BASE + path, { method: "POST", headers, body: formData });
  if (!res.ok) {
    let detail = "HTTP " + res.status;
    try { const body = await res.json(); detail = body.detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}
function isOnline() { return navigator.onLine; }

// ---------------- i18n ----------------
function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key; }
function applyI18n() {
  document.querySelectorAll("[data-i]").forEach(el => { el.textContent = t(el.getAttribute("data-i")); });
  document.documentElement.lang = lang;
}
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANG_SPEECH[lang] || "en-IN";
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) { /* speech not supported, ignore */ }
}

// ---------------- Toast ----------------
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------------- Bootstrapping collector ----------------
async function ensureCollector() {
  if (collectorId) return collectorId;
  const user = JSON.parse(localStorage.getItem("auth_user") || "null");
  if (user && user.id && localStorage.getItem("auth_role") === "collector") {
    collectorId = user.id;
    localStorage.setItem("collector_id", collectorId);
    return collectorId;
  }
  throw new Error("Collector authentication required");
}


// ---------------- Profile / settings ----------------
function profileStorageKey(phone) { return "punarvapar_profile_" + String(phone || "").replace(/\s+/g, ""); }
function getCurrentProfile() {
  const user = JSON.parse(localStorage.getItem("auth_user") || "null") || {};
  const extra = JSON.parse(localStorage.getItem(profileStorageKey(user.phone)) || "null") || {};
  return { ...user, ...extra };
}
function saveCurrentProfile(extra) {
  const user = JSON.parse(localStorage.getItem("auth_user") || "null") || {};
  const merged = { ...user, ...extra };
  localStorage.setItem("auth_user", JSON.stringify(merged));
  if (user.phone) localStorage.setItem(profileStorageKey(user.phone), JSON.stringify({ ...extra, phone: user.phone }));
  return merged;
}
function initials(name) {
  return String(name || "P").trim().split(/\s+/).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "P";
}
function renderAccountScreen() {
  const p = getCurrentProfile();
  const name = p.name || "Punarvapar User";
  const role = p.role === "recycler" || localStorage.getItem("auth_role") === "recycler" ? "Authorized Recycler" : "Scrap Collector";
  const av = initials(name);
  [document.getElementById("profileAvatar"), document.getElementById("profileAvatarLarge")].forEach(el => { if (el) el.textContent = av; });
  const nameEl = document.getElementById("profileName"); if (nameEl) nameEl.textContent = name;
  const roleEl = document.getElementById("profileRole"); if (roleEl) roleEl.textContent = role;
  const ver = document.getElementById("profileVerification"); if (ver) ver.textContent = p.verification_status === "pending" ? "⏳ Verification pending" : "✓ Verified account";
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== "") el.value = v; };
  set("accountLanguage", p.preferred_language || lang);
  set("accountArea", p.operating_location || p.area || p.facility_location || "");
  set("accountRadius", String(p.working_radius || "15"));
  set("accountAvailability", p.availability || "Flexible");
  set("accountEmail", p.email || "");
  set("accountAddress", p.address || "");
  set("accountAltPhone", p.alt_phone || "");
}
function openAccountScreen() { showScreen("account"); renderAccountScreen(); }
function openHelpScreen() { showScreen("help"); }
function openPrivacyScreen() { showScreen("privacy"); }

// ---------------- Authentication ----------------
let authRole = "collector";

function setAuthMessage(message, type = "error") {
  const el = document.getElementById("authMessage");
  if (!el) return;
  el.textContent = message;
  el.className = "auth-message show " + type;
}

function clearAuthMessage() {
  const el = document.getElementById("authMessage");
  if (el) el.className = "auth-message";
}

function updateAuthRoleUI() {
  document.querySelectorAll(".role-tab").forEach(b => b.classList.toggle("active", b.dataset.role === authRole));
  const isRecycler = authRole === "recycler";
  const loginTitle = document.getElementById("authTitle");
  const registerTitle = document.getElementById("registerTitle");
  const demo = document.getElementById("demoCredentials");
  const certLabel = document.getElementById("certUploadLabel");
  if (loginTitle) loginTitle.textContent = isRecycler ? "Authorized Recycler Login" : "Collector Login";
  if (registerTitle) registerTitle.textContent = isRecycler ? "Recycler Registration" : "Collector Registration";
  if (demo) demo.textContent = isRecycler
    ? "Recycler: +919800000001 · demo1234"
    : "Collector: 9999999999 · demo1234";
  if (certLabel) certLabel.textContent = isRecycler
    ? "Upload government authorization certificate"
    : "Upload collection certificate / permit";
  document.getElementById("collectorFields").style.display = isRecycler ? "none" : "block";
  document.getElementById("recyclerFields").style.display = isRecycler ? "block" : "none";
  ["certNumber","operatingLocation","facilityLocation","authorizationId","regContact"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.required = false;
  });
  if (isRecycler) {
    document.getElementById("facilityLocation").required = true;
    document.getElementById("authorizationId").required = true;
    document.getElementById("regContact").required = true;
  } else {
    document.getElementById("certNumber").required = true;
    document.getElementById("operatingLocation").required = true;
  }
}

function showAuthMode(mode) {
  document.getElementById("loginPanel").style.display = mode === "login" ? "block" : "none";
  document.getElementById("registerPanel").style.display = mode === "register" ? "block" : "none";
  document.getElementById("loginTab").classList.toggle("active", mode === "login");
  document.getElementById("registerTab").classList.toggle("active", mode === "register");
  clearAuthMessage();
  updateAuthRoleUI();
}

async function doLogin(e) {
  e.preventDefault();
  clearAuthMessage();
  const btn = e.submitter;
  const activeRole = document.querySelector(".role-tab.active")?.dataset.role || authRole || "collector";
  authRole = activeRole;
  if (btn) btn.disabled = true;
  try {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        phone: document.getElementById("loginPhone").value.trim(),
        password: document.getElementById("loginPassword").value,
        role: authRole
      })
    });
    localStorage.setItem("auth_token", data.token);
    localStorage.setItem("auth_role", data.role);
    const storedProfile = JSON.parse(localStorage.getItem(profileStorageKey(data.user.phone)) || "null") || {};
    localStorage.setItem("auth_user", JSON.stringify({ ...data.user, ...storedProfile, role: data.role }));
    if (data.role === "collector") {
      collectorId = data.user.id;
      localStorage.setItem("collector_id", collectorId);
      await enterCollectorApp();
    } else {
      await enterRecyclerDashboard();
    }
  } catch (err) {
    setAuthMessage(err.message || "Login failed");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function doRegister(e) {
  e.preventDefault();
  clearAuthMessage();
  const file = document.getElementById("certFile").files[0];
  if (!file) return setAuthMessage("Please upload your certification document.");
  if (file.size > 10 * 1024 * 1024) return setAuthMessage("Certification file must be 10 MB or smaller.");

  const get = id => document.getElementById(id)?.value?.trim() || "";
  const extra = {
    email: get("regEmail"),
    city: get("regCity"),
    district: get("regDistrict"),
    pincode: get("regPincode"),
    address: get("regAddress"),
    area: get("regArea"),
    availability: get("regAvailability") || "Flexible",
    working_radius: get("regRadius") || "15",
    collection_types: [...document.querySelectorAll('input[name="collection_types"]:checked')].map(x => x.value),
    vehicle_type: get("vehicleType"),
    years_experience: get("yearsExperience"),
    daily_capacity: get("dailyCapacity"),
    payment_preference: get("paymentPreference"),
    facility_type: get("facilityType"),
    accepted_materials: [...document.querySelectorAll('input[name="accepted_materials"]:checked')].map(x => x.value),
    service_radius: get("serviceRadius")
  };

  const fd = new FormData();
  fd.append("name", get("regName"));
  fd.append("phone", get("regPhone"));
  fd.append("password", document.getElementById("regPassword").value);
  fd.append("certification", file);
  if (authRole === "collector") {
    fd.append("certification_number", get("certNumber"));
    fd.append("operating_location", get("operatingLocation") || get("regArea") || get("regCity"));
    fd.append("preferred_language", get("preferredLanguage") || lang);
  } else {
    fd.append("facility_location", get("facilityLocation") || get("regAddress"));
    fd.append("authorization_id", get("authorizationId"));
    fd.append("contact", get("regContact"));
    fd.append("lat", "0"); fd.append("lng", "0");
  }
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    const data = await submitMultipart("/auth/register/" + authRole, fd);
    const phone = get("regPhone");
    if (phone) localStorage.setItem(profileStorageKey(phone), JSON.stringify({ ...extra, phone, preferred_language: get("preferredLanguage") || lang, operating_location: get("operatingLocation") || get("regArea") || get("regCity"), facility_location: get("facilityLocation") }));
    setAuthMessage(data.message + ". You can log in after approval.", "success");
    e.target.reset();
  } catch (err) {
    setAuthMessage(err.message || "Registration failed");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function logout() {
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_role");
  localStorage.removeItem("auth_user");
  localStorage.removeItem("collector_id");
  collectorId = null;
  document.getElementById("app").classList.remove("authenticated");
  document.getElementById("collectorNav").style.display = "";
  document.getElementById("statusBar").style.display = "";
  showAuthMode("login");
}

async function enterCollectorApp() {
  document.getElementById("app").classList.add("authenticated");
  document.getElementById("collectorNav").style.display = "";
  document.getElementById("statusBar").style.display = "flex";
  await ensureCollector();
  getLocation().then(c => { userCoords = c; });
  updateStatusBar();
  renderCatGrid();
  await refreshPriceBoard();
  await refreshRecyclers();
  await renderPriceBoard();
  await renderLotsList();
  await renderLedgerSummary();
  renderSafety();
  showScreen("home");
}

async function enterRecyclerDashboard() {
  document.getElementById("app").classList.add("authenticated");
  document.getElementById("collectorNav").style.display = "none";
  document.getElementById("statusBar").style.display = "none";
  document.querySelectorAll("main .screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-recycler-dashboard").classList.add("active");
  await renderRecyclerDashboard();
}

async function renderCollectorDashboard() {
  const nameEl = document.getElementById("collectorDashboardName");
  const areaEl = document.getElementById("collectorDashboardArea");
  if (!nameEl) return;
  try {
    const data = await apiFetch("/collector/dashboard");
    const c = data.collector || {};
    nameEl.textContent = `Welcome back, ${c.name || "Collector"} 👋`;
    areaEl.textContent = `${c.operating_location || "Your area"} · ${c.verification_status === "approved" ? "Verified collector" : "Verification pending"}`;
    document.getElementById("collectorDashboardAvatar").textContent = initials(c.name || "C");
    document.getElementById("collectorTotalLots").textContent = data.stats.total_lots || 0;
    document.getElementById("collectorActiveLots").textContent = data.stats.active_lots || 0;
    document.getElementById("collectorPaidEarnings").textContent = "₹" + Number(data.stats.paid_earnings || 0).toLocaleString("en-IN");

    const counts = data.category_counts || {};
    const preferredCategory = localStorage.getItem("last_ai_category") || data.latest_category;
    const filters = document.getElementById("dashboardMaterialFilters");
    const cats = CATEGORIES.filter(x => counts[x.id] || x.id === preferredCategory);
    const allCats = cats.length ? cats : CATEGORIES;
    filters.innerHTML = allCats.map(c => `<button class="material-chip ${c.id === preferredCategory ? "active" : ""}" data-cat="${c.id}">${c.emoji} ${c.label.en}</button>`).join("");
    filters.querySelectorAll(".material-chip").forEach(btn => btn.onclick = () => { localStorage.setItem("last_ai_category", btn.dataset.cat); filters.querySelectorAll(".material-chip").forEach(x => x.classList.remove("active")); btn.classList.add("active"); renderCollectorRecyclerSuggestions(btn.dataset.cat); });
    await renderCollectorRecyclerSuggestions(preferredCategory || allCats[0]?.id || "PCB");

    const recent = document.getElementById("collectorRecentLots");
    if (!data.recent_lots?.length) { recent.innerHTML = '<div class="empty"><span class="emoji">📦</span>No lots yet. Scan or create your first lot.</div>'; }
    else {
      recent.innerHTML = data.recent_lots.slice(0, 5).map(l => `<div class="dashboard-lot collector-lot-row" data-client-id="${l.id}">
        <div><div class="name">${catEmoji(l.category)} ${catLabel(l.category)}</div><div class="meta">${l.weight} kg · ${l.status} · ${new Date(l.date).toLocaleDateString()}</div>
        ${l.is_incoming ? '<span class="match-pill open">New compatible lot</span>' : '<span class="match-pill">Matched lot</span>'}</div>
        <div class="lot-right"><strong>₹${Math.round(l.value || 0)}</strong>${l.matched_recycler_id ? `<span class="match-pill">Matched: ${l.matched_recycler_name || "Recycler"}</span>` : '<span class="match-pill open">Visible to compatible recyclers</span>'}</div>
      </div>`).join("");
    }
  } catch (err) {
    toast(err.message || "Could not load collector dashboard");
  }
}

async function renderCollectorRecyclerSuggestions(category) {
  const wrap = document.getElementById("collectorRecommendedRecyclers");
  if (!wrap || !category) return;
  try {
    const dashboard = await apiFetch("/collector/dashboard");
    const cached = (dashboard.material_network || {})[category] || [];
    const items = cached.length ? cached : await refreshRecyclers(category);
    if (!items.length) {
      wrap.innerHTML = `<div class="empty"><span class="emoji">🏭</span>No authorized recycler accepts ${catLabel(category)} yet.</div>`;
      return;
    }
    wrap.innerHTML = `<div class="network-result-head"><div><strong>Authorized ${catLabel(category)} recyclers</strong><div class="meta">Only verified centres accepting this material are shown.</div></div><span class="badge">${items.length} matches</span></div><div class="recycler-shortlist">${items.slice(0,5).map(r => `<div class="recycler-card dashboard-recycler-card">
      <div class="recycler-top"><div><div class="name">${r.name}</div><div class="meta">${r.facility_location}${r.distance_km != null ? " · " + r.distance_km + " km" : ""}</div></div><span class="badge">Authorized</span></div>
      <div class="accepted-line">♻️ Accepts: ${String(r.materials_accepted || "").split(",").map(x => catLabel(x.trim())).join(" · ")}</div>
      <div class="recycler-actions"><span class="pickup-text">${r.pickup_available ? "🚚 Pickup available" : "📦 Drop-off"}</span><button class="mini-action" data-recycler-id="${r.id}" data-recycler-category="${category}">View centre</button></div>
    </div>`).join("")}</div>`;
    wrap.querySelectorAll("[data-recycler-id]").forEach(b => b.onclick = () => { showScreen("recyclers"); renderRecyclers(b.dataset.recyclerCategory); });
  } catch (e) { wrap.innerHTML = `<div class="empty">Could not load recycler network.</div>`; }
}

async function renderRecyclerDashboard() {
  try {
    const data = await apiFetch("/recycler/dashboard");
    document.getElementById("dashboardRecyclerName").textContent = data.recycler.name;
    document.getElementById("matchedLotsStat").textContent = data.stats.matched_lots;
    document.getElementById("incomingLotsStat").textContent = data.stats.incoming_lots || 0;
    document.getElementById("handedOverStat").textContent = data.stats.handed_over;
    const accepted = String(data.recycler.materials_accepted || "").split(",").filter(Boolean);
    const profile = document.getElementById("recyclerAcceptedMaterials");
    if (profile) profile.innerHTML = `<div class="title">♻️ Materials this centre accepts</div><div class="accepted-tags">${accepted.map(x => `<span class="accepted-tag">${catEmoji(x)} ${catLabel(x)}</span>`).join("")}</div>`;
    const list = document.getElementById("recyclerLotsList");
    if (!data.lots.length) {
      list.innerHTML = '<div class="empty"><span class="emoji">📦</span>No compatible collection lots yet.</div>';
      return;
    }
    list.innerHTML = data.lots.map(l => `
      <div class="dashboard-lot ${l.is_incoming ? "incoming-highlight" : ""}" data-lot-id="${l.id}">
        <div class="row"><div class="name">${catEmoji(l.category)} ${catLabel(l.category)}</div><strong>₹${Math.round(l.value || 0)}</strong></div>
        <div class="meta">${l.weight} kg · ${l.status} · ${new Date(l.date).toLocaleDateString()}</div>
        <div class="meta">👤 ${l.collector_name || "Collector"}${l.collection_location ? " · 📍 " + l.collection_location : ""}</div>
        ${l.is_incoming ? `<div class="recycler-actions"><span class="match-pill open">New compatible lot</span><button class="mini-action" data-accept-lot="${l.id}">Accept lot</button></div>` : '<span class="match-pill">Matched to your centre</span>'}
      </div>
    `).join("");
    list.querySelectorAll("[data-accept-lot]").forEach(btn => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          await apiFetch(`/lots/${encodeURIComponent(btn.dataset.acceptLot)}/accept`, { method: "POST" });
          toast("Lot accepted successfully");
          await renderRecyclerDashboard();
        } catch (e) { toast(e.message || "Could not accept lot"); btn.disabled = false; }
      };
    });
  } catch (err) { toast(err.message || "Could not load dashboard"); }
}

// ---------------- Price board ----------------
async function refreshPriceBoard() {
  if (isOnline()) {
    try {
      const data = await apiFetch("/price-board");
      await cacheSet("priceboard", data.items);
      return data.items;
    } catch (e) { /* fall back to cache */ }
  }
  return (await cacheGet("priceboard")) || [];
}
function catEmoji(cat) { const c = CATEGORIES.find(x => x.id === cat); return c ? c.emoji : "♻️"; }
function catLabel(cat) { const c = CATEGORIES.find(x => x.id === cat); return c ? c.label[lang] : cat; }

async function renderPriceBoard() {
  const items = await refreshPriceBoard();
  const list = document.getElementById("priceBoardList");
  if (!items.length) {
    list.innerHTML = `<div class="empty"><span class="emoji">📡</span>${t("status_offline")}</div>`;
    return;
  }
  list.innerHTML = items.map(it => `
    <div class="price-card">
      <div class="price-icon">${catEmoji(it.material_category)}</div>
      <div class="price-info">
        <div class="cat">${catLabel(it.material_category)}</div>
        <div class="loc">${it.location}</div>
        <span class="trend ${it.trend}">${it.trend === "rising" ? "↑" : it.trend === "falling" ? "↓" : "→"} ${it.trend}</span>
      </div>
      <div class="price-value">
        <div class="amt">₹${it.buying_price}</div>
        <div class="unit">${t("per_kg")}</div>
      </div>
      <button class="speak-btn" onclick="speak('${catLabel(it.material_category)}, ₹${it.buying_price} ${t("per_kg")}')">🔊</button>
    </div>
  `).join("");
}

// ---------------- Recyclers ----------------
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
async function refreshRecyclers(category) {
  if (isOnline()) {
    try {
      let path = "/recyclers";
      const params = [];
      if (category) params.push("material_category=" + encodeURIComponent(category));
      if (userCoords) { params.push("lat=" + userCoords.lat); params.push("lng=" + userCoords.lng); }
      if (params.length) path += "?" + params.join("&");
      const data = await apiFetch(path);
      await cacheSet("recyclers_all", data.length && !category ? data : await cacheGet("recyclers_all") || data);
      if (!category) await cacheSet("recyclers_all", data);
      return data;
    } catch (e) { /* fallback below */ }
  }
  let all = (await cacheGet("recyclers_all")) || [];
  if (category) all = all.filter(r => String(r.materials_accepted || "").split(",").map(x => x.trim()).includes(category));
  if (userCoords) {
    all = all.map(r => ({ ...r, distance_km: Math.round(haversine(userCoords.lat, userCoords.lng, r.lat, r.lng) * 10) / 10 }));
    all.sort((a, b) => a.distance_km - b.distance_km);
  }
  return all;
}
async function renderRecyclers(category) {
  const list = document.getElementById("recyclersList");
  const items = await refreshRecyclers(category);
  if (!items.length) {
    list.innerHTML = `<div class="empty"><span class="emoji">🏭</span>${t("status_offline")}</div>`;
    return items;
  }
  list.innerHTML = items.map(r => `
    <div class="recycler-card">
      <div class="name">${r.name}</div>
      <div class="meta">${r.facility_location}${r.distance_km != null ? " · " + r.distance_km + " " + t("km_away") : ""}</div>
      <div class="meta">📞 ${r.contact}</div>
      <span class="badge">${t("authorized")}</span>
      ${r.pickup_available ? `<span class="badge pickup">${t("pickup")}</span>` : ""}
    </div>
  `).join("");
  return items;
}

// ---------------- Geolocation ----------------
function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000 }
    );
  });
}

// ---------------- New lot flow ----------------
let selectedCategory = null;
let capturedPhoto = null;
let capturedFile = null;
let aiAnalysis = null;

function renderCatGrid() {
  const grid = document.getElementById("catGrid");
  // Always render the complete material catalogue. Dashboard filters are separate.
  grid.innerHTML = CATEGORIES.map(c => `
    <div class="cat-tile" data-cat="${c.id}" title="${c.label.en}"><span class="emoji">${c.emoji}</span><span class="cat-tile-label">${c.label[lang]}</span></div>
  `).join("");
  grid.querySelectorAll(".cat-tile").forEach(tile => {
    tile.onclick = () => {
      grid.querySelectorAll(".cat-tile").forEach(x => x.classList.remove("selected"));
      tile.classList.add("selected");
      selectedCategory = tile.dataset.cat;
      localStorage.setItem("last_ai_category", selectedCategory);
      updateEstimate();
      renderMaterialRecyclerPanel(selectedCategory);
    };
  });
}


async function renderMaterialRecyclerPanel(category = selectedCategory) {
  const panel = document.getElementById("materialRecyclerPanel");
  const title = document.getElementById("materialRecyclerTitle");
  const meta = document.getElementById("materialRecyclerMeta");
  const list = document.getElementById("materialRecyclerResults");
  if (!panel || !title || !meta || !list) return;
  if (!category) { panel.style.display = "none"; return; }
  panel.style.display = "block";
  title.textContent = `${catEmoji(category)} ${t("find_material_recyclers_prefix")} ${catLabel(category)} ${t("find_material_recyclers_suffix")}`;
  meta.textContent = t("authorized_material_only");
  list.innerHTML = `<div class="ai-loading">🔄 ${t("loading_recyclers")}</div>`;
  try {
    const items = await refreshRecyclers(category);
    if (!items.length) {
      list.innerHTML = `<div class="empty"><span class="emoji">🏭</span>${t("no_material_recyclers")}</div>`;
      return;
    }
    list.innerHTML = items.map(r => `
      <div class="material-recycler-card">
        <div class="material-recycler-head">
          <div><strong>${r.name}</strong><div class="meta">📍 ${r.facility_location}${r.distance_km != null ? ` · ${r.distance_km} ${t("km_away")}` : ""}</div></div>
          <span class="badge">✓ ${t("authorized")}</span>
        </div>
        <div class="accepted-line">♻️ ${t("accepts")}: ${String(r.materials_accepted || "").split(",").map(x => catLabel(x.trim())).join(" · ")}</div>
        <div class="material-recycler-foot">
          <span class="pickup-text">${r.pickup_available ? "🚚 " + t("pickup") : "📦 " + t("drop_off")}</span>
          <button class="mini-action green-action" data-view-recycler="${r.id}" data-category="${category}">${t("view_recycler")}</button>
        </div>
      </div>`).join("");
    list.querySelectorAll("[data-view-recycler]").forEach(btn => btn.onclick = async () => {
      showScreen("recyclers");
      await renderRecyclers(btn.dataset.category);
    });
  } catch (e) {
    list.innerHTML = `<div class="empty">${t("recycler_network_error")}</div>`;
  }
}

async function updateEstimate() {
  const weight = parseFloat(document.getElementById("weightInput").value);
  const box = document.getElementById("estimateBox");
  const btn = document.getElementById("createLotBtn");
  if (!selectedCategory || !weight || weight <= 0) {
    box.style.display = "none";
    btn.disabled = true;
    return;
  }
  const board = (await cacheGet("priceboard")) || [];
  const entry = board.find(b => b.material_category === selectedCategory);
  if (!entry) { box.style.display = "none"; btn.disabled = true; return; }
  const value = Math.round(entry.buying_price * weight * 10) / 10;
  document.getElementById("estimateAmt").textContent = "₹" + value;
  document.getElementById("estimateRange").textContent =
    entry.market_range_low ? `₹${entry.market_range_low}–₹${entry.market_range_high} ${t("per_kg")}` : "";
  box.style.display = "block";
  btn.disabled = false;
}

function resetNewLotForm() {
  selectedCategory = null;
  capturedPhoto = null;
  capturedFile = null;
  aiAnalysis = null;
  const aiCard = document.getElementById("aiScanCard");
  if (aiCard) aiCard.style.display = "none";
  const recyclerPanel = document.getElementById("materialRecyclerPanel");
  if (recyclerPanel) recyclerPanel.style.display = "none";
  document.getElementById("weightInput").value = "";
  document.getElementById("estimateBox").style.display = "none";
  document.getElementById("createLotBtn").disabled = true;
  document.getElementById("photoBox").innerHTML = `<span class="emoji">📷</span><span>${t("tap_to_capture")}</span>
    <input type="file" accept="image/*" capture="environment" id="photoInput" style="display:none">`;
  bindPhotoInput();
  renderCatGrid();
}

function renderAiAnalysis(data) {
  aiAnalysis = data;
  const card = document.getElementById("aiScanCard");
  if (!card) return;
  card.style.display = "block";
  document.getElementById("aiDeviceName").textContent = data.device || "E-waste item";
  document.getElementById("aiConfidence").textContent = Math.round((Number(data.confidence) || 0) * 100) + "%";
  document.getElementById("aiSummary").textContent = data.summary || "";
  const components = Array.isArray(data.components) ? data.components : [];
  document.getElementById("aiComponents").innerHTML = components.map(c => `
    <div class="ai-component">
      <div class="ai-component-title"><strong>${c.name}</strong><span>${Math.round((Number(c.confidence) || 0) * 100)}%</span></div>
      <div class="ai-materials">${(c.materials || []).map(m => `<span>${m}</span>`).join("")}</div>
      <div class="ai-note">${c.hazardous ? "⚠️ Handle carefully" : "✓ Typical recyclable association"} · ${c.note || ""}</div>
    </div>`).join("");
  document.getElementById("aiSafety").innerHTML = (data.safety_notes || []).map(n => `<div>⚠️ ${n}</div>`).join("");
  document.getElementById("aiDisclaimer").textContent = data.disclaimer || "Visual estimate only — exact composition requires physical analysis.";
  const sourceLabel = data.analysis_mode === "fallback" ? "🛟 Smart Fallback" : "✨ Gemini AI";
  document.getElementById("aiSummary").textContent = `${sourceLabel} · ${data.summary || ""}`;

  if (data.is_e_waste === false && !data.recommended_category) {
    selectedCategory = null;
    const panel = document.getElementById("materialRecyclerPanel");
    if (panel) panel.style.display = "none";
    if (data.analysis_mode === "fallback") toast("AI is temporarily unavailable — choose the correct material from the full list below.");
    else toast("No electronic waste detected — please choose the correct recyclable material manually.");
    return;
  }
  if (data.recommended_category) {
    selectedCategory = data.recommended_category;
    localStorage.setItem("last_ai_category", selectedCategory);
    renderCatGrid();
    const suggestedTile = document.querySelector(`.cat-tile[data-cat="${selectedCategory}"]`);
    if (suggestedTile) suggestedTile.classList.add("selected");
    updateEstimate();
    renderMaterialRecyclerPanel(selectedCategory);
    toast(`AI suggested ${catLabel(selectedCategory)}`);
  }
}

async function analyzeImageWithAI(file) {
  const card = document.getElementById("aiScanCard");
  if (!file || !isOnline()) {
    if (!isOnline()) toast("AI scan needs an internet connection");
    return;
  }
  if (card) {
    card.style.display = "block";
    document.getElementById("aiDeviceName").textContent = "Analyzing image…";
    document.getElementById("aiConfidence").textContent = "…";
    document.getElementById("aiSummary").textContent = "Punarvapar AI is identifying the device and visible components.";
    document.getElementById("aiComponents").innerHTML = "<div class=\"ai-loading\">🔄 Scanning…</div>";
    document.getElementById("aiSafety").innerHTML = "";
  }
  try {
    const fd = new FormData();
    fd.append("image", file, file.name || "ewaste.jpg");
    fd.append("hint_category", selectedCategory || "auto");
    const result = await submitMultipart("/ai/analyze-image", fd);
    renderAiAnalysis(result);
  } catch (e) {
    if (card) card.style.display = "none";
    toast("AI scan unavailable: " + (e.message || "try again"));
  }
}

function bindPhotoInput() {
  const box = document.getElementById("photoBox");
  const input = document.getElementById("photoInput");
  box.onclick = () => input.click();
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    capturedFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      capturedPhoto = reader.result;
      box.innerHTML = `<img src="${capturedPhoto}"><span class="photo-ai-hint">🤖 AI scan starting…</span>`;
      box.onclick = () => input.click();
      analyzeImageWithAI(file);
    };
    reader.readAsDataURL(file);
  };
}

async function saveLot() {
  const weight = parseFloat(document.getElementById("weightInput").value);
  if (!selectedCategory || !weight || weight <= 0) { toast(t("weight_required")); return; }
  await ensureCollector();
  const coords = await getLocation();
  const board = (await cacheGet("priceboard")) || [];
  const entry = board.find(b => b.material_category === selectedCategory);
  const estValue = entry ? Math.round(entry.buying_price * weight * 10) / 10 : null;

  const clientLocalId = uuid();
  const lot = {
    client_local_id: clientLocalId,
    collector_id: collectorId,
    material_category: selectedCategory,
    approx_weight_kg: weight,
    image_ref: capturedPhoto,
    material_description: aiAnalysis ? JSON.stringify({
      device: aiAnalysis.device,
      summary: aiAnalysis.summary,
      components: aiAnalysis.components,
      recommended_category: aiAnalysis.recommended_category
    }) : null,
    collection_lat: coords ? coords.lat : null,
    collection_lng: coords ? coords.lng : null,
    collection_location_text: null,
    estimated_value: estValue,
    quoted_price: estValue,
    status: "pending_sync",
    payment_status: "unpaid",
    server_id: null,
    collected_at: new Date().toISOString(),
  };
  await idbPut("lots", lot);

  if (isOnline()) {
    try {
      const created = await apiFetch("/lots", {
        method: "POST",
        body: JSON.stringify({
          client_local_id: clientLocalId,
          collector_id: collectorId,
          material_category: selectedCategory,
          approx_weight_kg: weight,
          image_ref: capturedPhoto,
          material_description: aiAnalysis ? JSON.stringify({
            device: aiAnalysis.device,
            summary: aiAnalysis.summary,
            components: aiAnalysis.components,
            recommended_category: aiAnalysis.recommended_category
          }) : null,
          collection_lat: lot.collection_lat,
          collection_lng: lot.collection_lng,
        }),
      });
      lot.server_id = created.id;
      lot.status = created.status;
      await idbPut("lots", lot);
      const compatible = await refreshRecyclers(selectedCategory);
      toast(`${t("lot_saved_online")} · ${compatible.length} ${t("compatible_recyclers_visible")}`);
    } catch (e) {
      toast(t("lot_saved_offline"));
    }
  } else {
    toast(t("lot_saved_offline"));
  }
  resetNewLotForm();
  updatePendingBadge();
  showScreen("lots");
}

// ---------------- Lots list & detail ----------------
async function renderLotsList() {
  const lots = await idbGetAll("lots");
  lots.sort((a, b) => new Date(b.collected_at) - new Date(a.collected_at));
  const list = document.getElementById("lotsList");
  if (!lots.length) {
    list.innerHTML = `<div class="empty"><span class="emoji">📦</span>${t("no_lots_yet")}</div>`;
    return;
  }
  list.innerHTML = lots.map(l => `
    <div class="lot-card" data-id="${l.client_local_id}">
      <div class="lot-thumb">${l.image_ref ? `<img src="${l.image_ref}">` : catEmoji(l.material_category)}</div>
      <div class="lot-body">
        <div class="cat">${catLabel(l.material_category)} · ${l.approx_weight_kg}${t("weight_kg")}</div>
        <div class="meta">₹${l.quoted_price ?? "-"} · ${new Date(l.collected_at).toLocaleDateString()}</div>
      </div>
      <div class="lot-status status-${l.status}">${l.status === "pending_sync" ? t("status_pending_sync") : l.status}</div>
    </div>
  `).join("");
  list.querySelectorAll(".lot-card").forEach(card => {
    card.onclick = () => openLotDetail(card.dataset.id);
  });
}

async function openLotDetail(clientLocalId) {
  currentLotDetail = clientLocalId;
  const lot = await idbGet("lots", clientLocalId);
  const body = document.getElementById("lotDetailBody");
  const canMatch = lot.status === "quoted" || lot.status === "pending_sync";
  const canHandover = lot.status === "matched";
  const done = lot.status === "handed_over" || lot.status === "confirmed";

  body.innerHTML = `
    <div class="lot-card" style="margin-bottom:16px">
      <div class="lot-thumb">${lot.image_ref ? `<img src="${lot.image_ref}">` : catEmoji(lot.material_category)}</div>
      <div class="lot-body">
        <div class="cat">${catLabel(lot.material_category)} · ${lot.approx_weight_kg}${t("weight_kg")}</div>
        <div class="meta">₹${lot.quoted_price ?? "-"}</div>
      </div>
      <div class="lot-status status-${lot.status}">${lot.status === "pending_sync" ? t("status_pending_sync") : lot.status}</div>
    </div>
    ${canMatch ? `<button class="btn btn-secondary" id="matchBtn">${t("find_material_recyclers_prefix")} ${catLabel(lot.material_category)} ${t("find_material_recyclers_suffix")}</button>` : ""}
    <div id="matchResult"></div>
    ${canHandover ? `<button class="btn btn-primary" id="handoverBtn">${t("confirm_handover")}</button>` : ""}
    ${done && lot.handover_ref ? `
      <div class="handover-record">
        <div class="ref">${lot.handover_ref}</div>
        <div class="row"><span>📍 GPS</span><span>${lot.handover_lat?.toFixed(3)}, ${lot.handover_lng?.toFixed(3)}</span></div>
        <div class="row"><span>🕒</span><span>${lot.handover_timestamp ? new Date(lot.handover_timestamp).toLocaleString() : "-"}</span></div>
        <div class="row"><span>💰</span><span>₹${lot.final_sale_value ?? lot.quoted_price}</span></div>
      </div>` : ""}
  `;

  if (canMatch) {
    document.getElementById("matchBtn").onclick = async () => {
      const result = document.getElementById("matchResult");
      const coords = await getLocation();
      userCoords = coords || userCoords;
      const items = await refreshRecyclers(lot.material_category);
      if (!items.length) { result.innerHTML = `<div class="empty"><span class="emoji">🏭</span>${t("no_material_recyclers")}</div>`; return; }
      result.innerHTML = `<div class="material-match-title">${catEmoji(lot.material_category)} ${t("authorized_match_title")} ${catLabel(lot.material_category)}</div>` + items.map(r => `
        <div class="material-recycler-card lot-match-card">
          <div class="material-recycler-head"><div><strong>${r.name}</strong><div class="meta">📍 ${r.facility_location}${r.distance_km != null ? ` · ${r.distance_km} ${t("km_away")}` : ""}</div></div><span class="badge">✓ ${t("authorized")}</span></div>
          <div class="accepted-line">♻️ ${t("accepts")}: ${String(r.materials_accepted || "").split(",").map(x => catLabel(x.trim())).join(" · ")}</div>
          <div class="material-recycler-foot"><span class="pickup-text">${r.pickup_available ? "🚚 " + t("pickup") : "📦 " + t("drop_off")}</span><button class="btn btn-secondary select-recycler-btn" data-recycler-id="${r.id}">${t("select_recycler")}</button></div>
        </div>`).join("");
      result.querySelectorAll("[data-recycler-id]").forEach(btn => btn.onclick = async () => {
        lot.matched_recycler_id = btn.dataset.recyclerId;
        lot.status = "matched";
        await idbPut("lots", lot);
        if (isOnline() && lot.server_id) {
          try { await apiFetch(`/lots/${lot.server_id}/match?lat=${coords?.lat || 0}&lng=${coords?.lng || 0}`, { method: "POST" }); } catch (e) {}
        }
        toast(t("recycler_selected"));
        openLotDetail(clientLocalId);
        renderLotsList();
      });
    };
  }
  if (canHandover) {
    document.getElementById("handoverBtn").onclick = async () => {
      const coords = await getLocation();
      const ref = "HOV-" + uuid().slice(4).toUpperCase();
      lot.handover_ref = ref;
      lot.handover_timestamp = new Date().toISOString();
      lot.handover_lat = coords ? coords.lat : null;
      lot.handover_lng = coords ? coords.lng : null;
      lot.final_sale_value = lot.quoted_price;
      lot.status = "handed_over";
      lot.payment_status = "paid";
      lot.payment_mode = "cash";
      await idbPut("lots", lot);

      if (isOnline() && lot.server_id) {
        try {
          const resp = await apiFetch("/handover", {
            method: "POST",
            body: JSON.stringify({
              lot_id: lot.server_id, recycler_id: lot.matched_recycler_id,
              handover_lat: lot.handover_lat, handover_lng: lot.handover_lng,
              final_sale_value: lot.final_sale_value, payment_mode: "cash",
            }),
          });
          lot.handover_ref = resp.handover_ref;
          await idbPut("lots", lot);
        } catch (e) {
          await idbPut("actions", { type: "handover", lot_client_id: clientLocalId, ts: Date.now() });
        }
      } else {
        await idbPut("actions", { type: "handover", lot_client_id: clientLocalId, ts: Date.now() });
      }
      toast(t("handover_success") + " " + ref);
      openLotDetail(clientLocalId);
      renderLotsList();
      updatePendingBadge();
    };
  }
}

// ---------------- Ledger (on home screen) ----------------
async function renderLedgerSummary() {
  const lots = await idbGetAll("lots");
  const paid = lots.filter(l => l.payment_status === "paid").reduce((s, l) => s + (l.final_sale_value || 0), 0);
  const pending = lots.filter(l => l.payment_status !== "paid" && l.status !== "pending_sync" && l.status !== "draft")
    .reduce((s, l) => s + (l.quoted_price || 0), 0);
  document.getElementById("homeTotalPaid").textContent = "₹" + Math.round(paid);
  document.getElementById("homePending").textContent = "₹" + Math.round(pending);
}

// ---------------- Safety screen ----------------
function renderSafety() {
  const tips = [
    { icon: "🔥", key: "safety_1" }, { icon: "🔋", key: "safety_2" },
    { icon: "📺", key: "safety_3" }, { icon: "🧪", key: "safety_4" },
  ];
  document.getElementById("safetyList").innerHTML = tips.map(tip => `
    <div class="safety-card">
      <span class="emoji">${tip.icon}</span>
      <p>${t(tip.key)}</p>
      <button onclick="speak('${t(tip.key).replace(/'/g, "\\'")}')">🔊</button>
    </div>
  `).join("");
}

// ---------------- Sync ----------------
async function updatePendingBadge() {
  const lots = await idbGetAll("lots");
  const pending = lots.filter(l => l.status === "pending_sync").length;
  const badge = document.getElementById("pendingBadge");
  const syncBtn = document.getElementById("syncBtn");
  if (pending > 0) {
    badge.style.display = "inline-block";
    badge.textContent = pending;
    syncBtn.style.display = isOnline() ? "inline-block" : "none";
  } else {
    badge.style.display = "none";
    syncBtn.style.display = "none";
  }
}

async function syncNow() {
  if (!isOnline()) return;
  await ensureCollector();
  const lots = await idbGetAll("lots");
  const pending = lots.filter(l => l.status === "pending_sync");
  if (!pending.length) { toast(t("synced")); return; }
  toast(t("syncing"));
  try {
    const items = pending.map(l => ({
      client_local_id: l.client_local_id,
      lot: {
        client_local_id: l.client_local_id,
        collector_id: collectorId,
        material_category: l.material_category,
        material_description: l.material_description || null,
        approx_weight_kg: l.approx_weight_kg,
        image_ref: l.image_ref,
        collection_lat: l.collection_lat,
        collection_lng: l.collection_lng,
      },
    }));
    const results = await apiFetch("/sync/push", { method: "POST", body: JSON.stringify({ items }) });
    for (const r of results) {
      const lot = await idbGet("lots", r.client_local_id);
      if (lot) { lot.server_id = r.server_id; lot.status = "quoted"; await idbPut("lots", lot); }
    }
    // replay queued handover actions
    const actions = await idbGetAll("actions");
    for (const a of actions) {
      if (a.type === "handover") {
        const lot = await idbGet("lots", a.lot_client_id);
        if (lot && lot.server_id) {
          try {
            await apiFetch("/handover", {
              method: "POST",
              body: JSON.stringify({
                lot_id: lot.server_id, recycler_id: lot.matched_recycler_id || "",
                handover_lat: lot.handover_lat, handover_lng: lot.handover_lng,
                final_sale_value: lot.final_sale_value, payment_mode: lot.payment_mode || "cash",
              }),
            });
          } catch (e) {}
        }
        await idbDelete("actions", a.id);
      }
    }
    toast(t("synced"));
  } catch (e) {
    toast(t("status_offline"));
  }
  updatePendingBadge();
  renderLotsList();
  renderLedgerSummary();
}

// ---------------- Screen navigation ----------------
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + name).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.screen === name));
  if (name === "home") { renderCollectorDashboard(); renderPriceBoard(); renderLedgerSummary(); }
  if (name === "new") { resetNewLotForm(); }
  if (name === "lots") { renderLotsList(); }
  if (name === "recyclers") { renderRecyclers(); }
  if (name === "safety") { renderSafety(); }
  if (name === "account") { renderAccountScreen(); }
  if (name === "help" || name === "privacy") {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  }
}

// ---------------- Online/offline status ----------------
function updateStatusBar() {
  const bar = document.getElementById("statusBar");
  const text = document.getElementById("statusText");
  if (isOnline()) {
    bar.className = "status-bar online";
    text.textContent = t("status_online");
  } else {
    bar.className = "status-bar offline";
    text.textContent = t("status_offline");
  }
  updatePendingBadge();
}

// ---------------- Admin portal ----------------
function setAdminMessage(message, type = "error") {
  const el = document.getElementById("adminLoginMessage");
  if (!el) return;
  el.textContent = message;
  el.className = "auth-message show " + type;
}

function adminAuthHeaders() {
  const token = localStorage.getItem("admin_token");
  return token ? { Authorization: "Bearer " + token } : {};
}

async function adminFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...adminAuthHeaders(), ...(opts.headers || {}) };
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (!res.ok) {
    let detail = "HTTP " + res.status;
    try { const body = await res.json(); detail = body.detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

async function adminLogin(e) {
  e.preventDefault();
  setAdminMessage("");
  const btn = e.submitter;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(API_BASE + "/auth/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("adminUsername").value.trim(),
        password: document.getElementById("adminPassword").value
      })
    });
    if (!res.ok) {
      let detail = "Admin login failed";
      try { detail = (await res.json()).detail || detail; } catch (_) {}
      throw new Error(detail);
    }
    const data = await res.json();
    localStorage.setItem("admin_token", data.token);
    await showAdminPortal();
  } catch (err) {
    setAdminMessage(err.message || "Admin login failed");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[ch]));
}

function adminApplicationCard(item, role) {
  const status = role === "collector" ? (item.verification_status || "pending") : (item.verification_status || item.authorization_status || "pending");
  const pending = status === "pending";
  const title = role === "collector" ? "👤 " + item.name : "🏭 " + item.name;
  const detail = role === "collector"
    ? `<div><strong>Permit:</strong> ${escapeHtml(item.certification_number || "—")}</div><div><strong>Location:</strong> ${escapeHtml(item.operating_location || "—")}</div>`
    : `<div><strong>Authorization:</strong> ${escapeHtml(item.authorization_id || "—")}</div><div><strong>Facility:</strong> ${escapeHtml(item.facility_location || "—")}</div><div><strong>Contact:</strong> ${escapeHtml(item.contact || item.phone || "—")}</div>`;
  return `<div class="admin-app-card">
    <div class="admin-app-head"><div><div class="admin-app-title">${title}</div><div class="admin-app-meta">${escapeHtml(item.phone || "")} · ${escapeHtml(role)}</div></div><span class="admin-status ${status}">${escapeHtml(status)}</span></div>
    <div class="admin-app-details">${detail}</div>
    <div class="admin-cert-row"><span>📄 ${escapeHtml(item.certification_file || "Certificate")}</span><button class="btn btn-outline admin-action" data-admin-action="view" data-role="${role}" data-id="${escapeHtml(item.id)}" type="button">View certificate</button></div>
    ${pending ? `<div class="admin-actions"><button class="btn btn-secondary admin-action" data-admin-action="approve" data-role="${role}" data-id="${escapeHtml(item.id)}" type="button">✓ Approve</button><button class="btn btn-danger admin-action" data-admin-action="reject" data-role="${role}" data-id="${escapeHtml(item.id)}" type="button">Reject</button></div>` : ""}
  </div>`;
}

async function viewAdminCertificate(role, id) {
  const res = await fetch(API_BASE + `/admin/certificates/${role}/${encodeURIComponent(id)}`, { headers: adminAuthHeaders() });
  if (!res.ok) throw new Error("Could not open certificate");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function decideAdminApplication(role, id, decision) {
  const label = decision === "approved" ? "approve" : "reject";
  if (!confirm(`Are you sure you want to ${label} this ${role} application?`)) return;
  try {
    await adminFetch(`/admin/applications/${role}/${encodeURIComponent(id)}/${decision}`, { method: "POST" });
    await loadAdminApplications();
  } catch (err) {
    alert(err.message || "Could not update application");
  }
}

async function loadAdminApplications() {
  const data = await adminFetch("/admin/applications");
  const collectors = data.collectors || [];
  const recyclers = data.recyclers || [];
  const pendingCollectors = collectors.filter(x => (x.verification_status || "pending") === "pending");
  const pendingRecyclers = recyclers.filter(x => (x.verification_status || "pending") === "pending");
  const reviewed = [...collectors.map(x => ({...x, _role:"collector"})), ...recyclers.map(x => ({...x, _role:"recycler"}))]
    .filter(x => (x.verification_status || "approved") !== "pending");
  document.getElementById("adminSummary").innerHTML = `<div class="admin-summary-card"><strong>${pendingCollectors.length + pendingRecyclers.length}</strong><span>Pending</span></div><div class="admin-summary-card"><strong>${collectors.length + recyclers.length}</strong><span>Total applications</span></div>`;
  document.getElementById("adminCollectors").innerHTML = pendingCollectors.length ? pendingCollectors.map(x => adminApplicationCard(x, "collector")).join("") : `<div class="admin-empty">No pending collector applications.</div>`;
  document.getElementById("adminRecyclers").innerHTML = pendingRecyclers.length ? pendingRecyclers.map(x => adminApplicationCard(x, "recycler")).join("") : `<div class="admin-empty">No pending recycler applications.</div>`;
  document.getElementById("adminReviewed").innerHTML = reviewed.length ? reviewed.map(x => adminApplicationCard(x, x._role)).join("") : `<div class="admin-empty">No reviewed applications yet.</div>`;
  document.querySelectorAll(".admin-action").forEach(btn => {
    btn.onclick = async () => {
      const action = btn.dataset.adminAction;
      try {
        if (action === "view") await viewAdminCertificate(btn.dataset.role, btn.dataset.id);
        else await decideAdminApplication(btn.dataset.role, btn.dataset.id, action === "approve" ? "approved" : "rejected");
      } catch (err) { alert(err.message || "Action failed"); }
    };
  });
}

async function showAdminPortal() {
  document.getElementById("authView").style.display = "none";
  document.querySelector(".topbar").style.display = "none";
  document.querySelector(".status-bar").style.display = "none";
  document.querySelector("main").style.display = "none";
  document.getElementById("collectorNav").style.display = "none";
  document.getElementById("adminView").style.display = "block";
  document.getElementById("adminLoginCard").style.display = "none";
  document.getElementById("adminPortal").style.display = "block";
  try { await loadAdminApplications(); } catch (err) {
    localStorage.removeItem("admin_token");
    document.getElementById("adminLoginCard").style.display = "block";
    document.getElementById("adminPortal").style.display = "none";
    setAdminMessage(err.message || "Admin session expired");
  }
}

function showAdminLogin() {
  document.getElementById("authView").style.display = "none";
  document.querySelector(".topbar").style.display = "none";
  document.querySelector(".status-bar").style.display = "none";
  document.querySelector("main").style.display = "none";
  document.getElementById("collectorNav").style.display = "none";
  document.getElementById("adminView").style.display = "block";
  document.getElementById("adminLoginCard").style.display = "block";
  document.getElementById("adminPortal").style.display = "none";
}

function exitAdmin() {
  localStorage.removeItem("admin_token");
  if (location.hash === "#admin") location.hash = "";
  location.reload();
}

// ---------------- Init ----------------
async function init() {
  await openDB();

  document.querySelectorAll(".lang-switch button").forEach(btn => {
    btn.onclick = () => {
      lang = btn.dataset.lang;
      localStorage.setItem("lang", lang);
      document.querySelectorAll(".lang-switch button").forEach(b => b.classList.toggle("active", b === btn));
      applyI18n();
      if (localStorage.getItem("auth_role") === "collector" && localStorage.getItem("auth_token")) {
        renderCollectorDashboard();
        renderPriceBoard();
        renderRecyclers();
        renderLotsList();
        renderSafety();
      }
    };
  });

  document.getElementById("loginTab").onclick = () => showAuthMode("login");
  document.getElementById("registerTab").onclick = () => showAuthMode("register");
  document.querySelectorAll(".role-tab").forEach(btn => {
    btn.onclick = () => { authRole = btn.dataset.role; updateAuthRoleUI(); };
  });
  document.getElementById("loginForm").onsubmit = doLogin;
  document.getElementById("registerForm").onsubmit = doRegister;
  document.getElementById("dashboardAllRecyclersBtn").onclick = () => { showScreen("recyclers"); renderRecyclers(); };
  document.getElementById("dashboardMyLotsBtn").onclick = () => showScreen("lots");
  document.getElementById("dashboardLogoutBtn").onclick = logout;
  const refreshRecyclerBtn = document.getElementById("refreshRecyclerDashboardBtn");
  if (refreshRecyclerBtn) refreshRecyclerBtn.onclick = renderRecyclerDashboard;
  document.getElementById("topLogout").onclick = logout;
  document.getElementById("accountSettingsBtn").onclick = openAccountScreen;
  document.getElementById("accountBackBtn").onclick = () => showScreen("home");
  document.getElementById("helpBackBtn").onclick = () => showScreen("account");
  document.getElementById("privacyBackBtn").onclick = () => showScreen("account");
  document.getElementById("saveAccountBtn").onclick = () => {
    const extra = {
      preferred_language: document.getElementById("accountLanguage").value,
      operating_location: document.getElementById("accountArea").value.trim(),
      working_radius: document.getElementById("accountRadius").value,
      availability: document.getElementById("accountAvailability").value,
      email: document.getElementById("accountEmail").value.trim(),
      address: document.getElementById("accountAddress").value.trim(),
      alt_phone: document.getElementById("accountAltPhone").value.trim()
    };
    saveCurrentProfile(extra);
    lang = extra.preferred_language || lang;
    localStorage.setItem("lang", lang);
    applyI18n(); updateStatusBar(); renderAccountScreen(); toast(t("changes_saved"));
  };
  document.getElementById("helpSupportBtn").onclick = openHelpScreen;
  document.getElementById("privacyBtn").onclick = openPrivacyScreen;
  document.getElementById("accountLogoutBtn").onclick = logout;
  document.getElementById("clearLocalProfileBtn").onclick = () => {
    const p = JSON.parse(localStorage.getItem("auth_user") || "null") || {};
    if (p.phone) localStorage.removeItem(profileStorageKey(p.phone));
    toast(t("profile_cleared")); renderAccountScreen();
  };
  document.getElementById("copySupportId").onclick = async () => {
    const v = document.getElementById("supportIdValue").textContent;
    try { await navigator.clipboard.writeText(v); } catch (_) {}
    toast(t("support_id_copied"));
  };
  document.querySelectorAll("#screen-account .section-title, #screen-help .section-title, #screen-privacy .section-title").forEach(el => {
    el.style.cursor = "pointer"; el.onclick = () => showScreen("home");
  });
  document.getElementById("adminLoginForm").onsubmit = adminLogin;
  document.getElementById("adminLogoutBtn").onclick = exitAdmin;

  applyI18n();

  // Wire collector controls up-front so restored sessions work after a page refresh.
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.onclick = () => showScreen(btn.dataset.screen);
  });
  document.getElementById("syncBtn").onclick = syncNow;
  bindPhotoInput();
  document.getElementById("weightInput").addEventListener("input", updateEstimate);
  document.getElementById("createLotBtn").onclick = saveLot;
  window.addEventListener("online", () => { updateStatusBar(); syncNow(); });
  window.addEventListener("offline", updateStatusBar);

  if (location.hash.toLowerCase() === "#admin") {
    if (localStorage.getItem("admin_token")) await showAdminPortal();
    else showAdminLogin();
    return;
  }

  if (localStorage.getItem("auth_token") && localStorage.getItem("auth_role")) {
    try {
      const me = await apiFetch("/auth/me");
      localStorage.setItem("auth_user", JSON.stringify(me.user));
      authRole = me.role;
      if (me.role === "collector") {
        collectorId = me.user.id;
        localStorage.setItem("collector_id", collectorId);
        await enterCollectorApp();
      } else {
        await enterRecyclerDashboard();
      }
      return;
    } catch (_) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_role");
      localStorage.removeItem("auth_user");
    }
  }

  document.getElementById("app").classList.remove("authenticated");
  showAuthMode("login");
  updateAuthRoleUI();

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
