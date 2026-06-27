/**
 * Central place for where persistent data lives.
 *
 * Locally this is ./data and ./data/uploads.
 * In production set DATA_DIR to a mounted persistent disk (e.g. /data on Render)
 * so listings and uploaded photos survive redeploys and restarts.
 */
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

[DATA_DIR, UPLOAD_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

module.exports = { DATA_DIR, UPLOAD_DIR, DB_PATH };
