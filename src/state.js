// Jesyon eta: gwoup aktif/ènaktif + sesyon
// (Kòmantè an Kreyòl Ayisyen)
const fs = require('fs');
const path = require('path');
const config = require('./config');

const STATE_FILE = path.join(config.SESSION_DIR, 'state.json');

function ensureDefault() {
  return {
    // Gwoup ki aktive (bot reponn ladan yo)
    activatedGroups: {},   // { groupJid: { name, enabled: bool } }
    // Kontak selifye / pei staf (osiyonèl)
    admins: [],
    owner: null,
  };
}

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...ensureDefault(), ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('[state] Erè lè wap li state.json:', e.message);
  }
  const s = ensureDefault();
  save(s);
  return s;
}

function save(state) {
  try {
    fs.mkdirSync(config.SESSION_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[state] Erè lè wap ekri state.json:', e.message);
  }
}

module.exports = { load, save, ensureDefault };
