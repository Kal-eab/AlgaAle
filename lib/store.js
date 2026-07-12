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
    // Where support sends this host's payout after a guest checks in.
    payout: {
      bankName: r.payout_bank_name || '',
      accountNumber: r.payout_account_number || '',
      accountName: r.payout_account_name || ''
    },
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
    checkinTime: r.checkin_time || null,
    checkoutTime: r.checkout_time || null,
    cancellationPolicy: r.cancellation_policy || '',
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
    userId: r.user_id || null,
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
    numRooms: r.num_rooms != null ? Number(r.num_rooms) : 1,
    assignedRoomNumber: r.assigned_room_number || null,
    createdAt: Number(r.created_at)
  };
}

function rowToBlock(r) {
  return {
    id: r.id,
    listingId: r.listing_id,
    roomId: r.room_id || null,
    startDate: r.start_date,
    endDate: r.end_date,
    unitsBlocked: Number(r.units_blocked) || 1,
    reason: r.reason || '',
    createdAt: Number(r.created_at)
  };
}

function rowToRoom(r) {
  let beds = r.beds || [];
  if (typeof beds === 'string') { try { beds = JSON.parse(beds); } catch { beds = []; } }
  let roomNumbers = r.room_numbers || [];
  if (typeof roomNumbers === 'string') { try { roomNumbers = JSON.parse(roomNumbers); } catch { roomNumbers = []; } }
  return {
    id: r.id,
    listingId: r.listing_id,
    name: r.name,
    capacity: Number(r.capacity) || 1,
    nightlyRate: Number(r.nightly_rate) || 0,
    photo: r.photo || null,
    sortOrder: Number(r.sort_order) || 0,
    totalUnits: r.total_units != null ? Number(r.total_units) : 1,
    bedType: r.bed_type || null,
    beds: Array.isArray(beds) ? beds : [],
    roomNumbers: Array.isArray(roomNumbers) ? roomNumbers.map(String) : [],
    description: r.description || '',
    createdAt: Number(r.created_at)
  };
}

function rowToPayment(r) {
  return {
    id: r.id,
    bookingId: r.booking_id,
    userId: r.user_id || null,
    listingId: r.listing_id || null,
    paymentAmount: Number(r.payment_amount) || 0,
    commissionAmount: Number(r.commission_amount) || 0,
    hotelPayoutAmount: Number(r.hotel_payout_amount) || 0,
    screenshotUrl: r.screenshot_url || null,
    screenshotUploadedAt: r.screenshot_uploaded_at ? Number(r.screenshot_uploaded_at) : null,
    paymentNote: r.payment_note || '',
    status: r.status || 'awaiting_payment',
    supportNotes: r.support_notes || '',
    rejectionReason: r.rejection_reason || '',
    confirmedByUserId: r.confirmed_by_user_id || null,
    confirmedAt: r.confirmed_at ? Number(r.confirmed_at) : null,
    arrivedAt: r.arrived_at ? Number(r.arrived_at) : null,
    paidToHotelAt: r.paid_to_hotel_at ? Number(r.paid_to_hotel_at) : null,
    paymentMethod: r.payment_method || null,
    paymentReference: r.payment_reference || null,
    completedAt: r.completed_at ? Number(r.completed_at) : null,
    createdAt: Number(r.created_at)
  };
}

