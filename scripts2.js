//POTAmap (c) POTA News & Reviews https://pota.review
//261
//
// Yield to the browser for first paint
const nextFrame = () => new Promise(r => requestAnimationFrame(r));


// --- Single-run guard for modes init ---
let __modesInitStarted = false;

async function ensureModesInitOnce() {
    if (__modesInitStarted) return;
    __modesInitStarted = true;
    try {
        const haveChanges = await detectModeChanges();
        if (haveChanges) {
            try {
                await checkAndUpdateModesAtStartup();
            } catch (e) {
                console.warn(e);
            }
            if (typeof initQsoWorkerIfNeeded === 'function') {
                try {
                    initQsoWorkerIfNeeded();
                } catch (e) {
                    console.warn(e);
                }
            }
            if (typeof updateVisibleModeCounts === 'function') {
                try {
                    updateVisibleModeCounts();
                } catch (e) {
                    console.warn(e);
                }
            }
        }
    } catch (e) {
        console.warn("ensureModesInitOnce failed:", e);
    }
}


// Initialize global variables
let activations = [];
let map; // Leaflet map instance
let isPopupOpen = false; // Tracks whether a map popup is currently open
let parks = []; // Global variable to store parks data
let userLat = null;
let userLng = null;
// Declare a global variable to store current search results
let currentSearchResults = [];
let previousMapState = {
    bounds: null,
    displayedParks: []
};

// Fast rendering path
let __canvasRenderer = null; // initialized after map setup
let __panInProgress = false; // suppress redraws while panning
let __skipNextMarkerRefresh = false; // skip refresh after programmatic pan

/**
 * Opens a marker's popup and lets Leaflet auto-pan the map so the popup
 * remains fully visible. Skips the next marker refresh so the popup isn't
 * closed by the resulting map move.
 * @param {L.Marker} marker - Leaflet marker with a bound popup
 */
function openPopupWithAutoPan(marker) {
    if (!map || !marker) return;
    __skipNextMarkerRefresh = true;
    marker.openPopup();
}

// --- Lightweight Toast UI -------------------------------------------------
function ensureToastCss() {
    if (document.getElementById('pql-toast-css')) return;
    const css = `
  .toast-container{position:fixed;right:14px;top:14px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
  .toast{min-width:260px;max-width:360px;background:rgba(24,24,24,.92);color:#fff;border-radius:10px;padding:10px 12px;box-shadow:0 8px 20px rgba(0,0,0,.25);display:flex;align-items:flex-start;gap:10px;font:14px/1.35 system-ui,Segoe UI,Roboto,Helvetica,Arial}
  .toast .icon{flex:0 0 auto;margin-top:1px}
  .toast .msg{flex:1 1 auto;white-space:pre-wrap}
  .toast.success{background:rgba(24,120,24,.92)}
  .toast.error{background:rgba(168,28,28,.92)}
  .toast .spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  `;
    const style = document.createElement('style');
    style.id = 'pql-toast-css';
    style.textContent = css;
    document.head.appendChild(style);
}

function showToast(message, opts = {}) {
    ensureToastCss();
    const {sticky = true, kind = '', showSpinner = true} = opts;
    let cont = document.querySelector('.toast-container');
    if (!cont) {
        cont = document.createElement('div');
        cont.className = 'toast-container';
        document.body.appendChild(cont);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? (' ' + kind) : '');
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.innerHTML = showSpinner ? '<div class="spinner"></div>' : 'ℹ️';
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = message;
    el.appendChild(icon);
    el.appendChild(msg);
    cont.appendChild(el);
    el.style.pointerEvents = 'auto';

    let closed = false;
    const api = {
        update(m, k) {
            if (m != null) msg.textContent = m;
            if (k != null) {
                el.classList.remove('success', 'error');
                if (k) el.classList.add(k);
            }
        },
        close(delay = 0) {
            if (closed) return;
            closed = true;
            setTimeout(() => {
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 220);
            }, delay);
        }
    };
    if (!sticky) api.close(3000);
    return api;
}

// === User geolocation pin (global) =========================================
let userLocationMarker = null;

function setUserLocationMarker(lat, lng) {
    if (!map || typeof lat !== 'number' || typeof lng !== 'number') return;
    if (userLocationMarker) {
        userLocationMarker.setLatLng([lat, lng]);
    } else {
        userLocationMarker = L.marker([lat, lng], {
            title: 'Your location',
            alt: 'Your location',
            zIndexOffset: 1000
        }).addTo(map);
    }
}

/**
 * Centers the map on the user's current geolocation and drops/updates a pin.
 * Keeps the current zoom level.
 */
function centerMapOnGeolocation() {
    if (!navigator.geolocation) {
        console.warn('Geolocation not supported; falling back.');
        const saved = localStorage.getItem('mapCenter');
        if (saved) {
            try {
                const [lat, lng] = JSON.parse(saved);
                map.setView([lat, lng], map.getZoom(), {animate: true, duration: 1.0});
            } catch {
            }
        } else if (typeof fallbackToDefaultLocation === 'function') {
            fallbackToDefaultLocation();
        }
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            userLat = position.coords.latitude;
            userLng = position.coords.longitude;
            setUserLocationMarker(userLat, userLng);
            if (map) {
                map.setView([userLat, userLng], map.getZoom(), {animate: true, duration: 1.0});
            }
        },
        (error) => {
            console.warn('Geolocation error:', error && error.message);
            const saved = localStorage.getItem('mapCenter');
            if (saved) {
                try {
                    const [lat, lng] = JSON.parse(saved);
                    map.setView([lat, lng], map.getZoom(), {animate: true, duration: 1.0});
                } catch {
                }
            } else if (typeof fallbackToDefaultLocation === 'function') {
                fallbackToDefaultLocation();
            }
        },
        {enableHighAccuracy: true, maximumAge: 30000, timeout: 15000}
    );
}

/** Bind an existing “Center On My Location” button if present */
function wireCenterOnMyLocationButton() {
    const candidates = [
        'centerOnGeolocation',      // actual menu button id
        'centerOnMyLocation',
        'btnCenterOnMyLocation',
        'centerMapOnMyLocation',
        'centerMapButton'
    ];
    let btn = null;
    for (const id of candidates) {
        const el = document.getElementById(id);
        if (el) {
            btn = el;
            break;
        }
    }
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        centerMapOnGeolocation();
    });
}


// --- PQL display filter helpers (highlight-only; keep base parks visible) --------
function ensurePqlPulseCss() {
    if (document.getElementById('pql-pulse-css')) return;
    const css = `
.pql-pulse-icon { pointer-events: none; }
.pql-pulse {
  position: relative;
  width: 36px;
  height: 36px;
  box-sizing: border-box;
  border-radius: 50%;
  background: rgba(255, 255, 0, 0.95);
  box-shadow: 0 0 0 2px #000 inset, 0 0 4px rgba(0,0,0,0.6);
}
.pql-pulse::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 36px;
  height: 36px;
  box-sizing: border-box;
  transform: translate(-50%, -50%) scale(1);
  border-radius: 50%;
  border: 2px solid rgba(255, 215, 0, 0.9);
  animation: pqlPulse 1.8s ease-out infinite;
}
@keyframes pqlPulse {
  0%   { transform: translate(-50%, -50%) scale(1.0); opacity: 0.9; }
  70%  { transform: translate(-50%, -50%) scale(2.0); opacity: 0; }
  100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
}`;
    const style = document.createElement('style');
    style.id = 'pql-pulse-css';
    style.textContent = css;
    document.head.appendChild(style);
}

