/**
 * Tiny synchronous JSON-file data store — DEV FALLBACK ONLY.
 * Used when DATABASE_URL is not set. Single-process, not concurrency-safe:
 * concurrent requests each read-modify-write the file and the later write
 * silently clobbers the earlier one. Fine for local dev; never use in prod.
 */
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./paths');

const DEFAULTS = {
  users: [],
  listings: [],
  bookings: [],
  reviews: [],
  rooms: [],
  blocks: []
};

function ensureFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULTS, null, 2));
  }
}

function read() {
  ensureFile();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Failed to read db, resetting:', err.message);
    return { ...DEFAULTS };
  }
}

function write(data) {
  ensureFile();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { read, write, DB_PATH };