function rowToBankAccount(r) {
  return {
    id: r.id,
    bankName: r.bank_name,
    accountHolderName: r.account_holder_name,
    accountNumber: r.account_number,
    branch: r.branch || '',
    instructions: r.instructions || '',
    isActive: !!r.is_active,
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
    payout: u.payout || { bankName: '', accountNumber: '', accountName: '' },
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
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS num_rooms      INTEGER DEFAULT 1;
    ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS total_units    INTEGER DEFAULT 1;
    ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS bed_type       TEXT;
    ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS description    TEXT DEFAULT '';
    ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS beds           JSONB DEFAULT '[]';
    ALTER TABLE rooms    ADD COLUMN IF NOT EXISTS room_numbers   JSONB DEFAULT '[]';
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS assigned_room_number TEXT;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS checkin_time   TEXT;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS checkout_time  TEXT;
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS cancellation_policy TEXT DEFAULT '';
    CREATE TABLE IF NOT EXISTS availability_blocks (
      id            TEXT PRIMARY KEY,
      listing_id    TEXT REFERENCES listings(id) ON DELETE CASCADE,
      room_id       TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      start_date    TEXT NOT NULL,
      end_date      TEXT NOT NULL,
      units_blocked INTEGER DEFAULT 1,
      reason        TEXT DEFAULT '',
      created_at    BIGINT NOT NULL
    );
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS user_id  TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_bank_name      TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_account_number TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_account_name   TEXT;
    -- Account guests transfer their money into. Only one row is active at a time.
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id                  TEXT PRIMARY KEY,
      bank_name           TEXT NOT NULL,
      account_holder_name TEXT NOT NULL,
      account_number      TEXT NOT NULL,
      branch              TEXT DEFAULT '',
      instructions        TEXT DEFAULT '',
      is_active           BOOLEAN DEFAULT true,
      created_at          BIGINT NOT NULL
    );
    -- One row per booking: the guest's proof of payment and its journey through
    -- support verification and the host payout.
    CREATE TABLE IF NOT EXISTS reservation_payments (
      id                    TEXT PRIMARY KEY,
      booking_id            TEXT NOT NULL UNIQUE,
      user_id               TEXT,
      listing_id            TEXT,
      payment_amount        NUMERIC NOT NULL DEFAULT 0,
      commission_amount     NUMERIC NOT NULL DEFAULT 0,
      hotel_payout_amount   NUMERIC NOT NULL DEFAULT 0,
      screenshot_url        TEXT,
      screenshot_uploaded_at BIGINT,
      payment_note          TEXT DEFAULT '',
      status                TEXT NOT NULL DEFAULT 'awaiting_payment',
      support_notes         TEXT DEFAULT '',
      rejection_reason      TEXT DEFAULT '',
      confirmed_by_user_id  TEXT,
      confirmed_at          BIGINT,
      arrived_at            BIGINT,
      paid_to_hotel_at      BIGINT,
      payment_method        TEXT,
      payment_reference     TEXT,
      completed_at          BIGINT,
      created_at            BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_room_dates    ON bookings (room_id, checkin_date, checkout_date);
    CREATE INDEX IF NOT EXISTS idx_bookings_listing_status ON bookings (listing_id, status);
    CREATE INDEX IF NOT EXISTS idx_bookings_user           ON bookings (user_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_listing           ON rooms (listing_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_listing          ON availability_blocks (listing_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status         ON reservation_payments (status);
    CREATE INDEX IF NOT EXISTS idx_payments_booking        ON reservation_payments (booking_id);
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

async function updateUserRole(id, role) {
  if (isPg) {
    await pool.query('UPDATE users SET role=$1 WHERE id=$2', [role, id]);
    return findUserById(id);
  }
  const data = db.read();
  const u = data.users.find(x => x.id === id);
  if (u) { u.role = role; db.write(data); }
  return u ? normaliseUser(u) : null;
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
          verified,featured,status,photos,checkin_time,checkout_time,cancellation_policy,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [l.id, l.ownerId || null, l.title, l.type, l.area, l.price,
       l.period, l.audience || 'any',
       !!l.furnished, !!l.wifi, !!l.water, !!l.parking,
       l.description || '', l.ownerName || '', l.ownerPhone || '',
       !!l.verified, !!l.featured, l.status || 'active',
       JSON.stringify(l.photos || {}),
       l.checkinTime || null, l.checkoutTime || null, l.cancellationPolicy || '',
       l.createdAt || Date.now()]
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
         owner_name=$12,owner_phone=$13,verified=$14,featured=$15,status=$16,photos=$17,
         checkin_time=$18,checkout_time=$19,cancellation_policy=$20
       WHERE id=$21`,
      [l.title, l.type, l.area, l.price, l.period, l.audience || 'any',
       !!l.furnished, !!l.wifi, !!l.water, !!l.parking,
       l.description || '', l.ownerName || '', l.ownerPhone || '',
       !!l.verified, !!l.featured, l.status || 'active',
       JSON.stringify(l.photos || {}),
       l.checkinTime || null, l.checkoutTime || null, l.cancellationPolicy || '', id]
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
      `INSERT INTO rooms (id,listing_id,name,capacity,nightly_rate,photo,sort_order,total_units,bed_type,beds,room_numbers,description,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.id, r.listingId, r.name, r.capacity || 1, r.nightlyRate || 0,
       r.photo || null, r.sortOrder || 0, r.totalUnits || 1,
       r.bedType || null, JSON.stringify(r.beds || []), JSON.stringify(r.roomNumbers || []),
       r.description || '', r.createdAt || Date.now()]
    );
    return getRoomById(r.id);
  }
  const data = db.read();
  data.rooms.push({ totalUnits: 1, beds: [], roomNumbers: [], ...r });
  db.write(data);
  return r;
}

async function updateRoom(id, r) {
  if (isPg) {
    await pool.query(
      `UPDATE rooms SET name=$1,capacity=$2,nightly_rate=$3,photo=$4,sort_order=$5,
                        total_units=$6,bed_type=$7,beds=$8,room_numbers=$9,description=$10 WHERE id=$11`,
      [r.name, r.capacity || 1, r.nightlyRate || 0, r.photo || null, r.sortOrder || 0,
       r.totalUnits || 1, r.bedType || null, JSON.stringify(r.beds || []),
       JSON.stringify(r.roomNumbers || []), r.description || '', id]
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
         (id,user_id,listing_id,listing_title,name,phone,duration,message,status,
          room_id,checkin_date,checkout_date,guests,nightly_rate,nights,
          subtotal,service_fee,total,payment_status,chapa_tx_ref,num_rooms,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [b.id, b.userId || null, b.listingId, b.listingTitle || '', b.name || '', b.phone || '',
       b.duration || '', b.message || '', b.status || 'pending',
       b.roomId || null, b.checkinDate || null, b.checkoutDate || null,
       b.guests != null ? b.guests : null,
       b.nightlyRate != null ? b.nightlyRate : null,
       b.nights != null ? b.nights : null,
       b.subtotal != null ? b.subtotal : null,
       b.serviceFee != null ? b.serviceFee : null,
       b.total != null ? b.total : null,
       b.paymentStatus || null, b.chapaTxRef || null,
       b.numRooms || 1, b.createdAt || Date.now()]
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

// ===========================================================================
// INVENTORY & AVAILABILITY (Trip.com-style computed availability)
// ===========================================================================
// A booking occupies nights [checkin, checkout) — half-open, so the checkout
// day is free for a new check-in. Only these statuses consume inventory
// ('accepted' is the legacy synonym of 'confirmed'):
const ACTIVE_STATUSES = ['confirmed', 'accepted', 'checked_in'];

function nightsList(checkin, checkout) {
  // ISO date strings; returns every night of the half-open range
  const out = [];
  // Anchor to UTC ('Z') so toISOString() never shifts the date across the
  // local-timezone boundary (e.g. UTC+3 would otherwise roll each night back a day).
  const d = new Date(checkin + 'T00:00:00Z');
  const end = new Date(checkout + 'T00:00:00Z');
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// --- Availability blocks (maintenance / held units, no guest) ---
async function createBlock(b) {
  if (isPg) {
    await pool.query(
      `INSERT INTO availability_blocks (id,listing_id,room_id,start_date,end_date,units_blocked,reason,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [b.id, b.listingId, b.roomId || null, b.startDate, b.endDate,
       b.unitsBlocked || 1, b.reason || '', b.createdAt || Date.now()]
    );
    return b;
  }
  const data = db.read();
  data.blocks = data.blocks || [];
  data.blocks.push(b);
  db.write(data);
  return b;
}

async function getBlockById(id) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM availability_blocks WHERE id=$1', [id]);
    return rows[0] ? rowToBlock(rows[0]) : null;
  }
  return (db.read().blocks || []).find(x => x.id === id) || null;
}

async function deleteBlock(id) {
  if (isPg) { await pool.query('DELETE FROM availability_blocks WHERE id=$1', [id]); return; }
  const data = db.read();
  data.blocks = (data.blocks || []).filter(x => x.id !== id);
  db.write(data);
}

async function getBlocksByListings(listingIds) {
  if (!listingIds.length) return [];
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT * FROM availability_blocks WHERE listing_id = ANY($1) ORDER BY start_date', [listingIds]
    );
    return rows.map(rowToBlock);
  }
  return (db.read().blocks || [])
    .filter(x => listingIds.includes(x.listingId))
    .sort((a, b) => a.startDate < b.startDate ? -1 : 1);
}

// Bookings that consume inventory and overlap the window [from, to)
async function getActiveBookingsInRange(listingIds, from, to) {
  if (!listingIds.length) return [];
  if (isPg) {
    const { rows } = await pool.query(
      `SELECT * FROM bookings
       WHERE listing_id = ANY($1)
         AND status = ANY($2)
         AND checkin_date < $3 AND checkout_date > $4`,
      [listingIds, ACTIVE_STATUSES, to, from]
    );
    return rows.map(rowToBooking);
  }
  return db.read().bookings.filter(b =>
    listingIds.includes(b.listingId) &&
    ACTIVE_STATUSES.includes(b.status) &&
    b.checkinDate && b.checkoutDate &&
    b.checkinDate < to && from < b.checkoutDate
  ).map(b => ({ numRooms: 1, ...b }));
}

/**
 * Available units of one bucket for [checkin, checkout).
 * Bucket = a rooms row (roomId set), or the whole listing (roomId null,
 * total_units 1) for listings without room options.
 * available = total_units − MAX(units used on any single night).
 * Pass `client` to run inside a transaction (overbooking safety).
 */
async function getAvailability({ listingId, roomId, checkin, checkout }, client) {
  let totalUnits = 1;
  if (roomId) {
    const room = await getRoomById(roomId);
    if (!room) return 0;
    totalUnits = room.totalUnits || 1;
  }
  if (isPg) {
    const q = client || pool;
    const { rows } = await q.query(
      `WITH nights AS (
         SELECT generate_series($1::date, ($2::date - INTERVAL '1 day'), INTERVAL '1 day')::date AS night
       ),
       used AS (
         SELECT n.night,
           COALESCE((SELECT SUM(COALESCE(b.num_rooms,1)) FROM bookings b
             WHERE ((CAST($3 AS TEXT) IS NULL AND b.listing_id = $4 AND b.room_id IS NULL)
                 OR (CAST($3 AS TEXT) IS NOT NULL AND b.room_id = $3))
               AND b.status = ANY($5)
               AND b.checkin_date::date <= n.night AND b.checkout_date::date > n.night), 0)
           +
           COALESCE((SELECT SUM(ab.units_blocked) FROM availability_blocks ab
             WHERE ((CAST($3 AS TEXT) IS NULL AND ab.listing_id = $4 AND ab.room_id IS NULL)
                 OR (CAST($3 AS TEXT) IS NOT NULL AND ab.room_id = $3))
               AND ab.start_date::date <= n.night AND ab.end_date::date > n.night), 0) AS used
         FROM nights n
       )
       SELECT GREATEST(0, $6::int - COALESCE(MAX(used), 0)::int) AS available FROM used`,
      [checkin, checkout, roomId || null, listingId, ACTIVE_STATUSES, totalUnits]
    );
    return rows[0] ? Number(rows[0].available) : totalUnits;
  }
  // JSON fallback: count per night in JS
  const data = db.read();
  const bookings = data.bookings.filter(b =>
    ACTIVE_STATUSES.includes(b.status) &&
    b.checkinDate && b.checkoutDate &&
    (roomId ? b.roomId === roomId : (b.listingId === listingId && !b.roomId))
  );
  const blocks = (data.blocks || []).filter(ab =>
    roomId ? ab.roomId === roomId : (ab.listingId === listingId && !ab.roomId)
  );
  let peak = 0;
  for (const night of nightsList(checkin, checkout)) {
    let used = 0;
    for (const b of bookings) if (b.checkinDate <= night && b.checkoutDate > night) used += b.numRooms || 1;
    for (const ab of blocks) if (ab.startDate <= night && ab.endDate > night) used += ab.unitsBlocked || 1;
    if (used > peak) peak = used;
  }
  return Math.max(0, totalUnits - peak);
}

// Per-bucket availability of a listing (for the listing/book pages)
async function listingBookableUnits(listingId, checkin, checkout) {
  const rooms = await getRoomsByListing(listingId);
  if (!rooms.length) {
    const available = await getAvailability({ listingId, roomId: null, checkin, checkout });
    return [{ room: null, totalUnits: 1, available }];
  }
  const out = [];
  for (const room of rooms) {
    const available = await getAvailability({ listingId, roomId: room.id, checkin, checkout });
    out.push({ room, totalUnits: room.totalUnits || 1, available });
  }
  return out;
}

async function isListingBookable(listingId, checkin, checkout) {
  const buckets = await listingBookableUnits(listingId, checkin, checkout);
  return buckets.some(b => b.available >= 1);
}

/**
 * Overbooking-safe booking creation. Locks the bucket row, RE-CHECKS
 * availability inside the transaction, then inserts — so two guests can
 * never both take the last unit. Throws Error with code 'SOLD_OUT'.
 * (JSON mode is single-process and synchronous, so a plain re-check
 * immediately before the write is race-free there.)
 */
async function createBookingSafe(b) {
  const need = b.numRooms || 1;
  const consumes = ACTIVE_STATUSES.includes(b.status);
  if (!isPg) {
    if (consumes) {
      const available = await getAvailability({
        listingId: b.listingId, roomId: b.roomId || null,
        checkin: b.checkinDate, checkout: b.checkoutDate
      });
      if (available < need) {
        const err = new Error('Sold out for those dates');
        err.code = 'SOLD_OUT';
        throw err;
      }
    }
    return createBooking(b);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (consumes) {
      // Lock the bucket so concurrent bookings serialize here
      if (b.roomId) await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [b.roomId]);
      else await client.query('SELECT id FROM listings WHERE id=$1 FOR UPDATE', [b.listingId]);
      const available = await getAvailability({
        listingId: b.listingId, roomId: b.roomId || null,
        checkin: b.checkinDate, checkout: b.checkoutDate
      }, client);
      if (available < need) {
        const err = new Error('Sold out for those dates');
        err.code = 'SOLD_OUT';
        throw err;
      }
    }
    await client.query(
      `INSERT INTO bookings
         (id,user_id,listing_id,listing_title,name,phone,duration,message,status,
          room_id,checkin_date,checkout_date,guests,nightly_rate,nights,
          subtotal,service_fee,total,payment_status,chapa_tx_ref,num_rooms,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [b.id, b.userId || null, b.listingId, b.listingTitle || '', b.name || '', b.phone || '',
       b.duration || '', b.message || '', b.status || 'pending',
       b.roomId || null, b.checkinDate || null, b.checkoutDate || null,
       b.guests != null ? b.guests : null,
       b.nightlyRate != null ? b.nightlyRate : null,
       b.nights != null ? b.nights : null,
       b.subtotal != null ? b.subtotal : null,
       b.serviceFee != null ? b.serviceFee : null,
       b.total != null ? b.total : null,
       b.paymentStatus || null, b.chapaTxRef || null,
       b.numRooms || 1, b.createdAt || Date.now()]
    );
    await client.query('COMMIT');
    return b;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Flip a pending (unpaid, hold-less) booking to confirmed — the moment it starts
 * consuming inventory. Uses the same bucket lock as createBookingSafe so two
 * support agents confirming at once can't both take the last unit.
 * Throws Error with code 'SOLD_OUT'.
 */
async function confirmBookingSafe(bookingId) {
  const b = await getBookingById(bookingId);
  if (!b) return null;
  const need = b.numRooms || 1;
  const args = {
    listingId: b.listingId, roomId: b.roomId || null,
    checkin: b.checkinDate, checkout: b.checkoutDate
  };
  const soldOut = () => {
    const err = new Error('Sold out for those dates');
    err.code = 'SOLD_OUT';
    return err;
  };
  if (!isPg) {
    if (await getAvailability(args) < need) throw soldOut();
    await updateBookingStatus(bookingId, 'confirmed');
    return getBookingById(bookingId);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (b.roomId) await client.query('SELECT id FROM rooms WHERE id=$1 FOR UPDATE', [b.roomId]);
    else await client.query('SELECT id FROM listings WHERE id=$1 FOR UPDATE', [b.listingId]);
    if (await getAvailability(args, client) < need) throw soldOut();
    await client.query(`UPDATE bookings SET status='confirmed' WHERE id=$1`, [bookingId]);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
    throw e;
  } finally {
    client.release();
  }
  return getBookingById(bookingId);
}

// ===========================================================================
// ROOM NUMBER ASSIGNMENT (specific numbered units within a room type)
// ===========================================================================
// A room type owns a list of physical room numbers (rooms.room_numbers, e.g.
// ["101","102","103"]). A confirmed/checked-in booking gets one (or numRooms)
// of them, stored comma-separated on bookings.assigned_room_number. Two
// bookings must never share a number on overlapping nights.

async function updateBookingRoomNumber(id, value) {
  if (isPg) {
    await pool.query('UPDATE bookings SET assigned_room_number=$1 WHERE id=$2', [value || null, id]);
    return;
  }
  const data = db.read();
  const b = data.bookings.find((x) => x.id === id);
  if (b) { b.assignedRoomNumber = value || null; db.write(data); }
}

// Room numbers already taken by other active bookings of this room type that
// overlap [from, to). Half-open, like availability.
async function getAssignedNumbersForRoom(roomId, from, to, excludeBookingId) {
  const used = new Set();
  const add = (val) => String(val || '').split(',').forEach((n) => { const t = n.trim(); if (t) used.add(t); });
  if (isPg) {
    const { rows } = await pool.query(
      `SELECT id, assigned_room_number FROM bookings
       WHERE room_id=$1 AND status=ANY($2) AND assigned_room_number IS NOT NULL
         AND checkin_date < $3 AND checkout_date > $4`,
      [roomId, ACTIVE_STATUSES, to, from]
    );
    rows.forEach((r) => { if (r.id !== excludeBookingId) add(r.assigned_room_number); });
    return used;
  }
  db.read().bookings
    .filter((b) => b.roomId === roomId && ACTIVE_STATUSES.includes(b.status) &&
      b.assignedRoomNumber && b.id !== excludeBookingId &&
      b.checkinDate && b.checkoutDate && b.checkinDate < to && from < b.checkoutDate)
    .forEach((b) => add(b.assignedRoomNumber));
  return used;
}

// Free (unassigned, non-overlapping) numbers of a room type for a date range.
async function freeRoomNumbers(room, from, to, excludeBookingId) {
  if (!room || !room.roomNumbers || !room.roomNumbers.length) return [];
  const used = await getAssignedNumbersForRoom(room.id, from, to, excludeBookingId);
  return room.roomNumbers.map(String).filter((n) => !used.has(n.trim()));
}

// Auto-assign numbers to a booking if its room type defines them and it doesn't
// have one yet. Returns the assigned value (comma-separated) or null.
async function assignRoomNumbers(bookingId) {
  const b = await getBookingById(bookingId);
  if (!b || !b.roomId || b.assignedRoomNumber) return b ? b.assignedRoomNumber : null;
  if (!ACTIVE_STATUSES.includes(b.status)) return null;
  const room = await getRoomById(b.roomId);
  const free = await freeRoomNumbers(room, b.checkinDate, b.checkoutDate, b.id);
  if (!free.length) return null;
  const value = free.slice(0, b.numRooms || 1).join(', ');
  await updateBookingRoomNumber(bookingId, value);
  return value;
}

// Bookings a guest made from their own account (drives "My trips").
async function getBookingsByUser(userId) {
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT * FROM bookings WHERE user_id=$1 ORDER BY created_at DESC', [userId]
    );
    return rows.map(rowToBooking);
  }
  return db.read().bookings
    .filter(b => b.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function updateUserPayout(id, payout) {
  if (isPg) {
    await pool.query(
      `UPDATE users SET payout_bank_name=$1,payout_account_number=$2,payout_account_name=$3 WHERE id=$4`,
      [payout.bankName || null, payout.accountNumber || null, payout.accountName || null, id]
    );
    return findUserById(id);
  }
  const data = db.read();
  const u = data.users.find(x => x.id === id);
  if (u) { u.payout = payout; db.write(data); }
  return u ? normaliseUser(u) : null;
}

// ===========================================================================
// BANK ACCOUNTS (the account guests transfer their money into)
// ===========================================================================
async function getBankAccounts() {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM bank_accounts ORDER BY created_at DESC');
    return rows.map(rowToBankAccount);
  }
  return [...(db.read().bankAccounts || [])].sort((a, b) => b.createdAt - a.createdAt);
}

// The one account shown on the payment page. Null means payments are not
// configured yet — callers must tell the guest instead of showing a blank page.
async function getActiveBankAccount() {
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT * FROM bank_accounts WHERE is_active = true ORDER BY created_at DESC LIMIT 1'
    );
    return rows[0] ? rowToBankAccount(rows[0]) : null;
  }
  const found = (db.read().bankAccounts || []).filter(a => a.isActive)
    .sort((a, b) => b.createdAt - a.createdAt);
  return found[0] || null;
}

async function createBankAccount(a) {
  if (isPg) {
    await pool.query(
      `INSERT INTO bank_accounts (id,bank_name,account_holder_name,account_number,branch,instructions,is_active,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [a.id, a.bankName, a.accountHolderName, a.accountNumber,
       a.branch || '', a.instructions || '', a.isActive !== false, a.createdAt || Date.now()]
    );
    return a;
  }
  const data = db.read();
  data.bankAccounts = data.bankAccounts || [];
  data.bankAccounts.push({ isActive: true, ...a });
  db.write(data);
  return a;
}

// Exactly one account can be active — activating one deactivates the rest.
async function activateBankAccount(id) {
  if (isPg) {
    await pool.query('UPDATE bank_accounts SET is_active = (id = $1)', [id]);
    return;
  }
  const data = db.read();
  (data.bankAccounts || []).forEach(a => { a.isActive = a.id === id; });
  db.write(data);
}

async function deleteBankAccount(id) {
  if (isPg) { await pool.query('DELETE FROM bank_accounts WHERE id=$1', [id]); return; }
  const data = db.read();
  data.bankAccounts = (data.bankAccounts || []).filter(a => a.id !== id);
  db.write(data);
}

// ===========================================================================
// RESERVATION PAYMENTS
// ===========================================================================
async function createPayment(p) {
  if (isPg) {
    await pool.query(
      `INSERT INTO reservation_payments
         (id,booking_id,user_id,listing_id,payment_amount,commission_amount,hotel_payout_amount,
          status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.bookingId, p.userId || null, p.listingId || null,
       p.paymentAmount || 0, p.commissionAmount || 0, p.hotelPayoutAmount || 0,
       p.status || 'awaiting_payment', p.createdAt || Date.now()]
    );
    return getPaymentById(p.id);
  }
  const data = db.read();
  data.payments = data.payments || [];
  data.payments.push({
    screenshotUrl: null, screenshotUploadedAt: null, paymentNote: '',
    supportNotes: '', rejectionReason: '', confirmedByUserId: null, confirmedAt: null,
    arrivedAt: null, paidToHotelAt: null, paymentMethod: null, paymentReference: null,
    completedAt: null, status: 'awaiting_payment', ...p
  });
  db.write(data);
  return p;
}

async function getPaymentById(id) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM reservation_payments WHERE id=$1', [id]);
    return rows[0] ? rowToPayment(rows[0]) : null;
  }
  return (db.read().payments || []).find(p => p.id === id) || null;
}

async function getPaymentByBooking(bookingId) {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM reservation_payments WHERE booking_id=$1', [bookingId]);
    return rows[0] ? rowToPayment(rows[0]) : null;
  }
  return (db.read().payments || []).find(p => p.bookingId === bookingId) || null;
}

async function getPayments() {
  if (isPg) {
    const { rows } = await pool.query('SELECT * FROM reservation_payments ORDER BY created_at DESC');
    return rows.map(rowToPayment);
  }
  return [...(db.read().payments || [])].sort((a, b) => b.createdAt - a.createdAt);
}

async function getPaymentsByStatus(statuses) {
  const list = [].concat(statuses);
  if (isPg) {
    const { rows } = await pool.query(
      'SELECT * FROM reservation_payments WHERE status = ANY($1) ORDER BY created_at DESC', [list]
    );
    return rows.map(rowToPayment);
  }
  return (await getPayments()).filter(p => list.includes(p.status));
}

// bookingId -> payment, for annotating a list of bookings in one pass.
async function getPaymentsByBookings(bookingIds) {
  if (!bookingIds.length) return {};
  let rows;
  if (isPg) {
    const res = await pool.query(
      'SELECT * FROM reservation_payments WHERE booking_id = ANY($1)', [bookingIds]
    );
    rows = res.rows.map(rowToPayment);
  } else {
    rows = (db.read().payments || []).filter(p => bookingIds.includes(p.bookingId));
  }
  const map = {};
  rows.forEach(p => { map[p.bookingId] = p; });
  return map;
}

// Partial update by column — every mutation below funnels through here.
async function updatePayment(id, fields) {
  const COLUMNS = {
    screenshotUrl: 'screenshot_url',
    screenshotUploadedAt: 'screenshot_uploaded_at',
    paymentNote: 'payment_note',
    status: 'status',
    supportNotes: 'support_notes',
    rejectionReason: 'rejection_reason',
    confirmedByUserId: 'confirmed_by_user_id',
    confirmedAt: 'confirmed_at',
    arrivedAt: 'arrived_at',
    paidToHotelAt: 'paid_to_hotel_at',
    paymentMethod: 'payment_method',
    paymentReference: 'payment_reference',
    completedAt: 'completed_at'
  };
  const keys = Object.keys(fields).filter(k => COLUMNS[k]);
  if (!keys.length) return getPaymentById(id);
  if (isPg) {
    const sets = keys.map((k, i) => `${COLUMNS[k]}=$${i + 1}`).join(',');
    const values = keys.map(k => (fields[k] === undefined ? null : fields[k]));
    await pool.query(`UPDATE reservation_payments SET ${sets} WHERE id=$${keys.length + 1}`,
      [...values, id]);
    return getPaymentById(id);
  }
  const data = db.read();
  const p = (data.payments || []).find(x => x.id === id);
  if (p) { keys.forEach(k => { p[k] = fields[k]; }); db.write(data); }
  return p || null;
}

module.exports = {
  initSchema, isPg,
  // users
  getUsers, findUserById, findUserByCredential,
  phoneExists, emailExists, createUser,
  updateProviderApplication, approveProvider, rejectProvider, getPendingApplications,
  updateUserPassword, updateUserPayout, updateUserRole,
  // listings
  getListings, getListingById, getListingsByOwner,
  createListing, updateListing, updateListingPhotos, deleteListing, toggleListing,
  // rooms
  getRoomsByListing, getRoomById, createRoom, updateRoom, deleteRoom,
  // bookings
  getBookings, createBooking, updateBookingStatus,
  getBookingById, getBookingByTxRef, updateBookingPayment, getBookingsByOwner,
  getBookingsByUser,
  // bank accounts & reservation payments
  getBankAccounts, getActiveBankAccount, createBankAccount, activateBankAccount, deleteBankAccount,
  createPayment, getPaymentById, getPaymentByBooking, getPayments,
  getPaymentsByStatus, getPaymentsByBookings, updatePayment,
  // reviews
  getReviewsByListing, getAllReviews, createReview, getReviewCountsByListing,
  // inventory & availability
  ACTIVE_STATUSES,
  createBlock, getBlockById, deleteBlock, getBlocksByListings,
  getActiveBookingsInRange,
  getAvailability, listingBookableUnits, isListingBookable,
  createBookingSafe, confirmBookingSafe,
  // room number assignment
  updateBookingRoomNumber, getAssignedNumbersForRoom, freeRoomNumbers, assignRoomNumbers
};
