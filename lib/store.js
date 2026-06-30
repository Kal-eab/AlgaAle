'use strict';
/**
 * Dual-mode data store.
 *   DATABASE_URL set  → PostgreSQL (production — data survives redeploys)
 *   DATABASE_URL not set → JSON-file fallback (local dev, zero setup)
 * Same async function signatures either way.
 */

const isPg = !!process.env.DATABASE_URL;

let pool;
if (isPg) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const db = require('./db');

// ---------------------------------------------------------------------------
// Row normalizers  (PG snake_case → JS camelCase)
// ---------------------------------------------------------------------------
function rowToUser(r) {
  return {
    id: r.id,
    fullName: r.full_name,
    phone: r.phone || null,
    email: r.email || null,
    passwordHash: r.password_hash,
    role: r.role,
    createdAt: Number(r.created_at),
    providerApplication: {
      status: r.provider_status || 'none',
      idType: r.id_type || null,
      idNumber: r.id_number || null,
      idImage: r.id_image || null,
      submittedAt: r.applied_at ? Number(r.applied_at) : null,
      reviewedAt: r.reviewed_at ? Number(r.reviewed_at) : null
    }
  };
}

function rowToListing(r) {
  let photos = r.photos || {};
  if (typeof photos === 'string') { try { photos = JSON.parse(photos); } catch { photos = {}; } }
  return {
    id: r.id,
    ownerId: r.owner_id || null,
    title: r.title,
    type: r.type,
    area: r.area,
    price: Number(r.price),
    period: r.period,
    audience: r.audience || 'any',
    furnished: !!r.furnished,
    wifi: !!r.wifi,
    water: !!r.water,
    parking: !!r.parking,
    description: r.description || '',
    ownerName: r.owner_name || '',
    ownerPhone: r.owner_phone || '',
    verified: !!r.verified,
    featured: !!r.featured,
    status: r.status || 'active',
    photos,
    createdAt: Number(r.created_at)
  };
}

function rowToBooking(r) {
  return {
    id: r.id,
    listingId: r.listing_id,
    listingTitle: r.listing_title || '',
    name: r.name || '',
    phone: r.phone || '',
    duration: r.duration || '',
    message: r.message || '',
    status: r.status || 'pending',
    roomId: r.room_id || null,
    checkinDate: r.checkin_date || null,
    checkoutDate: r.checkout_date || null,
    guests: r.guests != null ? Number(r.guests) : null,
    nightlyRate: r.nightly_rate != null ? Number(r.nightly_rate) : null,
    nights: r.nights != null ? Number(r.nights) : null,
    subtotal: r.subtotal != null ? Number(r.subtotal) : null,
    serviceFee: r.service_fee != null ? Number(r.service_fee) : null,
    total: r.total != null ? Number(r.total) : null,
    paymentStatus: r.payment_status || 'pending',
    chapaTxRef: r.chapa_tx_ref || null,
    createdAt: Number(r.created_at)
  };
}

function rowToRoom(r) {
  return {
    id: r.id,
    listingId: r.listing_id,
    name: r.name,
    capacity: Number(r.capacity) || 1,
    nightlyRate: Number(r.nightly_rate) || 0,
    photo: r.photo || null,
    sortOrder: Number(r.sort_order) || 0,
    createdAt: Number(r.created_at)
  };
}

function rowToReview(r) {
  return {
    id: r.id,
    listingId: r.listing_id,
    name: r.name || '',
    rating: Number(r.rating),
    comment: r.comment || '',
    createdAt: Number(r.created_at)
  };
}

// Normalise JSON-file users that may lack providerApplication
function normaliseUser(u) {
  return {
    ...u,
    providerApplication: u.providerApplication || {
      status: 'none', idType: null, idNumber: null,
      idImage: null, submittedAt: null, reviewedAt: null
    }
  };
}

