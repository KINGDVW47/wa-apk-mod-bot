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
  // Gwosè maks APK (byte) = 300MB
  MAX_APK_SIZE: 300 * 1024 * 1024,
};
