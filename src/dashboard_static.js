const express = require('express');
const path = require('path');

function serveStatic(app) {
  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub));
  app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
}

module.exports = { serveStatic };