// Build an in-memory cache of review URLs from IndexedDB so redraws can highlight immediately
async function ensureReviewCacheFromIndexedDB() {
    try {
        if (window.__REVIEW_URLS instanceof Map && window.__REVIEW_URLS.size > 0) return;
        const db = await getDatabase();
        const tx = db.transaction('parks', 'readonly');
        const store = tx.objectStore('parks');
        const all = await new Promise((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
        const map = new Map();
        for (const p of all) {
            if (p && p.reference && p.reviewURL) map.set(p.reference, p.reviewURL);
        }
        window.__REVIEW_URLS = map;
        if (map.size) console.log(`[reviews] Loaded ${map.size} review URLs from IndexedDB.`);
    } catch (e) {
        console.warn('ensureReviewCacheFromIndexedDB failed:', e);
    }
}

// Build a set of truly new parks (from changes.json) to avoid relying on drifting 'created' timestamps
async function ensureRecentAddsFromChangesJSON() {
    const MAX_RECENT_ADDS = 400; // safety valve: if more than this, treat as corrupted feed
    const URL = '/potamap/data/changes.json';
    const SIG_KEY = 'recentAddsSig::changes.json';
    const qp = new URLSearchParams(location.search);
    if (qp.get('nonew') === '1') {
        window.__RECENT_ADDS = new Set();
        try { localStorage.removeItem('recentAddsSig::changes.json'); } catch {}
        return window.__RECENT_ADDS;
    }
    const isWithinDays = (iso, days) => {
        try {
            return (Date.now() - new Date(iso).getTime()) <= days * 86400000;
        } catch {
            return false;
        }
    };
    try {
        // Check if changed via HEAD
        let sig = null, prev = null;
        try {
            const head = await fetch(URL, {method: 'HEAD', cache: 'no-store'});
            if (head.ok) sig = head.headers.get('etag') || head.headers.get('last-modified') || 'no-sig';
        } catch {
        }
        try {
            prev = localStorage.getItem(SIG_KEY);
        } catch {
        }
        if (sig && prev && sig === prev && window.__RECENT_ADDS instanceof Set) {
            if (window.__RECENT_ADDS.size > MAX_RECENT_ADDS) {
                console.warn(`[new-parks] Cached recent-adds set is too large (${window.__RECENT_ADDS.size}); clearing.`);
                window.__RECENT_ADDS = new Set();
                try { localStorage.removeItem(SIG_KEY); } catch {}
            } else {
                return window.__RECENT_ADDS; // up-to-date and sane
            }
        }

        // Fetch full file
        const res = await fetch(URL, {cache: 'no-store'});
        if (!res.ok) throw new Error('changes.json fetch failed');
        const rows = await res.json();
        const set = new Set();
        if (Array.isArray(rows)) {
            for (const r of rows) {
                if (!r || typeof r !== 'object') continue;
                const ref = r.reference || r.ref || r.id;
                const change = (r.change || '').toString().toLowerCase();
                const ts = r.timestamp || r.time || r.ts;
                if (!ref) continue;
                if (change.includes('park added')) {
                    // Only consider truly recent adds. If no timestamp, treat as NOT new.
                    if (ts && isWithinDays(ts, 30)) {
                        set.add(String(ref).toUpperCase());
                    }
                }
            }
        }
        // Safety valve: if an anomalously large number of parks are marked new, assume a bad baseline and ignore
        if (set.size > MAX_RECENT_ADDS) {
            console.warn(`[new-parks] Ignoring changes.json because it marks ${set.size} parks as new (> ${MAX_RECENT_ADDS}).`);
            // Clear signature so we re-check next load
            try { localStorage.removeItem(SIG_KEY); } catch {}
            window.__RECENT_ADDS = new Set();
            return window.__RECENT_ADDS;
        }
        window.__RECENT_ADDS = set;
        if (sig) try {
            localStorage.setItem(SIG_KEY, sig);
        } catch {
        }
        return set;
    } catch (e) {
        console.warn('ensureRecentAddsFromChangesJSON failed:', e);
        // Fallback: empty set (no purple storm)
        window.__RECENT_ADDS = new Set();
        return window.__RECENT_ADDS;
    }
}

// Ensure parks are present in memory and IndexedDB; if DB is empty, force-load allparks.json
async function ensureParksLoadedFromNetworkIfEmpty() {
    try {
        const db = await getDatabase();
        // Count existing records in IDB.parks
        const count = await new Promise((resolve, reject) => {
            const tx = db.transaction('parks', 'readonly');
            const store = tx.objectStore('parks');
            const req = store.count();
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = (e) => reject(e.target.error);
        });

        const haveMem = Array.isArray(window.parks) && window.parks.length > 0;
        if (count > 0 && haveMem) return; // everything is fine

        // Fetch fresh allparks.json regardless of any localStorage timestamp
        const res = await fetch('/potamap/data/allparks.json', {cache: 'no-store'});
        if (!res.ok) throw new Error('Failed to load allparks.json');
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('allparks.json is empty');

        // Write to IDB.parks (bulk upsert)
        await new Promise((resolve, reject) => {
            const tx = db.transaction('parks', 'readwrite');
            const store = tx.objectStore('parks');
            for (const p of rows) store.put(p);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });

        // Update in-memory copy and mark fetch timestamp
        window.parks = rows;
        try {
            localStorage.setItem('fetchTimestamp::allparks.json', Date.now().toString());
        } catch (_) {
        }
        console.log(`[bootstrap] Loaded ${rows.length} parks from network and repopulated IndexedDB.`);
        if (typeof refreshMarkers === 'function') refreshMarkers({full: true});
    } catch (e) {
        console.warn('ensureParksLoadedFromNetworkIfEmpty failed:', e);
    }
}

function _addPqlHighlightMarker(layer, park) {
    if (!(park.latitude && park.longitude)) return;
    ensurePqlPulseCss();
    const icon = L.divIcon({
        className: 'pql-pulse-icon',
        html: '<div class="pql-pulse"></div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
    L.marker([park.latitude, park.longitude], {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: -1000
    }).addTo(layer);
}

function applyPqlFilterDisplay(matchedParks) {
    if (!map) return;
    map._pql = map._pql || {};

    // Build/clear highlight layer (keep base parks visible for context)
    if (!map._pql.highlightLayer) map._pql.highlightLayer = L.layerGroup().addTo(map);
    map._pql.highlightLayer.clearLayers();

    for (const park of matchedParks) _addPqlHighlightMarker(map._pql.highlightLayer, park);
}

function clearPqlFilterDisplay() {
    if (!map) return;
    const P = map._pql || {};
    if (P.highlightLayer) {
        P.highlightLayer.clearLayers();
        if (map.hasLayer(P.highlightLayer)) map.removeLayer(P.highlightLayer);
    }
    map._pql = {};
}

let activationToggleState = 0; // 0: Show all, 1: Show my activations, 2: Remove my activations
let spots = []; //holds spot info
const appVersion = "20250412a"; // manually update as needed
const cacheDuration = (24 * 60 * 60 * 1000) * 2; // 8 days in milliseconds

// See if we are in desktop mode
const urlParams = new URLSearchParams(window.location.search);
const isDesktopMode = urlParams.get('desktop') === '1';
console.log('Reading desktop param: ' + isDesktopMode);
if (isDesktopMode) {
    document.body.classList.add('desktop-mode');
}

/**
 * Ensures that the DOM is fully loaded before executing scripts.
 */

// ==== Mode changes gating (performance) ====
let MODE_CHANGES_AVAILABLE = false;
let MODE_CHANGE_REFS = new Set();

async function detectModeChanges() {
    // Candidate URLs for mode-change feeds
    const candidates = Array.isArray(window.MODES_CHANGES_URLS) && window.MODES_CHANGES_URLS.length
        ? window.MODES_CHANGES_URLS
        : [
            '/potamap/data/mode-changes.json',
            '/potamap/data/mode_changes.json',
        ];

    // Helpers
    const SIG_KEY = (u) => `modeChangesSig::${u}`; // localStorage key per URL
    const normRef = (s) => (s ? String(s).trim().toUpperCase() : null);
    const extractRefsAndPatches = (body) => {
        const refs = new Set();
        const patches = [];
        const pushObj = (obj) => {
            if (!obj) return;
            const ref = normRef(obj.reference || obj.ref || obj.id);
            if (!ref) return;
            refs.add(ref);
            const p = {};
            if (obj.modeTotals && typeof obj.modeTotals === 'object') p.modeTotals = obj.modeTotals;
            if (typeof obj.qsos === 'number') p.qsos = obj.qsos;
            if (typeof obj.attempts === 'number') p.attempts = obj.attempts;
            if (typeof obj.activations === 'number') p.activations = obj.activations;
            if (Object.keys(p).length > 0) patches.push({reference: ref, patch: p});
        };

        if (Array.isArray(body)) {
            for (const row of body) {
                if (typeof row === 'string') {
                    const r = normRef(row);
                    if (r) {
                        refs.add(r);
                        patches.push({reference: r, patch: {}});
                    }
                } else if (row && typeof row === 'object') {
                    pushObj(row);
                }
            }
            return {refs: Array.from(refs), patches};
        }
        if (body && typeof body === 'object') {
            if (Array.isArray(body.changes)) {
                for (const it of body.changes) pushObj(it);
                return {refs: Array.from(refs), patches};
            }
            if (Array.isArray(body.batches)) {
                for (const b of body.batches) if (Array.isArray(b.changes)) for (const it of b.changes) pushObj(it);
                return {refs: Array.from(refs), patches};
            }
        }
        return {refs: [], patches: []};
    };

    // For each candidate, HEAD to see if content changed (ETag/Last-Modified)
    for (const baseUrl of candidates) {
        let etag = null, lastMod = null, signature = null, prevSig = null;
        try {
            const head = await fetch(baseUrl, {method: 'HEAD', cache: 'no-store'});
            if (!head.ok) {
                // if HEAD is blocked, fall back to GET without signature check
                throw new Error('HEAD not ok');
            }
            etag = head.headers.get('etag');
            lastMod = head.headers.get('last-modified');
            signature = etag || lastMod || 'no-sig';
            try {
                prevSig = localStorage.getItem(SIG_KEY(baseUrl));
            } catch (_) {
                prevSig = null;
            }
            if (prevSig && signature && prevSig === signature) {
                // unchanged — try next candidate URL
                continue;
            }
        } catch (_) {
            // Ignore HEAD errors; we will try a GET below with cache busting using Date.now()
        }

        // Build a versioned URL to defeat CDN caches when changed
        const v = encodeURIComponent((etag || lastMod || Date.now()).toString());
        const url = baseUrl + (baseUrl.includes('?') ? `&v=${v}` : `?v=${v}`);

        try {
            const res = await fetch(url, {cache: 'no-store'});
            if (!res.ok) continue;
            const body = await res.json();
            try {
                window.__MODE_CHANGES_BODY = body;
            } catch (_) {
            }
            const {refs, patches} = extractRefsAndPatches(body);
            if (refs.length === 0 && patches.length === 0) {
                // No useful data; try next candidate
                continue;
            }
            MODE_CHANGES_AVAILABLE = true;
            MODE_CHANGE_REFS = new Set(refs);
            try {
                window.__MODE_CHANGES_PATCHES = patches;
            } catch (_) {
            }

            // Persist new signature so we can skip identical feeds next load
            try {
                localStorage.setItem(SIG_KEY(baseUrl), (signature || v));
            } catch (_) {
            }

            console.log(`[modes] mode-changes loaded from ${baseUrl} (refs=${refs.length}, patches=${patches.length})`);
            return true;
        } catch (e) {
            // try next candidate
            console.warn('[modes] fetch failed for', baseUrl, e);
        }
    }

    // Nothing found/changed
    MODE_CHANGES_AVAILABLE = false;
    MODE_CHANGE_REFS = new Set();
    console.log('[modes] no new mode-changes; skipping per-mode computations.');
    return false;
}

async function applyModeChangesToIndexedDB() {
    const body = (typeof window !== 'undefined') ? window.__MODE_CHANGES_BODY : null;
    const patches = (typeof window !== 'undefined' && Array.isArray(window.__MODE_CHANGES_PATCHES)) ? window.__MODE_CHANGES_PATCHES : [];
    if (!body && patches.length === 0) return {applied: 0};

    let applied = 0;
    // Use existing helper to upsert into IDB, and also update in-memory parks
    for (const entry of patches) {
        const {reference, patch} = entry || {};
        if (!reference || !patch || typeof patch !== 'object') continue;
        try {
            await upsertParkFieldsInIndexedDB(reference, patch);
            // Update in-memory `parks` so UI can reflect changes immediately
            if (Array.isArray(parks)) {
                const idx = parks.findIndex(p => p && p.reference === reference);
                if (idx >= 0) {
                    parks[idx] = Object.assign({}, parks[idx], patch);
                }
            }
            applied++;
        } catch (e) {
            console.warn('[modes] upsert failed for', reference, e);
        }
    }

    // Trigger a light redraw
    try {
        if (typeof refreshMarkers === 'function') refreshMarkers();
    } catch (_) {
    }
    return {applied};
}

async function checkAndUpdateModesAtStartup() {
    try {
        const res = await applyModeChangesToIndexedDB();
        if (res && res.applied > 0) {
            console.log(`[modes] Applied ${res.applied} mode/qsos patches to IndexedDB + memory.`);
        }
    } catch (e) {
        console.warn('[modes] checkAndUpdateModesAtStartup failed:', e);
    }
}

// === Worker helper wrappers (global) ===
function initQsoWorkerIfNeeded() {
    if (typeof window.initQsoWorkerIfNeededInner === 'function') {
        return window.initQsoWorkerIfNeededInner();
    }
}

// One-time healer: strip stale 'change'/'created' fields from parks not truly new, to avoid bad banners/colors
async function healParksIfCorrupted() {
    try {
        const HEAL_KEY = `parksHealed::${appVersion}`; // run once per app build
        if (localStorage.getItem(HEAL_KEY)) return; // already healed for this version

        const RECENT = (window.__RECENT_ADDS instanceof Set) ? window.__RECENT_ADDS : new Set();
        const db = await getDatabase();

        // Read all parks
        const all = await new Promise((resolve, reject) => {
            const tx = db.transaction('parks', 'readonly');
            const store = tx.objectStore('parks');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
        if (!Array.isArray(all) || all.length === 0) {
            localStorage.setItem(HEAL_KEY, '1');
            return;
        }

        // Scan and patch as needed
        let fixes = 0;
        await new Promise((resolve, reject) => {
            const tx = db.transaction('parks', 'readwrite');
            const store = tx.objectStore('parks');
            for (const p of all) {
                if (!p || !p.reference) continue;
                let changed = false;
                // If a park isn't in the vetted recent-adds set, remove any stale created/change fields
                if (!RECENT.has(p.reference)) {
                    if (Object.prototype.hasOwnProperty.call(p, 'change')) {
                        delete p.change;
                        changed = true;
                    }
                    if (Object.prototype.hasOwnProperty.call(p, 'created')) {
                        delete p.created;
                        changed = true;
                    }
                }
                // (Optional future hook) sanity for modeTotals if you want
                if (changed) {
                    store.put(p);
                    fixes++;
                }
            }
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });

        localStorage.setItem(HEAL_KEY, '1');
        if (fixes > 0) console.log(`[heal] Cleaned ${fixes} park records in IndexedDB.`);
    } catch (e) {
        console.warn('healParksIfCorrupted failed:', e);
    }
}

function updateVisibleModeCounts() {
    if (!map || !parks || parks.length === 0) return;
    if (!MODE_CHANGES_AVAILABLE || !(MODE_CHANGE_REFS instanceof Set)) return; // nothing to do
    const b = map.getBounds();
    const refs = [];
    for (const park of parks) {
        const {latitude, longitude, reference} = park || {};
        if (latitude == null || longitude == null || !reference) continue;
        if (!MODE_CHANGE_REFS.has(reference)) continue; // Only compute where changes exist
        if (b.contains([latitude, longitude])) refs.push(reference);
    }
    enqueueVisibleReferences(refs);
}

function modeCountsForParkRef(reference) {
    if (typeof window.modeCountsForParkRefInner === 'function') {
        return window.modeCountsForParkRefInner(reference);
    }
    return {cw: 0, data: 0, ssb: 0, unk: 0};
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        initializeMenu();
        ensureReviewHaloCss();

        await ensureReviewCacheFromIndexedDB();
        // Load true new-park refs from changes.json to avoid mass purple due to drifting 'created'
        try {
            await ensureRecentAddsFromChangesJSON();
        } catch (e) {
            console.warn(e);
        }

        // If IndexedDB.parks is empty (e.g., after a manual reset), force-load allparks.json now
        await ensureParksLoadedFromNetworkIfEmpty();
        // Remove stale created/change fields from existing users' stores
        await healParksIfCorrupted();

        // === Off-main-thread per-mode QSO counting (performance patch) ===
        let modeCountCache = new Map(); // reference -> {cw,data,ssb,unk}
        let qsoWorker = null;
        let workerReady = false;
        let pendingVisibleBatch = [];
        let visibleComputeScheduled = false;

        function initQsoWorkerIfNeeded() {
            if (!MODE_CHANGES_AVAILABLE) return;
            if (qsoWorker) return;
            try {
                qsoWorker = new Worker('qsoWorker.js');
                qsoWorker.onmessage = (e) => {
                    const {type, payload} = e.data || {};
                    if (type === 'INIT_OK') {
                        workerReady = true;
                        scheduleVisibleCompute();
                    } else if (type === 'COMPUTE_DONE') {
                        const res = (payload && payload.result) || {};
                        for (const ref in res) {
                            modeCountCache.set(ref, res[ref]);
                        }
                        if (typeof updateMarkersForReferences === 'function') {
                            updateMarkersForReferences(Object.keys(res));
                        } else if (typeof refreshMarkers === 'function') {
                            if (window.requestIdleCallback) {
                                requestIdleCallback(() => refreshMarkers(), {timeout: 200});
                            } else {
                                setTimeout(() => refreshMarkers(), 50);
                            }
                        }
                    }
                };
                // Defer INIT until after initial map render so paint happens ASAP
                setTimeout(() => {
                    try {
                        qsoWorker.postMessage({type: 'INIT', payload: {parks, activations}});
                    } catch (_) {
                    }
                }, 0);
            } catch (e) {
                console.warn('QSO worker failed to initialize, falling back to main thread.', e);
            }
        }

        function getModeCounts(ref) {
            return modeCountCache.get(ref) || {cw: 0, data: 0, ssb: 0, unk: 0};
        }

        // Batch compute for visible parks only (and only missing entries)
        function enqueueVisibleReferences(refs) {
            for (const r of refs) {
                if (!modeCountCache.has(r)) pendingVisibleBatch.push(r);
            }
            scheduleVisibleCompute();
        }

        function scheduleVisibleCompute() {
            if (visibleComputeScheduled) return;
            visibleComputeScheduled = true;
            const run = () => {
                visibleComputeScheduled = false;
                if (!qsoWorker || !workerReady || pendingVisibleBatch.length === 0) return;
                const batch = pendingVisibleBatch.splice(0, 250); // small chunks
                try {
                    qsoWorker.postMessage({type: 'COMPUTE', payload: {references: batch}});
                } catch (_) {
                }
                if (pendingVisibleBatch.length > 0) {
                    if (window.requestIdleCallback) {
                        requestIdleCallback(scheduleVisibleCompute, {timeout: 200});
                    } else {
                        setTimeout(scheduleVisibleCompute, 30);
                    }
                }
            };
            if (window.requestIdleCallback) {
                requestIdleCallback(run, {timeout: 200});
            } else {
                setTimeout(run, 30);
            }
        }

        // Hook visibility: compute only for parks in current bounds AND with mode changes
        function updateVisibleModeCounts() {
            if (!map || !parks || parks.length === 0) return;
            if (!MODE_CHANGES_AVAILABLE || !(MODE_CHANGE_REFS instanceof Set)) return;
            const b = map.getBounds();
            const refs = [];
            for (const park of parks) {
                const {latitude, longitude, reference} = park || {};
                if (latitude == null || longitude == null || !reference) continue;
                if (!MODE_CHANGE_REFS.has(reference)) continue;
                if (b.contains([latitude, longitude])) refs.push(reference);
            }
            enqueueVisibleReferences(refs);
        }

        // Helper used by marker rendering
        function modeCountsForParkRef(reference) {
            return getModeCounts(reference);
        }

        // expose inner worker helpers to global wrappers
        window.initQsoWorkerIfNeededInner = initQsoWorkerIfNeeded;
        window.updateVisibleModeCountsInner = updateVisibleModeCounts;
        window.modeCountsForParkRefInner = modeCountsForParkRef;

        // Initialize the map, then kick off the mode check and worker if needed
        await nextFrame();
        await setupPOTAMap();

        // Use a shared Canvas renderer for circle markers (significantly faster than default SVG)
        try { __canvasRenderer = L.canvas({ padding: 0.5 }); } catch (_) {}

        // Debounce redraws on pan/zoom; redraw only when interaction settles
        if (map && typeof map.on === 'function') {
            map.on('movestart', () => { __panInProgress = true; });
            map.on('zoomstart', () => { __panInProgress = true; });
            const debouncedMoveEnd = (function(){
                let t = null;
                return () => {
                    clearTimeout(t);
                    t = setTimeout(() => {
                        __panInProgress = false;
                        if (__skipNextMarkerRefresh) {
                            __skipNextMarkerRefresh = false;
                        } else {
                            refreshMarkers();
                        }
                    }, 120);
                };
            })();
            map.on('moveend', debouncedMoveEnd);
            map.on('zoomend', debouncedMoveEnd);
        }

        if (typeof attachVisibleListenersOnce === 'function') attachVisibleListenersOnce();

        // Load PN&R review URLs **before** first draw so halos & links are present
        try {
            await fetchAndApplyReviewUrls();
        } catch (_) {}

        await initializeActivationsDisplay();
    } catch (e) {
        console.error(e);
    }
});
/* ==== POTAmap Filters & Thresholds (Ada 2025-08-12) ==== */
// Configurable filters (OR semantics). Defaults: All parks on.
window.potaFilters = JSON.parse(localStorage.getItem('potaFilters') || '{}');
if (!('allParks' in potaFilters)) {
    potaFilters = {myActivations: true, currentlyActivating: true, newParks: true, allParks: true};
}

// Configurable color thresholds. 'greenMax' means 1..greenMax is green; >greenMax is red; 0 is blue.
window.potaThresholds = JSON.parse(localStorage.getItem('potaThresholds') || '{}');
if (!('greenMax' in potaThresholds)) {
    potaThresholds = {greenMax: 5}; // default per Perry's example
}

// Helpers
function savePotaFilters() {
    localStorage.setItem('potaFilters', JSON.stringify(potaFilters));
    try {
        refreshMarkers({full: true});
    } catch (e) {
    }
}

function savePotaThresholds() {
    localStorage.setItem('potaThresholds', JSON.stringify(potaThresholds));
}

// Mode filters for active spots
window.modeFilters = JSON.parse(localStorage.getItem('modeFilters') || '{}');
if (!('new' in modeFilters)) {
    modeFilters = {new: true, data: true, cw: true, ssb: true, unk: true};
}

function saveModeFilters() {
    localStorage.setItem('modeFilters', JSON.stringify(modeFilters));
    try {
        refreshMarkers({full: true});
    } catch (e) {
    }
}


function shouldDisplayParkFlags(flags) {
    const isUserActivated = !!(flags && flags.isUserActivated);
    const isActive = !!(flags && flags.isActive);
    const isNew = !!(flags && flags.isNew);

    // When "All spots" is ON: show everything EXCEPT any categories that are toggled OFF.
    if (potaFilters.allParks) {
        if (potaFilters.myActivations === false && isUserActivated) return false;
        if (potaFilters.currentlyActivating === false && isActive) return false;
        if (potaFilters.newParks === false && isNew) return false;
        return true; // otherwise include
    }

    // When "All spots" is OFF: OR together any categories that are toggled ON.
    const anySpecific =
        !!potaFilters.myActivations ||
        !!potaFilters.currentlyActivating ||
        !!potaFilters.newParks;

    if (!anySpecific) return false;

    return (potaFilters.myActivations && isUserActivated)
        || (potaFilters.currentlyActivating && isActive)
        || (potaFilters.newParks && isNew);
}

function shouldDisplayByMode(isActive, isNew, mode) {
    if (!isActive) return true;
    if (isNew && !modeFilters.new) return false;
    let key = 'unk';
    if (mode === 'CW') key = 'cw';
    else if (mode === 'SSB') key = 'ssb';
    else if (mode === 'FT8' || mode === 'FT4') key = 'data';
    if (!modeFilters[key]) return false;
    return true;
}

// Returns true if the parsed PQL specifies an explicit geographic scope
function queryHasExplicitScope(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.callsign) return true;
    const s = (parsed.state || parsed.STATE || parsed.region || parsed.country || parsed.COUNTRY || parsed.ref || parsed.reference || parsed.id);
    if (s) return true;
    if (Array.isArray(parsed.refs) && parsed.refs.length > 0) return true;
    // Some parsers return a list of filters; look for STATE:/COUNTRY:/REF:
    const filters = parsed.filters || parsed.terms || [];
    if (Array.isArray(filters)) {
        for (const f of filters) {
            const k = (f && (f.key || f.type || f.name || '')).toString().toUpperCase();
            if (k === 'STATE' || k === 'COUNTRY' || k === 'REF' || k === 'REFERENCE' || k === 'ID') return true;
        }
    }
    // A meta flag can force global behavior
    if (parsed.meta && (parsed.meta.scope === 'global' || parsed.meta.global === true)) return true;
    return false;
}

function getMarkerColorConfigured(activations, isUserActivated) {
    try {
        // 1) 'My' parks
        if (isUserActivated) return "#1e8c27"; // light green

        // 2) Parks with zero activations
        if (activations === 0) return "#00008b"; // dark blue

        // 3) Default
        return "#ff6666"; // red
    } catch (_) {
        return "#ff6666"; // fallback to red
    }
}


// Build Filters UI inside the hamburger menu (thresholdChip fully removed)
function buildFiltersPanel() {
    const menu = document.getElementById('menu');
    if (!menu) return;

    // Hide old toggle button if present
    const oldToggle = document.getElementById('toggleActivations');
    if (oldToggle) oldToggle.style.display = 'none';

    // Remove any previously-inserted filters panel or legacy copies
    const oldPanels = menu.querySelectorAll('.filters-panel');
    oldPanels.forEach(p => p.parentElement && p.parentElement.remove());

    // Build the minimal panel (no threshold UI)
    const li = document.createElement('li');
    li.id = 'filtersPanelContainer';
    li.innerHTML = `
    <div class="filters-panel">
      <div class="filters-title">Filters</div>
      <div class="filters-grid">
        <button class="filter-chip" id="chipMyActs"   type="button" aria-pressed="false">My</button>
        <button class="filter-chip" id="chipOnAir"    type="button" aria-pressed="false">Active</button>
        <button class="filter-chip" id="chipNewParks" type="button" aria-pressed="false">New</button>
        <button class="filter-chip" id="chipAllParks" type="button" aria-pressed="false">All / Clr</button>
      </div>
    </div>
  `;

    // Insert at top of menu
    menu.insertBefore(li, menu.firstChild || null);

    // Nothing else to initialize here — threshold UI is retired.
}


function buildModeFilterPanel() {
    const menu = document.getElementById('menu');
    if (!menu) return;

    // nuke old copy if present
    const old = document.getElementById('modeFilterPanelContainer');
    if (old) old.remove();

    // find the Filters panel <li> so we can insert right after it
    const anchor = document.getElementById('filtersPanelContainer');

    const li = document.createElement('li');
    li.id = 'modeFilterPanelContainer';
    li.innerHTML = `
  <div class="mode-filter-panel" role="group" aria-label="Activation mode filters">
    <div class="mode-dots-row">
      <button class="mode-dot dot-new"  data-mode="new"  aria-pressed="${modeFilters.new}">
        <svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="9"/></svg>
      </button>
      <button class="mode-dot dot-data" data-mode="data" aria-pressed="${modeFilters.data}">
        <svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="9"/></svg>
      </button>
      <button class="mode-dot dot-cw"   data-mode="cw"   aria-pressed="${modeFilters.cw}">
        <svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="9"/></svg>
      </button>
      <button class="mode-dot dot-ssb"  data-mode="ssb"  aria-pressed="${modeFilters.ssb}">
        <svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="9"/></svg>
      </button>
      <button class="mode-dot dot-unk"  data-mode="unk"  aria-pressed="${modeFilters.unk}">
        <svg viewBox="0 0 22 22"><circle cx="11" cy="11" r="9"/></svg>
      </button>
    </div>
    <div class="mode-dots-labels">
      <span>New</span><span>Data</span><span>CW</span><span>SSB</span><span>Unk</span>
    </div>
  </div>
`;


    // insert right after Filters panel; if not found, put at top
    if (anchor?.nextSibling) menu.insertBefore(li, anchor.nextSibling);
    else menu.insertBefore(li, menu.firstChild || null);

    // initialize visual "off" state + interactions
    li.querySelectorAll('.mode-dot').forEach(btn => {
        const mode = btn.dataset.mode;
        const isOn = !!modeFilters[mode];
        btn.classList.toggle('off', !isOn);
        btn.setAttribute('aria-pressed', String(isOn));

        btn.addEventListener('click', () => {
            const next = !modeFilters[mode];
            modeFilters[mode] = next;
            btn.classList.toggle('off', !next);
            btn.setAttribute('aria-pressed', String(next));
            saveModeFilters();
            // redraw (uses shouldDisplayByMode)
            if (typeof refreshMarkers === 'function') refreshMarkers();
            else if (typeof redrawMarkersWithFilters === 'function') redrawMarkersWithFilters();

        });
    });
}

// Optional CSS fallback for image markers
function ensureReviewHaloCss() {
    if (document.getElementById('review-halo-css')) return;
    const css = `
  .leaflet-marker-icon.has-review {
    box-shadow: 0 0 0 1.5px rgba(255, 215, 0, 0.95), 0 0 0 2.5px rgba(0, 0, 0, 0.9) !important;
    border-radius: 50%;
  }
  `;
    const style = document.createElement('style');
    style.id = 'review-halo-css';
    style.textContent = css;
    document.head.appendChild(style);
}

// Add visual halo to a marker (two concentric rings) when a review exists
function decorateReviewHalo(marker, park) {
    if (!marker || !park || !park.reviewURL || marker.__reviewHalos) return;

    if (!map.getPane('reviewHalos')) {
        map.createPane('reviewHalos');
        const pane = map.getPane('reviewHalos');
        // Above Canvas overlay (~400), below DOM marker pane (~600)
        if (pane) pane.style.zIndex = 450;
    }

    const latLng = marker.getLatLng && marker.getLatLng();
    if (!latLng) return;

    let baseR;
    if (marker.getRadius) {
        baseR = marker.options?.radius || marker.getRadius();
    } else if (marker.options?.icon?.options?.iconSize) {
        baseR = marker.options.icon.options.iconSize[0] / 2;
    } else {
        baseR = 6;
    }

    const haloGold = L.circleMarker(latLng, {
        pane: 'reviewHalos',
        radius: baseR + 3,
        color: '#FFD700',
        weight: 2,
        fillOpacity: 0,
        opacity: 0.95,
        interactive: false
    }).addTo(map.activationsLayer || map);

    const haloBlack = L.circleMarker(latLng, {
        pane: 'reviewHalos',
        radius: baseR + 4,
        color: '#000',
        weight: 2,
        fillOpacity: 0,
        opacity: 1,
        interactive: false
    }).addTo(map.activationsLayer || map);

    marker.__reviewHalos = [haloBlack, haloGold];
    if (marker.on) {
        marker.on('remove', () => {
            if (marker.__reviewHalos) {
                marker.__reviewHalos.forEach(h => {
                    if (map.activationsLayer) map.activationsLayer.removeLayer(h);
                    else map.removeLayer(h);
                });
                marker.__reviewHalos = null;
            }
        });
    }
}

// Lightweight refresh: clear and redraw current view using existing flow

/* === Direct redraw path that respects potaFilters (Ada v7, patched for PN&R rings) === */
async function redrawMarkersWithFilters() {
    try {
        if (!map) {
            console.warn("redrawMarkersWithFilters: map not ready");
            return;
        }
        // Skip mid-pan redraws; we'll repaint once on moveend/zoomend
        if (__panInProgress) return;
//        if (!map.activationsLayer) { map.activationsLayer = L.layerGroup().addTo(map); }
//        if (!window.__nonDestructiveRedraw) { map.activationsLayer.clearLayers(); }
        if (!map.activationsLayer) {
            map.activationsLayer = L.layerGroup().addTo(map);
        }
        // Always clear before redraw to avoid stale styling/classes across filter toggles
        map.activationsLayer.clearLayers();
        const bounds = getCurrentMapBounds();
        const userActivatedReferences = (activations || []).map(a => a.reference);

        // Build a quick index for current spots by reference
        const spotByRef = {};
        if (Array.isArray(spots)) {
            for (const s of spots) if (s && s.reference) spotByRef[s.reference] = s;
        }

        // Ensure a pane for review halos so the rings render above Canvas overlay but below DOM markers
        if (!map.getPane('reviewHalos')) {
            map.createPane('reviewHalos');
            const pane = map.getPane('reviewHalos');
            // Ensure halos sit above Canvas overlay (≈400) but below DOM markers (≈600)
            if (pane) pane.style.zIndex = 450;
        }

        parks.forEach((park) => {
            const {reference, name, latitude, longitude, activations: parkActivationCount, created} = park;
            if (!(latitude && longitude)) return;
            const latLng = L.latLng(latitude, longitude);
            if (!bounds.contains(latLng)) return;

            const isUserActivated = userActivatedReferences.includes(reference);
            // Use recent-adds set instead of created timestamp
            const RECENT = (window.__RECENT_ADDS instanceof Set) ? window.__RECENT_ADDS : new Set();
            const isNew = RECENT.has(reference);
            // Gate the purple highlighting behind the New filter chip
            const showNewColor = !!potaFilters?.newParks && isNew;
            const currentActivation = spotByRef[reference];
            const isActive = !!currentActivation;
            const mode = currentActivation?.mode ? currentActivation.mode.toUpperCase() : '';

            if (!shouldDisplayParkFlags({isUserActivated, isActive, isNew})) return;
            if (!shouldDisplayByMode(isActive, isNew, mode)) return;

            // Does this park have a PN&R review URL?
            let hasReview = !!park.reviewURL;
            if (!hasReview && window.__REVIEW_URLS instanceof Map) {
                const urlFromCache = window.__REVIEW_URLS.get(reference);
                if (urlFromCache) {
                    park.reviewURL = urlFromCache;
                    hasReview = true;
                }
            }
            // Determine marker class for animated divIcon
            const markerClasses = [];
            if (showNewColor) markerClasses.push('pulse-marker');
            if (isActive) {
                markerClasses.push('active-pulse-marker');
                if (mode === 'CW') markerClasses.push('mode-cw');
                else if (mode === 'SSB') markerClasses.push('mode-ssb');
                else if (mode === 'FT8' || mode === 'FT4') markerClasses.push('mode-data');
            }
            const markerClassName = markerClasses.join(' ');

            // Build the marker (animated divIcon vs. simple circle)
            let marker;
            const usingDivIcon = markerClasses.length > 0;
            if (usingDivIcon) {
                marker = L.marker([latitude, longitude], {
                    icon: L.divIcon({
                        // include Leaflet's default class for compatibility with Leaflet styles
                        className: `leaflet-div-icon ${markerClassName}`.trim(),
                        iconSize: [20, 20],
                    })
                });
                if (hasReview) {
                    decorateReviewHalo(marker, park);
                } else if (window.__REVIEW_URLS instanceof Map) {
                    const u = window.__REVIEW_URLS.get(reference);
                    if (u) { park.reviewURL = u; decorateReviewHalo(marker, park); }
                }
            } else {
                const baseColor = getMarkerColorConfigured(parkActivationCount, isUserActivated);
                const fillColor = showNewColor ? "#800080" : baseColor; // purple only when New filter ON and truly new
                marker = L.circleMarker([latitude, longitude], {
                    renderer: __canvasRenderer || undefined,
                    radius: 6,
                    fillColor,
                    color: "#000",
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.9,
                });

                if (hasReview) {
                    decorateReviewHalo(marker, park);
                } else if (window.__REVIEW_URLS instanceof Map) {
                    const u = window.__REVIEW_URLS.get(reference);
                    if (u) { park.reviewURL = u; decorateReviewHalo(marker, park); }
                }
            }

            const tooltipText = currentActivation
                ? `${reference}: ${name} <br> ${currentActivation.activator} on ${currentActivation.frequency} kHz (${currentActivation.mode})${currentActivation.comments ? ` <br> ${currentActivation.comments}` : ''}`
                : `${reference}: ${name} (${parkActivationCount} activations)`;

            marker.park = park;
            marker.currentActivation = currentActivation;

            marker
                .addTo(map.activationsLayer)
                .bindPopup("<b>Loading park info...</b>", {keepInView: true, autoPan: true, autoPanPadding: [30, 40]})
                .bindTooltip(tooltipText, {direction: "top", opacity: 0.9, sticky: false, className: "custom-tooltip"})
                .on('click', function () {
                    this.closeTooltip();
                });

            marker.on('popupopen', async function () {
                try {
                    const parkActivations = await fetchParkActivations(reference);
                    await saveParkActivationsToIndexedDB(reference, parkActivations);
                    // Merge reviewURL from IndexedDB if the in-memory park lacks it
                    if (!park.reviewURL && park.reference) {
                        try {
                            const db = await getDatabase();
                            const tx = db.transaction('parks', 'readonly');
                            const store = tx.objectStore('parks');
                            const rec = await new Promise((res, rej) => {
                                const req = store.get(park.reference);
                                req.onsuccess = () => res(req.result || null);
                                req.onerror = (e) => rej(e.target.error);
                            });
                            if (rec && rec.reviewURL) park.reviewURL = rec.reviewURL;
                            if (park.reviewURL) decorateReviewHalo(this, park);
                        } catch (e) { /* non-fatal */
                        }
                    }
                    // Ensure we have a review URL from memory cache if IndexedDB didn't have it yet
                    if (!park.reviewURL && window.__REVIEW_URLS instanceof Map) {
                        const u = window.__REVIEW_URLS.get(park.reference);
                        if (u) park.reviewURL = u;
                    }
                    // Build a display-safe copy so we don't show stale or unintended change banners
                    const displayPark = Object.assign({}, park);
                    // Back-compat: some popup templates may look for different keys
                    if (park.reviewURL && !displayPark.reviewURL) displayPark.reviewURL = park.reviewURL;
                    if (park.reviewURL && !displayPark.reviewUrl) displayPark.reviewUrl = park.reviewURL; // camelCase alt
                    if (park.reviewURL && !displayPark.pnrUrl)    displayPark.pnrUrl    = park.reviewURL; // legacy key
                    try {
                        const RECENT = (window.__RECENT_ADDS instanceof Set) ? window.__RECENT_ADDS : new Set();
                        const isTrulyNew = RECENT.has(park.reference);
                        // Only keep the `change`/`created` fields if the park is truly new per backend delta window
                        if (!isTrulyNew) {
                            delete displayPark.change;
                            delete displayPark.created;
                        } else {
                            // Normalize the message for UI consistency
                            if (typeof displayPark.change === 'string' && displayPark.change.toLowerCase().includes('park added')) {
                                displayPark.change = 'Park added';
                            }
                        }
                    } catch (_) {
                    }

                    let popupContent = await fetchFullPopupContent(displayPark, currentActivation, parkActivations);
                    this.setPopupContent(popupContent);
                } catch (err) {
                    this.setPopupContent("<b>Error loading park info.</b>");
                    console.error(err);
                }
            });
        });
    } catch (e) {
        console.error("redrawMarkersWithFilters failed:", e);
    }
}

function refreshMarkers() {
    if (!map) return;
    // Avoid redraws while a popup is open (prevents immediate close after auto-pan)
    if (typeof isPopupOpen !== 'undefined' && isPopupOpen) { return; }
    if (MODE_CHANGES_AVAILABLE && typeof updateVisibleModeCounts === 'function') {
        updateVisibleModeCounts();
    }
    if (typeof redrawMarkersWithFilters === 'function') {
        if (window.requestAnimationFrame) {
            requestAnimationFrame(() => redrawMarkersWithFilters());
        } else {
            redrawMarkersWithFilters();
        }
    }
}

/* ==== end Filters & Thresholds block ==== */
/**
 * Initializes the hamburger menu.
 */
function initializeMenu() {
    const menu = document.createElement('div');
    menu.id = 'hamburgerMenu';
    menu.innerHTML = `
        <div id="menuToggle">
            <input type="checkbox" id="menuCheckbox" />
            <label for="menuCheckbox" aria-label="Toggle Menu">
                <span></span>
                <span></span>
                <span></span>
            </label>
            <ul id="menu">
                <li>
                    <button id="uploadActivations" title="Download your activations from your POTA.app Stats page, upper right corner, then upload it here.">Upload Activations File</button>
                    <input type="file" id="fileUpload" accept=".csv, text/csv" style="display:none;" />
                </li>
                <li>
                    <button id="toggleActivations" class="toggle-button">Show My Activations</button>
                </li>
                <li id="searchBoxContainer">
                    <!-- <label for="searchBox">Search Parks:</label> -->
                    <input type="text" id="searchBox" placeholder="Search name, ID, location..." />
                    <br/>
                    <button id="clearSearch" title="Clear Search" aria-label="Clear Search">Clear Search</button>
                </li>
                <li>
                    <button id="centerOnGeolocation" title="Center the map based on your current location.">Center on My Location</button>
                </li>

                <li>
                <button id="potaNewsButton" onclick="window.open('https://pota.review', '_blank')">Visit POTA News & Review</button>
            </li>
                <li>
                <button id="mapHelpButton" onclick="window.open('https://pota.review/howto/how-to-use-the-potamap/', '_blank')">How to Use this Map</button>
            </li>
            <!-- Removing slider functionality for now, it doesn't seem useful (also listener))
<div id="activationSliderContainer">
    <label for="activationSlider">Maximum Activations to Display:</label>
    <input
        type="range"
        id="activationSlider"
        min="0"
        max="100"
        value="10"
        data-value="10"
    />
</div>
-->
<li id="callsignDisplay" style="
    text-align: center;
    font-weight: bold;
    padding: 0.5em;
    font-size: 0.75em;
    background: #f0f0f0;
    margin-top: 0.5em;
">
    Callsign: <span id="callsignText">please set</span>
</li>

<li>
    <div id="versionInfo" style="font-size: 0.75em; color: #888; margin-top: 1em;"></div>
</li>

<li>
<div id="versionInfo" style="font-size: 0.75em; color: #888; margin-top: 1em;"></div>
</li>
            </ul>
        </div>
    `;
    document.body.appendChild(menu);

    // Add event listeners for the menu options
    document.getElementById('uploadActivations').addEventListener('click', () => {
        document.getElementById('fileUpload').click();
    });
    document.getElementById('fileUpload').addEventListener('change', handleFileUpload);

    // Add event listeners for the search box
    document.getElementById('searchBox').addEventListener('input', debounce(handleSearchInput, 300));
    document.getElementById('clearSearch').addEventListener('click', clearSearchInput);

    // Add event listener for 'Enter' key in the search box
    document.getElementById('searchBox').addEventListener('keydown', handleSearchEnter);

    //Removing slider functionality for now, it doesn't seem useful
    // Add event listener for the activation slider
    //document.getElementById('activationSlider').addEventListener('input', handleSliderChange);
    // document.getElementById('activationSlider').addEventListener('input', (event) => {
    //     const slider = event.target;
    //     const sliderValue = slider.value === "51" ? "All" : slider.value;
    //     slider.setAttribute('data-value', sliderValue);
    // });
    //Listener for Activations button
    document.getElementById('toggleActivations').addEventListener('click', toggleActivations);
    try {
        refreshMarkers({full: true});
    } catch (e) {
    }

    document.getElementById('centerOnGeolocation').addEventListener('click', centerMapOnGeolocation);

    buildFiltersPanel();
    buildModeFilterPanel();
    initializeFilterChips && initializeFilterChips();
    console.log("Hamburger menu initialized."); // Debugging

    // Add enhanced hamburger menu styles for mobile
    enhanceHamburgerMenuForMobile();

    displayVersionInfo();

}

async function displayVersionInfo() {
    let appDate = "unknown";
    let parksDate = "unknown";
    let changesDate = "unknown";

    // Get last-modified date of scripts.js
    try {
        const response = await fetch("/potamap/scripts.js", {method: 'HEAD'});
        const header = response.headers.get("last-modified");
        if (header) {
            appDate = formatAsYYYYMMDD(new Date(header));
        }
    } catch (e) {
        console.warn("Could not fetch scripts.js HEAD:", e);
    }

    // Get locally stored fetch timestamp for allparks.json
    try {
        const timestamp = await getLastFetchTimestamp('allparks.json');
        if (timestamp) {
            parksDate = formatAsYYYYMMDD(new Date(timestamp));
        }
    } catch (e) {
        console.warn("Could not get timestamp for allparks.json:", e);
    }

    // Get last-modified header for changes.json
    try {
        const changesResponse = await fetch("/potamap/data/changes.json", {method: 'HEAD'});
        const changesHeader = changesResponse.headers.get("last-modified");
        if (changesHeader) {
            changesDate = formatAsYYYYMMDD(new Date(changesHeader));
        }
    } catch (e) {
        console.warn("Could not fetch changes.json HEAD:", e);
    }

    const versionString = `<center>App-${appDate}<br/>Parks-${parksDate}<br/>Delta-${changesDate}</center>`;
    document.getElementById("versionInfo").innerHTML = versionString;
}

function formatAsYYYYMMDD(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}${m}${d}`;
}

function enhancePOTAMenuStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        #hamburgerMenu {
    position: absolute;
    top: 10px;
    right: 10px; /* Keep it positioned to the right */
    z-index: 1000;
    width: auto; /* Allow the width to adapt to the content */
    max-width: 350px; /* Set a reasonable maximum width */
    min-width: 250px; /* Prevent it from being too narrow */
    box-sizing: border-box; /* Include padding and border in width calculations */
    /* background-color: #ffffff;  Add a background color for visibility */
    border-radius: 8px; /* Slightly rounded corners for aesthetics */
    /* box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);  Add a subtle shadow */
    padding: 10px; /* Add padding to give the content breathing room */
}

#menu {
    display: none;
    list-style: none;
    margin: 0;
    padding: 0;
    position: absolute;
    right: 0; /* Ensure alignment with the right edge */
    width: 200px; /* Adjust width as needed */
    max-width: 100%; /* Prevent it from overflowing */
    box-sizing: border-box;
    background-color: #ffffff;
    border: 1px solid #ccc; /* Add a border for clarity */
    border-radius: 8px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
}

#menuToggle {
    display: flex;
    flex-direction: column;
    align-items: flex-end; /* Align toggle to the right */
    cursor: pointer;
    user-select: none;
}

#menuToggle input[type="checkbox"]:checked ~ #menu {
    display: block; /* Show the menu when the checkbox is checked */
}

#menuToggle label span {
    background: #333;
    height: 3px;
    margin: 4px 0;
    width: 25px;
    transition: all 0.3s ease;
    display: block;
}

        /* Hide the checkbox */
        #menuToggle input[type="checkbox"] {
            display: none;
        }

        /* Hamburger Lines */
        #menuToggle label span {
            background: #336633; /* Forest green */
            height: 4px;
            margin: 4px 0;
            width: 30px;
            transition: all 0.3s ease;
            display: block;
        }

        /* Menu Styling */
        #menu {
            display: none;
            list-style: none;
            padding: 10px;
            background: #f8f8f2; /* Light parchment */
            border: 2px solid #336633; /* Forest green border */
            position: absolute;
            top: 35px;
            left: 0;
            width: 260px;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
            border-radius: 8px;
        }

        #menuToggle input[type="checkbox"]:checked ~ #menu {
            display: block;
        }

        /* Animate Hamburger to "X" */
        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(1) {
            transform: translateY(8px) rotate(45deg);
        }

        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(2) {
            opacity: 0;
        }

        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(3) {
            transform: translateY(-8px) rotate(-45deg);
        }

        /* Menu Items */
        #menu li {
            margin: 10px 0;
        }

        /* Buttons */
        button {
            cursor: pointer;
            background: #336633; /* Forest green */
            color: #fff;
            border: none;
            padding: 10px;
            font-size: 16px;
            width: 100%;
            border-radius: 6px;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        button:hover {
            background: #264d26; /* Darker green */
            transform: translateY(-2px);
        }

/* Container for Slider */
.sliderWrapper {
    position: relative;
    width: 100%;
}
/* Style the slider container to position relative for proper placement */
#activationSliderContainer {
    position: relative;
    margin-bottom: 20px; /* Adjust spacing as needed */
}

/* Style for the slider */
#activationSlider {
    -webkit-appearance: none;
    width: 100%;
    height: 8px;
    border-radius: 4px;
    background: #d3d3d3;
    outline: none;
    transition: background 0.3s ease;
}

#activationSlider::before {
    content: attr(data-value); /* Display the slider value */
    position: absolute;
    top: 30px; /* Adjust to place below the slider */
    left: 50%; /* Center horizontally */
    transform: translateX(-50%); /* Adjust for tooltip alignment */
    font-size: 14px;
    color: #333;
    background: #fff;
    padding: 5px;
    border: 1px solid #ccc;
    border-radius: 4px;
    white-space: nowrap;
    z-index: 9999;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}


/* Adjust the position dynamically for better centering */
#activationSlider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #007BFF;
    cursor: pointer;
    transition: background 0.3s ease, transform 0.2s ease;
}

#activationSlider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #007BFF;
    cursor: pointer;
    transition: background 0.3s ease, transform 0.2s ease;
}

#sliderTooltip {
    position: absolute;
    background: #336633;
    color: #fff;
    font-size: 12px;
    font-weight: bold;
    padding: 4px 8px;
    border-radius: 4px;
    transform: translate(-50%, -150%);
    white-space: nowrap;
    z-index: 9999; /* Ensure it's above other elements */
    display: none; /* Hidden until interaction */
}


#sliderTooltip::after {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    transform: translateX(-50%);
    border-width: 6px;
    border-style: solid;
    border-color: #336633 transparent transparent transparent;
}

        /* Responsive Adjustments */
        @media (max-width: 600px) {
            #menu {
                width: 200px;
            }

            button {
                font-size: 14px;
                padding: 8px;
            }
        }
    `;
    document.head.appendChild(style);
    console.log("Enhanced POTA menu styles applied.");
}

document.addEventListener('DOMContentLoaded', () => {
    enhancePOTAMenuStyles();
});

/**
 * Enhances the hamburger menu's responsiveness, touch-friendliness, and styles the activation slider.
 */
function enhanceHamburgerMenuForMobile() {
    const style = document.createElement('style');
    style.innerHTML = `
       @media (max-width: 600px) {
    #hamburgerMenu {
        top: 5px;
        right: 5px;
        max-width: 200px; /* Reduce the width slightly on small screens */
    }

    #menu {
        width: 150px;
    }
}

        /* Menu Toggle */
        #menuToggle {
            display: flex;
            flex-direction: column;
            cursor: pointer;
            user-select: none;
        }

        /* Hide the checkbox */
        #menuToggle input[type="checkbox"] {
            display: none;
        }

        /* Hamburger Lines within Label */
        #menuToggle label span {
            background: #333;
            height: 3px;
            margin: 5px 0;
            width: 25px;
            transition: all 0.3s ease;
            display: block;
        }

        /* Menu Styling */
        #menu {
            display: none;
            list-style: none;
            padding: 10px;
            background: #fff;
            border: 1px solid #ccc;
            position: absolute;
            top: 35px;
            right: 0; /* Positioned to the right */
            width: 220px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            border-radius: 8px;
        }

        /* Show Menu When Checkbox is Checked */
        #menuToggle input[type="checkbox"]:checked ~ #menu {
            display: block;
        }

        /* Animate Hamburger to 'X' When Menu is Open */
        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(1) {
            transform: translateY(8px) rotate(45deg);
        }

        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(2) {
            opacity: 0;
        }

        #menuToggle input[type="checkbox"]:checked ~ label span:nth-child(3) {
            transform: translateY(-8px) rotate(-45deg);
        }

        /* Style Menu Items */
        #menu li {
            margin: 15px 0;
        }

        /* Upload Activations Button */
        #uploadActivations {
            cursor: pointer;
            background: #007BFF;
            color: #fff;
            border: none;
            padding: 12px;
            font-size: 16px;
            width: 100%;
            border-radius: 6px;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #uploadActivations:hover {
            background: #0056b3;
            transform: translateY(-2px);
        }

        /* Toggle Activations Button */
        .toggle-button {
            cursor: pointer;
            background: #6c757d;
            color: #fff;
            border: none;
            padding: 12px;
            font-size: 16px;
            width: 100%;
            border-radius: 6px;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        .toggle-button.active {
            background: #28a745;
        }

        .toggle-button:hover {
            background: #5a6268;
            transform: translateY(-2px);
        }

        /* Slider Container */
        #activationSliderContainer {
            margin-top: 20px;
        }

        /* Slider Label */
        #activationSliderContainer label {
            display: block;
            font-size: 16px;
            margin-bottom: 8px;
            color: #333;
        }

        /* Slider Value Display */
        #sliderValue {
            font-weight: bold;
            margin-left: 8px;
            color: #007BFF;
        }

        /* Slider Styling */
        #activationSlider {
            -webkit-appearance: none;
            width: 100%;
            height: 8px;
            border-radius: 4px;
            background: #d3d3d3;
            outline: none;
            transition: background 0.3s ease;
        }

        #activationSlider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #activationSlider::-webkit-slider-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #activationSlider::-moz-range-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-ms-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
        }

        #activationSlider::-ms-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        /* Responsive Styles for Mobile Devices */
        @media (max-width: 600px) {
            /* Adjust hamburger menu size and positioning */
            #hamburgerMenu {
                top: 5px;
                right: 5px;
            }

            #menuToggle label span {
                width: 20px;
                height: 2px;
                margin: 4px 0;
            }

            /* Adjust menu width */
            #menu {
                width: 180px;
                padding: 10px;
            }

            /* Increase font sizes for better readability */
            #menu button,
            #menu label {
                font-size: 18px;
            }

            /* Increase button sizes for touch */
            button,
            input[type="file"] {
                padding: 10px;
                font-size: 16px;
            }

            /* Adjust map container height */
            #map {
                height: 100vh; /* Full viewport height */
            }
            
            #centerOnGeolocation {
    cursor: pointer;
    background: #336633; /* Forest green */
    color: #fff;
    border: none;
    padding: 10px;
    font-size: 16px;
    width: 100%;
    border-radius: 6px;
    transition: background 0.3s ease, transform 0.2s ease;
}

#centerOnGeolocation:hover {
    background: #264d26; /* Darker green */
    transform: translateY(-2px);
}


            /* Style Callsign Display */
            #callsignDisplay {
                position: absolute;
                top: 10px;
                left: 10px;
                background: rgba(255, 255, 255, 0.8);
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 16px;
                z-index: 1001;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
        }
/* Container for the search box and clear button */
#searchBoxContainer {
    position: relative;
    width: 100%; /* Constrain to parent width */
    box-sizing: border-box;
    margin-bottom: 10px;
    z-index: 10;
}

#searchBox {
    width: 100%;
    padding: 10px;
    font-size: 16px;
    border: 1px solid #ccc;
    border-radius: 4px;
    outline: none;
    box-sizing: border-box; /* Include padding in width */
    margin-bottom: 10px; /* Add spacing between input and button */
}

#clearSearch {
    display: block; /* Make it behave as a block element */
    width: 100%; /* Full width for alignment */
    padding: 10px;
    font-size: 16px; /* Adjust font size */
    color: #fff; /* Text color */
    background-color: #336633; /* Forest green background */
    border: none; /* Remove border */
    border-radius: 4px; /* Round edges */
    cursor: pointer;
    text-align: center; /* Center-align text */
    transition: background-color 0.3s ease, transform 0.2s ease; /* Add hover/active effects */
}

#clearSearch:hover {
    background-color: #264d26; /* Darker green background on hover */
    transform: scale(1.02); /* Slightly enlarge on hover */
}

#clearSearch:active {
    transform: scale(0.98); /* Slightly shrink when clicked */
}

/* Make the search box and button responsive */
@media (max-width: 600px) {
    #searchBox {
        font-size: 14px;
    }

    #clearSearch {
        font-size: 16px;
        height: 36px;
        width: 36px;
    }
}

#clearSearch:active {
    transform: translateY(-50%) scale(1.2);
}

/* Icon Styling */
#clearSearch i {
    pointer-events: none; /* Prevent icon from blocking button clicks */
    color: inherit;
}

/* Responsive Styles for Search Box */
@media (max-width: 600px) {
    #searchBoxContainer label {
        font-size: 18px;
    }
}

@media (min-width: 601px) and (max-width: 1024px) {
    #searchBoxContainer label {
        font-size: 16px;
    }

    #searchBox {
        font-size: 16px;
    }

    #clearSearch {
        font-size: 18px;
    }
}

        @media (min-width: 601px) and (max-width: 1024px) {
            /* Tablet-specific styles */
            #hamburgerMenu {
                top: 10px;
                right: 10px;
            }

            #menuToggle label span {
                width: 25px;
                height: 3px;
                margin: 5px 0;
            }

            /* Adjust menu width */
            #menu {
                width: 200px;
                padding: 12px;
            }

            /* Increase font sizes moderately */
            #menu button,
            #menu label {
                font-size: 16px;
            }

            /* Adjust map container height */
            #map {
                height: 90vh; /* Slightly less than viewport height */
            }

            /* Increase button sizes */
            button,
            input[type="file"] {
                padding: 8px;
                font-size: 14px;
            }

            /* Style Callsign Display */
            #callsignDisplay {
                position: absolute;
                top: 10px;
                left: 10px;
                background: rgba(255, 255, 255, 0.8);
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 14px;
                z-index: 1001;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
        }

        /* General Responsive Enhancements */
        body, html {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
        }

        #map {
            width: 100%;
            height: 90vh; /* Adjust height as needed */
        }

        /* Adjust Leaflet Controls for Mobile */
        .leaflet-control-attribution {
            font-size: 12px;
        }

        .leaflet-control {
            font-size: 16px; /* Increase control sizes */
        }

        /* Popup Content Adjustments */
        .leaflet-popup-content {
            font-size: 14px;
        }

        /* Tooltip Adjustments */
        .custom-tooltip {
            font-size: 14px;
            padding: 5px;
        }

        /* Ensure buttons and inputs have adequate size and spacing */
        button, label, input[type="file"] {
            min-height: 40px;
            padding: 10px;
            font-size: 16px;
        }
    `;
    document.head.appendChild(style);
    console.log("Responsive styles with enhanced slider added."); // Debugging

    // Add styles for the activation slider
    const sliderStyle = document.createElement('style');
    sliderStyle.innerHTML = `
        /* Slider Container */
        #activationSliderContainer {
            margin-top: 20px;
        }

        /* Slider Label */
        #activationSliderContainer label {
            display: block;
            font-size: 16px;
            margin-bottom: 8px;
            color: #333;
        }

        /* Slider Value Display */
        #sliderValue {
            font-weight: bold;
            margin-left: 8px;
            color: #007BFF;
        }

        /* Slider Styling */
        #activationSlider {
            -webkit-appearance: none;
            width: 100%;
            height: 8px;
            border-radius: 4px;
            background: #d3d3d3;
            outline: none;
            transition: background 0.3s ease;
        }

        #activationSlider:hover {
            background: #c0c0c0;
        }

        #activationSlider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
            box-shadow: 0 0 2px rgba(0,0,0,0.5);
        }

        #activationSlider::-webkit-slider-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-moz-range-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
            box-shadow: 0 0 2px rgba(0,0,0,0.5);
        }

        #activationSlider::-moz-range-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        #activationSlider::-ms-thumb {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #007BFF;
            cursor: pointer;
            transition: background 0.3s ease, transform 0.2s ease;
            box-shadow: 0 0 2px rgba(0,0,0,0.5);
        }

        #activationSlider::-ms-thumb:hover {
            background: #0056b3;
            transform: scale(1.1);
        }

        /* Track Styling */
        #activationSlider::-webkit-slider-runnable-track {
            height: 8px;
            border-radius: 4px;
            background: #ff6666;
        }

        #activationSlider::-moz-range-track {
            height: 8px;
            border-radius: 4px;
            background: #ff6666;
        }

        #activationSlider::-ms-track {
            height: 8px;
            border-radius: 4px;
            background: #ff6666;
            border: none;
            color: transparent;
        }

        /* Active Range Styling */
        #activationSlider::-webkit-slider-thumb:active {
            transform: scale(1.2);
        }

        #activationSlider::-moz-range-thumb:active {
            transform: scale(1.2);
        }

        #activationSlider::-ms-thumb:active {
            transform: scale(1.2);
        }
    `;
    document.head.appendChild(sliderStyle);
    console.log("Activation slider custom styles added."); // Debugging
}

/**
 * Initializes and returns the IndexedDB database.
 * @returns {Promise<IDBDatabase>} The IndexedDB database instance.
 */
async function getDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('potaDatabase', 3); // Incremented version to add 'parkActivations' store

        request.onupgradeneeded = function (event) {
            const db = event.target.result;

            // Create object store for activations if it doesn't exist
            if (!db.objectStoreNames.contains('activations')) {
                db.createObjectStore('activations', {keyPath: 'reference'});
            }

            // Create object store for parks if it doesn't exist
            if (!db.objectStoreNames.contains('parks')) {
                db.createObjectStore('parks', {keyPath: 'reference'});
            }

            // Create object store for park activations if it doesn't exist
            if (!db.objectStoreNames.contains('parkActivations')) {
                db.createObjectStore('parkActivations', {keyPath: 'reference'});
            }
        };

        request.onsuccess = function (event) {
            resolve(event.target.result);
        };

        request.onerror = function (event) {
            console.error('Error opening IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/** Upsert arbitrary fields for a park in IndexedDB.parks (by reference). */
async function upsertParkFieldsInIndexedDB(reference, patch) {
    const db = await getDatabase();
    const tx = db.transaction('parks', 'readwrite');
    const store = tx.objectStore('parks');
    return new Promise((resolve, reject) => {
        const getReq = store.get(reference);
        getReq.onsuccess = () => {
            const current = getReq.result || {reference};
            const updated = Object.assign({}, current, patch);
            const putReq = store.put(updated);
            putReq.onsuccess = () => resolve(updated);
            putReq.onerror = (e) => reject(e.target.error);
        };
        getReq.onerror = (e) => reject(e.target.error);
    });
}

/** Convenience: upsert just the review URL for a park. */
async function upsertParkReviewURL(reference, reviewURL) {
    if (!reference || !reviewURL) return null;
    return upsertParkFieldsInIndexedDB(reference, {reviewURL});
}

// Incrementally fetch PN&R review URLs and persist into IndexedDB + memory cache
async function fetchAndApplyReviewUrls() {
    // Allow override via window.REVIEWS_URLS; otherwise try sensible defaults
    const candidates = Array.isArray(window.REVIEWS_URLS) && window.REVIEWS_URLS.length
        ? window.REVIEWS_URLS
        : [
            '/potamap/data/park-review-urls.json',       // preferred JSON
            '/potamap/data/review_urls.json',   // alternate name
            '/potamap/data/reviews.ndjson',     // NDJSON fallback
        ];

    const SIG_KEY = (u) => `reviewsSig::${u}`; // localStorage signature per URL

    // Parse helpers: accept array of objects, object map, or NDJSON text
    const normalizeMap = (payload) => {
        const out = new Map(); // reference -> reviewURL
        const push = (ref, url) => {
            if (!ref || !url) return;
            const r = String(ref).trim().toUpperCase();
            const u = String(url).trim();
            if (!/^https?:\/\//i.test(u)) return; // only http(s)
            out.set(r, u);
        };
        if (!payload) return out;
        if (Array.isArray(payload)) {
            for (const row of payload) {
                if (!row || typeof row !== 'object') continue;
                push(row.reference || row.ref || row.id, row.reviewURL || row.url);
            }
            return out;
        }
        if (typeof payload === 'object') {
            // Mapping object: { "US-0001": "https://...", ... } or { items:[...] }
            if (Array.isArray(payload.items)) {
                for (const row of payload.items) {
                    if (!row || typeof row !== 'object') continue;
                    push(row.reference || row.ref || row.id, row.reviewURL || row.url);
                }
                return out;
            }
            for (const [k, v] of Object.entries(payload)) {
                if (v && typeof v === 'string') push(k, v);
                else if (v && typeof v === 'object') push(v.reference || k, v.reviewURL || v.url);
            }
            return out;
        }
        return out;
    };

    const tryFetch = async (baseUrl) => {
        let etag = null, lastMod = null, signature = null, prevSig = null;
        try {
            const head = await fetch(baseUrl, { method: 'HEAD', cache: 'no-store' });
            if (head.ok) {
                etag = head.headers.get('etag');
                lastMod = head.headers.get('last-modified');
                signature = etag || lastMod || 'no-sig';
                try { prevSig = localStorage.getItem(SIG_KEY(baseUrl)); } catch { /* ignore */ }
                // If unchanged and we already have a cache in memory or IDB, skip
                if (prevSig && signature && prevSig === signature && (window.__REVIEW_URLS instanceof Map) && window.__REVIEW_URLS.size > 0) {
                    return { changed: false, map: window.__REVIEW_URLS };
                }
            }
        } catch { /* some CDNs block HEAD; proceed to GET */ }

        // Cache-bust GET
        const v = encodeURIComponent((etag || lastMod || Date.now()).toString());
        const url = baseUrl + (baseUrl.includes('?') ? `&v=${v}` : `?v=${v}`);

        // Try JSON first
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return null;
            const contentType = (res.headers.get('content-type') || '').toLowerCase();
            let data = null;
            if (contentType.includes('application/json') || contentType.includes('+json')) {
                data = await res.json();
            } else {
                // Maybe NDJSON or text mapping
                const txt = await res.text();
                try {
                    // Try parse as JSON anyway
                    data = JSON.parse(txt);
                } catch {
                    // Parse NDJSON lines: each line is a JSON object
                    const m = new Map();
                    txt.split(/\r?\n/).forEach(line => {
                        if (!line.trim()) return;
                        try {
                            const obj = JSON.parse(line);
                            const ref = obj.reference || obj.ref || obj.id;
                            const url = obj.reviewURL || obj.url;
                            if (ref && url) m.set(String(ref).toUpperCase(), String(url));
                        } catch { /* ignore bad line */ }
                    });
                    data = { items: Array.from(m, ([reference, url]) => ({ reference, reviewURL: url })) };
                }
            }
            const map = normalizeMap(data);
            if (map.size === 0) return null; // useless

            // Persist into IndexedDB.parks and memory
            const db = await getDatabase();
            // Load all existing parks once
            const parksAll = await new Promise((resolve, reject) => {
                const tx = db.transaction('parks', 'readonly');
                const store = tx.objectStore('parks');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror  = (e) => reject(e.target.error);
            });

            let updates = 0;
            await new Promise((resolve, reject) => {
                const tx = db.transaction('parks', 'readwrite');
                const store = tx.objectStore('parks');
                for (const p of parksAll) {
                    if (!p || !p.reference) continue;
                    const url = map.get(p.reference.toUpperCase());
                    if (!url) continue;
                    if (p.reviewURL === url) continue;
                    p.reviewURL = url;
                    store.put(p);
                    updates++;
                }
                tx.oncomplete = () => resolve();
                tx.onerror    = (e) => reject(e.target.error);
            });

            // Also update in-memory fast cache for immediate rendering
            window.__REVIEW_URLS = map;
            try { localStorage.setItem(SIG_KEY(baseUrl), (signature || v)); } catch { /* ignore */ }

            if (updates > 0) console.log(`[reviews] Applied ${updates} review URL updates from ${baseUrl}.`);
            return { changed: updates > 0, map };
        } catch (e) {
            console.warn('[reviews] fetch failed for', baseUrl, e);
            return null;
        }
    };

    for (const baseUrl of candidates) {
        const res = await tryFetch(baseUrl);
        if (res) return res.changed; // true/false depending on updates
    }
    return false; // nothing fetched
}




/**
 * Retrieves all activations from IndexedDB.
 * @returns {Promise<Array>} Array of activation objects.
 */
async function getActivationsFromIndexedDB() {
    const db = await getDatabase();
    const transaction = db.transaction('activations', 'readonly');
    const store = transaction.objectStore('activations');
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
            console.log("Retrieved Activations from IndexedDB:", request.result); // Debugging
            resolve(request.result);
        };
        request.onerror = () => {
            console.error("Error retrieving activations from IndexedDB:", request.error); // Debugging
            reject('Error retrieving activations from IndexedDB');
        };
    });
}

/**
 * Saves an array of activations to IndexedDB.
 * @param {Array} activations - Array of activation objects to save.
 * @returns {Promise<void>}
 */
async function saveActivationsToIndexedDB(activations) {
    const db = await getDatabase();
    const transaction = db.transaction('activations', 'readwrite');
    const store = transaction.objectStore('activations');

    // Clear existing activations to prevent duplicates
    store.clear();

    return new Promise((resolve, reject) => {
        activations.forEach(act => {
            store.put(act);
        });

        transaction.oncomplete = () => {
            console.log('Activations saved successfully to IndexedDB.');
            resolve();
        };

        transaction.onerror = (event) => {
            console.error('Error saving activations to IndexedDB:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Deletes an activation from IndexedDB.
 * @param {string} reference - The reference of the activation to delete.
 * @returns {Promise<void>}
 */
async function deleteActivationFromIndexedDB(reference) {
    const db = await getDatabase();
    const transaction = db.transaction('activations', 'readwrite');
    const store = transaction.objectStore('activations');

    return new Promise((resolve, reject) => {
        const request = store.delete(reference);
        request.onsuccess = () => {
            console.log(`Activation ${reference} deleted successfully.`);
            resolve();
        };
        request.onerror = () => {
            console.error(`Error deleting activation ${reference} from IndexedDB.`);
            reject('Error deleting activation.');
        };
    });
}

/**
 * Retrieves activations for a specific park from IndexedDB.
 * @param {string} reference - The park reference code.
 * @returns {Promise<Array>} Array of activation objects.
 */
async function getParkActivationsFromIndexedDB(reference) {
    const db = await getDatabase();
    const transaction = db.transaction('parkActivations', 'readonly');
    const store = transaction.objectStore('parkActivations');
    return new Promise((resolve, reject) => {
        const request = store.get(reference);
        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result.activations);
            } else {
                resolve(null);
            }
        };
        request.onerror = () => {
            console.error(`Error retrieving park activations for ${reference} from IndexedDB:`, request.error);
            reject('Error retrieving park activations from IndexedDB');
        };
    });
}

/**
 * Saves activations for a specific park to IndexedDB.
 * @param {string} reference - The park reference code.
 * @param {Array} activations - Array of activation objects to save.
 * @returns {Promise<void>}
 */
async function saveParkActivationsToIndexedDB(reference, activations) {
    const db = await getDatabase();
    const transaction = db.transaction('parkActivations', 'readwrite');
    const store = transaction.objectStore('parkActivations');
    return new Promise((resolve, reject) => {
        const data = {reference, activations};
        const request = store.put(data);
        request.onsuccess = () => {
            console.log(`Park activations for ${reference} saved successfully to IndexedDB.`);
            resolve();
        };
        request.onerror = (event) => {
            console.error(`Error saving park activations for ${reference} to IndexedDB:`, event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Fetches *all* activations for a specific park from the POTA API,
 * with *no* caching in IndexedDB.
 * @param {string} reference - The park reference code (e.g. "K-1234").
 * @returns {Promise<Array>} Array of activation objects from the API.
 */
async function fetchParkActivations(reference) {
    // Always fetch from the POTA API, no cache check
    const url = `https://api.pota.app/park/activations/${reference}?count=all`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch activations for park ${reference}: ${response.statusText}`);
        }
        const data = await response.json();
        console.log(`Fetched ${data.length} activations for park ${reference} from API.`);

        // Return the fresh data
        return data;
    } catch (error) {
        console.error(error);
        // Return empty array if fetch fails
        return [];
    }
}


/**
 * Formats a QSO date string into a human‑readable date.
 * If the date contains a dash, it is assumed to be in ISO format.
 * Otherwise, it is assumed to be in YYYYMMDD format.
 *
 * @param {string} qsoDate - The QSO date string.
 * @returns {string} The formatted date.
 */
function formatQsoDate(qsoDate) {
    let date;
    if (qsoDate.includes("-")) {
        // Date is already in ISO format (e.g., "2025-01-10")
        date = new Date(qsoDate);
    } else {
        // Date is in YYYYMMDD format (e.g., "20250110")
        const year = qsoDate.substring(0, 4);
        const month = qsoDate.substring(4, 6);
        const day = qsoDate.substring(6, 8);
        date = new Date(`${year}-${month}-${day}`);
    }
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Retrieves all parks from IndexedDB.
 * @returns {Promise<Array>} Array of park objects.
 */
async function getParksFromIndexedDB() {
    const db = await getDatabase();
    const transaction = db.transaction('parks', 'readonly');
    const store = transaction.objectStore('parks');
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject('Error retrieving parks from IndexedDB');
    });
}

/**
 * Saves an array of parks to IndexedDB.
 * @param {Array} parks - Array of park objects to save.
 * @returns {Promise<void>}
 */
// async function saveParksToIndexedDB(parks) {
//     const db = await getDatabase();
//     const transaction = db.transaction('parks', 'readwrite');
//     const store = transaction.objectStore('parks');
//
//     // Clear existing parks to prevent duplicates
//    // store.clear();
//
//     return new Promise((resolve, reject) => {
//         parks.forEach(park => {
//             store.put(park);
//         });
//
//         transaction.oncomplete = () => {
//             console.log('Parks saved successfully to IndexedDB.');
//             resolve();
//         };
//
//         transaction.onerror = (event) => {
//             console.error('Error saving parks to IndexedDB:', event.target.error);
//             reject(event.target.error);
//         };
//     });
// }

/**
 * Parses CSV text into an array of objects using PapaParse.
 * @param {string} csvText - The CSV data as a string.
 * @returns {Array<Object>} Parsed CSV data.
 * @throws {Error} If parsing fails.
 */
function parseCSV(csvText) {
    if (typeof Papa === 'undefined') {
        throw new Error('PapaParse library is not loaded. Please include it before using parseCSV.');
    }

    const parsedResult = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true
    });

    if (parsedResult.errors.length > 0) {
        console.error('Errors parsing CSV:', parsedResult.errors);
        throw new Error('Error parsing CSV data.');
    }

    return parsedResult.data;
}


/**
 * Creates a debounced version of the provided function.
 * @param {Function} func - The function to debounce.
 * @param {number} wait - The delay in milliseconds.
 * @returns {Function} The debounced function.
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function toggleActivations() {
    const toggleButton = document.getElementById('toggleActivations');

    // Cycle through states: 0 -> 1 -> 2 -> 3 -> back to 0
    activationToggleState = (activationToggleState + 1) % 4;
// 🧠 Persist it
    localStorage.setItem('activationToggleState', activationToggleState);
    // Update button text for clarity
    const buttonTexts = [
        "Show My Activations",
        "Hide My Activations",
        "Show Currently On Air",
        "Show All Spots",
    ];
    toggleButton.innerText = buttonTexts[activationToggleState];
    console.log(`Toggled activation state: ${activationToggleState}`);

    // Clear activationsLayer before updating map
    if (map.activationsLayer) {
        if (!window.__nonDestructiveRedraw) {
            map.activationsLayer.clearLayers();
        }
    } else {
        map.activationsLayer = L.layerGroup().addTo(map);
    }

    const userActivatedReferences = activations.map((act) => act.reference);

    switch (activationToggleState) {
        case 0: // Show all spots
            displayParksOnMap(map, parks, userActivatedReferences, map.activationsLayer);
            break;

        case 1: // Show just user's activations
            const userActivatedParks = parks.filter((park) =>
                userActivatedReferences.includes(park.reference)
            );
            displayParksOnMap(map, userActivatedParks, userActivatedReferences, map.activationsLayer);
            break;

        case 2: // Show all spots except user's activations
            const nonUserActivatedParks = parks.filter((park) =>
                !userActivatedReferences.includes(park.reference)
            );
            displayParksOnMap(map, nonUserActivatedParks, [], map.activationsLayer);
            break;

        case 3: // Show only currently active parks (on air)
            const onAirReferences = spots.map((spot) => spot.reference);
            const onAirParks = parks.filter((park) =>
                onAirReferences.includes(park.reference)
            );
            displayParksOnMap(map, onAirParks, userActivatedReferences, map.activationsLayer);
            break;

        default:
            console.error("Invalid activation state.");
            break;
    }
}

/**
 * Handles updating activations via API and stores them in IndexedDB.
 * (Removed as per user request)
 */

/**
 * Handles file upload and appends activations to IndexedDB.
 */
async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            // Parse the CSV file using PapaParse
            const parsedData = parseCSV(e.target.result);
            let newActivations = parsedData;

            console.log("Uploaded Activations from CSV:", newActivations); // Debugging

            // Retrieve existing activations from IndexedDB
            const storedActivations = await getActivationsFromIndexedDB();
            console.log("Stored Activations Before Upload:", storedActivations); // Debugging

            // Create a map for quick lookup to avoid duplicates based on 'reference'
            const activationMap = new Map();
            storedActivations.forEach(act => activationMap.set(act.reference, act));

            // Initialize counters for user feedback
            let appendedCount = 0;
            let duplicateCount = 0;
            let invalidCount = 0;

            // Append new activations, avoiding duplicates and validating entries
            newActivations.forEach(act => {
                // Basic validation: Check for required fields
                if (act.Reference && act["Park Name"] && act["First QSO Date"] && act.QSOs) {
                    const reference = act.Reference.trim();
                    const name = act["Park Name"].trim();
                    const qso_date = act["First QSO Date"].trim();
                    const totalQSOs = parseInt(act.QSOs, 10) || 0;
                    const activationsCount = parseInt(act.Activations, 10) || 0;
                    const attempts = parseInt(act.Attempts, 10) || 0;

                    // Create the activation object
                    const activationObject = {
                        reference: reference,
                        name: name,
                        qso_date: qso_date,
                        activeCallsign: act.activeCallsign ? act.activeCallsign.trim() : "", // Extracted from CSV
                        totalQSOs: totalQSOs,
                        qsosCW: 0, // Assign default value
                        qsosDATA: 0, // Assign default value
                        qsosPHONE: 0, // Assign default value
                        attempts: attempts,
                        activations: activationsCount
                    };

                    if (!activationMap.has(reference)) {
                        activationMap.set(reference, activationObject);
                        appendedCount++;
                        console.log(`Appended new activation: ${reference}`); // Debugging
                    } else {
                        duplicateCount++;
                        console.log(`Duplicate activation ignored: ${reference}`); // Debugging
                    }
                } else {
                    invalidCount++;
                    console.warn(`Invalid activation entry skipped: ${JSON.stringify(act)}`); // Debugging
                }
            });

            // Update the global activations array and IndexedDB
            activations = Array.from(activationMap.values());
            await saveActivationsToIndexedDB(activations);
            console.log("Activations After Upload:", activations); // Debugging

            alert(`Activations appended successfully!\nAppended: ${appendedCount}\nDuplicates: ${duplicateCount}\nInvalid: ${invalidCount}`);

            // Refresh the map to reflect new activations
            updateActivationsInView();

            // If Show My Activations is active, display callsign
            const toggleButton = document.getElementById('toggleActivations');
            if (toggleButton.classList.contains('active')) {
                displayCallsign();
            }
        } catch (err) {
            console.error('Error uploading activations:', err);
            alert('Invalid CSV file or incorrect data format.');
        }
    };
    reader.readAsText(file);
}

/**
 * Maps the slider's linear value (0-100) to the desired non-linear scale.
 * @param {number} value - The linear slider value (0-100).
 * @returns {number|string} The mapped value ('All' for the maximum).
 */
function mapSliderValue(value) {
    if (value <= 33) {
        // Map the first third (0–33) to 0–10
        return Math.round((value / 33) * 10);
    } else if (value <= 66) {
        // Map the middle third (34–66) to 11–50
        return Math.round(11 + ((value - 33) / 33) * 39);
    } else {
        // Map the last third (67–100) to 51–All
        const mappedValue = Math.round(51 + ((value - 66) / 34) * 948); // Maps 67-100 to 51-999
        return mappedValue >= 999 ? 'All' : mappedValue;
    }
}


function fallbackToDefaultLocation() {
    if (!map) return;
    userLat = 39.8283;
    userLng = -98.5795;
    map.setView([userLat, userLng], map.getZoom(), {
        animate: true,
        duration: 1.5,
    });
    console.log("Map centered on default fallback location.");
}

/**
 * Handles input in the search box and dynamically highlights matching parks within the visible map bounds.
 * @param {Event} event - The input event from the search box.
 */
function handleSearchInput(event) {
    const raw = event.target.value || '';
    const trimmed = raw.trim();

    // If this looks like a PQL query, do NOTHING while typing (no filtering, no zoom, no logs).
    if (trimmed.startsWith('?')) {
        return;
    }

    // ===== Legacy (non-PQL) incremental search =====
    const query = normalizeString(raw);
    console.log(`Search query received: "${query}"`);

    if (!map.highlightLayer) map.highlightLayer = L.layerGroup().addTo(map);
    map.highlightLayer.clearLayers();

    if (!query) {
        currentSearchResults = [];
        return;
    }

    const bounds = getCurrentMapBounds();
    const filteredParks = parks.filter(park => {
        if (!(park.latitude && park.longitude)) return false;
        const latLng = L.latLng(park.latitude, park.longitude);
        if (!bounds.contains(latLng)) return false;

        const nameMatch = normalizeString(park.name).includes(query);
        const idMatch = normalizeString(park.reference).includes(query);
        const locMatch = normalizeString(park?.city || park?.state || park?.country || '').includes(query);
        return nameMatch || idMatch || locMatch;
    });

    currentSearchResults = filteredParks;

    filteredParks.forEach((park) => {
        const marker = L.circleMarker([park.latitude, park.longitude], {
            radius: 8,
            fillColor: '#ffff00',
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map.highlightLayer);

        marker.bindTooltip(`${park.name} (${park.reference})`, {
            direction: 'top',
            className: 'custom-tooltip'
        });

        const showPopup = async (e) => {
            if (e) L.DomEvent.stop(e);
            const popupContent = await fetchFullPopupContent(park);
            marker.bindPopup(popupContent, { autoPan: true, autoPanPadding: [20, 20] });
            openPopupWithAutoPan(marker);
        };
        marker.on('click', showPopup);
        marker.on('touchend', showPopup);
    });
}


/**
 * Handles the 'Enter' key press in the search box to zoom to the searched park(s).
 * @param {KeyboardEvent} event - The keyboard event triggered by key presses.
 */
function handleSearchEnter(event) {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent form submission or other default actions
        console.log("'Enter' key pressed in search box."); // Debugging

        // Ensure the search box has a value
        const searchBox = document.getElementById('searchBox');
        if (!searchBox || !searchBox.value.trim()) {
            console.warn("Search box is empty. No action taken."); // Debugging
            return;
        }

        // Search for parks matching the input query
        const query = normalizeString(searchBox.value.trim());
        // If structured query, honor structured results — but default to CURRENT VIEW scope
        if (searchBox.value.trim().startsWith('?')) {
            const parsed = parseStructuredQuery(searchBox.value);
            const bounds = getCurrentMapBounds();

            // Build context used by matchers
            const spotByRef = {};
            const spotByCall = {};
            if (Array.isArray(spots)) {
                for (const s of spots) {
                    if (s && s.reference) {
                        spotByRef[s.reference] = s;
                        const call = (s.activator || s.callsign || '').trim().toUpperCase();
                        if (call) {
                            if (!spotByCall[call]) spotByCall[call] = [];
                            spotByCall[call].push(s);
                        }
                    }
                }
            }
            const userActivatedRefs = (activations || []).map(a => a.reference);
            const now = Date.now();
            const nferByRef = buildNferByRef(parks);
            const ctx = {bounds, spotByRef, spotByCall, userActivatedRefs, now, userLat, userLng, nferByRef};

            // Default scope: only parks inside current bounds
            const scoped = queryHasExplicitScope(parsed);
            const candidates = scoped
                ? parks
                : parks.filter(p => p.latitude && p.longitude && bounds.contains(L.latLng(p.latitude, p.longitude)));

            const matched = candidates.filter(p => parkMatchesStructuredQuery(p, parsed, ctx));
            currentSearchResults = matched;

            // If the query had explicit scope (e.g., STATE:MA), fit to results; otherwise keep current view
            if (scoped && matched.length > 0) {
                fitToMatchesIfGlobalScope ? fitToMatchesIfGlobalScope(parsed, matched) : zoomToParks(matched);
            }

            applyPqlFilterDisplay(matched);

            if (matched.length === 0) {
                alert('No parks match that query in the current view.');
            }
            return;
        }

        console.log(`Searching for parks matching: "${query}"`); // Debugging

        if (currentSearchResults.length > 0) {
            if (currentSearchResults.length === 1) {
                // If only one park matches, center and zoom to it
                const park = currentSearchResults[0];
                zoomToPark(park);
            } else {
                // If multiple parks match, fit the map bounds to include all
                zoomToParks(currentSearchResults);
            }
        } else {
            // Handle "Go To Park" functionality for the global dataset
            const matchingPark = parks.find(park =>
                normalizeString(park.name).includes(query) ||
                normalizeString(park.reference).includes(query)
            );

            if (matchingPark) {
                zoomToPark(matchingPark);
            } else {
                // Display message only if no matches are found after searching
                alert('No parks found matching your search criteria.');
            }
        }
    }
}

/**
 * Zooms the map to a single park's location and shows its full information popup,
 * including current activation details, as if clicked by the user.
 * @param {Object} park - The park object to zoom into (must have .latitude, .longitude).
 */
async function zoomToPark(park) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    const {latitude, longitude} = park;
    if (!latitude || !longitude) {
        console.warn("Park has no valid coordinates:", park.reference);
        return;
    }

    // Zoom in closer
    const currentZoom = map.getZoom();
    const maxZoom = map.getMaxZoom();
    const newZoomLevel = Math.min(currentZoom + 2, maxZoom); // or pick any desired zoom
    map.setView([latitude, longitude], newZoomLevel, {
        animate: true,
        duration: 1.5, // animation in seconds
    });
    console.log(`Zoomed to park [${latitude}, ${longitude}] - ${park.reference}.`);

    // Close the hamburger menu (if open)
    const menuCheckbox = document.getElementById('menuCheckbox');
    if (menuCheckbox && menuCheckbox.checked) {
        menuCheckbox.checked = false;
        console.log("Hamburger menu closed.");
    }

    // 1) Try to find the existing marker in map activations/spots layers
    //    We'll assume your "parks" go in map.activationsLayer, but if spots are separate, check map.spotsLayer too.
    let foundMarker = null;

    // If you have a single group for parks:
    if (map.activationsLayer) {
        map.activationsLayer.eachLayer((layer) => {
            // If it's a circleMarker, check if it belongs to the park
            // For your code, you might store the park reference in layer.options or layer.parkReference
            // or match lat/long. For instance:
            if (layer.getLatLng) {
                const latLng = layer.getLatLng();
                if (latLng.lat === park.latitude && latLng.lng === park.longitude) {
                    foundMarker = layer;
                }
            }
        });
    }

    // If you also keep "spot" markers in map.spotsLayer, you might do the same loop there:
    if (!foundMarker && map.spotsLayer) {
        map.spotsLayer.eachLayer((layer) => {
            if (layer.getLatLng) {
                const latLng = layer.getLatLng();
                if (latLng.lat === park.latitude && latLng.lng === park.longitude) {
                    foundMarker = layer;
                }
            }
        });
    }

    // 2) If we found an existing marker, open its popup so it triggers the normal "popupopen" logic
    if (foundMarker) {
        // Ensure the popup is bound (it should be, from your displayParksOnMap or fetchAndDisplaySpots function)
        if (foundMarker._popup) {
            // This will automatically trigger the 'popupopen' event if you have it set
            openPopupWithAutoPan(foundMarker);
            console.log(`Opened popup for existing marker of park ${park.reference}.`);
        } else {
            console.warn(`Marker has no bound popup for ${park.reference}.`);
        }
    } else {
        console.warn(`No existing marker found for park ${park.reference}.`);
        // Optionally, create a *temporary* marker if you like
        // ...
    }
}

/**
 * Fetches the full popup content for a park, including recent activations,
 * plus optionally showing "current activation" (spot) details if provided.
 *
 * @param {Object} park - The park object containing its details.
 *   e.g. { reference: "K-1234", name: "Some Park", latitude: 12.345, longitude: -98.765, ... }
 * @param {Object} [currentActivation] - Optional activation/spot details
 *   (e.g. { activator, frequency, mode, comments }).
 * @returns {Promise<string>} The full popup HTML content.
 */
async function fetchFullPopupContent(park, currentActivation = null, parkActivations = null) {
    const {reference, name, latitude, longitude} = park;

    // Generate POTA.app link
    const potaAppLink =
        `<a href="https://pota.app/#/park/${reference}" target="_blank" rel="noopener noreferrer">
         <b>${name} (${reference})</b>
       </a>`.trim();

    // Generate "Get Directions" link if user location is available
    const directionsLink =
        userLat !== null && userLng !== null
            ? `<a href="https://www.google.com/maps/dir/?api=1&origin=${userLat},${userLng}&destination=${latitude},${longitude}&travelmode=driving"
                 target="_blank" rel="noopener noreferrer">Get Directions</a>`
            : '';

    // Use passed-in activations or fetch fresh
    if (!parkActivations) {
        try {
            parkActivations = await fetchParkActivations(reference);
            await saveParkActivationsToIndexedDB(reference, parkActivations);
        } catch (err) {
            console.warn(`Unable to fetch activations for ${reference}:`, err);
            parkActivations = [];
        }
    }

    // Start building popup content
    const activationCount = parkActivations.length;
    //See if nfers exist
    let popupContent = `${potaAppLink}<br>Activations: ${activationCount}`;

// If park has NFERs, add them as clickable links
    if (park.nfer && Array.isArray(park.nfer) && park.nfer.length > 0) {
        const links = park.nfer.map(ref => {
            return `<a href="#" onclick="zoomToParkByReference('${ref}'); return false;">${ref}</a>`;
        }).join(', ');
        popupContent += `<br>Possible NFERs: ${links}`;
    }

    if (directionsLink) popupContent += `<br>${directionsLink}`;
    // If a PN&R review exists, show it under Get Directions
    if (park && park.reviewURL) {
        popupContent += `\n<br><a href="${park.reviewURL}" target="_blank" rel="noopener">Read PN&R Review</a>`;
    }

    if (parkActivations.length > 0) {
        const cwTotal = parkActivations.reduce((sum, act) => sum + (act.qsosCW || act.cw || 0), 0);
        const phoneTotal = parkActivations.reduce((sum, act) => sum + (act.qsosPHONE || act.phone || 0), 0);
        const dataTotal = parkActivations.reduce((sum, act) => sum + (act.qsosDATA || act.data || 0), 0);

        const recentActivations = parkActivations
            .sort((a, b) => {
                const dateA = parseInt(a.qso_date || a.date || '0', 10);
                const dateB = parseInt(b.qso_date || b.date || '0', 10);
                return dateB - dateA;
            })
            .slice(0, 3)
            .map((act) => {
                const dateStr = formatQsoDate(act.qso_date || act.date);
                const total = act.totalQSOs || act.total || 0;
                const callsign = act.activeCallsign || act.callsign || 'Unknown';
                return `${callsign} on ${dateStr} (${total} QSOs)`;
            })
            .join('<br>') || 'No recent activations.';

        popupContent += `
        <br><br><b>Total QSOs (All Activations):</b><br>
        CW: ${cwTotal} &nbsp;|&nbsp; PHONE: ${phoneTotal} &nbsp;|&nbsp; DATA: ${dataTotal}
        <br><br><b>Recent Activations:</b><br>${recentActivations}`;
    }

    if (currentActivation) {
        const {activator, frequency, mode, comments} = currentActivation;
        popupContent += `
            <br><br><b>Current Activation:</b><br>
            <b>Activator:</b> ${activator}<br>
            <b>Frequency:</b> ${frequency} kHz<br>
            <b>Mode:</b> ${mode}<br>
            <b>Comments:</b> ${comments || 'N/A'}`;
    }

    return popupContent.trim();
}

async function zoomToParkByReference(reference) {
    const allParks = await getAllParksFromIndexedDB();
    const targetPark = allParks.find(p => p.reference === reference);
    if (targetPark) {
        zoomToPark(targetPark);
    } else {
        alert(`Park ${reference} not found.`);
    }
}


/**
 * Zooms the map to fit all searched parks within the view and increases the zoom level by one.
 * @param {Array} parks - An array of park objects to include in the view.
 */
function zoomToParks(parks) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    const latLngs = parks.map(park => [park.latitude, park.longitude]);

    if (latLngs.length === 0) {
        console.warn("No valid park locations to zoom to.");
        return;
    }

    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, {
        padding: [50, 50], // Padding in pixels
        animate: true,
        duration: 1.5 // Duration in seconds for the animation
    });

    console.log(`Zoomed to fit ${parks.length} parks within the view.`); // Debugging

    // After fitting bounds, increase the zoom level by one
    map.once('moveend', function () {
        const currentZoom = map.getZoom();
        const maxZoom = map.getMaxZoom();
        const newZoomLevel = Math.min(currentZoom + 1, maxZoom);
        map.setZoom(newZoomLevel, {
            animate: true,
            duration: 1.0 // Duration in seconds for the zoom animation
        });
        console.log(`Increased zoom level to ${newZoomLevel}.`); // Debugging
    });

    // Optionally, open popups for all filtered parks
    parks.forEach(park => {
        map.activationsLayer.eachLayer(layer => {
            const layerLatLng = layer.getLatLng();
            if (layerLatLng.lat === park.latitude && layerLatLng.lng === park.longitude) {
                openPopupWithAutoPan(layer);
            }
        });
    });
}


/**
 * Normalizes a string for consistent comparison.
 * Converts to lowercase and trims whitespace.
 * If the input is not a string, returns an empty string.
 * @param {string} str - The string to normalize.
 * @returns {string} The normalized string.
 */
function normalizeString(str) {
    return typeof str === 'string' ? str.toLowerCase().trim() : '';
}


/**
 * Parses a structured query that begins with '?'.
 * Keys (case-insensitive):
 *  - MODE: CW | PHONE | SSB | DATA | FT8 | FT4
 *  - MAX: <number>        (max total activations)
 *  - ACTIVE: 1|0|true|false
 *  - NEW: 1|0|true|false
 *  - MINE: 1|0|true|false
 *  - REVIEW: 1|0|true|false
 *  - STATE: <US state/territory 2-letter code>
 *  - CALL / CALLSIGN: <activator callsign>
 * Free text (quoted "like this" or bare) is matched against name/reference.
 */
function parseStructuredQuery(raw) {
    const q = (raw || '').trim().replace(/^\?\s*/, '');
    const result = {
        isStructured: true,
        text: '',
        mode: null,
        max: null,
        min: null,
        active: null,
        isNew: null,
        mine: null,
        state: null,
        callsign: null,
        refs: [],
        minDist: null,
        maxDist: null,
        nferWithRefs: [],
        hasNfer: null,         // ← NEW: boolean or null (no filter)
        hasReview: null        // ← NEW: boolean or null (no filter)
    };
    if (!q) return result;

    function parseDistanceValue(rawVal) {
        const m = String(rawVal).trim().match(/^(\d+(?:\.\d+)?)(\s*(km|mi))?$/i);
        if (!m) return {miles: NaN};
        const val = parseFloat(m[1]);
        const unit = (m[3] || 'mi').toLowerCase();
        return {miles: unit === 'km' ? val * 0.621371 : val};
    }

    // tokenize
    const tokens = [];
    let i = 0;
    while (i < q.length) {
        const ch = q[i];
        if (ch === '"') {
            let j = i + 1;
            while (j < q.length && q[j] !== '"') j++;
            tokens.push(`TEXT:${q.slice(i + 1, j)}`);
            i = (j < q.length) ? j + 1 : q.length;
        } else if (/\s/.test(ch)) {
            i++;
        } else {
            let j = i + 1;
            while (j < q.length && !/\s/.test(q[j])) j++;
            tokens.push(q.slice(i, j));
            i = j;
        }
    }

    // parse
    for (const t of tokens) {
        const kv = t.includes(':') ? t.split(':') : null;
        if (!kv) {
            result.text = (result.text ? result.text + ' ' : '') + t;
            continue;
        }

        const key = kv[0].toUpperCase();
        const valueRaw = kv.slice(1).join(':');
        const value = (valueRaw || '').replace(/^TEXT:/, '');

        if (key === 'MODE') {
            const v = value.toUpperCase();
            if (v === 'CW') result.mode = 'CW';
            else if (v === 'SSB' || v === 'PHONE') result.mode = 'SSB';
            else if (v === 'DATA' || v === 'FT8' || v === 'FT4') result.mode = 'DATA';

        } else if (key === 'MAX') {
            const n = parseInt(value, 10);
            if (!Number.isNaN(n)) result.max = n;

        } else if (key === 'MIN') {
            const n = parseInt(value, 10);
            if (!Number.isNaN(n)) result.min = n;

        } else if (key === 'ACTIVE') {
            const v = value.toLowerCase();
            result.active = (v === '1' || v === 'true');

        } else if (key === 'NEW') {
            const v = value.toLowerCase();
            result.isNew = (v === '1' || v === 'true');

        } else if (key === 'MINE') {
            const v = value.toLowerCase();
            result.mine = (v === '1' || v === 'true');

        } else if (key === 'STATE') {
            const st = value.toUpperCase().match(/([A-Z]{2})$/);
            if (st && st[1]) result.state = st[1];

        } else if (key === 'CALL' || key === 'CALLSIGN') {
            result.callsign = value.trim().toUpperCase();
            if (result.active === null) result.active = true; // default to ACTIVE:1 when filtering by callsign

        } else if (key === 'REVIEW') {
            const v = value.toLowerCase();
            result.hasReview = (v === '1' || v === 'true');

        } else if (key === 'REF' || key === 'REFERENCE' || key === 'ID') {
            const arr = String(value).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            if (arr.length > 0) {
                result.refs = arr;
                result.ref = arr[0];
            }

        } else if (key === 'MINDIST') {
            const {miles} = parseDistanceValue(value);
            if (!Number.isNaN(miles)) result.minDist = miles;

        } else if (key === 'MAXDIST') {
            const {miles} = parseDistanceValue(value);
            if (!Number.isNaN(miles)) result.maxDist = miles;

        } else if (key === 'DIST') {
            const m = value.replace(/\s+/g, '').toLowerCase().match(/^([^-]*?)(?:-([^-]*))?$/);
            if (m) {
                const left = m[1], right = m[2] || '';
                if (left) {
                    const {miles} = parseDistanceValue(left);
                    if (!Number.isNaN(miles)) result.minDist = miles;
                }
                if (right) {
                    const {miles} = parseDistanceValue(right);
                    if (!Number.isNaN(miles)) result.maxDist = miles;
                }
            }

        } else if (key === 'NFERWITH') {
            result.nferWithRefs = String(value).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

        } else if (key === 'NFER' || key === 'NFERS') {   // ← NEW
            const v = value.trim().toLowerCase();
            if (v === '1' || v === 'true' || v === 'yes') result.hasNfer = true;
            else if (v === '0' || v === 'false' || v === 'no') result.hasNfer = false;

        } else if (key === 'TEXT') {
            result.text = (result.text ? result.text + ' ' : '') + value;
        }
    }

    result.text = normalizeString(result.text);
    return result;
}

function buildNferByRef(parks) {
    // Map<REF, Set<REF>>
    const map = new Map();
    for (const p of parks) {
        // accept p.nfer or p.nferWith arrays
        const arr = Array.isArray(p.nfer) ? p.nfer
            : Array.isArray(p.nferWith) ? p.nferWith
                : null;
        if (!arr) continue;
        const key = String(p.reference).toUpperCase();
        const vals = arr.map(r => String(r).toUpperCase()).filter(Boolean);
        map.set(key, new Set(vals));
    }
    return map;
}


/**
 * Tests whether a given park matches the parsed structured query.
 * Uses current map state (spots, activations) for ACTIVE/MODE/MINE filters.
 */
/**
 * Tests whether a given park matches the parsed structured query.
 * Uses current map state (spots, activations) for ACTIVE/MODE/MINE filters.
 */
function parkMatchesStructuredQuery(park, parsed, ctx) {
    const {bounds} = ctx || {};

    // 1) Proximity or in-view constraint
    const hasDistConstraint = (parsed.minDist !== null) || (parsed.maxDist !== null);
    const hasStateConstraint = !!parsed.state;
    const hasNferConstraint = Array.isArray(parsed.nferWithRefs) && parsed.nferWithRefs.length > 0;
    const hasCountryConstraint = !!parsed.country;
    const hasRefConstraint = Array.isArray(parsed.refs) && parsed.refs.length > 0;
    const hasCallConstraint = !!parsed.callsign;

    // Default to in-bounds unless one of the *explicit* global-scope keys is present
    const hasGlobalConstraint = hasDistConstraint || hasStateConstraint || hasNferConstraint
        || hasCountryConstraint || hasRefConstraint || hasCallConstraint;

    if (hasGlobalConstraint) {
        if (hasDistConstraint) {
            if (typeof ctx?.userLat !== 'number' || typeof ctx?.userLng !== 'number') return false;
            const dMiles = haversineMiles(ctx.userLat, ctx.userLng, park.latitude, park.longitude);
            if (parsed.minDist !== null && dMiles < parsed.minDist) return false;
            if (parsed.maxDist !== null && dMiles > parsed.maxDist) return false;
            park._distMiles = dMiles;
        }
    } else {
        const latLng = L.latLng(park.latitude, park.longitude);
        if (!bounds || !bounds.contains(latLng)) return false;
    }

    // 2) Free-text
    if (parsed.text) {
        const hay = [
            park.name, park.reference, park.city,
            Array.isArray(park.states) ? park.states.join(' ') : park.state,
            park.country
        ].filter(Boolean).join(' ');
        if (!normalizeString(hay).includes(parsed.text)) return false;
    }

    // 2.5) REFERENCE (REF/REFERENCE/ID)
    if (hasRefConstraint) {
        const ref = String(park.reference || '').toUpperCase();
        if (!parsed.refs.includes(ref)) return false;
    }

    // 3) STATE
    if (parsed.state) {
        const statesArr = Array.isArray(park.states) ? park.states.map(s => String(s).toUpperCase()) : [];
        const single = String(park.state || park.primaryState || '').toUpperCase();
        if (!(statesArr.includes(parsed.state) || single === parsed.state)) return false;
    }

    // 4) NFERWITH (union)
    if (hasNferConstraint) {
        const ref = String(park.reference || '').toUpperCase();
        const map = ctx && ctx.nferByRef;
        let ok = false;
        for (const target of parsed.nferWithRefs) {
            const T = String(target).toUpperCase();
            if (map && map.get(T) && map.get(T).has(ref)) {
                ok = true;
                break;
            } // forward
            if (Array.isArray(park.nfer) && park.nfer.some(r => String(r).toUpperCase() === T)) {
                ok = true;
                break;
            } // backward
        }
        if (!ok) return false;
    }

    // 5) NFERS / NFER boolean (does this park have *any* NFERs?)
    if (parsed.hasNfer !== null) {
        const ref = String(park.reference || '').toUpperCase();
        const fwd = Array.isArray(park.nfer) ? park.nfer
            : Array.isArray(park.nferWith) ? park.nferWith
                : null;
        let has = Array.isArray(fwd) && fwd.length > 0;

        // Optional inbound detection via ctx.nferByRef (so parks that appear only as someone else's neighbor count as "has NFER")
        if (!has && ctx && ctx.nferByRef) {
            const inboundSet = ctx.nferByRef._inboundSet; // may exist if you use the optimized builder below
            if (inboundSet) {
                has = inboundSet.has(ref);
            } else {
                for (const set of ctx.nferByRef.values()) {
                    if (set.has(ref)) {
                        has = true;
                        break;
                    }
                }
            }
        }

        if (parsed.hasNfer && !has) return false;
        if (parsed.hasNfer === false && has) return false;
    }

    // 6) REVIEW URL presence
    if (parsed.hasReview !== null) {
        const has = !!park.reviewURL;
        if (parsed.hasReview && !has) return false;
        if (parsed.hasReview === false && has) return false;
    }

    // 7) NEW
    if (parsed.isNew === true) {
        const created = park.created || 0;
        const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
        if (!created || (Date.now() - created) > THIRTY_DAYS) return false;
    }

    // 8) MINE
    // 8) MINE (robust to Set | Array | Object)
    if (parsed.mine !== null && ctx && ctx.userActivatedRefs) {
        const refRaw = String(park.reference || '');
        const refU = refRaw.toUpperCase();
        const s = ctx.userActivatedRefs;

        let mine = false;
        if (s instanceof Set) {
            mine = s.has(refU) || s.has(refRaw);
        } else if (Array.isArray(s)) {
            // array of refs
            mine = s.includes(refU) || s.includes(refRaw);
        } else if (typeof s === 'object') {
            // map/dict or anything else keyed by ref
            mine = !!(s[refU] || s[refRaw] || (typeof s.has === 'function' && (s.has(refU) || s.has(refRaw))));
        }

        if (parsed.mine && !mine) return false;
        if (!parsed.mine && mine) return false;
    }


    // 9) ACTIVE (live)
    if (parsed.active !== null && ctx && ctx.spotByRef) {
        const active = !!ctx.spotByRef[park.reference];
        if (parsed.active && !active) return false;
        if (!parsed.active && active) return false;
    }

    // 9.5) CALLSIGN filter (requires ACTIVE)
    if (parsed.callsign && ctx && ctx.spotByCall) {
        const arr = ctx.spotByCall[parsed.callsign];
        if (!(Array.isArray(arr) && arr.some(s => s.reference === park.reference))) return false;
    }

    // 10) MODE / MIN / MAX — QSO bucket check
    if (parsed.min !== null || parsed.max !== null || parsed.mode) {
        const mode = parsed.mode;
        // Normalize mode key: phone -> ssb, ft8/ft4 -> data
        const lowerRaw = mode ? String(mode).toLowerCase() : null;
        const key = (lowerRaw === 'phone' ? 'ssb'
            : (lowerRaw === 'ft8' || lowerRaw === 'ft4') ? 'data'
                : lowerRaw);

        let qsoCount = park.qsos || 0;

        if (mode) {
            const byRef = ctx?.modeQsosByRef && ctx.modeQsosByRef[park.reference];
            if (byRef && typeof byRef[key] === 'number') {
                qsoCount = byRef[key];
            } else if (park.modeTotals && typeof park.modeTotals[key] === 'number') {
                qsoCount = park.modeTotals[key];
            } else if (typeof park[`qsos_${key}`] === 'number') {
                qsoCount = park[`qsos_${key}`];
            } else if (park.qsosByMode) {
                // accept either lower or upper keys in qsosByMode
                if (typeof park.qsosByMode[key] === 'number') qsoCount = park.qsosByMode[key];
                else if (typeof park.qsosByMode[String(mode).toUpperCase()] === 'number') qsoCount = park.qsosByMode[String(mode).toUpperCase()];
            }
        }

        if (parsed.min !== null && qsoCount < parsed.min) return false;
        if (parsed.max !== null && qsoCount > parsed.max) return false;
    }

    return true;
}

function fitToMatchesIfGlobalScope(parsed, matched) {
    const usedGlobalScope =
        (!!parsed.state) ||
        (!!parsed.country) ||
        (!!parsed.callsign) ||
        (Array.isArray(parsed.refs) && parsed.refs.length > 0) ||
        (parsed.minDist !== null) || (parsed.maxDist !== null) ||
        (Array.isArray(parsed.nferWithRefs) && parsed.nferWithRefs.length > 0);

    if (!usedGlobalScope || !map || !matched || !matched.length) return;

    const latlngs = matched.map(p => [p.latitude, p.longitude]);
    const bounds = L.latLngBounds(latlngs);

    if (matched.length === 1) {
        // Single park: keep current zoom and fly to it
        map.flyTo(bounds.getCenter(), map.getZoom());
    } else {
        // Multiple parks: fit them all in view (may adjust zoom)
        map.fitBounds(bounds, {padding: [50, 50], animate: true});
    }
}

/**
 * Filters and displays parks based on the maximum number of activations.
 * @param {number} maxActivations - The maximum number of activations to display.
 */
function filterParksByActivations(maxActivations) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    // Get current map bounds
    const bounds = getCurrentMapBounds();
    console.log("Current Map Bounds:", bounds.toBBoxString()); // Debugging

    // Get all parks within the current bounds and meeting the activation criteria
    const parksInBounds = parks.filter(park => {
        if (park.latitude && park.longitude) {
            const latLng = L.latLng(park.latitude, park.longitude);
            return bounds.contains(latLng) && park.activations <= maxActivations;
        }
//        console.warn(`Invalid park data for reference: ${park.reference}`); // Debugging
        return false;
    });

    console.log("Parks in Current View with Activations <= max:", parksInBounds); // Debugging

    // Clear existing markers
    if (map.activationsLayer) {
        if (!window.__nonDestructiveRedraw) {
            map.activationsLayer.clearLayers();
        }
        console.log("Cleared existing markers."); // Debugging
    } else {
        map.activationsLayer = L.layerGroup().addTo(map);
        console.log("Created activationsLayer."); // Debugging
    }

    // Determine which parks are activated by the user within bounds
    const activatedReferences = activations
        .filter(act => parksInBounds.some(p => p.reference === act.reference))
        .map(act => act.reference);

    console.log("Activated References in Filtered View:", activatedReferences); // Debugging

    // Display activated parks within current view based on slider
    //displayParksOnMap(map, parksInBounds, activatedReferences, map.activationsLayer);
    applyActivationToggleState();
    console.log("Displayed activated parks within filtered view."); // Debugging
}


/**
 * Displays the callsign(s) of the user's activations in the hamburger menu.
 */
function displayCallsign() {
    const el = document.getElementById('callsignText');
    if (!el) return;

    const uniqueCallsigns = [...new Set(activations
        .filter(act => act.activeCallsign)
        .map(act => act.activeCallsign.trim())
    )];

    el.textContent = uniqueCallsigns.length > 0
        ? uniqueCallsigns.join(', ')
        : 'please set';
}

/**
 * Removes the callsign display from the page.
 */
function removeCallsignDisplay() {
    const callsignDiv = document.getElementById('callsignDisplay');
    if (callsignDiv) {
        callsignDiv.remove();
        console.log("Calls-in display removed."); // Debugging
    }
}

/**
 * Retrieves the current geographical bounds of the map.
 * @returns {L.LatLngBounds} The current map bounds.
 */
function getCurrentMapBounds() {
    return map.getBounds();
}

function getParksInBounds(parks) {
    const bounds = getCurrentMapBounds();
    return parks.filter(p =>
        p.latitude && p.longitude && bounds.contains([p.latitude, p.longitude])
    );
}

/**
 * Filters activated parks that are within the current map bounds.
 * @param {Array} activations - The list of activated parks.
 * @param {Array} parks - The complete list of parks.
 * @param {L.LatLngBounds} bounds - The current map bounds.
 * @returns {Array} List of activated parks within bounds.
 */
function getActivatedParksInBounds(activations, parks, bounds) {
    const filteredParks = activations.filter((activation) => {
        // Find the corresponding park in the parks list
        const park = parks.find(p => p.reference === activation.reference);
        if (park && park.latitude && park.longitude) {
            const latLng = L.latLng(park.latitude, park.longitude);
            const isWithin = bounds.contains(latLng);
            console.log(`Park ${park.reference} (${park.name}) is within bounds: ${isWithin}`); // Debugging
            return isWithin;
        }
        // console.warn(`Invalid park data for reference: ${activation.reference}`); // Debugging
        return false;
    });
    console.log("Filtered Activated Parks:", filteredParks); // Debugging
    return filteredParks;
}

/**
 * Updates the map to display activated parks within the current map view.
 */
async function updateActivationsInView() {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    const bounds = getCurrentMapBounds();
    const allParks = await getAllParksFromIndexedDB();

    const parksInBounds = allParks.filter(park => {
        if (park.latitude && park.longitude) {
            const latLng = L.latLng(park.latitude, park.longitude);
            return bounds.contains(latLng);
        }
        return false;
    });

    if (map.activationsLayer) {
        if (!window.__nonDestructiveRedraw) {
            map.activationsLayer.clearLayers();
        }
    } else {
        map.activationsLayer = L.layerGroup().addTo(map);
    }

    const userActivatedReferences = activations.map(act => act.reference);
    const onAirReferences = spots.map(spot => spot.reference);

    let parksToDisplay = parksInBounds;

    switch (activationToggleState) {
        case 1: // Show just user's activations
            parksToDisplay = parksInBounds.filter(park =>
                userActivatedReferences.includes(park.reference)
            );
            break;

        case 2: // Show all spots except user's activations
            parksToDisplay = parksInBounds.filter(park =>
                !userActivatedReferences.includes(park.reference)
            );
            break;

        case 3: // Show only currently active parks (on air)
            parksToDisplay = parksInBounds.filter(park =>
                onAirReferences.includes(park.reference)
            );
            break;

        // case 0 and default: Show all parks in bounds
    }

//    displayParksOnMap(map, parksToDisplay, userActivatedReferences, map.activationsLayer);
    applyActivationToggleState();
}

/**
 * Updates the map to display only the filtered parks based on the search query.
 * @param {Array} filteredParks - Array of park objects that match the search criteria.
 */
function updateMapWithFilteredParks(filteredParks) {
    if (!map) {
        console.error("Map instance is not initialized.");
        return;
    }

    // Clear existing markers
    if (map.activationsLayer) {
        if (!window.__nonDestructiveRedraw) {
            map.activationsLayer.clearLayers();
        }
        console.log("Cleared existing markers for filtered search."); // Debugging
    } else {
        map.activationsLayer = L.layerGroup().addTo(map);
        console.log("Created activationsLayer for filtered search."); // Debugging
    }

    // Determine which parks are activated by the user within filtered parks
    const activatedReferences = activations
        .filter(act => filteredParks.some(p => p.reference === act.reference))
        .map(act => act.reference);

    console.log("Activated References in Filtered Search:", activatedReferences); // Debugging

    // Display ONLY the filtered parks on the map (PQL result)
    displayParksOnMap(map, filteredParks, activatedReferences, map.activationsLayer);
    console.log("Displayed filtered parks on the map."); // Debugging
}

// Unified Clear Search
function clearSearchInput() {
    // 1) Clear pulsing PQL overlay (if any)
    try {
        clearPqlFilterDisplay();
    } catch (e) {
    }

    // 2) Clear legacy highlight layer (non-PQL incremental search)
    if (map && map.highlightLayer) {
        try {
            map.highlightLayer.clearLayers();
        } catch (e) {
        }
    }

    // 3) Clear the search box
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.value = '';
        // If you want to force downstream listeners to react, you can emit input:
        // searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 4) Drop any cached results from the last search
    try {
        currentSearchResults = [];
    } catch (e) {
    }

    // 5) Restore the previous map view (if we saved it before the search)
    if (previousMapState && previousMapState.bounds) {
        try {
            map.fitBounds(previousMapState.bounds);
            // Restore base display according to current toggles/filters
            if (typeof applyActivationToggleState === 'function') {
                applyActivationToggleState();
            }
            // Clear saved state
            previousMapState = {bounds: null, displayedParks: []};
            console.log('Map view restored to prior state.');
        } catch (e) {
            console.warn('Failed to restore previous map view:', e);
        }
    } else {
        // If we didn’t save a state, at least ensure the base display is consistent
        if (typeof applyActivationToggleState === 'function') {
            applyActivationToggleState();
        }
    }
}


/**
 * Adds event listeners to the search box and Clear button.
 */
function setupSearchBoxListeners() {
    const searchBox = document.getElementById('searchBox');
    const clearButton = document.getElementById('clearSearch');

    if (!searchBox || !clearButton) {
        console.error("Search box or Clear button not found.");
        return;
    }

    // Show the Clear button only when there is input
    searchBox.addEventListener('input', () => {
        if (searchBox.value.trim() !== '') {
            clearButton.style.display = 'block';
        } else {
            clearButton.style.display = 'none';
        }
    });

    // Attach the Clear button functionality
    clearButton.addEventListener('click', clearSearchInput);
}

// Call the setup function when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
    setupSearchBoxListeners();
    wireCenterOnMyLocationButton();
    console.log("Search box listeners initialized and geolocation button wired."); // Debugging
    // Load PN&R review URLs and refresh markers if updated
    try {
        const changed = await fetchAndApplyReviewUrls();
        if (changed && typeof refreshMarkers === 'function') {
            refreshMarkers();
        }
    } catch (_) {
    }
});

/**
 * Resets the park display on the map based on current activation filters.
 * This function is called when the search input is cleared.
 */
function resetParkDisplay() {
    const activationSlider = document.getElementById('activationSlider');
    const minActivations = activationSlider ? parseInt(activationSlider.value, 10) : 0;
    console.log(`Resetting park display with Minimum Activations: ${minActivations}`); // Debugging

    // Filter parks based on the current activation slider value
    const parksToDisplay = parks.filter(park => park.activations >= minActivations);

    // Update the map with the filtered parks
    filterParksByActivations(minActivations);
}

/**
 * Initializes and displays activations on startup.
 * If activations exist in the local store, this function attempts to update them
 * by fetching data from the API at https://pota.app/#/user/activations.
 */
async function initializeActivationsDisplay() {
    try {
        // Restore activation toggle state from localStorage (if available)
        const savedToggleState = parseInt(localStorage.getItem('activationToggleState'), 10);
        if (!isNaN(savedToggleState) && savedToggleState >= 0 && savedToggleState <= 3) {
            activationToggleState = savedToggleState;

            // Update button label accordingly
            const toggleButton = document.getElementById('toggleActivations');
            const buttonTexts = [
                "Show My Activations",
                "Hide My Activations",
                "Show Currently On Air",
                "Show All Spots",
            ];
            if (toggleButton) {
                toggleButton.innerText = buttonTexts[activationToggleState];
            }
        }

        const storedActivations = await getActivationsFromIndexedDB();
        if (storedActivations.length > 0) {
            // Set the toggle button to active if activations exist.
            const toggleButton = document.getElementById('toggleActivations');
            if (toggleButton) {
                toggleButton.classList.add('active');
                console.log("Activations exist in IndexedDB. Enabling 'Show My Activations' by default.");
            }

            // Load stored activations.
            activations = storedActivations;

            // If we have stored activations (and by extension a valid callsign), try updating from the API.
//            await updateUserActivationsFromAPI();
            // await updateActivationsFromScrape();
            // Refresh the map view and display the user's callsign.
            updateActivationsInView();
            displayCallsign();
        } else {
            console.log("No activations found in IndexedDB. Starting with default view.");
        }
    } catch (error) {
        console.error('Error initializing activations display:', error);
    }
}

async function updateUserActivationsFromAPI() {
    try {
        // Correct endpoint returning JSON.
        const apiUrl = 'https://api.pota.app/#/user/activations?all=1';

        // Fetch using credentials so that cookies are sent
        const response = await fetch(apiUrl, {
            credentials: 'include', // Include cookies and credentials in cross-origin requests.
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
                // If needed, you can add:
                // 'Authorization': `Bearer YOUR_TOKEN_HERE`
            }
        });

        // Parse the JSON response.
        const apiData = await response.json();
        console.log("Fetched API activations:", apiData.activations);

        // Check if activations were returned.
        if (!apiData || !Array.isArray(apiData.activations) || apiData.activations.length === 0) {
            console.log("No activation data returned from API, skipping update.");
            return;
        }

        // Create a map keyed by 'reference' from existing activations.
        const activationMap = new Map();
        activations.forEach(act => {
            activationMap.set(act.reference, act);
        });

        // Merge each API activation into the map.
        apiData.activations.forEach(apiAct => {
            const reference = apiAct.reference.trim();
            const newActivation = {
                reference: reference,
                name: apiAct.name.trim(),
                qso_date: apiAct.date.trim(),  // e.g., "2025-01-10"
                activeCallsign: apiAct.callsign.trim(),
                totalQSOs: parseInt(apiAct.total, 10) || 0,
                qsosCW: parseInt(apiAct.cw, 10) || 0,
                qsosDATA: parseInt(apiAct.data, 10) || 0,
                qsosPHONE: parseInt(apiAct.phone, 10) || 0,
                attempts: parseInt(apiAct.total, 10) || 0,
                activations: parseInt(apiAct.total, 10) || 0,
            };

            if (activationMap.has(reference)) {
                const existingAct = activationMap.get(reference);
                activationMap.set(reference, {
                    ...existingAct,
                    ...newActivation,
                    // Optionally aggregate numeric values:
                    totalQSOs: existingAct.totalQSOs + newActivation.totalQSOs,
                    qsosCW: existingAct.qsosCW + newActivation.qsosCW,
                    qsosDATA: existingAct.qsosDATA + newActivation.qsosDATA,
                    qsosPHONE: existingAct.qsosPHONE + newActivation.qsosPHONE,
                    activations: existingAct.activations + newActivation.activations,
                });
                console.log(`Updated activation: ${reference}`);
            } else {
                activationMap.set(reference, newActivation);
                console.log(`Added new activation: ${reference}`);
            }
        });

        // Update the global activations array.
        activations = Array.from(activationMap.values());
        await saveActivationsToIndexedDB(activations);
        console.log("Successfully merged API activations into local store.");
    } catch (error) {
        console.error("Error fetching or merging user activations from API:", error);
    }
}

/**
 * Scrapes recent activations data from the returned HTML string.
 * Assumes that the table rows in the first table inside an element
 * with class "v-data-table__wrapper" contain the data.
 *
 * Each row is assumed to have these columns (in order):
 *  - Date (e.g. "01/09/2025")
 *  - Park (an <a> element whose href contains a reference like "#/park/US-0891" and text with the park name)
 *  - CW (a number)
 *  - Data (a number)
 *  - Phone (a number)
 *  - Total QSOs (a number)
 *
 * @param {string} html - The full HTML from the page.
 * @returns {Array<Object>} Array of activation objects.
 */
function scrapeActivationsFromHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    // Find the table that holds the activations.
    // Adjust this selector if needed.
    const table = doc.querySelector('.v-data-table__wrapper table');
    if (!table) {
        console.error('Activations table not found in HTML.');
        return [];
    }

    // Query all rows within the table body.
    const rows = Array.from(table.querySelectorAll('tbody > tr'));
    if (!rows.length) {
        console.warn('No rows found in the activations table.');
        return [];
    }

    // Map over each row to extract the data.
    const activations = rows.map(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 6) {
            // If for some reason there are not enough cells, skip this row.
            return null;
        }

        // Column indices:
        // 0: Date (assumed format "MM/DD/YYYY")
        // 1: Park information (contains an <a> tag with href and text)
        // 2: CW
        // 3: Data
        // 4: Phone
        // 5: Total QSOs
        const date = cells[0].textContent.trim();

        // Extract park reference from the <a> tag.
        let parkReference = '';
        let parkName = '';
        const parkAnchor = cells[1].querySelector('a');
        if (parkAnchor) {
            // Example href: "#/park/US-0891"
            const href = parkAnchor.getAttribute('href');
            const match = href.match(/\/park\/(.+)/);
            if (match) {
                parkReference = match[1].trim();
            }
            parkName = parkAnchor.textContent.trim();
        }

        const cw = parseInt(cells[2].textContent.trim(), 10) || 0;
        const dataVal = parseInt(cells[3].textContent.trim(), 10) || 0;
        const phone = parseInt(cells[4].textContent.trim(), 10) || 0;
        const totalQSOs = parseInt(cells[5].textContent.trim(), 10) || 0;

        // Return an object matching (or easily mappable to) your activation format.
        return {
            qso_date: date,  // if using qso_date everywhere
            reference: parkReference,
            name: parkName,
            callsign: '',
            totalQSOs: totalQSOs,  // Always use totalQSOs
            qsosCW: cw,
            qsosDATA: dataVal,
            qsosPHONE: phone
        };
    }).filter(item => item !== null);

    return activations;
}

/**
 * An example function that fetches the page containing the recent activations,
 * scrapes the activations from its HTML, and then merges them with your local data.
 *
 * You can call this function in place of, or in addition to, your API call.
 */
async function updateActivationsFromScrape() {
    try {
        // Replace with the URL of the page you want to scrape.
        const url = 'https://api.pota.app/#/user/activations?all=1';
        const response = await fetch(url, {credentials: 'include'});

        if (!response.ok) {
            throw new Error(`Failed to fetch activations page. Status: ${response.status}`);
        }

        const html = await response.text();
        console.log("Fetched HTML (first 300 chars):", html.substring(0, 300));

        // Scrape activations from the HTML.
        const scrapedActivations = scrapeActivationsFromHTML(html);
        console.log("Scraped activations:", scrapedActivations);

        // Merge scrapedActivations into your existing global 'activations' array.
        // For merging, we’ll build a map keyed by the activation reference.
        const activationMap = new Map();
        activations.forEach(act => {
            activationMap.set(act.reference, act);
        });

        scrapedActivations.forEach(scraped => {
            const ref = scraped.reference;
            if (activationMap.has(ref)) {
                // Merge the activation. Adjust merge logic as needed.
                const existing = activationMap.get(ref);
                activationMap.set(ref, {
                    ...existing,
                    ...scraped,
                    // Optionally combine numeric fields.
                    total: existing.total + scraped.total
                });
                console.log(`Merged scraped activation: ${ref}`);
            } else {
                activationMap.set(ref, scraped);
                console.log(`Added new scraped activation: ${ref}`);
            }
        });

        // Update the global array.
        activations = Array.from(activationMap.values());
        await saveActivationsToIndexedDB(activations);
        console.log("Successfully saved merged scraped activations.");
        updateActivationsInView();

    } catch (error) {
        console.error("Error updating activations from scrape:", error);
    }
}

/**
 * Initializes the Leaflet map.
 * @param {number} lat - Latitude for the map center.
 * @param {number} lng - Longitude for the map center.
 * @returns {L.Map} The initialized Leaflet map instance.
 */
function initializeMap(lat, lng) {
    // Determine if the device is mobile based on screen width
    const isMobile = window.innerWidth <= 600;

    // Check for saved map center and zoom in localStorage
    let savedCenter = localStorage.getItem("mapCenter");
    let savedZoom = localStorage.getItem("mapZoom");

    if (savedCenter) {
        try {
            savedCenter = JSON.parse(savedCenter);
        } catch (e) {
            savedCenter = null;
        }
    }

    if (savedZoom) {
        savedZoom = parseInt(savedZoom, 10);
    }

    const mapInstance = L.map("map", {
        center: savedCenter || [lat, lng],
        zoom: savedZoom || (isMobile ? 12 : 10),
        zoomControl: !isMobile,
        attributionControl: true,
    });

    console.log("Initialized map at:", mapInstance.getCenter(), "zoom:", mapInstance.getZoom());

    // Add OpenStreetMap tiles
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
    }).addTo(mapInstance);

    console.log("Added OpenStreetMap tiles.");


    // Save center and zoom to localStorage whenever map is moved or zoomed
    mapInstance.on("moveend zoomend", () => {
        const center = mapInstance.getCenter();
        localStorage.setItem("mapCenter", JSON.stringify([center.lat, center.lng]));
        localStorage.setItem("mapZoom", mapInstance.getZoom());
        localStorage.setItem("mapSavedAt", Date.now().toString());
    });

    // Attach dynamic spot fetching to map movement
    let skipNextSpotFetch = false;
    mapInstance.on("popupopen", () => {
        skipNextSpotFetch = true;
        isPopupOpen = true;
    });
    mapInstance.on("popupclose", () => {
        isPopupOpen = false;
    });
    if (!isDesktopMode) {
        mapInstance.on(
            "moveend",
            debounce(() => {
                if (skipNextSpotFetch) {
                    skipNextSpotFetch = false;
                    return;
                }
                console.log("Map moved or zoomed. Updating spots...");
                fetchAndDisplaySpotsInCurrentBounds(mapInstance)
                    .then(() => applyActivationToggleState());
            }, 300)
        );
    }

    return mapInstance;
}


/**
 * Displays parks on the map.
 */
/**
 * Displays parks on the map with proper popups that include activation information.
 */
async function displayParksOnMap(map, parks, userActivatedReferences = null, layerGroup = map.activationsLayer) {
    console.log(`Displaying ${parks.length} parks on the map.`); // Debugging

    if (!layerGroup) {
        map.activationsLayer = L.layerGroup().addTo(map);


        // let userLocationMarker = null;
        // function setUserLocationMarker(lat, lng) {
        //     if (!map) return;
        //     if (userLocationMarker) {
        //         userLocationMarker.setLatLng([lat, lng]);
        //     } else {
        //         userLocationMarker = L.marker([lat, lng], {
        //             icon: L.icon({
        //                 iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
        //                 iconSize: [30, 30],
        //                 iconAnchor: [15, 30],
        //                 popupAnchor: [0, -30],
        //             }),
        //         }).addTo(map);
        //     }
        // }

        layerGroup = map.activationsLayer;
        console.log("Created a new activations layer.");
    } else {
        console.log("Using existing activations layer.");
    }

    layerGroup.clearLayers(); // Clear existing markers before adding new ones

    parks.forEach((park) => {
        const {reference, name, latitude, longitude, activations: parkActivationCount, created} = park;
        const isUserActivated = userActivatedReferences.includes(reference);
        let createdTime = null;
        if (created) {
            createdTime = typeof created === 'number'
                ? created
                : new Date(created).getTime();
        }
        const isNew = createdTime && (Date.now() - createdTime <= 30 * 24 * 60 * 60 * 1000);
//        const isNew = (Date.now() - new Date(created).getTime()) <= (30 * 24 * 60 * 60 * 1000); // 30 days
        const currentActivation = spots?.find(spot => spot.reference === reference);
        const isActive = !!currentActivation;
        const mode = currentActivation?.mode ? currentActivation.mode.toUpperCase() : '';

        // Show pulsing active icon whenever the park is currently on-air, even if activations === 0 (first activation)
        const useActiveDiv = !!isActive;

        // Apply Filters (OR semantics)
        if (!shouldDisplayParkFlags({isUserActivated, isActive, isNew})) return;
        if (!shouldDisplayByMode(isActive, isNew, mode)) return;

        // Debugging
        // if (isNew) {
        //     const delta = Date.now() - new Date(created).getTime();
        //     console.log(`Park ${reference} created: ${created}, delta: ${delta}, isNew: true`);
        // }

        // Determine marker class for animated divIcon
        const markerClasses = [];
        if (isNew) markerClasses.push('pulse-marker');
        if (isActive) {
            markerClasses.push('active-pulse-marker');
            if (mode === 'CW') markerClasses.push('mode-cw');
            else if (mode === 'SSB') markerClasses.push('mode-ssb');
            else if (mode === 'FT8' || mode === 'FT4') markerClasses.push('mode-data');
        }
        const markerClassName = markerClasses.join(' ');

        // Does this park have a PN&R review URL?
        let hasReview = !!park.reviewURL;
        if (!hasReview && window.__REVIEW_URLS instanceof Map) {
            const urlFromCache = window.__REVIEW_URLS.get(reference);
            if (urlFromCache) {
                park.reviewURL = urlFromCache;
                hasReview = true;
            }
        }

        const marker = useActiveDiv
            ? L.marker([latitude, longitude], {
                icon: L.divIcon({
                    className: markerClassName,
                    iconSize: [20, 20],
                })
            })
            : L.circleMarker([latitude, longitude], {
                radius: 6,
                fillColor: getMarkerColorConfigured(parkActivationCount, isUserActivated, created), // Blue
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.9,
            });

        if (hasReview) decorateReviewHalo(marker, park);

        marker.park = park;
        marker.currentActivation = currentActivation;
        //Set up data block
        //
        const tooltipText = currentActivation
            ? `${reference}: ${name} <br> ${currentActivation.activator} on ${currentActivation.frequency} kHz (${currentActivation.mode})${currentActivation.comments ? ` <br> ${currentActivation.comments}` : ''}`
            : `${reference}: ${name} (${parkActivationCount} activations)`;

        marker
            .addTo(layerGroup)
            .bindPopup("<b>Loading park info...</b>", {
                // cap its width on small screens
                maxWidth: 280,
                keepInView: true,
                autoPan: true,
                autoPanPadding: [30, 40],
                keepInView: false
            })

            .bindTooltip(tooltipText, {
                direction: "top",
                opacity: 0.9,
                sticky: false,
                className: "custom-tooltip",
            });

        const handleMarkerTap = (e) => {
            if (e) L.DomEvent.stop(e);
            marker.closeTooltip();
            openPopupWithAutoPan(marker);
        };
        marker.on('click', handleMarkerTap);
        marker.on('touchend', handleMarkerTap);

        marker.on('popupopen', async function () {
            try {
                parkActivations = await fetchParkActivations(reference);
                await saveParkActivationsToIndexedDB(reference, parkActivations);

                let popupContent = await fetchFullPopupContent(park, currentActivation, parkActivations);

                if (park.change) {
                    popupContent += `
                        <div style="font-size: 0.85em; font-style: italic; margin-top: 0.5em;">
                            <b>Recent change:</b> ${park.change}
                        </div>
                    `;
                }

                this.setPopupContent(popupContent);
            } catch (error) {
                console.error(`Error fetching activations for park ${reference}:`, error);
                this.setPopupContent("<b>Error loading park info.</b>");
            }
        });
    });

    console.log("All parks displayed with appropriate highlights.");
}

// ---- helper: extract 2-letter US state/territory codes from locationDesc ----
// ---- helpers ----
function extractStates(locationDesc) {
    if (!locationDesc) return [];
    const tokens = String(locationDesc)
        .split(/[,\s/|]+/)
        .map(s => s.trim().toUpperCase())
        .map(s => s.replace(/^US-/, ''))      // accept "US-XX" and "XX"
        .filter(s => /^[A-Z]{2}$/.test(s));   // keep only 2-letter codes
    return [...new Set(tokens)];            // de-dupe, preserve order
}

function haversineMiles(lat1, lon1, lat2, lon2) {
    const toRad = d => d * Math.PI / 180;
    const R = 3958.7613; // Earth radius in miles
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function fetchAndCacheParks(jsonUrl, cacheDuration) {
    const db = await getDatabase();
    const now = Date.now();
    const lastFullFetch = await getLastFetchTimestamp('allparks.json');
    let parks = [];

    // Full fetch if stale; when using cache, also backfill states
    if (!lastFullFetch || (Date.now() - lastFullFetch > cacheDuration)) {
        console.log('Fetching full park data from JSON...');
        const response = await fetch(jsonUrl);
        if (!response.ok) throw new Error(`Failed to fetch park data: ${response.statusText}`);

        const parsed = await response.json();

        // Baseline load from allparks.json; no "created" here
        parks = parsed.map(park => {
            const states = extractStates(park.locationDesc);
            return {
                reference: park.reference,
                name: park.name,
                latitude: parseFloat(park.latitude),
                longitude: parseFloat(park.longitude),
                grid: park.grid,                  // keep if present in allparks.json
                locationDesc: park.locationDesc,  // keep raw source string
                attempts: parseInt(park.attempts, 10) || 0,
                activations: parseInt(park.activations, 10) || 0,
                qsos: parseInt(park.qsos, 10) || 0,
                states: states,                           // e.g., ['MD','DC','WV']
                primaryState: states[0] || null
            };
        });

        await upsertParksToIndexedDB(parks);
        await setLastFetchTimestamp('allparks.json', now);
    } else {
        console.log('Using cached full park data');
        const cached = await getAllParksFromIndexedDB();

        // Backfill states for any records that predate this change
        const patched = cached.map(p => {
            if (p.states && Array.isArray(p.states) && p.states.length) return p;
            const states = extractStates(p.locationDesc);
            return {
                ...p,
                states,
                primaryState: p.primaryState ?? (states[0] || null)
            };
        });

        // Only write back if we actually added anything
        const needsUpsert = patched.some((p, i) => p !== cached[i]);
        if (needsUpsert) {
            await upsertParksToIndexedDB(patched);
        }
        parks = patched;
    }

    // Apply updates from changes.json and ensure states stay in sync
    try {
        const changesResponse = await fetchIfModified('/potamap/data/changes.json', 'changes.json');
        if (changesResponse && changesResponse.ok) {
            const changesData = await changesResponse.json();

            const updatedParks = changesData.map(park => {
                const isNew = park.change === 'Park added';
                const states = extractStates(park.locationDesc);
                return {
                    reference: park.reference,
                    name: park.name,
                    latitude: parseFloat(park.latitude),
                    longitude: parseFloat(park.longitude),
                    grid: park.grid,
                    locationDesc: park.locationDesc,
                    attempts: parseInt(park.attempts, 10) || 0,
                    activations: parseInt(park.activations, 10) || 0,
                    qsos: parseInt(park.qsos, 10) || 0,
                    states: states,
                    primaryState: states[0] || null,
                    created: isNew
                        ? (park.timestamp ? new Date(park.timestamp).getTime() : Date.now())
                        : undefined,
                    change: park.change
                };
            });

            console.log("Final updatedParks going to IndexedDB:", updatedParks);
            await upsertParksToIndexedDB(updatedParks);
            await setLastModifiedHeader('changes.json', changesResponse.headers.get('last-modified'));
            console.log('Applied updates from changes.json');
        } else {
            console.log('No new changes in changes.json');
        }
    } catch (err) {
        console.warn('Failed to apply park changes:', err);
    }

    return parks;
}

async function fetchAndApplyUserActivations(callsign = null) {
    // Try to load stored callsign
    if (!callsign) {
        callsign = localStorage.getItem("pota_user_callsign");
    }

    // Prompt the user if still not available
    if (!callsign) {
        callsign = prompt("Enter your callsign to load your POTA activations:");
        if (!callsign) {
            console.warn("No callsign provided; skipping user activation fetch.");
            return;
        }
        localStorage.setItem("pota_user_callsign", callsign.trim().toUpperCase());
    }

    const url = `https://api.pota.app/profile/${callsign}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch activations: ${response.statusText}`);
        }

        const profile = await response.json();
        const recent = profile.recent_activity.activations || [];

        if (recent.length === 0) {
            console.log("No recent activations returned.");
            return;
        }

        const newActivations = recent.map(act => ({
            reference: act.reference.trim(),
            name: (act.park || "").trim(),
            qso_date: act.date.trim(),
            activeCallsign: callsign,
            totalQSOs: parseInt(act.total, 10) || 0,
            qsosCW: parseInt(act.cw, 10) || 0,
            qsosDATA: parseInt(act.data, 10) || 0,
            qsosPHONE: parseInt(act.phone, 10) || 0,
            attempts: parseInt(act.total, 10) || 0,
            activations: parseInt(act.total, 10) || 0
        }));

        const existing = await getActivationsFromIndexedDB();
        const map = new Map(existing.map(act => [act.reference, act]));

        newActivations.forEach(act => {
            const ref = act.reference;
            if (map.has(ref)) {
                const merged = {
                    ...map.get(ref),
                    ...act,
                    totalQSOs: map.get(ref).totalQSOs + act.totalQSOs,
                    qsosCW: map.get(ref).qsosCW + act.qsosCW,
                    qsosDATA: map.get(ref).qsosDATA + act.qsosDATA,
                    qsosPHONE: map.get(ref).qsosPHONE + act.qsosPHONE,
                    activations: map.get(ref).activations + act.activations
                };
                map.set(ref, merged);
            } else {
                map.set(ref, act);
            }
        });

        activations = Array.from(map.values());
        await saveActivationsToIndexedDB(activations);
        console.log(`Fetched and merged ${newActivations.length} recent activations.`);

        updateActivationsInView();
        displayCallsign();

    } catch (error) {
        console.error("Error fetching or processing user activations:", error);
    }
}

// === Modes ingestion (initial + rolling updates) =============================

const MODES_URL = '/potamap/backend/modes.json';
const MODES_CHANGES_URLS = [
    '/potamap/backend/mode-changes.json',
    '/potamap/backend/mode-changes.json'
];

const MODES_KEYS = {
    initialized: 'modes.initialized',
    baseETag: 'modes.base.etag',
    baseLM: 'modes.base.lastModified',
    baseUpdatedAt: 'modes.base.updatedAt',
    changesETag: 'modes.changes.etag',
    changesLM: 'modes.changes.lastModified',
    changesUpdatedAt: 'modes.changes.updatedAt',
    changesLastDate: 'modes.changes.lastDate'
};

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Robustly detects which parks have mode/QSO changes.
 * Returns an array of park references (uppercase) that have mode/QSO updates.
 * Supports multiple input shapes from MODES_CHANGES_URLS:
 *   1) ["US-0001", ...]
 *   2) [{ reference: "US-0001", ... }, ...]
 *   3) [{ reference: "US-0001", cw: 10, ssb: 20, data: 5 }, ...]
 *   4) { changes: [...] } or { batches: [{date, changes: [...]}, ...] }
 */
async function detectModeChanges() {
    // Returns an array of park references (uppercase) that have mode/QSO updates.
    // Supports multiple input shapes:
    //  1) ["US-0001", "US-6363", ...]
    //  2) [{ reference: "US-0001", ...full park... }, ...]
    //  3) [{ reference: "US-0001", cw: 10, ssb: 20, data: 5 }, ...]
    //  4) { changes: [...] } or { batches: [{date, changes: [...]}, ...] }

    const urls = Array.isArray(MODES_CHANGES_URLS) ? MODES_CHANGES_URLS : [];

    // Helper: normalize a single row to a reference string
    const toRef = (row) => {
        if (!row) return null;
        if (typeof row === 'string') return String(row).trim().toUpperCase();
        if (typeof row === 'object') {
            const r = row.reference || row.ref || row.id;
            if (!r) return null;
            return String(r).trim().toUpperCase();
        }
        return null;
    };

    // Helper: extract refs from a parsed JSON payload
    const extractRefs = (body) => {
        const out = [];
        if (!body) return out;

        if (Array.isArray(body)) {
            for (const item of body) {
                const ref = toRef(item);
                if (ref) out.push(ref);
            }
            return out;
        }

        // Object wrapper forms
        if (Array.isArray(body.changes)) {
            for (const item of body.changes) {
                const ref = toRef(item);
                if (ref) out.push(ref);
            }
            return out;
        }

        if (Array.isArray(body.batches)) {
            for (const batch of body.batches) {
                if (!Array.isArray(batch.changes)) continue;
                for (const item of batch.changes) {
                    const ref = toRef(item);
                    if (ref) out.push(ref);
                }
            }
            return out;
        }

        return out;
    };

    // Try candidates in order until one succeeds
    for (const url of urls) {
        try {
            const res = await fetch(url, {cache: 'no-store'});
            if (!res.ok) {
                // Try the next candidate on 404/403/etc.
                continue;
            }
            const body = await res.json();
            const refs = extractRefs(body);
            if (!refs.length) continue;

            // Deduplicate & normalize
            const unique = [...new Set(refs.filter(Boolean))];
            return unique;
        } catch (e) {
            // Network or parse error — try next candidate
            continue;
        }
    }

    // Nothing found
    return [];
}

function getFromStore(store, key) {
    return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}


async function upsertParksToIndexedDB(parks) {
    const db = await getDatabase();
    const tx = db.transaction('parks', 'readwrite');
    const store = tx.objectStore('parks');

    for (const park of parks) {
        const existing = await getFromStore(store, park.reference);

        const merged = {
            ...existing,
            ...park,
            created: park.created ?? existing?.created // ✅ Only update if explicitly provided
        };

        store.put(merged);
    }

    return tx.complete;
}


async function getAllParksFromIndexedDB() {
    const db = await getDatabase();
    const transaction = db.transaction('parks', 'readonly');
    const store = transaction.objectStore('parks');

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Quickly render whatever we already have in IndexedDB, limited to current map view
async function renderInitialParksFromIDBInView() {
    try {
        if (!map) return; // map must exist so we can read bounds

        const all = await getAllParksFromIndexedDB();
        if (!Array.isArray(all) || all.length === 0) {
            console.log('[boot] No parks in IDB yet — skipping early render.');
            return;
        }

        // Keep global `parks` up to date so downstream code works,
        // but only display the subset in bounds to keep it snappy.
        parks = all;

        // Reuse existing logic that filters to current bounds & applies toggles
        applyActivationToggleState();
        console.log(`[boot] Early render from IDB: ${all.length} parks available; showing in-bounds subset.`);
    } catch (e) {
        console.warn('[boot] Early IDB render failed:', e);
    }
}


async function getLastFetchTimestamp(key) {
    return parseInt(localStorage.getItem(`lastFetch_${key}`), 10) || null;
}

async function setLastFetchTimestamp(key, timestamp) {
    localStorage.setItem(`lastFetch_${key}`, timestamp.toString());
}

// Conditional fetch: returns Response if modified, or null if not modified / 404.
// Persists ETag/Last-Modified in localStorage under the provided `key`.
async function fetchIfModified(url, key) {
    const lmKey = `lastModified_${key}`;
    const etKey = `etag_${key}`;

    const prevLM = localStorage.getItem(lmKey);
    const prevET = localStorage.getItem(etKey);

    const headers = {};
    if (prevET) headers['If-None-Match'] = prevET;
    if (prevLM) headers['If-Modified-Since'] = prevLM;

    let res;
    try {
        res = await fetch(url, {method: 'GET', headers, cache: 'no-store'});
    } catch (e) {
        console.warn('fetchIfModified: network error for', url, e);
        return null;
    }

    if (res.status === 304) return null;     // Unchanged
    if (!res.ok) {
        if (res.status === 404) return null;   // Missing is not fatal
        console.warn('fetchIfModified: not ok for', url, res.status);
        return null;
    }

    const newET = res.headers.get('ETag');
    const newLM = res.headers.get('Last-Modified');
    if (newET) localStorage.setItem(etKey, newET);
    if (newLM) localStorage.setItem(lmKey, newLM);

    return res;
}

async function setLastModifiedHeader(key, value) {
    if (value) {
        localStorage.setItem(`lastModified_${key}`, value);
    }
}


/**
 * Initializes the Leaflet map and loads park data from CSV using IndexedDB.
 */
async function setupPOTAMap() {
    const csvUrl = '/potamap/data/allparks.json';

    try {
        // 1) Paint FIRST: use saved center or a sensible default; do NOT wait on data.
        let savedCenter = null;
        try {
            savedCenter = JSON.parse(localStorage.getItem('mapCenter') || 'null');
        } catch {
        }
        const [defLat, defLng] = savedCenter || [39.8283, -98.5795]; // CONUS center as fallback
        map = initializeMap(defLat, defLng);
        map.activationsLayer = L.layerGroup().addTo(map);

        // 2) Kick geolocation WITHOUT blocking first paint; pan when it arrives
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    userLat = position.coords.latitude;
                    userLng = position.coords.longitude;
// Do not re-center on load; just drop/update the pin
                    try {
                        setUserLocationMarker(userLat, userLng);
                    } catch {
                    }
                } catch (e) {
                    console.warn('geo location error', e);
                }
                try {
                    await fetchAndDisplaySpots();
                    applyActivationToggleState();
                } catch (e) {
                    console.warn(e);
                }
                displayCallsign();
            },
            async (error) => {
                console.warn('Geolocation failed:', error && error.message);
                try {
                    await fetchAndDisplaySpots();
                    applyActivationToggleState();
                } catch (e) {
                    console.warn(e);
                }
                displayCallsign();
            }
        );

        // Yield one frame so the shell can render before heavy work
        await new Promise(r => requestAnimationFrame(r));

        // 3) Immediately show any cached parks from IDB that are in view
        await renderInitialParksFromIDBInView();

        // 4) Start data pipeline in the background (parallel)
        const parksP = (async () => {
            await fetchAndCacheParks(csvUrl, cacheDuration);
            parks = await getAllParksFromIndexedDB();
        })().catch(err => {
            console.warn('parks load failed', err);
        });

        const nferP = parksP.then(() => loadAndApplyNferData()).catch(e => console.warn(e));

        const actsP = (async () => {
            activations = await getActivationsFromIndexedDB();
            const userCallsign = await getOrPromptUserCallsign();
            if (userCallsign) {
                await fetchAndApplyUserActivations(userCallsign);
            }
        })().catch(e => console.warn('activations init', e));

        // 5) When parks are ready, render once (don’t block first paint)
        await parksP;
        try {
            applyActivationToggleState();
            displayCallsign();
        } catch (e) {
            console.warn('initial render failed', e);
        }

        // 6) Defer modes check so it never blocks map paint; ensure it runs only once
        if (!window.__modesInitStarted && typeof checkAndUpdateModesAtStartup === 'function') {
            window.__modesInitStarted = true;
            const startModes = () => checkAndUpdateModesAtStartup().catch(console.warn);
            if ('requestIdleCallback' in window) requestIdleCallback(startModes); else setTimeout(startModes, 0);
        }

    } catch (error) {
        console.error('Error setting up POTA map:', error && error.message);
        alert('Failed to set up the POTA map. Please try again later.');
    }
}

