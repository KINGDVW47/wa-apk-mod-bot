// unlockproxy.js — Sèvè proxy deblokaj (Approach A)
//
// Lè yon APK sevè-valide (tankou Autoflowly) reekri hôte API li sou bot la,
// li vini isit la. Bot la rele VRÈ backend la, epi li reekri repons
// abònman / kwota / entitelman yo sou "Premium + illimité".
//
// Kijan li mache:
//   - APK a fè yon request pou /api/subscription/checkFeatureAccess ... 
//   - proxy la reenvoye li nan backend reyèl la
//   - proxy la reekri repons la: plan="premium"/"enterprise", limit=illimité
//   - APK a wè "ou gen Premium" menm si kont lan se Free
//
// (Kòmantè an Kreyòl Ayisyen)
const http = require('http');
const https = require('https');

// Hôte backend reyèl yo. Nou reekri domèn sa yo (hôte ki sou APK a).
const REAL_HOSTS = ['api.autoflowly.com'];

// Champs ki endike plan/kwota nan repons JSON — nou fòse yo.
const UNLOCK_KEYS = [
  'plan', 'planName', 'planId', 'currentPlan', 'subscribed', 'isSubscribed',
  'subscriptionActive', 'isPremium', 'isPro', 'premium', 'pro', 'entitlement',
  'entitlements', 'tier', 'currentTier', 'tierName', 'isUnlocked', 'isPaid',
  'credits', 'creditBalance', 'remainingCredits', 'tokens', 'tokenBalance',
  'quota', 'usageLimit', 'limit', 'maxApps', 'appsRemaining',
];

function rewriteJson(obj) {
  if (Array.isArray(obj)) return obj.map(rewriteJson);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      const lk = k.toLowerCase();
      const v = obj[k];
      if (UNLOCK_KEYS.includes(k) || UNLOCK_KEYS.includes(lk)) {
        out[k] = unlimitValue(v);
      } else {
        out[k] = rewriteJson(v);
      }
    }
    return out;
  }
  return obj;
}

function unlimitValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'boolean') return true;
  if (typeof v === 'number') {
    // Yon limit nimerik (kwota) → fòse yon valè gwo
    if (v < 999999) return 999999;
    return v;
  }
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'free' || s === 'starter' || s === 'basic' || s === 'none') return 'premium';
    return v;
  }
  if (Array.isArray(v)) {
    // entitelman: ajoute tout sa ki nesesè
    return v;
  }
  return v;
}

function makeRequest(targetHost, req) {
  return new Promise((resolve, reject) => {
    const opts = {
      host: targetHost,
      port: 443,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: targetHost },
    };
    const mod = opts.protocol === 'http:' ? http : https;
    const r = mod.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks) }));
    });
    r.on('error', reject);
    req.pipe(r);
  });
}

async function handle(req, res) {
  const host = req.headers['x-unlock-target'] || REAL_HOSTS[0];
  try {
    const r = await makeRequest(host, req);
    let body = r.body;
    const ct = (r.headers['content-type'] || '').toLowerCase();
    if (ct.includes('json')) {
      try {
        const parsed = JSON.parse(body.toString('utf-8'));
        const rewritten = rewriteJson(parsed);
        body = Buffer.from(JSON.stringify(rewritten));
      } catch (_) {
        // pa JSON valab — kite kòm li ye
      }
    }
    res.writeHead(r.status, r.headers);
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'proxy err', msg: String(e.message) }));
  }
}

function startUnlockProxy(port) {
  const server = http.createServer(handle);
  server.listen(port, '0.0.0.0', () => {
    console.log(`[unlock-proxy] sou pò ${port}`);
  });
  return server;
}

module.exports = { startUnlockProxy };
