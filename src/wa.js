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
  phoneNumber: null,
  name: null,
  error: null,
};

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

  setConnState({ status: 'connecting', error: null });

  if (state.creds?.me?.id) {
    const me = state.creds.me.id.split(':')[0];
    setConnState({ status: 'connected', phoneNumber: me, name: state.creds.me.name });
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setConnState({ status: 'waiting_qr', qr, pairingCode: null });
      qrcode.generate(qr, { small: true });
      console.log('\n📱 Skenne QR sa a ak WhatsApp (Linked devices → Link a device):\n');
    }

    if (connection === 'open') {
      const me = sock.user?.id?.split(':')[0];
      setConnState({ status: 'connected', qr: null, pairingCode: null, phoneNumber: me, name: sock.user?.name });
      console.log('\n✅ Bot konekte ak WhatsApp kòm:', me || sock.user?.name);
    }

    if (connection === 'close') {
      let code;
      try { code = new Boom(lastDisconnect?.error)?.output?.statusCode; } catch (_) { code = null; }
      const msg = disconnectMsg(code);
      setConnState({ status: 'disconnected', error: msg, qr: null, pairingCode: null });
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
async function requestPairingCode(sock, phoneNumber) {
  try {
    // Baileys: request pairing code — gen nimewo WhatsApp sipòte sa toujou
    const code = await sock.requestPairingCode(phoneNumber);
    if (code) {
      setConnState({ pairMode: true, pairingCode: code });
      console.log('\n🔢 Pairing code ou: ' + code);
      console.log('Antre kòd sa a sou apparèy ou: WhatsApp → Linked devices → Link with phone number.\n');
      return code;
    }
  } catch (e) {
    console.log('[wa] Pairing code pa sipòte pou nimewo sa a. Ap sèvi ak QR olye.');
    setConnState({ pairMode: false });
  }
  return null;
}

module.exports = { connect, requestPairingCode, getConnState, setConnState };