// ---------------------------------------------------------------------------
// Schema (PG only — idempotent)
// ---------------------------------------------------------------------------
async function initSchema() {
  if (!isPg) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      full_name       TEXT NOT NULL,
      phone           TEXT UNIQUE,
      email           TEXT,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'seeker',
      provider_status TEXT NOT NULL DEFAULT 'none',
      id_type         TEXT,
      id_number       TEXT,
      id_image        TEXT,
      applied_at      BIGINT,
      reviewed_at     BIGINT,
      created_at      BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS listings (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
      title       TEXT NOT NULL,
      type        TEXT NOT NULL,
      area        TEXT NOT NULL,
      price       NUMERIC NOT NULL DEFAULT 0,
      period      TEXT NOT NULL,
      audience    TEXT NOT NULL DEFAULT 'any',
      furnished   BOOLEAN DEFAULT false,
      wifi        BOOLEAN DEFAULT false,
      water       BOOLEAN DEFAULT false,
      parking     BOOLEAN DEFAULT false,
      description TEXT DEFAULT '',
      owner_name  TEXT DEFAULT '',
      owner_phone TEXT DEFAULT '',
      verified    BOOLEAN DEFAULT false,
      featured    BOOLEAN DEFAULT false,
      status      TEXT DEFAULT 'active',
      photos      JSONB DEFAULT '{}',
      created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id            TEXT PRIMARY KEY,
      listing_id    TEXT,
      listing_title TEXT,
      name          TEXT,
      phone         TEXT,
      duration      TEXT DEFAULT '',
      message       TEXT DEFAULT '',
      status        TEXT DEFAULT 'pending',
      created_at    BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id          TEXT PRIMARY KEY,
      listing_id  TEXT,
      name        TEXT,
      rating      INTEGER DEFAULT 5,
      comment     TEXT,
      created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id           TEXT PRIMARY KEY,
      listing_id   TEXT REFERENCES listings(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      capacity     INTEGER DEFAULT 1,
      nightly_rate NUMERIC NOT NULL DEFAULT 0,
      photo        TEXT,
      sort_order   INTEGER DEFAULT 0,
      created_at   BIGINT NOT NULL
    );
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS room_id        TEXT;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_date   TEXT;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkout_date  TEXT;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guests         INTEGER DEFAULT 1;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS nightly_rate   NUMERIC;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS nights         INTEGER;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS subtotal       NUMERIC;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_fee    NUMERIC;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total          NUMERIC;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS chapa_tx_ref   TEXT;
  `);
}

// ===========================================================================
// USERS
// ===========================================================================
async function getUsers() {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    return rows.map(rowToUser);
  }
  return db.read().users.map(normaliseUser);
}

async function findUserById(id) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  const u = db.read().users.find(x => x.id === id);
  return u ? normaliseUser(u) : null;
}

async function findUserByCredential(identifier) {
  if (isPg) {
    const { rows } = await pool.query(
      `SELECT * FROM users
       WHERE phone=$1 OR (email IS NOT NULL AND LOWER(email)=LOWER($1))
       LIMIT 1`,
      [identifier]
    );
    return rows[0] ? rowToUser(rows[0]) : null;
  }
  const u = db.read().users.find(x =>
    (x.phone && x.phone === identifier) ||
    (x.email && x.email.toLowerCase() === identifier.toLowerCase())
  );
  return u ? normaliseUser(u) : null;
}

async function phoneExists(phone) {
  if (isPg) {
    const { rows } = await pool.query('SELECT id FROM users WHERE phone=$1', [phone]);
    return rows.length > 0;
  }
  return db.read().users.some(u => u.phone === phone);
}

async function emailExists(email) {
  if (isPg) {
    const { rows } = await pool.query('SELECT id FROM users WHERE LOWER(email)=LOWER($1)', [email]);
    return rows.length > 0;
  }
  return db.read().users.some(u => u.email && u.email.toLowerCase() === email.toLowerCase());
}

async function createUser(user) {
  const { id, fullName, phone, email, passwordHash, role, providerApplication: app, createdAt } = user;
  if (isPg) {
    await pool.query(
      `INSERT INTO users (id,full_name,phone,email,password_hash,role,provider_status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, fullName, phone || null, email || null, passwordHash,
       role || 'seeker', (app && app.status) || 'none', createdAt || Date.now()]
    );
    return findUserById(id);
  }
  const newUser = {
    id, fullName, phone: phone || null, email: email || null, passwordHash,
    role: role || 'seeker',
    providerApplication: app || { status: 'none', idType: null, idNumber: null, idImage: null, submittedAt: null, reviewedAt: null },
    createdAt: createdAt || Date.now()
  };
  const data = db.read();
  data.users.push(newUser);
  db.write(data);
  return newUser;
}

async function updateUserPassword(id, passwordHash) {
  if (isPg) {
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, id]);
    return;
  }
  const data = db.read();
  const u = data.users.find(x => x.id === id);
  if (u) { u.passwordHash = passwordHash; db.write(data); }
}

