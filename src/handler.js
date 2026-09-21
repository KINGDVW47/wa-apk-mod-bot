// Jere mesaj WhatsApp ki antre
// Detekte grup → aktivite → APK mod flow
// (Kòmantè an Kreyòl Ayisyen)
const fs = require('fs');
const path = require('path');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const config = require('./config');
const stateMod = require('./state');
const { runModPipeline } = require('./modbridge');

// Katab / chak itilizatè
const WORK_ROOT = '/tmp/wamod';

function normJid(jid) { return (jid || '').split('@')[0]; }

function isGroupMsg(msg) {
  return !!(msg.key && msg.key.remoteJid && msg.key.remoteJid.endsWith('@g.us'));
}

// Vle di grup la aktive?
function groupEnabled(state, jid) {
  return !!(state.activatedGroups[jid] && state.activatedGroups[jid].enabled);
}

async function handleMessage(sock, msg, state) {
  const jid = msg.key.remoteJid;
  const fromMe = !!msg.key.fromMe;

  // Ignore pwòp mesaj bot la
  if (fromMe) return;

  // Sèlman ogmante si se mesaj
  const text = (msg.message?.conversation || msg.message?.extendedTextMessage?.text || '').trim();

  // ===== Kòmand ou ka voye =====
  // Tout kòmand mache nan DM, men aktivasyon pou gwoup depann de eta
  if (text.startsWith('/')) {
    return handleCommand(sock, msg, state, text, jid);
  }

  // ===== APK k ap antre =====
  if (!msg.message || !msg.message.documentMessage) return;

  const doc = msg.message.documentMessage;
  const fname = doc.fileName || doc.title || 'apk_unknown.apk';

  if (!fname.toLowerCase().endsWith('.apk')) {
    // Se yon dokiman men pa APK
    if (isGroupMsg(msg) && groupEnabled(state, jid)) {
      await sock.sendMessage(jid, { text: '❌ Mwen sèlman aksepte fichye .apk.' });
    }
    return;
  }

  // Gwosè
  const sizeBytes = doc.fileLength ? parseInt(doc.fileLength) : 0;
  if (sizeBytes > config.MAX_APK_SIZE) {
    await sock.sendMessage(jid, { text: '❌ APK twò gwo (maks 300MB).' });
    return;
  }

  // Sèlman aji si se DM oswa grup aktive
  if (isGroupMsg(msg) && !groupEnabled(state, jid)) {
    return; // grup pa aktive, inyore
  }

  await sock.sendMessage(jid, { text: '⏳ Mwen resevwa APK ou. Dekonpilasyon an kouri... sa ka pran kèk minit.' });

  // Telechaje medya
  const tmpIn = path.join(WORK_ROOT, normJid(jid) + '-' + Date.now() + '.apk');
  fs.mkdirSync(WORK_ROOT, { recursive: true });
  try {
    const buf = await downloadMediaMessage(msg, 'buffer', {});
    fs.writeFileSync(tmpIn, buf);

    // Lanse mod pipeline (Python)
    const result = await runModPipeline(tmpIn, normJid(jid));
    // result = { ok, apkPath, msg }

    if (result.ok && result.apkPath && fs.existsSync(result.apkPath)) {
      await sock.sendMessage(jid, { text: '✅ Mod fini! Men APK mod ou a 👇' });
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
    case '/help':
      await sock.sendMessage(jid, { text: HELP_TEXT });
      break;

    case '/aktive':
      // Aktive bot sou grup sa a (sèlman nan grup)
      if (!isGroupMsg(msg)) {
        await sock.sendMessage(jid, { text: 'ℹ️ Kòmand sa a se pou anndan yon grup.' });
        return;
      }
      {
        const meta = await sock.groupMetadata(jid).catch(() => null);
        const name = meta?.subject || jid;
        state.activatedGroups[jid] = { name, enabled: true };
        stateMod.save(state);
        await sock.sendMessage(jid, { text: `✅ Bot aktive sou grup "${name}". Voye .apk pou mod.\n\nOu ka fèmen l avèk /dezaktive.` });
      }
      break;

    case '/dezaktive':
      if (!isGroupMsg(msg)) {
        await sock.sendMessage(jid, { text: 'ℹ️ Kòmand sa a se pou anndan yon grup.' });
        return;
      }
      if (state.activatedGroups[jid]) { state.activatedGroups[jid].enabled = false; }
      stateMod.save(state);
      await sock.sendMessage(jid, { text: '🔕 Bot dezaktive sou grup sa a.' });
      break;

    case '/estati':
      {
        const st = require('./wa').getConnState();
        const n = Object.keys(state.activatedGroups).filter(g => state.activatedGroups[g].enabled).length;
        await sock.sendMessage(jid, { text: `📊 Estati bot:\n• Koneksyon: ${st.status}\n• Gwoup aktif: ${n}` });
      }
      break;

    case '/ls':
      {
        const list = Object.entries(state.activatedGroups)
          .filter(([,v]) => v.enabled)
          .map(([jid, v]) => `• ${v.name} (${normJid(jid)})`)
          .join('\n') || '(okenn)';
        await sock.sendMessage(jid, { text: '📋 Gwoup aktif:\n' + list });
      }
      break;

    default:
      await sock.sendMessage(jid, { text: 'Kòmand enkoni. Tape /help pou wè lis la.' });
  }
}

const HELP_TEXT = `🤖 *BaliBuddy WA* — bot mod APK

*Kòmand:*
/help — montre lis sa a
/aktive — aktive bot sou grup sa a
/dezaktive — dezaktive bot sou grup sa a
/estati — wè eta koneksyon
/ls — lis gwoup aktif

*Kijan pou mod:*
1. Aktive bot sou grup la (/aktive)
2. Voye fichye .apk la
3. Bot la dekonpile, mod non app la, epi voye APK mod la tounen ✓`;

module.exports = { handleMessage, isGroupMsg, HELP_TEXT };
