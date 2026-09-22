// Jere mesaj WhatsApp ki antre
// Detekte grup → aktivite → APK mod flow
// (Kòmantè an Kreyòl Ayisyen)
const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const config = require('./config');
const stateMod = require('./state');
const { runModPipeline } = require('./modbridge');

// Katab chak itilizatè
const WORK_ROOT = '/tmp/wamod';

function normJid(jid) { return (jid || '').split('@')[0]; }

const ALL_PATCHES = ['plan', 'credit', 'token', 'lvl', 'ads', 'root', 'signature'];

// Konfigirasyon patch pou chak gwoup (default: tout aktif)
function getGroupPatches(state, jid) {
  const g = state.activatedGroups[jid];
  if (g && g.patches) return { ...g.patches };
  return { plan: true, credit: true, token: true, lvl: true, ads: true, root: true, signature: true };
}

function setGroupPatch(state, jid, patch, val) {
  const g = state.activatedGroups[jid] || (state.activatedGroups[jid] = { name: jid, enabled: true });
  if (!g.patches) g.patches = getGroupPatches(state, jid);
  g.patches[patch] = val;
  stateMod.save(state);
}

function isGroupMsg(msg) {
  return !!(msg.key && msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us'));
}

function groupEnabled(state, jid) {
  return !!(state.activatedGroups[jid] && state.activatedGroups[jid].enabled);
}

async function handleMessage(sock, msg, state) {
  const jid = msg.key.remoteJid;
  const fromMe = !!msg.key.fromMe;
  if (fromMe) return;

  // Pran tèks (mesaj nòmal oswa repons bouton)
  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.listResponseMessage?.title ||
    msg.message?.buttonsResponseMessage?.selectedButtonId ||
    ''
  ).trim();

  if (text.startsWith('/')) {
    return handleCommand(sock, msg, state, text, jid);
  }

  // APK k ap antre
  if (!msg.message || !msg.message.documentMessage) return;

  const doc = msg.message.documentMessage;
  const fname = doc.fileName || doc.title || 'apk_unknown.apk';

  if (!fname.toLowerCase().endsWith('.apk')) {
    if (isGroupMsg(msg) && groupEnabled(state, jid)) {
      await sock.sendMessage(jid, { text: '❌ Mwen sèlman aksepte fichye .apk.' });
    }
    return;
  }

  const sizeBytes = doc.fileLength ? parseInt(doc.fileLength) : 0;
  if (sizeBytes > config.MAX_APK_SIZE) {
    await sock.sendMessage(jid, { text: '❌ APK twò gwo (maks 300MB).' });
    return;
  }

  if (isGroupMsg(msg) && !groupEnabled(state, jid)) {
    return;
  }

  await sock.sendMessage(jid, { text: '⏳ Mwen resevwa APK ou. Dekonpilasyon an kouri... sa ka pran kèk minit.' });

  const tmpIn = path.join(WORK_ROOT, normJid(jid) + '-' + Date.now() + '.apk');
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  try {
    const buf = await downloadMediaMessage(msg, 'buffer', {});
    fs.writeFileSync(tmpIn, buf);

    const patches = getGroupPatches(state, jid);
  const result = await runModPipeline(tmpIn, normJid(jid), patches);

    if (result.ok && result.apkPath && fs.existsSync(result.apkPath)) {
      await sock.sendMessage(jid, { text: '✅ Mod fini!' + buildReport(result.summary) + '\nMen APK mod ou a 👇' });
      await sock.sendMessage(jid, {
        document: { url: result.apkPath },
        fileName: path.basename(result.apkPath),
        mimetype: 'application/vnd.android.package-archive',
        caption: 'BaliBuddy WA • APK mod ✓',
      });
    } else {
      await sock.sendMessage(jid, { text: '⚠️ ' + (result.msg || 'Mod echwe.') });
    }
  } catch (e) {
    console.error('[handler] Erè mod:', e.message);
    await sock.sendMessage(jid, { text: '❌ Erè pandan mod: ' + e.message });
  } finally {
    try { fs.unlinkSync(tmpIn); } catch (_) {}
  }
}

async function handleCommand(sock, msg, state, text, jid) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');

  switch (cmd) {
    case '/menu':
    case '/help':
      await sendMenu(sock, jid);
      break;

    case '/aktive':
      if (!isGroupMsg(msg)) {
        await sock.sendMessage(jid, { text: 'ℹ️ Kòmand sa a se pou anndan yon grup.' });
        return;
      }
      {
        const meta = await sock.groupMetadata(jid).catch(() => null);
        const name = meta?.subject || jid;
        state.activatedGroups[jid] = { name, enabled: true };
        stateMod.save(state);
        await sock.sendMessage(jid, { text: `✅ Bot aktive sou grup "${name}".\n\nVoye .apk pou mod. Ou ka fèmen l avèk /dezaktive.` });
      }
      break;

    case '/dezaktive':
      if (!isGroupMsg(msg)) {
        await sock.sendMessage(jid, { text: 'ℹ️ Kòmand sa a se pou anndan yon grup.' });
        return;
      }
      if (state.activatedGroups[jid]) state.activatedGroups[jid].enabled = false;
      stateMod.save(state);
      await sock.sendMessage(jid, { text: '🔕 Bot dezaktive sou grup sa a.' });
      break;

    case '/estati':
      {
        const st = require('./wa').getConnState();
        const n = Object.keys(state.activatedGroups).filter(g => state.activatedGroups[g].enabled).length;
        await sock.sendMessage(jid, { text: `📊 *Estati bot*\n• Koneksyon: ${st.status}\n• Gwoup aktif: ${n}\n• Nimewo: ${st.phoneNumber || '—'}` });
      }
      break;

    case '/patch':
    case '/patches':
      await handlePatchCommand(sock, msg, state, cmd, arg, jid, text);
      break;

    case '/ls':
      {
        const list = Object.entries(state.activatedGroups)
          .filter(([, v]) => v.enabled)
          .map(([jid, v]) => `• ${v.name} (${normJid(jid)})`)
          .join('\n') || '(okenn)';
        await sock.sendMessage(jid, { text: '📋 Gwoup aktif:\n' + list });
      }
      break;

    default:
      await sock.sendMessage(jid, { text: 'Kòmand enkoni. Tape /menu pou wè sa bot la ka fè.' });
  }
}

