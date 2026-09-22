// Koneksyon WhatsApp (Baileys)
// Pairing code ak QR ki mache solid
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

let connState = {
  status: 'disconnected',
  qr: null,
  pairingCode: null,
  pairMode: false,
  phoneNumber: null,
  name: null,
  error: null,
};

let activeSock = null;
// Lis de leson (eg. messages.upsert) pou re-fikse sou chak nouvo sokè
const listeners = [];

function getConnState() { return connState; }
function setConnState(patch) { Object.assign(connState, patch); }

// Rejistre yon leson ki dwe viv sou nenpòt sokè (nouvo oswa aktyèl)
function on(event, cb) {
  listeners.push({ event, cb });
  if (activeSock) activeSock.ev.on(event, cb);
}
function getActiveSock() { return activeSock; }

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

function cleanPhone(p) {
  return String(p || '').replace(/\D/g, '');
}

async function getAuthState() {
  fs.mkdirSync(config.SESSION_DIR, { recursive: true });
  return useMultiFileAuthState(config.SESSION_DIR);
}

// Kreye sokè ak jesyon evènman koneksyon
function makeSocket(state, saveCreds, { onQR, onOpen, onClose } = {}) {
  return makeWASocket({
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    markOnlineOnConnect: true,
    syncFullHistory: false,
    connectTimeoutMs: 120_000,
    qrTimeout: 120_000,
  });
}

// Fikse evènman koneksyon yo
function wireEvents(sock, saveCreds) {
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setConnState({ status: 'waiting_qr', qr, pairingCode: connState.pairingCode, pairMode: connState.pairMode, error: null });
      qrcode.generate(qr, { small: true });
      console.log('\n📱 Skenne QR — WhatsApp → Linked devices → Link a device:\n');
    }

    if (connection === 'open') {
      const me = sock.user?.id?.split(':')[0];
      setConnState({ status: 'connected', qr: null, pairingCode: null, pairMode: false, phoneNumber: me, name: sock.user?.name, error: null });
      console.log('✅ Bot konekte kòm:', me || sock.user?.name);
    }

    if (connection === 'close') {
      let code = null;
      try { code = new Boom(lastDisconnect?.error)?.output?.statusCode; } catch (_) {}
      if (code == null) { try { code = lastDisconnect?.error?.statusCode; } catch (_) {} }
      const msg = disconnectMsg(code);
      const wasWaitingPair = connState.pairMode;

      setConnState({
        status: 'disconnected',
        error: msg,
        qr: null,
        // Si nou t ap tann pairing/epi li fèmen, pa efase kòd la
        pairingCode: wasWaitingPair ? connState.pairingCode : null,
        pairMode: wasWaitingPair,
      });
      console.log('[wa] Koneksyon fèmen →', msg, '(code:', code + ')');

      // Rekonekte sèlman si nou te deja pè (gen sesyon) — pa pandan pairing/QR
      if (!wasWaitingPair && code !== DisconnectReason.loggedOut) {
        setTimeout(() => reconnect().catch(e => console.error('[wa] reconnect echwe:', e.message)), 4000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Re-fikse tout leson rejistre yo (eg. messages.upsert depi index.js)
  for (const l of listeners) {
    sock.ev.on(l.event, l.cb);
  }
}

// Koneksyon inisyal: si gen sesyon, konekte nòmal; sinon rete tann pairing/QR
async function connect() {
  const { state, saveCreds } = await getAuthState();
  const hasSession = !!state.creds?.me?.id;

  // Deja gen sesyon → konekte nòmalman
  const sock = makeSocket(state, saveCreds);
  activeSock = sock;
  wireEvents(sock, saveCreds);

  if (hasSession) {
    setConnState({ status: 'connecting', error: null });
    const me = state.creds.me.id.split(':')[0];
    setConnState({ status: 'connected', phoneNumber: me, name: state.creds.me.name });
  } else {
    // Pa gen sesyon: mete nan eta "pare pou pairing". QR ap vini atravè evènman an.
    setConnState({ status: 'waiting_qr', error: null, pairMode: false });
    console.log('[wa] Pa gen sesyon — tann pairing code oswa QR. QR ap parèt sou dashboard.');
  }

  return sock;
}

async function reconnect() {
  const { state, saveCreds } = await getAuthState();
  const sock = makeSocket(state, saveCreds);
  activeSock = sock;
  wireEvents(sock, saveCreds);
  setConnState({ status: 'connecting', error: null });
  return sock;
}

// Mande pairing code — si sokè aktyèl la mouri, kreye yon nouvo frè
async function requestPairingCode(sock, phoneNumber) {
  const phone = cleanPhone(phoneNumber);
  if (!phone || phone.length < 8) {
    return { ok: false, error: 'Nimewo pa valid.' };
  }

  if (connState.status === 'connected') {
    return { ok: false, error: 'Bot deja konekte!' };
  }

  setConnState({ status: 'waiting_pair', pairMode: true, pairingCode: null, phoneNumber: phone, error: null });

  // Kreye yon SOKÈ FRÈ pou pairing — sa a soti pou fè pairing, pa vye sokè ki mouri
  const { state, saveCreds } = await getAuthState();
  const freshSock = makeSocket(state, saveCreds);
  activeSock = freshSock;
  wireEvents(freshSock, saveCreds);

  // Kite sokè a yon ti moman pou koneksyon TCP etabli (parèt kòm sa a nan local test)
  await new Promise(r => setTimeout(r, 2000));

  for (let i = 1; i <= 4; i++) {
    try {
      const code = await freshSock.requestPairingCode(phone);
      if (code) {
        setConnState({ pairMode: true, pairingCode: code, status: 'waiting_pair', error: null });
        console.log('\n🔢 Pairing code ou: ' + code);
        console.log('Antre kòd sa a: WhatsApp → Linked devices → Link with phone number.\n');
        return { ok: true, code };
      }
    } catch (e) {
      const raw = (e && (e.message || e.output?.payload?.message)) || String(e && e.stack || e);
      console.error('[wa] requestPairingCode eseye ' + i + '/4 →', raw);
      if (/forbidden|unauthorized|401|403|banned|exists|already|registered|invalid phone|not allowed/i.test(raw)) {
        setConnState({ pairMode: false, error: raw });
        return { ok: false, error: raw };
      }
    }
    if (i < 4) await new Promise(r => setTimeout(r, 2500));
  }

  // Dènye chans: kite QR avèk sokè frè a (li rete vivan pou QR)
  setConnState({ status: 'waiting_qr', pairMode: true, pairingCode: null, error: 'Pairing code pa disponib. Sèvi ak QR ki anba a.' });
  return { ok: false, error: 'Pairing code pa disponib. Sèvi ak QR ki anba a sou dashboard.' };
}

module.exports = { connect, requestPairingCode, cleanPhone, getConnState, setConnState, getActiveSock, on };