async function loadAndApplyNferData() {
    try {
        const response = await fetch('/potamap/data/nfer_from_top_activators.json');
        if (!response.ok) throw new Error(`Failed to fetch NFER data: ${response.statusText}`);

        const raw = await response.json();

        // Map from park reference -> Set of co-activated parks
        const nferMap = {};

        for (const entry of raw) {
            const refs = entry.references;
            for (const park of refs) {
                if (!nferMap[park]) nferMap[park] = new Set();
                for (const other of refs) {
                    if (other !== park) {
                        nferMap[park].add(other);
                    }
                }
            }
        }

        const db = await getDatabase();
        const tx = db.transaction('parks', 'readwrite');
        const store = tx.objectStore('parks');

        const updatePromises = [];

        for (const [reference, nferSet] of Object.entries(nferMap)) {
            updatePromises.push(
                new Promise((resolve, reject) => {
                    const getReq = store.get(reference);
                    getReq.onsuccess = () => {
                        const park = getReq.result;
                        if (park) {
                            park.nfer = Array.from(nferSet).sort();
                            store.put(park);
                        }
                        resolve();
                    };
                    getReq.onerror = () => {
                        console.warn(`Failed to read park ${reference} from IndexedDB`);
                        resolve(); // Don't block on errors
                    };
                })
            );
        }

        await Promise.all(updatePromises);
        console.log("NFER relationships applied to parks in IndexedDB.");
    } catch (err) {
        console.error("Error loading or applying NFER data:", err);
    }
}

