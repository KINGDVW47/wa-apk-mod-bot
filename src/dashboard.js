// Dashboard web — gade koneksyon + QR + lis gwoup + bouton aktive/dezaktive
// (Kòmantè an Kreyòl Ayisyen)
const express = require('express');
const path = require('path');
const QRCode = require('qrcode');
const wa = require('./wa');
const stateMod = require('./state');
const { serveStatic } = require('./dashboard_static');

function startDashboard(sock, state) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  serveStatic(app);

  // ----- API -----
  app.get('/api/status', (req, res) => {
    res.json({ conn: wa.getConnState() });
  });

  // QR kòm imaj (skan dirèk nan dashboard)
  app.get('/api/qr', async (req, res) => {
    const conn = wa.getConnState();
    if (conn.status === 'connected') {
      return res.json({ status: 'connected' });
    }
    if (!conn.qr) {
      return res.json({ status: 'no_qr', pairingCode: conn.pairingCode || null });
    }
    try {
      const dataUrl = await QRCode.toDataURL(conn.qr, { margin: 1, width: 320 });
      res.json({ status: 'qr', image: dataUrl });
    } catch (e) {
      res.json({ status: 'no_qr', error: String(e.message) });
    }
  });

  app.get('/api/groups', (req, res) => {
    const groups = Object.entries(state.activatedGroups).map(([jid, g]) => ({
      jid, name: g.name, enabled: !!g.enabled,
    }));
    res.json({ groups });
  });

  app.post('/api/groups/:jid/toggle', (req, res) => {
    const jid = req.params.jid;
    const cur = state.activatedGroups[jid];
    if (!cur) return res.status(404).json({ error: 'grup pa jwenn' });
    cur.enabled = !cur.enabled;
    stateMod.save(state);
    res.json({ jid, enabled: cur.enabled });
  });

  app.post('/api/groups/:jid/remove', (req, res) => {
    const jid = req.params.jid;
    if (state.activatedGroups[jid]) {
      delete state.activatedGroups[jid];
      stateMod.save(state);
    }
    res.json({ ok: true });
  });

  // Efase sesyon WhatsApp (pou yon pairing/QR frè)
  app.post('/api/reset', async (req, res) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.join(__dirname, '..', 'session');
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      res.json({ ok: true, msg: 'Sesyon efase. Bot ap rekonekte ak yon sesyon frè.' });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.post('/api/pair', async (req, res) => {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 8) {
      return res.status(400).json({ error: 'Antre yon nimewo valid (avèk kòd peyi).' });
    }
    try {
      const r = await wa.requestPairingCode(sock, phone);
      if (r && r.ok) {
        res.json({ ok: true, pairingCode: r.code });
      } else {
        const err = (r && r.error) || 'Pairing code pa sipòte; skenne QR nan paj sa a.';
        res.json({ ok: false, msg: err });
      }
    } catch (e) {
      res.status(500).json({ error: String(e && e.message || e) });
    }
  });

  app.listen(process.env.DASHBOARD_PORT || 3000, '0.0.0.0', () => {
    console.log(`[dashboard] sou pò ${process.env.DASHBOARD_PORT || 3000}`);
  });

  return app;
}

module.exports = { startDashboard };