async function updateProviderApplication(id, app) {
  if (isPg) {
    await pool.query(
      `UPDATE users SET provider_status=$1,id_type=$2,id_number=$3,id_image=$4,applied_at=$5,reviewed_at=$6 WHERE id=$7`,
      [app.status, app.idType || null, app.idNumber || null, app.idImage || null,
       app.submittedAt || null, app.reviewedAt || null, id]
    );
    return findUserById(id);
  }
  const data = db.read();
  const u = data.users.find(x => x.id === id);
  if (u) { u.providerApplication = app; db.write(data); }
  return u ? normaliseUser(u) : null;
}

async function approveProvider(id) {
  if (isPg) {
    await pool.query(
      `UPDATE users SET role='provider',provider_status='approved',reviewed_at=$1 WHERE id=$2`,
      [Date.now(), id]
    );
    return findUserById(id);
  }
  const data = db.read();
  const u = data.users.find(x => x.id === id);
  if (u) {
    u.role = 'provider';
    if (!u.providerApplication) u.providerApplication = { status: 'none' };
    u.providerApplication.status = 'approved';
    u.providerApplication.reviewedAt = Date.now();
    db.write(data);
  }
  return u ? normaliseUser(u) : null;
}

async function rejectProvider(id) {
  if (isPg) {
    await pool.query(
      `UPDATE users SET provider_status='rejected',reviewed_at=$1 WHERE id=$2`,
      [Date.now(), id]
    );
    return findUserById(id);
  }
  const data = db.read();
  const u = data.users.find(x => x.id === id);
  if (u) {
    if (!u.providerApplication) u.providerApplication = { status: 'none' };
    u.providerApplication.status = 'rejected';
    u.providerApplication.reviewedAt = Date.now();
    db.write(data);
  }
  return u ? normaliseUser(u) : null;
}

async function getPendingApplications() {
  if (isPg) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE provider_status='pending' ORDER BY applied_at DESC`
    );
    return rows.map(rowToUser);
  }
  return db.read().users
    .filter(u => u.providerApplication && u.providerApplication.status === 'pending')
    .map(normaliseUser);
}

// ===========================================================================
// LISTINGS
// ===========================================================================
async function getListings() {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM listings ORDER BY created_at DESC');
    return rows.map(rowToListing);
  }
  return db.read().listings;
}

async function getListingById(id) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM listings WHERE id=$1', [id]);
    return rows[0] ? rowToListing(rows[0]) : null;
  }
  return db.read().listings.find(l => l.id === id) || null;
}

async function getListingsByOwner(ownerId) {
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT * FROM listings WHERE owner_id=$1 ORDER BY created_at DESC', [ownerId]
    );
    return rows.map(rowToListing);
  }
  return db.read().listings
    .filter(l => l.ownerId === ownerId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function createListing(l) {
  if (isPg) {
    await pool.query(
      `INSERT INTO listings
         (id,owner_id,title,type,area,price,period,audience,
          furnished,wifi,water,parking,description,owner_name,owner_phone,
          verified,featured,status,photos,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [l.id, l.ownerId || null, l.title, l.type, l.area, l.price,
       l.period, l.audience || 'any',
       !!l.furnished, !!l.wifi, !!l.water, !!l.parking,
       l.description || '', l.ownerName || '', l.ownerPhone || '',
       !!l.verified, !!l.featured, l.status || 'active',
       JSON.stringify(l.photos || {}), l.createdAt || Date.now()]
    );
    return getListingById(l.id);
  }
  const data = db.read();
  data.listings.push(l);
  db.write(data);
  return l;
}

async function updateListing(id, l) {
  if (isPg) {
    await pool.query(
      `UPDATE listings SET
         title=$1,type=$2,area=$3,price=$4,period=$5,audience=$6,
         furnished=$7,wifi=$8,water=$9,parking=$10,description=$11,
         owner_name=$12,owner_phone=$13,verified=$14,featured=$15,status=$16,photos=$17
       WHERE id=$18`,
      [l.title, l.type, l.area, l.price, l.period, l.audience || 'any',
       !!l.furnished, !!l.wifi, !!l.water, !!l.parking,
       l.description || '', l.ownerName || '', l.ownerPhone || '',
       !!l.verified, !!l.featured, l.status || 'active',
       JSON.stringify(l.photos || {}), id]
    );
    return getListingById(id);
  }
  const data = db.read();
  const idx = data.listings.findIndex(x => x.id === id);
  if (idx !== -1) {
    data.listings[idx] = { ...data.listings[idx], ...l };
    db.write(data);
    return data.listings[idx];
  }
  return null;
}