function getCurrentUserCallsign() {
    const validCallsigns = activations
        .map(act => act.activeCallsign)
        .filter(cs => cs && typeof cs === "string" && cs.trim().length > 0);

    const unique = [...new Set(validCallsigns.map(cs => cs.trim()))];

    if (unique.length === 1) {
        return unique[0]; // ✅ Found a single consistent callsign
    } else if (unique.length > 1) {
        console.warn("Multiple callsigns found in activations:", unique);
        return unique[0]; // Still return one, fallback behavior
    }

    console.warn("No valid callsign found in activations.");
    return null;
}

async function getOrPromptUserCallsign() {
    let stored = localStorage.getItem("userCallsign");
    if (stored) return stored;

    // Try to extract from activations
    const fromActivations = getCurrentUserCallsign();
    if (fromActivations) {
        localStorage.setItem("userCallsign", fromActivations);
        return fromActivations;
    }

    // Otherwise, ask the user
    const input = prompt("Enter your callsign to show your POTA activations:");
    if (input && input.trim().length > 0) {
        const callsign = input.trim().toUpperCase();
        localStorage.setItem("userCallsign", callsign);
        return callsign;
    }

    return null;
}

function applyActivationToggleState() {
    const toggleButton = document.getElementById('toggleActivations');
    const userActivatedReferences = activations.map((act) => act.reference);

    const buttonTexts = [
        "Show My Activations",
        "Hide My Activations",
        "Show Currently On Air",
        "Show All Spots",
    ];

    if (toggleButton) {
        toggleButton.innerText = buttonTexts[activationToggleState];
    }

    let parksInBounds = getParksInBounds(parks);
    let parksToDisplay = [];

    switch (activationToggleState) {
        case 0: // Show all parks in bounds
            parksToDisplay = parksInBounds;
            break;

        case 1: // Show just user's activations in bounds
            parksToDisplay = parksInBounds.filter(p => userActivatedReferences.includes(p.reference));
            break;

        case 2: // Show parks not activated by user
            parksToDisplay = parksInBounds.filter(p => !userActivatedReferences.includes(p.reference));
            break;

        case 3: // Show only currently active parks (on air)
            const onAirRefs = spots.map(s => s.reference);
            parksToDisplay = parksInBounds.filter(p => onAirRefs.includes(p.reference));
            break;

        default:
            console.warn(`Unknown activationToggleState: ${activationToggleState}`);
            parksToDisplay = parksInBounds;
            break;
    }

    displayParksOnMap(map, parksToDisplay, userActivatedReferences, map.activationsLayer);
}

