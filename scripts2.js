/** Run a callback once the Leaflet map exists and is fully ready. */
function whenMapReady(cb) {
    if (typeof cb !== 'function') return;
    const go = function () {
        try {
            cb();
        } catch (e) {
        }
    };
    if (typeof window === 'undefined' || !window.map) {
        // Poll briefly until map is created
        let tries = 40;
        const t = setInterval(function () {
            if (window.map) {
                clearInterval(t);
                whenMapReady(cb);
            } else if (--tries <= 0) {
                clearInterval(t);
                console.warn("whenMapReady: map not initialized");
            }
        }, 50);
        return;
    }
    if (typeof map.whenReady === 'function') {
        map.whenReady(go);
    } else if (map._loaded) {
        go();
    } else {
        map.once && map.once('load', go);
    }
}

// === Enhanced popup stability lock system ===
let __popupLockUntil = 0;
let __popupStabilityMode = false;

function lockPopupRefresh(ms = 900) {
    __popupLockUntil = Date.now() + ms;
    __popupStabilityMode = true;
}

function shouldDeferRefresh() {
    return Date.now() < __popupLockUntil || __popupStabilityMode;
}

function clearPopupLock() {
    __popupStabilityMode = false;
    __popupLockUntil = 0;
}

// === Marker registry shim: auto-register markers created with options.reference/ref ===
(function () {
    if (typeof L === 'undefined' || !L.marker) return;
    if (L.__markerShimInstalled) return;
    L.__markerShimInstalled = true;

    const __origMarker = L.marker;
    L.marker = function (latlng, options) {
        const m = __origMarker.call(this, latlng, options || {});
        try {
            const ref = (options && (options.reference || options.ref)) || m._parkRef;
            if (ref) {
                m._parkRef = ref;
                window.markerByRef = window.markerByRef || {};
                window.markerByRef[ref] = m;
            }
        } catch (e) { /* no-op */
        }
        return m;
    };
})();


// === Global popup opener helper ===

// === Helpers for Go-To-Park popup behavior ===
window.openTempPopupAt = function (lat, lng, html) {
    try {
        if (!window.map) return;
        const content = html || "<b>Loading park…</b>";
        var tmp = null;
        whenMapReady(function () {
            tmp = L.popup({autoPan: true, keepInView: true, autoPanPadding: [30, 40]})
                .setLatLng([lat, lng]).setContent(content).openOn(map);
        });
        // Close automatically when a real marker popup opens
        map.once('popupopen', function (ev) {
            try {
                if (ev && ev.popup !== tmp) map.closePopup(tmp);
            } catch (e) {
            }
        });
    } catch (e) {
        console.warn("openTempPopupAt failed", e);
    }
};

window.__findMarkerByRef = window.__findMarkerByRef || function (reference) {
    if (!window.map || !reference) return null;
    if (window.markerByRef && window.markerByRef[reference]) return window.markerByRef[reference];

    function scanGroup(g) {
        var found = null;
        if (!g || !g.eachLayer) return null;
        g.eachLayer(function (layer) {
            if (found) return;
            // include CircleMarker and DivIcon markers (all inherit from Marker in Leaflet)
            if (layer && (layer instanceof L.Marker)) {
                var ref = (layer._parkRef || (layer.options && (layer.options.reference || layer.options.ref)));
                if (ref === reference) found = layer;
            } else if (layer && layer.eachLayer) {
                var inner = scanGroup(layer);
                if (inner) found = inner;
            }
        });
        return found;
    }

    var groups = [];
    if (map.activationsLayer) groups.push(map.activationsLayer);
    if (map.spotsLayer) groups.push(map.spotsLayer);
    if (map.reviewLayer) groups.push(map.reviewLayer);
    for (var i = 0; i < groups.length; i++) {
        var m = scanGroup(groups[i]);
        if (m) return m;
    }
    return scanGroup(map) || null;
};

window.openParkPopupByRef = function (reference, attempts) {
    attempts = (typeof attempts === 'number') ? attempts : 14;
    whenMapReady(function () {
        if (!reference) return;
        var marker = (typeof window.__findMarkerByRef === 'function') ? window.__findMarkerByRef(reference) : null;
        if (marker) {
            try {
                if (typeof marker.fire === 'function') {
                    marker.fire('click');
                } else if (typeof marker.openPopup === 'function') {
                    marker.openPopup();
                }
            } catch (e) {
                console.warn("openParkPopupByRef: open failed", e);
            }
            return;
        }
        if (attempts > 0) {
            try {
                if (typeof window.refreshMarkers === 'function') window.refreshMarkers();
            } catch (e) {
            }
            setTimeout(function () {
                window.openParkPopupByRef(reference, attempts - 1);
            }, 140);
        } else {
            console.warn("openParkPopupByRef: marker not found for", reference);
        }
    });
};

window.openParkPopupByRef = function (reference, attempts) {
    attempts = (typeof attempts === 'number') ? attempts : 14;
    if (!window.map || !reference) return;
    var marker = (typeof window.__findMarkerByRef === 'function') ? window.__findMarkerByRef(reference) : null;
    if (marker) {
        try {
            if (typeof marker.fire === 'function') {
                marker.fire('click');
            } else if (typeof marker.openPopup === 'function') {
                marker.openPopup();
            }
        } catch (e) {
            console.warn("openParkPopupByRef failed", e);
        }
        return;
    }
    if (attempts > 0) {
        try {
            if (typeof window.refreshMarkers === 'function') window.refreshMarkers();
        } catch (e) {
        }
        setTimeout(function () {
            window.openParkPopupByRef(reference, attempts - 1);
        }, 110);
    } else {
        console.warn("openParkPopupByRef: marker not found for", reference);
    }
};

//POTAmap (c) POTA News & Reviews https://pota.review
//261
//
// Yield to the browser for first paint
const nextFrame = () => new Promise(r => requestAnimationFrame(r));

function getModeLoadingIndicator() {
    let el = document.getElementById('mode-loading');
    if (!el) {
        el = document.createElement('div');
        el.id = 'mode-loading';
        el.textContent = 'Updating mode data…';
        document.body.appendChild(el);
    }
    return el;
}

// --- Single-run guard for modes init ---
let __modesInitStarted = false;