async function updateListingPhotos(id, photos) {
  if (isPg) {
    await pool.query('UPDATE listings SET photos=$1 WHERE id=$2', [JSON.stringify(photos), id]);
    return;
  }
  const data = db.read();
  const l = data.listings.find(x => x.id === id);
  if (l) { l.photos = photos; db.write(data); }
}

async function deleteListing(id) {
  if (isPg) {
    await pool.query('DELETE FROM reviews  WHERE listing_id=$1', [id]);
    await pool.query('DELETE FROM bookings WHERE listing_id=$1', [id]);
    await pool.query('DELETE FROM listings WHERE id=$1', [id]);
    return;
  }
  const data = db.read();
  data.reviews  = data.reviews.filter(r => r.listingId !== id);
  data.bookings = data.bookings.filter(b => b.listingId !== id);
  data.listings = data.listings.filter(l => l.id !== id);
  db.write(data);
}

async function toggleListing(id, field) {
  const listing = await getListingById(id);
  if (!listing) return;
  if (isPg) {
    if (field === 'verified' || field === 'featured') {
      await pool.query(`UPDATE listings SET ${field} = NOT ${field} WHERE id=$1`, [id]);
    } else if (field === 'status') {
      const next = listing.status === 'hidden' ? 'active' : 'hidden';
      await pool.query('UPDATE listings SET status=$1 WHERE id=$2', [next, id]);
    }
    return;
  }
  const data = db.read();
  const l = data.listings.find(x => x.id === id);
  if (l) {
    if (field === 'verified' || field === 'featured') l[field] = !l[field];
    else if (field === 'status') l.status = l.status === 'hidden' ? 'active' : 'hidden';
    db.write(data);
  }
}

// ===========================================================================
// ROOMS (room/bed options under a listing)
// ===========================================================================
async function getRoomsByListing(listingId) {
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT * FROM rooms WHERE listing_id=$1 ORDER BY sort_order, created_at', [listingId]
    );
    return rows.map(rowToRoom);
  }
  return db.read().rooms
    .filter(r => r.listingId === listingId)
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt - b.createdAt));
}

async function getRoomById(id) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM rooms WHERE id=$1', [id]);
    return rows[0] ? rowToRoom(rows[0]) : null;
  }
  return db.read().rooms.find(r => r.id === id) || null;
}

async function createRoom(r) {
  if (isPg) {
    await pool.query(
      `INSERT INTO rooms (id,listing_id,name,capacity,nightly_rate,photo,sort_order,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, r.listingId, r.name, r.capacity || 1, r.nightlyRate || 0,
       r.photo || null, r.sortOrder || 0, r.createdAt || Date.now()]
    );
    return getRoomById(r.id);
  }
  const data = db.read();
  data.rooms.push(r);
  db.write(data);
  return r;
}

async function updateRoom(id, r) {
  if (isPg) {
    await pool.query(
      `UPDATE rooms SET name=$1,capacity=$2,nightly_rate=$3,photo=$4,sort_order=$5 WHERE id=$6`,
      [r.name, r.capacity || 1, r.nightlyRate || 0, r.photo || null, r.sortOrder || 0, id]
    );
    return getRoomById(id);
  }
  const data = db.read();
  const idx = data.rooms.findIndex(x => x.id === id);
  if (idx !== -1) { data.rooms[idx] = { ...data.rooms[idx], ...r }; db.write(data); return data.rooms[idx]; }
  return null;
}

async function deleteRoom(id) {
  if (isPg) { await pool.query('DELETE FROM rooms WHERE id=$1', [id]); return; }
  const data = db.read();
  data.rooms = data.rooms.filter(r => r.id !== id);
  db.write(data);
}

// ===========================================================================
// BOOKINGS
// ===========================================================================
async function getBookings() {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM bookings ORDER BY created_at DESC');
    return rows.map(rowToBooking);
  }
  return [...db.read().bookings].sort((a, b) => b.createdAt - a.createdAt);
}

async function createBooking(b) {
  if (isPg) {
    await pool.query(
      `INSERT INTO bookings
         (id,listing_id,listing_title,name,phone,duration,message,status,
          room_id,checkin_date,checkout_date,guests,nightly_rate,nights,
          subtotal,service_fee,total,payment_status,chapa_tx_ref,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [b.id, b.listingId, b.listingTitle || '', b.name || '', b.phone || '',
       b.duration || '', b.message || '', b.status || 'pending',
       b.roomId || null, b.checkinDate || null, b.checkoutDate || null,
       b.guests != null ? b.guests : null,
       b.nightlyRate != null ? b.nightlyRate : null,
       b.nights != null ? b.nights : null,
       b.subtotal != null ? b.subtotal : null,
       b.serviceFee != null ? b.serviceFee : null,
       b.total != null ? b.total : null,
       b.paymentStatus || null, b.chapaTxRef || null, b.createdAt || Date.now()]
    );
    return b;
  }
  const data = db.read();
  data.bookings.push(b);
  db.write(data);
  return b;
}

async function getBookingById(id) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE id=$1', [id]);
    return rows[0] ? rowToBooking(rows[0]) : null;
  }
  return db.read().bookings.find(b => b.id === id) || null;
}

