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

// Referans sokè aktif
let activeSock = null;
// Reutilize menm estado pou pa pèdi creds
let saveCredsFn = null;

function getConnState() { return connState; }
function setConnState(patch) { Object.assign(connState, patch); }

function disconnectMsg(code) {
  const map = {
    [DisconnectReason.loggedOut]: 'Ou te dekonekte (loggedOut). Bezwen nouvo pairing.',
    [DisconnectReason.connectionClosed]: 'Koneksyon fèmen.',
    [DisconnectReason.connectionLost]: 'Koneksyon pèdi.',
    [DisconnectReason.connectionReplaced]: 'Ou konekte sou yon lòt aparèy.',
    [DisconnectReason.restartRequired]: 'Restart obligatwa.',
    [DisconnectReason.timedOut]: 'Koneksyon ekspire (timeout).',
    [403]: 'Nimewo entèdi (banned).',
    [401]: 'Nimewo oswa otantifikasyon pa bon.',
  };
  return map[code] || ('Rezon: ' + code);
}

// Netwaye nimewo a: sèlman chif
function cleanPhone(p) {
  return String(p || '').replace(/\D/g, '');
}

// Kreye yon sokè Baileys (san auto-dial byen wòl)
async function makeSocket(state) {
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2,3000,1015901307] }));
  return makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 60_000,
  });
}

async function connect() {
  fs.mkdirSync(config.SESSION_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(config.SESSION_DIR);
  saveCredsFn = saveCreds;

  const sock = await makeSocket(state);
  activeSock = sock;

  setConnState({ status: 'connecting', error: null });

  // Si deja gen yon sesyon sovga
  if (state.creds?.me?.id) {
    const me = state.creds.me.id.split(':')[0];
    setConnState({ status: 'connected', phoneNumber: me, name: state.creds.me.name });
  }

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setConnState({ status: 'waiting_qr', qr, pairingCode: null, pairMode: false, error: null });
      qrcode.generate(qr, { small: true });
      console.log('\n📱 Skenne QR sa a ak WhatsApp (Linked devices → Link a device):\n');
    }

    if (connection === 'open') {
      const me = sock.user?.id?.split(':')[0];
      setConnState({ status: 'connected', qr: null, pairingCode: null, pairMode: false, phoneNumber: me, name: sock.user?.name, error: null });
      console.log('\n✅ Bot konekte ak WhatsApp kòm:', me || sock.user?.name);
    }

    if (connection === 'close') {
      let code = null;
      try { code = new Boom(lastDisconnect?.error)?.output?.statusCode; } catch (_) { code = lastDisconnect?.error?.output?.statusCode; }
      if (code == null) code = lastDisconnect?.error?.statusCode;
      const msg = disconnectMsg(code);
      // Pa bay yon erè kounye a si li te jis eseye konekte (QR/komin)
      const isLoggedOut = code === DisconnectReason.loggedOut;
      setConnState({
        status: 'disconnected',
        error: msg,
        qr: null,
        pairingCode: isLoggedOut ? connState.pairingCode : null,
        pairMode: isLoggedOut ? connState.pairMode : false,
      });
      console.log('[wa] Koneksyon fèmen →', msg, '(code', code + ')');

      // Rekonekte otomatikman (sòf si loggedOut)
      if (!isLoggedOut) {
        setTimeout(() => { connect().catch(e => console.error('[wa] reconnect echwe:', e.message)); }, 4000);
      } else {
        console.log('[wa] loggedOut — rete tann nouvo pairing/QR.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  return sock;
}

// Mande yon pairing code
async function requestPairingCode(sock, phoneNumber) {
  const phone = cleanPhone(phoneNumber);
  if (!phone || phone.length < 8) {
    return { ok: false, error: 'Nimewo pa valid.' };
  }

  const s = sock || activeSock;
  if (!s) {
    return { ok: false, error: 'Bot pa konekte ankò. Tann yon ti moman epi re-ese.' };
  }

  if (connState.status === 'connected') {
    return { ok: false, error: 'Bot deja konekte!' };
  }

  setConnState({ status: 'waiting_pair', pairMode: true, pairingCode: null, phoneNumber: phone, error: null });

  // Baileys: requestPairingCode ka mande sokè vivan. Eseye plizyè fwa ak tann.
  for (let i = 1; i <= 5; i++) {
    try {
      const code = await s.requestPairingCode(phone);
      if (code) {
        setConnState({ pairMode: true, pairingCode: code, status: 'waiting_pair', error: null });
        console.log('\n🔢 Pairing code ou: ' + code);
        console.log('Antre kòd sa a sou aparèy ou: WhatsApp → Linked devices → Link with phone number.\n');
        return { ok: true, code };
      }
    } catch (e) {
      const raw = (e && (e.message || e.output?.payload?.message)) || String(e && e.stack || e);
      console.error('[wa] requestPairingCode eseye ' + i + '/5 →', raw);

      // Erè pèmanan — sispann
      if (/forbidden|unauthorized|401|403|banned|exists|already|registered|invalid phone|not allowed/i.test(raw)) {
        setConnState({ pairMode: false, error: raw });
        return { ok: false, error: raw };
      }
    }
    if (i < 5) await new Promise(r => setTimeout(r, 3000));
  }

  const msg = 'Koneksyon fèmen — pa ka jwenn pairing code. Rekonekte epi re-ese.';
  setConnState({ pairMode: false, error: msg });
  return { ok: false, error: msg };
}

module.exports = { connect, requestPairingCode, cleanPhone, getConnState, setConnState };