async function ensureModesInitOnce() {
    if (__modesInitStarted) return;
    __modesInitStarted = true;
    try {
        const haveChanges = await detectModeChanges();
        if (haveChanges) {
            const indicator = getModeLoadingIndicator();
            indicator.style.display = 'block';
            try {
                await checkAndUpdateModesAtStartup();
            } catch (e) {
                console.warn(e);
            } finally {
                indicator.style.display = 'none';
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
// Stabilize: avoid refresh-induced popup closes while the map pans
    lockPopupRefresh(900);
    if (!map || !marker) return;
    __skipNextMarkerRefresh = true;
    marker.openPopup();
}

// Ensure popup-collapsible styles are present (runtime injector as a safety net)
function ensurePopupCollapsibleCss() {
    if (document.getElementById('popup-collapsible-css')) return;
    const css = `
.leaflet-popup-content details.popup-collapsible {
  margin: 6px 0 6px;
  padding: 0;
  border: 1px solid rgba(0,0,0,0.15);
  border-radius: 6px;
  background: #fafafa;
  overflow: hidden;
}
.leaflet-popup-content details.popup-collapsible:first-of-type { margin-top: 4px; }
.leaflet-popup-content details.popup-collapsible:last-of-type  { margin-bottom: 4px; }
.leaflet-popup-content details.popup-collapsible > summary {
  cursor: pointer;
  list-style: none;
  padding: 8px 10px;
  font-weight: 600;
  outline: none;
  user-select: none;
}
.leaflet-popup-content details.popup-collapsible > summary::-webkit-details-marker { display: none; }
.leaflet-popup-content details.popup-collapsible > summary::before {
  content: "▸";
  display: inline-block;
  margin-right: 6px;
  transform: translateY(-1px);
}
.leaflet-popup-content details.popup-collapsible[open] > summary::before { content: "▾"; }
.leaflet-popup-content .popup-collapsible-body {
  padding: 8px 10px 10px;
  border-top: 1px solid rgba(0,0,0,0.08);
  background: #fff;
}
@media (max-width: 480px) {
  .leaflet-popup-content details.popup-collapsible { margin: 6px 0 10px; }
  .leaflet-popup-content details.popup-collapsible > summary { padding: 8px 9px; }
  .leaflet-popup-content .popup-collapsible-body { padding: 8px 9px 9px; }
}`;
    const style = document.createElement('style');
    style.id = 'popup-collapsible-css';
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * Fold specific sections of a park popup into collapsible panels (closed by default).
 * We look for headings rendered as <b>Recent Activations:</b> and <b>Current Activation:</b>
 * and move their following content into <details> blocks until the next bold heading or the end.
 * If nothing matches, the original HTML is returned.
 */
function foldPopupSections(html) {
    try {
        ensurePopupCollapsibleCss();
        if (!html || typeof html !== 'string') return html;

        // Stage the HTML so we can manipulate nodes safely
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;

        // Helper: turn a heading node (the <b>...</b>) into a <details> with a <summary>
        function makeDetailsFromBold(boldEl, titleText) {
            const details = document.createElement('details'); // closed by default
            details.className = 'popup-collapsible';
            if (titleText === 'Recent Activations') {
                details.classList.add('recent-activations');
            } else if (titleText === 'Current Activation') {
                details.classList.add('current-activation');
            }

            const summary = document.createElement('summary');
            summary.textContent = titleText;
            details.appendChild(summary);

            // Move following siblings (until next <b>...</b> heading or end) into the details body
            const body = document.createElement('div');
            body.className = 'popup-collapsible-body';

            // Start immediately after the section heading and trim only whitespace/colon breaks.
            // Do NOT skip the next <b>...> label (e.g., "Activator:"), or it will end up outside the panel.
            let node = boldEl.nextSibling;
            while (node && ((node.nodeType === 3 && /^[\s:|]+$/.test(node.textContent)) || node.nodeName === 'BR')) {
                const nextAfter = node.nextSibling;
                node.remove(); // tighten vertical spacing and remove stray colon text nodes
                node = nextAfter;
            }

            // Collect until we hit the next bold heading that looks like a section title
            while (node) {
                const isNextSectionHeader =
                    node.nodeName === 'B' &&
                    /Recent Activations:|Current Activation:/i.test(node.textContent || '');
                if (isNextSectionHeader) break;

                const next = node.nextSibling;
                body.appendChild(node); // this moves the node
                node = next;
            }

            details.appendChild(body);

            // Replace the original bold heading with our details panel
            if (boldEl.parentNode) {
                boldEl.replaceWith(details);
            }
        }

        // Find bold headings that we want to fold
        const bolds = Array.from(wrapper.querySelectorAll('b'));
        // Idempotency: do not double-wrap if already wrapped (look for parent details.popup-collapsible)
        for (const b of bolds) {
            const t = (b.textContent || '').trim();
            if ((/^Recent Activations:\s*$/i.test(t) || /^Current Activation:\s*$/i.test(t)) &&
                !(b.parentElement && b.parentElement.classList && b.parentElement.classList.contains('popup-collapsible'))) {
                if (/^Recent Activations:\s*$/i.test(t)) {
                    makeDetailsFromBold(b, 'Recent Activations');
                } else if (/^Current Activation:\s*$/i.test(t)) {
                    makeDetailsFromBold(b, 'Current Activation');
                }
            }
        }

        return wrapper.innerHTML;
    } catch (e) {
        console.warn('foldPopupSections failed:', e);
        return html;
    }
}

// --- Lightweight Toast UI -------------------------------------------------
function ensureToastCss() {
    if (document.getElementById('pql-toast-css')) return;
    const css = `
  .toast-container{position:fixed;right:14px;bottom:14px;z-index:10000;display:flex;flex-direction:column;gap:8px;pointer-events:none}
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
    const currentZoom = (map && typeof map.getZoom === 'function') ? map.getZoom() : undefined;

    if (!navigator.geolocation) {
        console.warn('Geolocation not supported; falling back.');
        const saved = localStorage.getItem('mapCenter');
        if (saved) {
            try {
                const [lat, lng] = JSON.parse(saved);
                map.setView([lat, lng], currentZoom, {animate: true, duration: 1.0});
            } catch (e) {
                // ignore parse error
            }
        } else if (typeof fallbackToDefaultLocation === 'function') {
            fallbackToDefaultLocation();
        }
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;

            // Update globals if you rely on them elsewhere
            try {
                window.userLat = lat;
                window.userLng = lng;
            } catch (e) {
            }

            if (typeof setUserLocationMarker === 'function') {
                setUserLocationMarker(lat, lng);
            }

            if (map) {
                map.setView([lat, lng], currentZoom, {animate: true, duration: 1.0});
            }
        },
        (error) => {
            console.warn('Geolocation error:', error && error.message);
            const saved = localStorage.getItem('mapCenter');
            if (saved) {
                try {
                    const [lat, lng] = JSON.parse(saved);
                    map.setView([lat, lng], currentZoom, {animate: true, duration: 1.0});
                } catch (e) {
                    // ignore parse error
                }
            } else if (typeof fallbackToDefaultLocation === 'function') {
                fallbackToDefaultLocation();
            }
        },
        {enableHighAccuracy: true, maximumAge: 30000, timeout: 15000}
    );
}

// Helper for console diagnosis
async function diagnoseGeolocation() {
    const findings = {};
    findings.secureContext = window.isSecureContext;
    findings.inIframe = (function(){ try { return window !== window.top; } catch(_){ return true; } })();
    findings.permissionsPolicyHint = 'Check server header: Permissions-Policy: geolocation=(self "https://pota.review")';
    try {
        if ('permissions' in navigator && navigator.permissions.query) {
            findings.permissionState = (await navigator.permissions.query({ name: 'geolocation' })).state;
        } else {
            findings.permissionState = 'unknown (Permissions API not available)';
        }
    } catch { findings.permissionState = 'unknown (query failed)'; }
    try { console.table(findings); } catch(_) { console.log(findings); }
    return findings;
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
        try {
            localStorage.removeItem('recentAddsSig::changes.json');
        } catch {
        }
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
                try {
                    localStorage.removeItem(SIG_KEY);
                } catch {
                }
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
            try {
                localStorage.removeItem(SIG_KEY);
            } catch {
            }
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

// Ensure parks are present in memory and IndexedDB.
// If IndexedDB already has data, hydrate memory from it without a network fetch.
// Otherwise, fetch allparks.json once and seed the database.
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

        // If we already have data in IndexedDB, load it into memory when needed
        if (count > 0) {
            if (!haveMem) {
                try {
                    window.parks = await getAllParksFromIndexedDB();
                    console.log(`[bootstrap] Hydrated ${window.parks.length} parks from IndexedDB.`);
                    if (typeof refreshMarkers === 'function') refreshMarkers({full: true});
                } catch (e) {
                    console.warn('Failed to load parks from IndexedDB:', e);
                }
            }
            return; // nothing further to do
        }

        // No parks in IndexedDB — fetch baseline allparks.json
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
            await setLastFetchTimestamp('allparks.json', Date.now());
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
    const CHUNK_SIZE = 200;
    for (let i = 0; i < patches.length; i += CHUNK_SIZE) {
        const slice = patches.slice(i, i + CHUNK_SIZE);
        await Promise.all(slice.map(async entry => {
            const {reference, patch} = entry || {};
            if (!reference || !patch || typeof patch !== 'object') return;
            try {
                await upsertParkFieldsInIndexedDB(reference, patch);
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
        }));
        try {
            await nextFrame();
        } catch (_) {
        }
    }

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
    if (typeof window.updateVisibleModeCountsInner === 'function') {
        return window.updateVisibleModeCountsInner();
    }
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

        // Expose inner worker helpers to global wrappers
        window.initQsoWorkerIfNeededInner = initQsoWorkerIfNeeded;
        window.updateVisibleModeCountsInner = updateVisibleModeCounts;
        window.modeCountsForParkRefInner = modeCountsForParkRef;

        // Initialize the map, then kick off the mode check and worker if needed
        await nextFrame();
        await setupPOTAMap();


        // Map-level safety: fold popup sections even for pre-existing markers/popups.
        if (map && typeof map.on === 'function') {
            map.on('popupopen', function (ev) {
                lockPopupRefresh(900);
                try {
                    const popup = ev && ev.popup;
                    if (!popup || typeof popup.getContent !== 'function') return;
                    const cur = popup.getContent();

                    // Helper to test for headings
                    const hasTargets = (s) => /(Recent Activations:|Current Activation:)/i.test(s || '');

                    if (typeof cur === 'string') {
                        if (hasTargets(cur)) {
                            const folded = foldPopupSections(cur);
                            if (folded && folded !== cur) popup.setContent(folded);
                        }
                        return;
                    }

                    // If Leaflet gave us a DOM node (Element), mutate in place
                    if (cur && cur.nodeType === 1) { // ELEMENT_NODE
                        // Skip if already folded
                        if (cur.querySelector && cur.querySelector('details.popup-collapsible')) return;

                        const html = cur.innerHTML || '';
                        if (!hasTargets(html)) return;

                        const folded = foldPopupSections(html);
                        if (folded && folded !== html) {
                            cur.innerHTML = folded; // update in place to preserve the node
                        }
                        return;
                    }

                    // Fallback: convert anything else to string and try
                    const asText = String(cur || '');
                    if (hasTargets(asText)) {
                        const folded = foldPopupSections(asText);
                        if (folded && folded !== asText) popup.setContent(folded);
                    }
                } catch (e) {
                    console.warn('map-level foldPopupSections failed:', e);
                }
            });
        }

        // Defer common refreshers during popup stability window
        (function () {
            function wrapIfNeeded(obj, key) {
                const fn = obj && obj[key];
                if (typeof fn !== 'function' || fn.__wrappedForPopup) return;
                const original = fn;
                const wrapped = async function (...args) {
                    if (shouldDeferRefresh()) {
                        const delay = Math.max(0, __popupLockUntil - Date.now());
                        return new Promise(resolve => setTimeout(() => resolve(wrapped.apply(this, args)), delay));
                    }
                    return original.apply(this, args);
                };
                wrapped.__wrappedForPopup = true;
                obj[key] = wrapped;
            }
            // Known refreshers that can clear/redraw layers and inadvertently close popups
            wrapIfNeeded(window, 'fetchAndDisplaySpotsInCurrentBounds');
            wrapIfNeeded(window, 'applyActivationToggleState');
            wrapIfNeeded(window, 'refreshMarkers');
            wrapIfNeeded(window, 'updateActivationsInView');
        })();

        // Use a shared Canvas renderer for circle markers (significantly faster than default SVG)
        try {
            __canvasRenderer = L.canvas({padding: 0.5});
        } catch (_) {
        }

        // Debounce redraws on pan/zoom; redraw only when interaction settles
        if (map && typeof map.on === 'function') {
            map.on('movestart', () => {
                __panInProgress = true;
            });
            map.on('zoomstart', () => {
                __panInProgress = true;
            });
            const debouncedMoveEnd = (function () {
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
        } catch (_) {
        }

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
    if (parsed.minDist != null || parsed.maxDist != null) return true;
    // Some parsers return a list of filters; look for STATE:/COUNTRY:/REF:
    const filters = parsed.filters || parsed.terms || [];
    if (Array.isArray(filters)) {
        for (const f of filters) {
            const k = (f && (f.key || f.type || f.name || '')).toString().toUpperCase();
            if (k === 'STATE' || k === 'COUNTRY' || k === 'REF' || k === 'REFERENCE' || k === 'ID' || k === 'MINDIST' || k === 'MAXDIST' || k === 'DIST') return true;
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
function buildFiltersPanel(container) {
    const target = container || document.getElementById('filtersPanelContent');
    if (!target) return;

    const oldToggle = document.getElementById('toggleActivations');
    if (oldToggle) oldToggle.style.display = 'none';

    target.innerHTML = `
    <div class="filters-panel">
      <div class="filters-grid">
        <button class="filter-chip" id="chipMyActs"   type="button" aria-pressed="false">My</button>
        <button class="filter-chip" id="chipOnAir"    type="button" aria-pressed="false">Active</button>
        <button class="filter-chip" id="chipNewParks" type="button" aria-pressed="false">New</button>
        <button class="filter-chip" id="chipAllParks" type="button" aria-pressed="false">All / Clr</button>
      </div>
    </div>
  `;
}


function buildModeFilterPanel(container) {
    const target = container || document.getElementById('modeFilterPanelContent');
    if (!target) return;

    target.innerHTML = `
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

    // initialize visual "off" state + interactions
    target.querySelectorAll('.mode-dot').forEach(btn => {
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
            const RECENT = (window.__RECENT_ADDS instanceof Set) ? window.__RECENT_ADDS : new Set();
            let createdTime = null;
            if (created) {
                createdTime = typeof created === 'number' ? created : new Date(created).getTime();
            }
            const isNew = RECENT.has(reference) || (createdTime && (Date.now() - createdTime <= 30 * 24 * 60 * 60 * 1000));
            const showNewColor = isNew; // always highlight truly new parks
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
                    if (u) {
                        park.reviewURL = u;
                        decorateReviewHalo(marker, park);
                    }
                }
            } else {
                const baseColor = getMarkerColorConfigured(parkActivationCount, isUserActivated);
                const fillColor = showNewColor ? "#800080" : baseColor; // purple for newly added parks
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
                    if (u) {
                        park.reviewURL = u;
                        decorateReviewHalo(marker, park);
                    }
                }
            }

            const tooltipText = currentActivation
                ? `${reference}: ${name} <br> ${currentActivation.activator} on ${currentActivation.frequency} kHz (${currentActivation.mode})${currentActivation.comments ? ` <br> ${currentActivation.comments}` : ''}`
                : `${reference}: ${name} (${parkActivationCount} activations)`;

            marker.park = park;
            marker.currentActivation = currentActivation;

            marker
                .addTo(map.activationsLayer)
                .bindPopup("<b>Loading park info...</b>", {
                    maxWidth: 280,
                    keepInView: true,
                    autoPan: true,
                    autoPanPadding: [30, 40]
                })
                .bindTooltip(tooltipText, {direction: "top", opacity: 0.9, sticky: false, className: "custom-tooltip"})
                .on('click touchend', function () {
                    this.closeTooltip();
                });

            marker.on('popupopen', async function () {
                lockPopupRefresh(900);
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
                    if (park.reviewURL && !displayPark.pnrUrl) displayPark.pnrUrl = park.reviewURL; // legacy key
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
                    // Wrap "Recent Activations" and "Current Activation" in collapsible panels (closed by default)
                    popupContent = foldPopupSections(popupContent);
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

    // Skip marker redraws while Leaflet is auto-panning a freshly opened popup (mobile tap stability).
    if (typeof suppressRedrawUntil !== 'undefined' && Date.now() < suppressRedrawUntil) {
        return;
    }
    if (__skipNextMarkerRefresh) {
        return;
    }


    /** Robustly find a park's marker by reference, searching common layer groups. */
    function __findMarkerByRef(reference) {
        if (!map || !reference) return null;

        // 1) Explicit registry if you attach markers here elsewhere:
        if (window.markerByRef && window.markerByRef[reference]) {
            return window.markerByRef[reference];
        }

        // 2) Scan known groups first
        var groups = [];
        if (map.activationsLayer) groups.push(map.activationsLayer);
        if (map.spotsLayer) groups.push(map.spotsLayer);
        if (map.reviewLayer) groups.push(map.reviewLayer);

        function scanGroup(g) {
            var found = null;
            if (!g) return null;
            if (g.eachLayer) {
                g.eachLayer(function (layer) {
                    if (found) return;
                    if (layer && layer instanceof L.Marker) {
                        var ref = (layer._parkRef || (layer.options && (layer.options.reference || layer.options.ref)));
                        if (ref === reference) {
                            found = layer;
                        }
                    } else if (layer && layer.eachLayer) {
                        var inner = scanGroup(layer);
                        if (inner) found = inner;
                    }
                });
            }
            return found;
        }

        for (var i = 0; i < groups.length; i++) {
            var m = scanGroup(groups[i]);
            if (m) return m;
        }

        // 3) Full map scan as last resort
        var result = null;
        map.eachLayer(function (layer) {
            if (result) return;
            if (layer && layer instanceof L.Marker) {
                var ref = (layer._parkRef || (layer.options && (layer.options.reference || layer.options.ref)));
                if (ref === reference) {
                    result = layer;
                }
            } else if (layer && layer.eachLayer) {
                var inner = scanGroup(layer);
                if (inner) result = inner;
            }
        });
        return result;
    }

    /** Open a park's popup by its reference with retries; prefers firing 'click' to trigger async content loaders. */
    function openParkPopupByRef(reference, attempts) {
        attempts = (typeof attempts === 'number') ? attempts : 14;
        if (!map || !reference) return;
        var marker = __findMarkerByRef(reference);
        if (marker) {
            try {
                // Prefer click to ensure any bound 'click' handlers run (async content, analytics, etc.)
                if (typeof marker.fire === 'function') {
                    marker.fire('click');
                } else if (typeof marker.openPopup === 'function') {
                    marker.openPopup();
                }
            } catch (e) {
                console.warn("openParkPopupByRef failed to open", e);
            }
            return;
        }
        if (attempts > 0) {
            // If the layer may not exist yet, nudge a refresh, then retry
            try {
                if (typeof refreshMarkers === 'function') refreshMarkers();
            } catch (e) {
            }
            setTimeout(function () {
                openParkPopupByRef(reference, attempts - 1);
            }, 110);
        } else {
            console.warn("openParkPopupByRef: marker not found for", reference);
        }
    }
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
                    <details class="menu-panel" open>
                        <summary>Search</summary>
                        <div class="panel-content">
                            <div id="searchBoxContainer">
                                <input type="text" id="searchBox" placeholder="Search name, ID, location..." />
                                <button id="clearSearch" title="Clear Search" aria-label="Clear Search">Clear Search</button>
                                <button id="goToParkButton" title="Expand search to the full dataset and zoom to a park">Go To Park</button>
                                <button id="centerOnGeolocation" title="Center the map based on your current location.">Center on My Location</button>
                            </div>
                            <details class="menu-subpanel">
                                <summary>Saved Searches</summary>
                                <div class="panel-content" id="savedSearchesContainer"></div>
                            </details>
                        </div>
                    </details>
                </li>
                <li>
                    <details class="menu-panel">
                        <summary>Filters</summary>
                        <div class="panel-content">
                            <div id="filtersPanelContent"></div>
                            <div id="modeFilterPanelContent"></div>
                        </div>
                    </details>
                </li>
                <li>
                    <details class="menu-panel">
                        <summary>Info</summary>
                        <div class="panel-content">
                            <button id="mapHelpButton" onclick="window.open('https://pota.review/howto/how-to-use-the-potamap/', '_blank')">How to Use This Map</button>
                            <button id="potaNewsButton" onclick="window.open('https://pota.review', '_blank')">Visit POTA News & Reviews</button>
                            <button id="uploadActivations">Upload Activations File</button>
                            <input type="file" id="activationsFileInput" accept=".csv" />
                            <div id="callsignDisplay" style="text-align: center; font-weight: bold; padding: 0.5em; font-size: 0.75em; background: #f0f0f0; margin-top: 0.5em;">
                                Callsign: <span id="callsignText">please set</span>
                            </div>
                            <div id="versionInfo" style="font-size: 0.75em; color: #888; margin-top: 1em;"></div>
                        </div>
                    </details>
                </li>
            </ul>
        </div>
    `;
    document.body.appendChild(menu);

    document.getElementById('searchBox').addEventListener('input', debounce(handleSearchInput, 300));
    document.getElementById('clearSearch').addEventListener('click', clearSearchInput);
    document.getElementById('searchBox').addEventListener('keydown', handleSearchEnter);
    document.getElementById('centerOnGeolocation').addEventListener('click', centerMapOnGeolocation);

    const uploadBtn = document.getElementById('uploadActivations');
    const fileInput = document.getElementById('activationsFileInput');
    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', handleFileUpload);
    }

    buildFiltersPanel(document.getElementById('filtersPanelContent'));
    buildModeFilterPanel(document.getElementById('modeFilterPanelContent'));
    initializeFilterChips && initializeFilterChips();
    console.log("Hamburger menu initialized.");

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
    position: fixed;
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
    const root = document.getElementById('hamburgerMenu');
    if (!root) return;

    const apply = () => {
        const isTouch = window.matchMedia('(pointer: coarse)').matches;
        const mobile = isTouch || window.innerWidth <= 480;
        root.classList.toggle('mobile', mobile);
    };

    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
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
            const head = await fetch(baseUrl, {method: 'HEAD', cache: 'no-store'});
            if (head.ok) {
                etag = head.headers.get('etag');
                lastMod = head.headers.get('last-modified');
                signature = etag || lastMod || 'no-sig';
                try {
                    prevSig = localStorage.getItem(SIG_KEY(baseUrl));
                } catch { /* ignore */
                }
                // If unchanged and we already have a cache in memory or IDB, skip
                if (prevSig && signature && prevSig === signature && (window.__REVIEW_URLS instanceof Map) && window.__REVIEW_URLS.size > 0) {
                    return {changed: false, map: window.__REVIEW_URLS};
                }
            }
        } catch { /* some CDNs block HEAD; proceed to GET */
        }

        // Cache-bust GET
        const v = encodeURIComponent((etag || lastMod || Date.now()).toString());
        const url = baseUrl + (baseUrl.includes('?') ? `&v=${v}` : `?v=${v}`);

        // Try JSON first
        try {
            const res = await fetch(url, {cache: 'no-store'});
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
                        } catch { /* ignore bad line */
                        }
                    });
                    data = {items: Array.from(m, ([reference, url]) => ({reference, reviewURL: url}))};
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
                req.onerror = (e) => reject(e.target.error);
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
                tx.onerror = (e) => reject(e.target.error);
            });

            // Also update in-memory fast cache for immediate rendering
            window.__REVIEW_URLS = map;
            try {
                localStorage.setItem(SIG_KEY(baseUrl), (signature || v));
            } catch { /* ignore */
            }

            if (updates > 0) console.log(`[reviews] Applied ${updates} review URL updates from ${baseUrl}.`);
            return {changed: updates > 0, map};
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
    return date.toLocaleDateString('en-US', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit'
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

    const lat = 39.8283;   // CONUS centroid
    const lng = -98.5795;

    // If you track these globally elsewhere:
    try {
        window.userLat = lat;
        window.userLng = lng;
    } catch (e) {
    }

    // Optionally update the user pin if you have this helper
    if (typeof setUserLocationMarker === 'function') {
        setUserLocationMarker(lat, lng);
    }

    map.setView([lat, lng], map.getZoom(), {animate: true, duration: 1.5});
    console.log("Map centered on default fallback location.");
}

/**
 * Handles input in the search box and dynamically highlights matching parks within the visible map bounds.
 * @param {Event} event - The input event from the search box.
 */
/**
 * Ensure a dedicated non-interactive highlight layer exists below spot markers.
 * This prevents search results from blocking taps on mobile devices.
 */
function ensureSearchHighlightLayer() {
    if (!window.map) return null;
    if (!map.getPane('searchHighlightPane')) {
        const pane = map.createPane('searchHighlightPane');
        pane.style.zIndex = 450; // below default marker pane (600)
        pane.style.pointerEvents = 'none';
    }
    if (!map.highlightLayer) {
        map.highlightLayer = L.layerGroup([], { pane: 'searchHighlightPane' }).addTo(map);
    }
    return map.highlightLayer;
}

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

    const highlightLayer = ensureSearchHighlightLayer();
    highlightLayer.clearLayers();

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
            className: 'goto-park-highlight',
            radius: 8,
            fillColor: '#ffff00',
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8,
            // Prevent highlight markers from blocking interaction with underlying spots
            interactive: false,
            bubblingMouseEvents: false
        }).addTo(highlightLayer);

        // The highlight is purely visual; the actual spot marker underneath
        // remains fully interactive. Tooltips/popup handling are therefore
        // unnecessary on this overlay marker.
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
    map.setView([latitude, longitude], map.getZoom(), {
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

    // After the map finishes moving, refresh spots and open the popup for the park.
    map.once('moveend', async () => {
        try {
            await fetchAndDisplaySpotsInCurrentBounds(map);
            applyActivationToggleState();
        } catch (err) {
            console.warn('zoomToPark: failed to refresh spots', err);
        }

        // Try to find the existing marker in activations or spots layers now that the area has refreshed.
        let foundMarker = null;
        if (map.activationsLayer) {
            map.activationsLayer.eachLayer((layer) => {
                if (layer.getLatLng) {
                    const latLng = layer.getLatLng();
                    if (latLng.lat === latitude && latLng.lng === longitude) {
                        foundMarker = layer;
                    }
                }
            });
        }
        if (!foundMarker && map.spotsLayer) {
            map.spotsLayer.eachLayer((layer) => {
                if (layer.getLatLng) {
                    const latLng = layer.getLatLng();
                    if (latLng.lat === latitude && latLng.lng === longitude) {
                        foundMarker = layer;
                    }
                }
            });
        }

        if (foundMarker && foundMarker._popup) {
            openPopupWithAutoPan(foundMarker);
            console.log(`Opened popup for existing marker of park ${park.reference}.`);
            return;
        }

        const layer = ensureSearchHighlightLayer();
        layer.clearLayers();

        const highlight = L.circleMarker([latitude, longitude], {
            className: 'goto-park-highlight',
            radius: 8,
            fillColor: '#ffff00',
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(layer);

        try {
            const popupContent = await fetchFullPopupContent(park);
            highlight.bindPopup(popupContent, {autoPan: true, autoPanPadding: [20, 20]});
            openPopupWithAutoPan(highlight);
            console.log(`Opened popup for ${park.reference} via temporary highlight.`);
        } catch (e) {
            console.warn('zoomToPark: failed to fetch popup content', e);
        }
    });
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
        CW: ${cwTotal} &nbsp;|&nbsp; PHONE: ${phoneTotal} <br>DATA: ${dataTotal} 
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

// Alias for compatibility with older code that expects `parsePQL`
// This keeps existing calls to `parseStructuredQuery` working while
// ensuring `runPQL` can locate the parser.
function parsePQL(raw) {
    return parseStructuredQuery(raw);
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
    const hasDistConstraint = (parsed.minDist != null) || (parsed.maxDist != null);
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
            if (parsed.minDist != null && dMiles < parsed.minDist) return false;
            if (parsed.maxDist != null && dMiles > parsed.maxDist) return false;
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
    if (!map || !matched || !matched.length) return;

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
function __pqlWantsGlobalScope(parsed) {
    return !!(parsed && (
        parsed.state ||
        parsed.country ||
        parsed.callsign ||
        (Array.isArray(parsed.refs) && parsed.refs.length) ||
        parsed.minDist != null || parsed.maxDist != null ||
        (Array.isArray(parsed.nferWithRefs) && parsed.nferWithRefs.length)
    ));
}

function clearSearchInput() {
    // 1) Clear pulsing PQL overlay (if any)
    try { clearPqlFilterDisplay(); } catch (e) {}

    // 2) Clear legacy highlight layer (non-PQL incremental search)
    if (map && map.highlightLayer) {
        try {
            map.highlightLayer.clearLayers();
            map.removeLayer(map.highlightLayer);
            const pane = map.getPane('searchHighlightPane');
            if (pane) pane.remove();
        } catch (e) {}
        map.highlightLayer = null;
    }

    // 3) Clear the search box
    const searchBox = document.getElementById('searchBox');
    if (searchBox) {
        searchBox.value = '';
        // Force downstream listeners (like handleSearchInput) to react
        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // 4) Drop any cached results from the last search
    try { currentSearchResults = []; } catch (e) {}

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

// --- PQL SEARCH: Main runner ---
// Exposed as window.runPQL for saved searches and Enter key
// --- PQL SEARCH: Main runner ---
// Exposed as window.runPQL for saved searches and Enter key
async function runPQL(raw, ctx = {}) {
    try {
        const parsed = parsePQL(raw);

        const bounds = getCurrentMapBounds();

        // Build context for matchers
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

        const fullCtx = {
            bounds,
            spotByRef,
            spotByCall,
            userActivatedRefs,
            now,
            userLat,
            userLng,
            nferByRef,
            ...ctx
        };

        const useGlobal = __pqlWantsGlobalScope(parsed);
        const candidates = useGlobal ? parks : getParksInBounds(parks);

        const matched = candidates.filter(p => parkMatchesStructuredQuery(p, parsed, fullCtx));
        currentSearchResults = matched;

        if (!matched.length) {
            const scopeMsg = useGlobal ? '' : ' in the current view';
            if (typeof showNoMatchModal === 'function') {
                showNoMatchModal(`No parks match that query${scopeMsg}.`);
            } else {
                alert(`No parks match that query${scopeMsg}.`);
            }
            return [];
        }

        fitToMatchesIfGlobalScope(parsed, matched);
        updateMapWithFilteredParks(matched);

        // Ensure matched parks are visibly highlighted
        try {
            applyPqlFilterDisplay(matched);
        } catch (e) {
            console.warn('applyPqlFilterDisplay failed', e);
        }

        return matched;
    } catch (e) {
        console.warn('runPQL failed:', e);
        return [];
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
// ===== Popup-safe redraw guards =====
window.isPopupOpen = window.isPopupOpen || false;
window.__skipNextMarkerRefresh = window.__skipNextMarkerRefresh || false;
window.__pendingMarkerRefresh = window.__pendingMarkerRefresh || false;

function scheduleDeferredRefresh(reason = '') {
    try { console.log('[defer] marker refresh scheduled', reason); } catch {}
    window.__pendingMarkerRefresh = true;
}

function runDeferredRefresh() {
    if (!window.__pendingMarkerRefresh) return;
    window.__pendingMarkerRefresh = false;
    try {
        if (typeof applyActivationToggleState === 'function') {
            applyActivationToggleState();
        } else if (typeof refreshMapActivations === 'function') {
            refreshMapActivations();
        }
    } catch (e) { console.warn('Deferred refresh failed:', e); }
}

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
    const debouncedSpotFetch = debounce(async () => {
        if (window.isPopupOpen || window.__skipNextMarkerRefresh) {
            scheduleDeferredRefresh('debouncedSpotFetch');
            return;
        }
        console.log("Map moved or zoomed. Updating spots...");
        const result = await fetchAndDisplaySpotsInCurrentBounds(mapInstance);
        // Only re-render if the fetch did not defer due to an open popup
        if (result !== 'deferred') {
            applyActivationToggleState();
        }
    }, 300);
    map.on('popupopen', ev => {
        lockPopupRefresh(900);
        isPopupOpen = true;
        // fold sections if needed (existing code)
    });
    map.on('popupclose', ev => {
        isPopupOpen = false;
        clearPopupLock();
        setTimeout(runDeferredRefresh, 100);
    });
    if (!isDesktopMode) {
        mapInstance.on("moveend", () => {
            if (skipNextSpotFetch) {
                skipNextSpotFetch = false;
                return;
            }
            debouncedSpotFetch();
        });
    }
// Map-level safety: fold popup sections even for pre-existing markers/popups.
    if (map && typeof map.on === 'function') {
        map.on('popupopen', function (ev) {
            lockPopupRefresh(900);
            window.isPopupOpen = true;
            // ... existing popup content folding code ...
        });

        map.on('popupclose', function (ev) {
            window.isPopupOpen = false;
            clearPopupLock();
            // Run any deferred refreshes after popup closes
            setTimeout(() => {
                runDeferredRefresh();
            }, 100);
        });
    }
    return mapInstance;
}


// Find the current marker for a park reference in a LayerGroup
function findMarkerByReference(ref, layerGroup) {
    if (!layerGroup || typeof layerGroup.eachLayer !== 'function') return null;
    let found = null;
    layerGroup.eachLayer((l) => {
        if (found) return;
        const m = l;
        if (m && m.park && m.park.reference === ref) {
            found = m;
        }
    });
    return found;
}

/**
 * Displays parks on the map.
 */
/**
 * Displays parks on the map with proper popups that include activation information.
 */
// --- Custom marker tap handler ---
function handleMarkerTap(e) {
    // prevent default Leaflet open-on-click during pan
    if (e && e.originalEvent) {
        e.originalEvent.preventDefault();
        e.originalEvent.stopPropagation();
    }
    L.DomEvent.stop(e);

    // close any existing popups
    map.closePopup();

    const ref = this.park.reference;
    const latlng = this.getLatLng();

    lockPopupRefresh(1200);

    // compute a pan target so popup has room
    const size = map.getSize();
    const targetPoint = map.project(latlng).subtract([0, Math.round(size.y * 0.25)]);
    const targetLatLng = map.unproject(targetPoint);

    let done = false;
    const onMoveEnd = async () => {
        if (done) return;
        done = true;
        map.off('moveend', onMoveEnd);

        // small delay to let pan finish
        setTimeout(async () => {
            await fetchAndDisplaySpotsInCurrentBounds(map);
            if (!shouldDeferRefresh()) {
                applyActivationToggleState();
            }

            // find the re-rendered marker and open its popup
            const fresh = findMarkerByReference(ref, map.activationsLayer);
            if (fresh) {
                fresh.openPopup();
            }
            // clear the lock once popup is open
            clearPopupLock();
        }, 100);
    };

    map.on('moveend', onMoveEnd);
    map.panTo(targetLatLng, { animate: true });
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

        // 6) Defer mode-change detection so it never blocks map paint
        if (typeof ensureModesInitOnce === 'function') {
            const startModes = () => ensureModesInitOnce().catch(console.warn);
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
    if (shouldDeferRefresh()) {
        scheduleDeferredRefresh('applyActivationToggleState');
        return;
    }

    const toggleButton = document.getElementById('toggleActivations');
    const userActivatedReferences = activations.map(act => act.reference);
    const buttonTexts = [
        "Show My Activations",
        "Hide My Activations",
        "Show Currently On Air",
        "Show All Spots",
    ];
    if (toggleButton) toggleButton.innerText = buttonTexts[activationToggleState];

    const parksInBounds = getParksInBounds(parks);
    let parksToDisplay = [];
    switch (activationToggleState) {
        case 0:
            parksToDisplay = parksInBounds;
            break;
        case 1:
            parksToDisplay = parksInBounds.filter(p => userActivatedReferences.includes(p.reference));
            break;
        case 2:
            parksToDisplay = parksInBounds.filter(p => !userActivatedReferences.includes(p.reference));
            break;
        case 3:
            const onAirRefs = spots.map(s => s.reference);
            parksToDisplay = parksInBounds.filter(p => onAirRefs.includes(p.reference));
            break;
        default:
            parksToDisplay = parksInBounds;
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
    if (shouldDeferRefresh()) {
        scheduleDeferredRefresh('fetchAndDisplaySpotsInCurrentBounds');
        return 'deferred';
    }

    const response = await fetch(SPOT_API_URL);
    if (!response.ok) throw new Error(`Error fetching spots: ${response.statusText}`);
    const spots = await response.json();

    if (!mapInstance.spotsLayer) {
        mapInstance.spotsLayer = L.layerGroup().addTo(mapInstance);
    } else {
        mapInstance.spotsLayer.clearLayers();
    }

    const bounds = mapInstance.getBounds();
    const spotsInBounds = spots.filter(s =>
        s.latitude && s.longitude && bounds.contains([s.latitude, s.longitude])
    );

    // redraw activations layer (it, in turn, defers if needed)
    applyActivationToggleState();
}


/**
 * Initializes the recurring fetch for POTA spots.
 */
function initializeSpotFetching() {
    // Initial
    if (window.isPopupOpen || window.__skipNextMarkerRefresh) {
        scheduleDeferredRefresh('initializeSpotFetching.initial');
    } else {
        fetchAndDisplaySpots();
    }
    // Periodic updates (mobile only)
    if (!isDesktopMode) {
        setInterval(() => {
            if (window.isPopupOpen || window.__skipNextMarkerRefresh) {
                scheduleDeferredRefresh('initializeSpotFetching.interval');
                return;
            }
            fetchAndDisplaySpots();
        }, 5 * 60 * 1000);
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
    if (window.isPopupOpen || window.__skipNextMarkerRefresh) { scheduleDeferredRefresh('refreshMapActivations'); return; }
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
    const goToParkButton = document.getElementById('goToParkButton');
    const searchBox = document.getElementById('searchBox');

    if (!goToParkButton || !searchBox) {
        console.error("Go To Park initialization elements missing.");
        return;
    }

    goToParkButton.addEventListener('click', () => {
        triggerGoToPark();
    });

    searchBox.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            const raw = searchBox.value.trim();
            if (raw.startsWith('?')) {
                return; // Let PQL handler manage
            }
            event.preventDefault();
            triggerGoToPark(true);
        }
    });
}

/**
 * Triggers the Go To Park functionality by searching and zooming to a park.
 */
function triggerGoToPark() {
    whenMapReady(function () {

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

    });
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


/* =====================================================================
 * POTAmap — Saved PQL Searches (MVP)
 * Adds a collapsible "Saved Searches" panel to the hamburger menu (#menu)
 * and supports saving/running/renaming/deleting/shareable-URL for PQL.
 * ===================================================================== */
(() => {
    'use strict';
    if (window.__POTAMapSavedSearchesInit) return;
    window.__POTAMapSavedSearchesInit = true;

    const POTA_SAVED_PQL_KEY = 'pota.savedSearches.v1'; // [{id, name, pql, view?}]

    function normalizePql(pql) {
        const q = (pql || '').trim();
        return q.startsWith('?') ? q : ('?' + q);
    }

    function getSearchBoxEl() {
        return document.getElementById('searchBox') || document.getElementById('pqlInput');
    }

    function getCurrentPqlFromUI() {
        const el = getSearchBoxEl();
        const raw = (el?.value ?? window.__pqlCurrent ?? '').trim();
        return normalizePql(raw);
    }

    function loadSavedPql() {
        try {
            return JSON.parse(localStorage.getItem(POTA_SAVED_PQL_KEY) || '[]');
        } catch {
            return [];
        }
    }

    function persistSavedPql(list) {
        localStorage.setItem(POTA_SAVED_PQL_KEY, JSON.stringify(list));
    }

    function saveCurrentSearch({name, pql, includeView = true}) {
        const list = loadSavedPql();
        const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        const entry = {id, name: (name || '').trim() || '(unnamed)', pql: normalizePql(pql)};

        if (includeView && typeof window.map !== 'undefined' && window.map) {
            try {
                const c = map.getCenter();
                const z = map.getZoom();
                entry.view = {z, lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6)};
            } catch {
            }
        }

        // De-dupe identical {pql,view}
        const key = JSON.stringify({p: entry.pql, v: entry.view || null});
        if (list.some(e => JSON.stringify({p: e.pql, v: e.view || null}) === key)) {
            return null;
        }

        list.unshift(entry);
        if (list.length > 50) list.pop();
        persistSavedPql(list);
        return entry;
    }

    function deleteSavedSearch(id) {
        persistSavedPql(loadSavedPql().filter(e => e.id !== id));
    }

    function renameSavedSearch(id, nextName) {
        const list = loadSavedPql();
        const i = list.findIndex(e => e.id === id);
        if (i >= 0) {
            list[i].name = (nextName || '').trim() || '(unnamed)';
            persistSavedPql(list);
        }
    }

    function buildShareUrl(entry) {
        const base = `${location.origin}${location.pathname}`;
        const params = new URLSearchParams();
        params.set('pql', entry.pql);
        if (entry.view) {
            params.set('z', String(entry.view.z));
            params.set('lat', String(entry.view.lat));
            params.set('lng', String(entry.view.lng));
        }
        return `${base}?${params.toString()}`;
    }

    async function runSavedEntry(entry) {
        if (entry.view && typeof window.map !== 'undefined' && window.map) {
            try {
                map.setView([entry.view.lat, entry.view.lng], entry.view.z, {animate: false});
            } catch {
            }
        }
        const box = getSearchBoxEl();
        if (box) {
            box.value = entry.pql;
            box.focus();
        }
        window.__pqlCurrent = entry.pql;

        try {
            if (typeof runPQL === 'function') {
                await runPQL(entry.pql);
                return;
            }
            if (typeof handleSearchEnter === 'function') {
                handleSearchEnter({key: 'Enter', preventDefault: () => {}});
                return;
            }
            if (typeof redrawMarkersWithFilters === 'function') {
                await redrawMarkersWithFilters();
                return;
            }
        } catch (e) {
            console.warn('runSavedEntry runPQL failed', e);
        }

        try {
            const evt = new KeyboardEvent('keydown', {key: 'Enter'});
            box?.dispatchEvent(evt);
        } catch (e) {
            console.warn('Enter dispatch failed', e);
        }
    }

    // Expose globally for external callers and saved-search buttons
    window.runSavedEntry = runSavedEntry;

    function renderSavedList() {
        const ul = document.getElementById('ssp-list');
        if (!ul) return;
        const items = loadSavedPql();
        ul.innerHTML = '';
        if (items.length === 0) {
            ul.innerHTML = `<li class="ssp-empty"><em>No saved searches yet.</em></li>`;
            return;
        }
        for (const e of items) {
            const li = document.createElement('li');
            li.className = 'ssp-item';

            // Editable name (flush-left)
            const name = document.createElement('span');
            name.className = 'ssp-name';
            name.textContent = e.name || e.pql;
            name.title = e.pql;
            name.contentEditable = 'true';
            name.addEventListener('blur', () => renameSavedSearch(e.id, name.textContent || ''));
            name.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    name.blur();
                }
            });

            // Actions container (flush-right)
            const actions = document.createElement('div');
            actions.className = 'ssp-actions';

            // Helper to make an icon button
            const makeIconBtn = (title, svg) => {
                const b = document.createElement('button');
                b.className = 'ssp-iconbtn';
                b.type = 'button';
                b.title = title;
                b.setAttribute('aria-label', title);
                b.innerHTML = svg;
                return b;
            };

            // Play button (run saved search)
            const runBtn = makeIconBtn('Run saved search',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"></path></svg>'
            );
            runBtn.classList.add('ssp-playbtn');
            runBtn.addEventListener('click', () => window.runSavedEntry(e));

            // Share button (copy URL) — temporarily disabled
            // const shareBtn = makeIconBtn('Copy shareable link',
            //     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 9V5l7 7-7 7v-4H6V9h8z" fill="currentColor"></path></svg>'
            // );
            // shareBtn.addEventListener('click', async () => {
            //     const url = buildShareUrl(e);
            //     try {
            //         await navigator.clipboard.writeText(url);
            //     } catch {
            //     }
            //     console.log('Copied:', url);
            // });

            // Delete button
            const delBtn = makeIconBtn('Delete saved search',
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z" fill="currentColor"></path></svg>'
            );
            delBtn.addEventListener('click', () => {
                deleteSavedSearch(e.id);
                renderSavedList();
            });

            // actions.append(runBtn, shareBtn, delBtn);
            actions.append(runBtn, delBtn);
            li.append(name, actions);
            ul.appendChild(li);
        }
    }

    function buildSavedSearchesPanel() {
        const container = document.getElementById('savedSearchesContainer');
        if (!container) return;

        container.innerHTML = `
      <div class="saved-searches-panel">
        <div class="ssp-row">
          <input id="ssp-name" class="ssp-input" placeholder="Name this search…" />
          <button id="ssp-save" class="ssp-btn" type="button">Save Current</button>
        </div>
        <ul id="ssp-list" class="ssp-list"></ul>
      </div>
    `;

        container.querySelector('#ssp-save')?.addEventListener('click', () => {
            const name = container.querySelector('#ssp-name')?.value || '';
            const includeEl = container.querySelector('#ssp-include-view');
            const includeView = includeEl ? !!includeEl.checked : true;
            const pql = getCurrentPqlFromUI();
            const saved = saveCurrentSearch({name, pql, includeView});
            if (saved) {
                const nameEl = container.querySelector('#ssp-name');
                if (nameEl) nameEl.value = '';
                renderSavedList();
            } else {
                console.log('Saved search already exists (same PQL & view).');
            }
        });

        renderSavedList();
    }

    function applyIncomingPqlFromUrl() {
        try {
            const url = new URL(location.href);
            const pqlParam = url.searchParams.get('pql');
            const z = url.searchParams.get('z');
            const lat = url.searchParams.get('lat');
            const lng = url.searchParams.get('lng');

            if (lat && lng && z && typeof window.map !== 'undefined' && window.map) {
                try {
                    map.setView([parseFloat(lat), parseFloat(lng)], parseInt(z, 10), {animate: false});
                } catch {
                }
            }
            if (!pqlParam) return;

            const pql = normalizePql(pqlParam);
            const box = getSearchBoxEl();
            if (box) box.value = pql;
            window.__pqlCurrent = pql;

            if (typeof window.runPQL === 'function') {
                window.runPQL(pql);
            } else if (typeof window.handleSearchEnter === 'function') {
                window.handleSearchEnter({
                    key: 'Enter', preventDefault: () => {
                    }
                });
            } else {
                const evt = new KeyboardEvent('keydown', {key: 'Enter'});
                box?.dispatchEvent(evt);
            }
        } catch (e) {
            console.warn('applyIncomingPqlFromUrl: failed', e);
        }
    }

    function ensurePanelWhenMenuExists() {
        const attempt = () => {
            if (document.getElementById('savedSearchesContainer')) {
                buildSavedSearchesPanel();
                return true;
            }
            return false;
        };
        if (attempt()) return;
        const obs = new MutationObserver(() => {
            if (attempt()) {
                obs.disconnect();
            }
        });
        obs.observe(document.documentElement, {childList: true, subtree: true});
    }

    document.addEventListener('DOMContentLoaded', () => {
        ensurePanelWhenMenuExists();
        if (typeof window.whenMapReady === 'function') {
            window.whenMapReady(() => applyIncomingPqlFromUrl());
        } else {
            applyIncomingPqlFromUrl();
        }
    });
})();


if (typeof window !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        if (window.map && typeof window.map.on === 'function') {
            map.on('movestart', () => {
                if (window.isPopupOpen) window.__skipNextMarkerRefresh = true;
            });
            map.on('moveend', () => {
                if (window.isPopupOpen) {
                    setTimeout(() => { window.__skipNextMarkerRefresh = false; runDeferredRefresh(); }, 120);
                }
            });
        }
    });
}