/**
 * Fetches active POTA spots from the API and displays them on the map.
 */
async function fetchAndDisplaySpots() {
    const SPOT_API_URL = 'https://api.pota.app/v1/spots';
    try {
        const response = await fetch(SPOT_API_URL);
        if (!response.ok) throw new Error(`Error fetching spots: ${response.statusText}`);

        spots = await response.json();  // ✅ store globally for isActive logic

        console.log('Fetched spots data:', spots); // Debugging

        if (!map) {
            console.error('Map instance is not initialized.');
            return;
        }

        // Just refresh markers using the existing unified logic
        if (!map.activationsLayer) {
            map.activationsLayer = L.layerGroup().addTo(map);
        } else {
            if (!window.__nonDestructiveRedraw) {
                map.activationsLayer.clearLayers();
            }
        }

        const activatedReferences = activations.map(act => act.reference);

        const parksInBounds = getParksInBounds(parks);
//        displayParksOnMap(map, parksInBounds, activatedReferences, map.activationsLayer);
        applyActivationToggleState();
        console.log(`Updated display of ${spots.length} active spots on the map.`);
    } catch (error) {
        console.error('Error fetching or displaying POTA spots:', error);
    }
}


/**
 * Fetches active POTA spots from the API, filters them to the current map bounds,
 * and displays them so that their popups show both park info + spot data.
 * Clicking on a spot now also closes any visible tooltip.
 */
