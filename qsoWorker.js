
// qsoWorker.js - computes per-mode QSO counts off the main thread
let parks = [];
let activations = [];

function normalizeMode(m) {
    if (!m) return 'unk';
    const s = String(m).toUpperCase();
    if (s === 'CW') return 'cw';
    if (s === 'SSB' || s === 'PHONE') return 'ssb';
    if (s === 'FT8' || s === 'FT4' || s === 'DATA' || s === 'DIGITAL') return 'data';
    return 'unk';
}

self.onmessage = (e) => {
    const { type, payload } = e.data || {};
    if (type === 'INIT') {
        parks = payload?.parks || [];
        activations = payload?.activations || [];
        self.postMessage({ type: 'INIT_OK' });
        return;
    }
    if (type === 'COMPUTE') {
        const refs = payload?.references || [];
        // Build an index by reference for faster filtering
        const want = new Set(refs);
        const result = Object.create(null);
        // Assuming activations entries look like { reference, mode, qsos } or similar
        for (const a of activations) {
            if (!a) continue;
            const ref = a.reference || a.park || a.ref;
            if (!ref || !want.has(ref)) continue;
            const key = normalizeMode(a.mode);
            const count = Number(a.qsos ?? a.count ?? 1) || 1;
            if (!result[ref]) result[ref] = { cw:0, data:0, ssb:0, unk:0 };
            result[ref][key] += count;
        }
        self.postMessage({ type: 'COMPUTE_DONE', payload: { result } });
        return;
    }
};