async function getBookingByTxRef(txRef) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM bookings WHERE chapa_tx_ref=$1', [txRef]);
    return rows[0] ? rowToBooking(rows[0]) : null;
  }
  return db.read().bookings.find(b => b.chapaTxRef === txRef) || null;
}

async function updateBookingPayment(id, paymentStatus) {
  if (isPg) {
    await pool.query('UPDATE bookings SET payment_status=$1 WHERE id=$2', [paymentStatus, id]);
    return;
  }
  const data = db.read();
  const b = data.bookings.find(x => x.id === id);
  if (b) { b.paymentStatus = paymentStatus; db.write(data); }
}

async function getBookingsByOwner(ownerId) {
  // Bookings for listings owned by this user (used later for the host view/email)
  const all = await getBookings();
  const myListings = await getListingsByOwner(ownerId);
  const ids = new Set(myListings.map(l => l.id));
  return all.filter(b => ids.has(b.listingId));
}

async function updateBookingStatus(id, status) {
  if (isPg) {
    await pool.query('UPDATE bookings SET status=$1 WHERE id=$2', [status, id]);
    return;
  }
  const data = db.read();
  const b = data.bookings.find(x => x.id === id);
  if (b) { b.status = status; db.write(data); }
}

// ===========================================================================
// REVIEWS
// ===========================================================================
async function getReviewsByListing(listingId) {
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT * FROM reviews WHERE listing_id=$1 ORDER BY created_at DESC', [listingId]
    );
    return rows.map(rowToReview);
  }
  return db.read().reviews
    .filter(r => r.listingId === listingId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getAllReviews() {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM reviews');
    return rows.map(rowToReview);
  }
  return db.read().reviews;
}

async function createReview(r) {
  if (isPg) {
    await pool.query(
      `INSERT INTO reviews (id,listing_id,name,rating,comment,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.id, r.listingId, r.name, r.rating, r.comment, r.createdAt || Date.now()]
    );
    return r;
  }
  const data = db.read();
  data.reviews.push(r);
  db.write(data);
  return r;
}

async function getReviewCountsByListing() {
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT listing_id, COUNT(*) AS cnt FROM reviews GROUP BY listing_id'
    );
    const counts = {};
    rows.forEach(r => { counts[r.listing_id] = Number(r.cnt); });
    return counts;
  }
  const counts = {};
  db.read().reviews.forEach(r => { counts[r.listingId] = (counts[r.listingId] || 0) + 1; });
  return counts;
}

module.exports = {
  initSchema, isPg,
  // users
  getUsers, findUserById, findUserByCredential,
  phoneExists, emailExists, createUser,
  updateProviderApplication, approveProvider, rejectProvider, getPendingApplications,
  updateUserPassword,
  // listings
  getListings, getListingById, getListingsByOwner,
  createListing, updateListing, updateListingPhotos, deleteListing, toggleListing,
  // rooms
  getRoomsByListing, getRoomById, createRoom, updateRoom, deleteRoom,
  // bookings
  getBookings, createBooking, updateBookingStatus,
  getBookingById, getBookingByTxRef, updateBookingPayment, getBookingsByOwner,
  // reviews
  getReviewsByListing, getAllReviews, createReview, getReviewCountsByListing
};