async function fetchAndDisplaySpotsInCurrentBounds(mapInstance) {
    const SPOT_API_URL = "https://api.pota.app/v1/spots";
    try {
        const response = await fetch(SPOT_API_URL);
        if (!response.ok) throw new Error(`Error fetching spots: ${response.statusText}`);
        const spots = await response.json();

        console.log("Fetched spots data:", spots);

        if (!mapInstance.spotsLayer) {
            console.log("Initializing spots layer...");
            mapInstance.spotsLayer = L.layerGroup().addTo(mapInstance);
        } else {
            console.log("Clearing existing spots layer...");
            mapInstance.spotsLayer.clearLayers();
        }

        const bounds = mapInstance.getBounds();
        console.log("Current map bounds:", bounds);

        const spotsInBounds = spots.filter(({latitude, longitude}) => {
            if (!latitude || !longitude) {
                console.warn("Invalid coordinates:", {latitude, longitude});
                return false;
            }
            return bounds.contains([latitude, longitude]);
        });

        console.log(`Displaying ${spotsInBounds.length} spots in current bounds.`);

        if (!mapInstance.activationsLayer) {
            mapInstance.activationsLayer = L.layerGroup().addTo(mapInstance);
        } else {
            mapInstance.activationsLayer.clearLayers();
        }

        const activatedReferences = activations.map(act => act.reference);
        //displayParksOnMap(mapInstance, parks, activatedReferences, mapInstance.activationsLayer);
        applyActivationToggleState();

    } catch (error) {
        console.error("Error fetching or displaying POTA spots:", error);
    }
}


