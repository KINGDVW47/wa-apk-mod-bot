// Koneksyon WhatsApp (Baileys)
// Pairing code an premye, QR kòm fallback
// (Kòmantè an Kreyòl Ayisyen)
const fs = require('fs');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const config = require('./config');

// Etat global koneksyon (dashboard + log li sa)
let connState = {
  status: 'disconnected', // disconnected | connecting | connected | waiting_pair | waiting_qr
  qr: null,
  pairingCode: null,
  pairMode: false,
  phoneNumber: null,
  name: null,
  error: null,
};

// Referans sokè aktif (pou /api/pair ka rele requestPairingCode a nenpòt lè)
let activeSock = null;

function getConnState() { return connState; }
function setConnState(patch) { Object.assign(connState, patch); }

function disconnectMsg(code) {
  const map = {
    [DisconnectReason.loggedOut]: 'Ou te dekonekte (loggedOut). Bezwen nouvo pairing.',
    [DisconnectReason.connectionClosed]: 'Koneksyon fèmen.',
    [DisconnectReason.connectionLost]: 'Koneksyon pèdi.',
    [DisconnectReason.connectionReplaced]: 'Ou konekte sou yon lòt aparèy.',
    [DisconnectReason.restartRequired]: 'Restart obligatwa.',
    [403]: 'Nimewo entèdi (banned).',
    [401]: 'Nimewo oswa otantifikasyon pa bon.',
  };
  return map[code] || ('Rezon: ' + code);
}

// Netwaye nimewo a: sèlman chif, san '+', espas, tire
function cleanPhone(p) {
  return String(p || '').replace(/\D/g, '');
}

async function connect() {
  fs.mkdirSync(config.SESSION_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.SESSION_DIR);

  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2,3000,1015901307] }));

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
  });

  activeSock = sock;

  setConnState({ status: 'connecting', error: null });

  if (state.creds?.me?.id) {
    const me = state.creds.me.id.split(':')[0];
    setConnState({ status: 'connected', phoneNumber: me, name: state.creds.me.name });
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setConnState({ status: 'waiting_qr', qr, pairingCode: null, pairMode: false });
      qrcode.generate(qr, { small: true });
      console.log('\n📱 Skenne QR sa a ak WhatsApp (Linked devices → Link a device):\n');
    }

    if (connection === 'open') {
      const me = sock.user?.id?.split(':')[0];
      setConnState({ status: 'connected', qr: null, pairingCode: null, pairMode: false, phoneNumber: me, name: sock.user?.name });
      console.log('\n✅ Bot konekte ak WhatsApp kòm:', me || sock.user?.name);
    }

    if (connection === 'close') {
      let code;
      try { code = new Boom(lastDisconnect?.error)?.output?.statusCode; } catch (_) { code = null; }
      const msg = disconnectMsg(code);
      setConnState({ status: 'disconnected', error: msg, qr: null, pairingCode: null, pairMode: false });
      console.log('[wa] Koneksyon fèmen →', msg);
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(() => connect().catch(console.error), 3000);
      } else {
        console.log('[wa] Bezwen nouvo pairing (loggedOut).');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  return sock;
}

// Mande yon pairing code pou nimewo (si WhatsApp sipòte li)
// Retoune: { ok: true, code } oswa { ok: false, error }
async function requestPairingCode(sock, phoneNumber) {
  const phone = cleanPhone(phoneNumber);
  if (!phone || phone.length < 8) {
    return { ok: false, error: 'Nimewo pa valid.' };
  }

  // Sèvi ak sokè klè si yo pa pase youn
  const s = sock || activeSock;
  if (!s) {
    return { ok: false, error: 'Bot pa konekte ankò. Tann yon ti moman epi re-ese.' };
  }

  // Si deja konekte, pa bezwen pairing
  if (connState.status === 'connected') {
    return { ok: false, error: 'Bot deja konekte.' };
  }

  try {
    setConnState({ status: 'waiting_pair', pairMode: true, pairingCode: null, phoneNumber: phone, error: null });

    // Baileys: request pairing code — resi depi nimewo a sipòte sa
    let code = null;
    try {
      code = await s.requestPairingCode(phone);
    } catch (e) {
      // Baileys ka voye erè; nou kaptire mesaj vrè a pou n ka montre l
      const raw = (e && (e.message || e.output?.payload?.message)) || String(e && e.stack || e);
      console.error('[wa] requestPairingCode te echwe:', raw);

      // Si erè a se "Connection Closed" oswa sokè poko pare, eseye remonte sokè a
      if (/closed|close|not open|unauthorized|401/i.test(raw)) {
        setConnState({ pairMode: false });
        return { ok: false, error: 'Sokè pa nan bon eta pou pairing. Re-ese nan kèk segond.' };
      }
      setConnState({ pairMode: false });
      return { ok: false, error: raw || 'Pairing code pa sipòte pou nimewo sa a.' };
    }

    if (code) {
      setConnState({ pairMode: true, pairingCode: code, status: 'waiting_pair' });
      console.log('\n🔢 Pairing code ou: ' + code);
      console.log('Antre kòd sa a sou aparèy ou: WhatsApp → Linked devices → Link with phone number.\n');
      return { ok: true, code };
    }

    // Pa gen code — swa QR sèl fason
    setConnState({ pairMode: false, error: 'Pairing code pa disponib; sèvi ak QR.' });
    return { ok: false, error: 'Pairing code pa disponib; sèvi ak QR.' };
  } catch (e) {
    setConnState({ pairMode: false });
    return { ok: false, error: String(e && e.message || e) };
  }
}

module.exports = { connect, requestPairingCode, cleanPhone, getConnState, setConnState };
