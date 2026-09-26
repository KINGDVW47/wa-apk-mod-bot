// Pon ant Node.js (Baileys) ak Python (modding APK)
// Rele script Python pou dekonpile → mod → rebuild → sign
// (Kòmantè an Kreyòl Ayisyen)
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const PY_SCRIPT = path.join(__dirname, '..', 'python', 'mod_apk.py');

// Lanse mod pipeline Python (ak opsyon patch)
// patches: objè tankou { plan: true, credit: true, token: true, ... }
function runModPipeline(apkPath, uid, patches) {
  return new Promise((resolve) => {
    const outDir = path.resolve(config.OUTPUT_DIR);
    fs.mkdirSync(outDir, { recursive: true });

    const args = [PY_SCRIPT, apkPath, outDir, uid || 'wa'];
    // Ajoute patch yo kòm agiman --patch=...
    if (patches && typeof patches === 'object') {
      for (const [k, v] of Object.entries(patches)) {
        if (v) args.push('--patch=' + k);
      }
    }

    execFile('python3', args,
      {
        timeout: 25 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 20,
        env: {
          ...process.env,
          UNLOCK_PROXY_HOST: config.UNLOCK_PROXY_HOST || '',
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          // Timeout oswa erè. mod_apk.py ekri "ERR: ..." sou STDOUT,
          // se pou sa nou montre stdout tou (pa sèlman stderr).
          const reason = (stdout + '\n' + stderr).replace(/\s+/g, ' ').trim().slice(-700);
          resolve({ ok: false, msg: 'Mod echwe: ' + (err.killed ? 'tan ekspiré (>25 min)' : reason || err.message) });
          return;
        }
        // Lè siksè, dènye liy stdout = chemen APK final
        const lines = stdout.trim().split('\n').filter(Boolean);
        const last = lines[lines.length - 1] || '';
        if (last.startsWith('OK:')) {
          const apkPath = last.slice(3).trim();
          // Chèche liy SUMMARY:json nan stdout
          let summary = null;
          const sumLine = lines.find(l => l.startsWith('SUMMARY:'));
          if (sumLine) {
            try { summary = JSON.parse(sumLine.slice('SUMMARY:'.length).trim()); } catch (_) {}
          }
          resolve({ ok: true, apkPath, msg: 'siksè', summary });
        } else {
          resolve({ ok: false, msg: (stdout + stderr).replace(/\s+/g, ' ').slice(-800) || 'Mod echwe (rezilta vid).' });
        }
      });
  });
}

module.exports = { runModPipeline };