/**
 * Initializes the recurring fetch for POTA spots.
 */
function initializeSpotFetching() {
    fetchAndDisplaySpots(); // Initial
    // in initializeSpotFetching()
    if (!isDesktopMode) {
        setInterval(fetchAndDisplaySpots, 5 * 60 * 1000);
    }
}

// Ensure spots fetching starts when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeSpotFetching();
});


/**
 * Determines the marker color based on activations and user activation status.
 * @param {number} activations - The number of activations for the park.
 * @param {boolean} userActivated - Whether the user has activated the park.
 * @returns {string} The color code for the marker.
 */
function getMarkerColor(activations, userActivated, created) {
    // Treat missing/invalid dates as "old" (i.e., not new)
    let isNew = false;
    if (created) {
        const createdDate = new Date(created);
        if (!isNaN(createdDate)) {
            const ageInDays = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
            isNew = ageInDays <= 30; // Purple for brand-new parks (<= 30 days)
        }
    }

    if (isNew) return "#800080";   // Purple (new)
    if (userActivated) return "#06f406"; // Light green (user-activated)

    // --- Restore legacy behavior: dark blue for zero activations ---
    if (!activations || activations === 0) return "#001a66"; // Dark blue (no activations)

//    if (activations > 10) return "#ff6666"; // Light red (highly active)
    if (activations > 0) return "#90ee90"; // Light green (some activity)

    // Fallback
    return "#001a66"; // Dark blue
}

