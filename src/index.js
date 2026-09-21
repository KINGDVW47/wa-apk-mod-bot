// Kòmantè an Kreyòl Ayisyen
// Pentry pwensipal bot WhatsApp BaliBuddy
const stateMod = require('./state');
const wa = require('./wa');
const { handleMessage } = require('./handler');
const { startDashboard } = require('./dashboard');
const config = require('./config');

async function main() {
  console.log('🤖 BaliBuddy WA ap demare...');

  // Chaje eta gwoup yo
  const state = stateMod.load();

  // Konekte ak WhatsApp
  const sock = await wa.connect();

  // Koute mesaj yo
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages?.[0];
    if (!msg || !msg.message) return;
    try {
      await handleMessage(sock, msg, state);
    } catch (e) {
      console.error('[index] Erè nan handleMessage:', e.message);
    }
  });

  // Dashboard web
  startDashboard(sock, state);

  console.log('✅ BaliBuddy WA pare. Voye /help nan chat la.');

  // Graceful shutdown
  process.on('SIGINT', () => { console.log('Bye.'); process.exit(0); });
  process.on('SIGTERM', () => { console.log('Bye.'); process.exit(0); });
}

main().catch((e) => {
  console.error('Erè fatal:', e);
  process.exit(1);
});
