// Kòmantè an Kreyòl Ayisyen
// Pentry pwensipal bot WhatsApp BaliBuddy
const stateMod = require('./state');
const wa = require('./wa');
const { handleMessage } = require('./handler');
const { startDashboard } = require('./dashboard');
const config = require('./config');

let state = null;

async function main() {
  console.log('🤖 BaliBuddy WA ap demare...');

  state = stateMod.load();

  const sock = await wa.connect();

  // Koute mesaj atravè wa.on — re-fikse otomatikman sou chak nouvo sokè
  wa.on('messages.upsert', async (m) => {
    const msg = m.messages?.[0];
    if (!msg || !msg.message) return;
    const active = wa.getActiveSock() || sock;
    try {
      await handleMessage(active, msg, state);
    } catch (e) {
      console.error('[index] Erè nan handleMessage:', e.message);
    }
  });

  startDashboard(sock, state);

  console.log('✅ BaliBuddy WA pare. Voye /help nan chat la.');

  process.on('SIGINT', () => { console.log('Bye.'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('Bye.'); process.exit(0); });
}

main().catch((e) => {
  console.error('Erè fatal:', e);
  process.exit(1);
});
