// Konfigirasyon bot WhatsApp
// (Kòmantè an Kreyòl Ayisyen)

module.exports = {
  BOT_NAME: 'BaliBuddy WA',
  // Katab pou konsève sesyon WhatsApp (yo kreye otomatikman)
  SESSION_DIR: 'session',
  // Katab pou resevwa APK yo voye
  UPLOAD_DIR: 'uploads',
  // Katab pou stocke APK mod
  OUTPUT_DIR: 'output',
  // Dashboard pò
  DASHBOARD_PORT: process.env.DASHBOARD_PORT || 3000,
  // Pò proxy deblokaj (Approach A)
  UNLOCK_PROXY_PORT: process.env.UNLOCK_PROXY_PORT || 8080,
  // Domèn piblik bot la (pou reekri hôte API nan APK sevè-valide)
  // Lè li pa etabli, nou fè deblokaj lokal sèlman (Approach B)
  UNLOCK_PROXY_HOST: process.env.UNLOCK_PROXY_HOST || 'wa-apk-mod-bot-production.up.railway.app',
  // Gwosè maks APK (byte) = 300MB
  MAX_APK_SIZE: 300 * 1024 * 1024,
};
