// Dashboard web — gade koneksyon + lis gwoup + bouton aktive/dezaktive
// (Kòmantè an Kreyòl Ayisyen)
const express = require('express');
const path = require('path');
const wa = require('./wa');
const stateMod = require('./state');
const { serveStatic } = require('./dashboard_static');

function startDashboard(sock, state) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Paj HTML statik (dashboard UI)
  serveStatic(app);

  // ----- API -----
  app.get('/api/status', (req, res) => {
    res.json({ conn: wa.getConnState() });
  });

  app.get('/api/groups', (req, res) => {
    const groups = Object.entries(state.activatedGroups).map(([jid, g]) => ({
      jid, name: g.name, enabled: !!g.enabled,
    }));
    res.json({ groups });
  });

  // Bouton aktive/dezaktive depi dashboard
  app.post('/api/groups/:jid/toggle', (req, res) => {
    const jid = req.params.jid;
    const cur = state.activatedGroups[jid];
    if (!cur) return res.status(404).json({ error: 'grup pa jwenn' });
    cur.enabled = !cur.enabled;
    stateMod.save(state);
    res.json({ jid, enabled: cur.enabled });
  });

  // Retire yon grup nèt
  app.post('/api/groups/:jid/remove', (req, res) => {
    const jid = req.params.jid;
    if (state.activatedGroups[jid]) {
      delete state.activatedGroups[jid];
      stateMod.save(state);
    }
    res.json({ ok: true });
  });

  // Pairing code: mande kòd pou yon nimewo
  app.post('/api/pair', async (req, res) => {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    if (!phone || phone.length < 8) {
      return res.status(400).json({ error: 'Antre yon nimewo valid (avèk kòd peyi).' });
    }
    try {
      const code = await wa.requestPairingCode(sock, phone);
      if (code) res.json({ ok: true, pairingCode: code });
      else res.json({ ok: false, msg: 'Pairing code pa sipòte; skenne QR nan log yo.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(process.env.DASHBOARD_PORT || 3000, '0.0.0.0', () => {
    console.log(`[dashboard] sou pò ${process.env.DASHBOARD_PORT || 3000}`);
  });

  return app;
}

module.exports = { startDashboard };