function buildReport(summary) {
  if (!summary) return '';
  const labels = {
    plan: 'Plan/VIP', credit: 'Kredi', token: 'Token',
    lvl: 'LVL', ads: 'Reklam', root: 'Root', signature: 'Siyati',
  };
  const rows = [];
  for (const k of Object.keys(labels)) {
    const v = summary[k];
    if (v && typeof v === 'object' && (v.found > 0 || v.patched > 0)) {
      rows.push('• ' + labels[k] + ': patched ' + v.patched + '/' + v.found);
    } else if (typeof v === 'number' && v > 0) {
      rows.push('• ' + labels[k] + ': ' + v + ' lye');
    }
  }
  if (rows.length === 0) return '';
  return '\n\n🔍 *Plan/Token/Kredi detekte & patch:*\n' + rows.join('\n');
}

function patchLabel(p) {
  const map = {
    plan: 'Plan/VIP/Premium', credit: 'Kredi/Balance', token: 'Token',
    lvl: 'LVL (lisans Google)', ads: 'Reklam (ads)', root: 'Root check', signature: 'Siyati',
  };
  return map[p] || p;
}

async function handlePatchCommand(sock, msg, state, cmd, arg, jid, text) {
  const cur = getGroupPatches(state, jid);
  // Pa gen agiman → montre lis patch + eta yo
  if (!arg) {
    const lines = ALL_PATCHES.map(p => (cur[p] ? '✅' : '❌') + ' ' + patchLabel(p) + ' — /patch ' + p).join('\n');
    await sock.sendMessage(jid, { text: '🔧 *Patch ki aplike sou APK mod yo*\n\n' + lines + '\n\nTip: /patch <non> pou aktive/dezaktive (eg. /patch plan)' });
    return;
  }
  const p = arg.toLowerCase().trim();
  if (!ALL_PATCHES.includes(p)) {
    await sock.sendMessage(jid, { text: '❌ Patch enkoni: ' + p + '.\nPatch ki disponib: ' + ALL_PATCHES.join(', ') });
    return;
  }
  const newVal = !cur[p];
  setGroupPatch(state, jid, p, newVal);
  await sock.sendMessage(jid, { text: (newVal ? '✅' : '❌') + ' Patch *' + patchLabel(p) + '* kounye a ' + (newVal ? 'AKTIVE' : 'DEZAKTIVE en') + ' pou gwoup sa a.' });
}

async function sendMenu(sock, jid) {
  // Bouton interaktif (Baileys v6)
  try {
    await sock.sendMessage(jid, {
      text: MENU_TEXT,
      footer: 'BaliBuddy WA',
      buttons: [
        { buttonId: '/aktive', buttonText: { displayText: '✅ Aktive gwoup' }, type: 1 },
        { buttonId: '/dezaktive', buttonText: { displayText: '🔕 Dezaktive' }, type: 1 },
        { buttonId: '/estati', buttonText: { displayText: '📊 Estati' }, type: 1 },
      ],
      headerType: 1,
      viewOnce: true,
    });
  } catch (e) {
    // Fallback: tèks senp si bouton pa sipòte
    await sock.sendMessage(jid, { text: MENU_TEXT });
  }
}

const MENU_TEXT = `🤖 *BaliBuddy WA* — bot mod APK

*Kisa bot la ka fè:*
🔧 Dekonpile nenpòt APK
✏️ Chanje non aplikasyon an
📢 Enjekte Toast (mesaj) nan launcher
🔐 Patch opsyonèl (LVL, ads, root, siyati, plan/credit/token)
📦 Rebuild + siyati + voye APK mod tounen

*Kòmand:*
/aktive — aktive bot nan grup sa a
/dezaktive — dezaktive bot nan grup sa a
/estati — wè eta koneksyon
/ls — lis gwoup aktif
/patch — aktive/dezaktive patch (plan, kredi, token, lvl, ads, root, siyati)
/menu (oswa /help) — montre meni sa a

*Kijan pou mod:*
1. Aktive bot la (/aktive)
2. Voye fichye .apk la
3. Bot la mod li epi voye l tounen ✓`;

module.exports = { handleMessage, isGroupMsg, HELP_TEXT: MENU_TEXT, MENU_TEXT };