// Provide getMarkerColorConfigured wrapper if not already defined
if (typeof getMarkerColorConfigured !== "function") {
    function getMarkerColorConfigured(activations, userActivated, created) {
        return getMarkerColor(activations, userActivated, created);
    }
}


/**
 * Optimizes Leaflet controls and popups for better mobile experience.
 */
function optimizeLeafletControlsAndPopups() {
    const style = document.createElement('style');
    style.innerHTML = `
        /* Adjust Leaflet Controls for Mobile */
        .leaflet-control-attribution {
            font-size: 12px;
        }

        .leaflet-control {
            font-size: 16px; /* Increase control sizes */
        }

        /* Adjust popup font sizes for better readability on mobile */
        .leaflet-popup-content {
            font-size: 16px;
            line-height: 1.5;
        }

        /* Ensure links are easily tappable */
        .leaflet-popup-content a {
            font-size: 16px;
            text-decoration: underline;
        }

        /* Ensure images or other media within popups are responsive */
        .leaflet-popup-content img {
            max-width: 100%;
            height: auto;
        }

        /* Adjust tooltip styles for mobile */
        .custom-tooltip {
            font-size: 14px;
            padding: 8px;
        }

        @media (min-width: 601px) {
            .custom-tooltip {
                font-size: 12px;
                padding: 5px;
            }
        }
    `;
    document.head.appendChild(style);
    console.log("Leaflet controls and popups optimized for mobile."); // Debugging
}

// Call the optimization function
optimizeLeafletControlsAndPopups();

/**
 * Refreshes the map activations based on the current state.
 */
function refreshMapActivations() {
    // Clear existing markers or layers if necessary
    if (map.activationsLayer) {
        if (!window.__nonDestructiveRedraw) {
            map.activationsLayer.clearLayers();
        }
        console.log("Cleared existing activation markers."); // Debugging
    }

    // Create a new layer group
    map.activationsLayer = L.layerGroup().addTo(map);
    console.log("Created activationsLayer."); // Debugging

    // Determine which activations to display
    let activatedReferences = [];
    const toggleButton = document.getElementById('toggleActivations');
    if (toggleButton && toggleButton.classList.contains('active')) {
        activatedReferences = activations.map(act => act.reference);
        console.log("Activated References in Refresh:", activatedReferences); // Debugging
    }
    // Display parks with the current activations
    const parksInBounds = getParksInBounds(parks);
//    displayParksOnMap(map, parksInBounds, activatedReferences, map.activationsLayer);
    applyActivationToggleState();
    console.log("Displayed activated parks (if any) based on refresh."); // Debugging
}


/**
 * Adds a "Go To Park" button below the search box for global dataset search.
 */
function addGoToParkButton() {
    const searchBoxContainer = document.getElementById('searchBoxContainer');

    if (!searchBoxContainer) {
        console.error("SearchBoxContainer not found.");
        return;
    }

    // Create Go To Park button
    const goToParkButton = document.createElement('button');
    goToParkButton.id = 'goToParkButton';
    goToParkButton.innerText = 'Go To Park';
    goToParkButton.title = 'Expand search to the full dataset and zoom to a park';
    goToParkButton.style.marginTop = '10px';

    // Add event listener for Go To Park button
    goToParkButton.addEventListener('click', () => {
        triggerGoToPark();
    });

    // Add Clear Search button if not already present
    const clearButton = document.getElementById('clearSearch');
    if (!clearButton) {
        const clearSearchButton = document.createElement('button');
        clearSearchButton.id = 'clearSearch';
        clearSearchButton.innerText = 'Clear Search';
        clearSearchButton.title = 'Clear Search';
        clearSearchButton.style.marginTop = '10px';

        clearSearchButton.addEventListener('click', clearSearchInput);
        searchBoxContainer.appendChild(clearSearchButton);
        console.log("Clear Search button added.");
    }

    // Append Go To Park button after the Clear Search button
    searchBoxContainer.appendChild(goToParkButton);
    console.log("Go To Park button added.");

    // Bind Enter key to Go To Park functionality
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const raw = searchBox.value.trim();
                if (raw.startsWith('?')) {
                    // Let handleSearchEnter manage PQL Enter
                    return;
                }
                event.preventDefault();
                triggerGoToPark(true);
            }
        });
        console.log("Enter key bound to Go To Park functionality (non-PQL only).");
    }
}

/**
 * Triggers the Go To Park functionality by searching and zooming to a park.
 */
function triggerGoToPark() {
    const searchBox = document.getElementById('searchBox');

    if (!searchBox || !searchBox.value.trim()) {
        alert('Please enter a search term.');
        return;
    }

    if (searchBox.value.trim().startsWith('?')) {
        // PQL Enter is handled by handleSearchEnter; ignore here to avoid duplicate alerts.
        return;
    }

    const query = normalizeString(searchBox.value);
    const matchingPark = parks.find(park =>
        normalizeString(park.name).includes(query) ||
        normalizeString(park.reference).includes(query)
    );

    if (matchingPark) {
        zoomToPark(matchingPark);
    } else {
        alert('No matching park.');
    }
}


// Initialize Go To Park button on DOMContentLoaded
addEventListener('DOMContentLoaded', () => {
    addGoToParkButton();
});

/**
 * Adds CSS styles for the hamburger menu and other responsive elements.
 * (Already incorporated into the enhanceHamburgerMenuForMobile function)
 */

/**
 * Ensure that the map container adjusts to viewport changes
 */
window.addEventListener('resize', debounce(() => {
    if (map) {
        map.invalidateSize();
        console.log("Map size invalidated on window resize.");
        if (!isPopupOpen) {
            applyActivationToggleState();
        }
    }
}, 300));


function initializeFilterChips() {
    const pairs = [
        ['chipMyActs', 'myActivations'],
        ['chipOnAir', 'currentlyActivating'],
        ['chipNewParks', 'newParks'],
        ['chipAllParks', 'allParks']
    ];

    function setChip(btn, on) {
        btn.classList.toggle('active', !!on);
        btn.setAttribute('aria-pressed', !!on);
    }

    function updateChipStates() {
        const chipAll = document.getElementById('chipAllParks');
        if (chipAll) setChip(chipAll, !!potaFilters.allParks);

        [['chipMyActs', 'myActivations'], ['chipOnAir', 'currentlyActivating'], ['chipNewParks', 'newParks']].forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (!el) return;
            setChip(el, !!potaFilters[key]);
        });
    }

    // Initialize states
    updateChipStates();

    // Wire individual chips
    const chipMy = document.getElementById('chipMyActs');
    const chipOnAir = document.getElementById('chipOnAir');
    const chipNew = document.getElementById('chipNewParks');
    const chipAll = document.getElementById('chipAllParks');

    if (chipMy) chipMy.addEventListener('click', () => {
        potaFilters.myActivations = !potaFilters.myActivations;
        savePotaFilters();
        updateChipStates();
        refreshMarkers();
    });
    if (chipOnAir) chipOnAir.addEventListener('click', () => {
        potaFilters.currentlyActivating = !potaFilters.currentlyActivating;
        savePotaFilters();
        updateChipStates();
        refreshMarkers();
    });
    if (chipNew) chipNew.addEventListener('click', () => {
        potaFilters.newParks = !potaFilters.newParks;
        savePotaFilters();
        updateChipStates();
        refreshMarkers();
    });
    if (chipAll) chipAll.addEventListener('click', () => {
        const willBeOn = !potaFilters.allParks;
        potaFilters.allParks = willBeOn;
        if (willBeOn) {
            potaFilters.myActivations = true;
            potaFilters.currentlyActivating = true;
            potaFilters.newParks = true;
        } else {
            potaFilters.myActivations = false;
            potaFilters.currentlyActivating = false;
            potaFilters.newParks = false;
        }
        savePotaFilters();
        updateChipStates();
        refreshMarkers();
    });
}
