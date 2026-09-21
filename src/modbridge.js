// Pon ant Node.js (Baileys) ak Python (modding APK)
// Rele script Python pou dekonpile → mod → rebuild → sign
// (Kòmantè an Kreyòl Ayisyen)
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const PY_SCRIPT = path.join(__dirname, '..', 'python', 'mod_apk.py');

// Lanse mod pipeline Python
function runModPipeline(apkPath, uid) {
  return new Promise((resolve) => {
    const outDir = path.resolve(config.OUTPUT_DIR);
    fs.mkdirSync(outDir, { recursive: true });

    execFile('python3', [PY_SCRIPT, apkPath, outDir, uid || 'wa'],
      { timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 * 10 },
      (err, stdout, stderr) => {
        if (err) {
          // Timeout oswa erè
          resolve({ ok: false, msg: 'Mod echwe: ' + (err.killed ? 'tan ekspiré' : stderr.slice(-500) || err.message) });
          return;
        }
        // Lè siksè, dènye liy stdout = chemen APK final
        const lines = stdout.trim().split('\n').filter(Boolean);
        const last = lines[lines.length - 1] || '';
        if (last.startsWith('OK:')) {
          const apkPath = last.slice(3).trim();
          resolve({ ok: true, apkPath, msg: 'siksè' });
        } else {
          resolve({ ok: false, msg: (stdout + stderr).slice(-800) || 'Mod echwe (rezilta vid).' });
        }
      });
  });
}

module.exports = { runModPipeline };
