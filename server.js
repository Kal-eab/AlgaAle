'use strict';
require('dotenv').config();
const path    = require('path');
const fs      = require('fs');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash   = require('connect-flash');
const multer  = require('multer');
const bcrypt  = require('bcryptjs');
const { nanoid } = require('nanoid');

const store  = require('./lib/store');
const seed   = require('./lib/seed');
const C      = require('./lib/constants');
const { UPLOAD_DIR } = require('./lib/paths');

const app   = express();
const PORT  = process.env.PORT || 3000;
const OWNER_EMAIL = 'genkaleab@gmail.com';

// Wrap async route handlers — prevents unhandled-promise crashes
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// ---------------------------------------------------------------------------
// View engine & middleware
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.set('trust proxy', 1);

const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'alga-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
};

// In production, keep sessions in Postgres so they survive restarts/deploys
if (process.env.DATABASE_URL) {
  sessionConfig.store = new pgSession({
    conObject: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    },
    createTableIfMissing: true   // auto-creates the "session" table
  });
}

app.use(session(sessionConfig));
app.use(flash());

app.use(async (req, res, next) => {
  if (req.session.user) {
    try {
      const fresh = await store.findUserById(req.session.user.id);
      if (fresh && fresh.role !== req.session.user.role) {
        req.session.user.role = fresh.role;
        req.session.user.providerAppStatus =
          fresh.providerApplication ? fresh.providerApplication.status : 'none';
      }
    } catch (_) { /* ignore, keep existing session */ }
  }
  res.locals.C     = C;
  res.locals.user  = req.session.user || null;
  res.locals.flash = { success: req.flash('success'), error: req.flash('error') };
  res.locals.path  = req.path;
  res.locals.money = (n) => Number(n).toLocaleString('en-US');
  next();
});

// ---------------------------------------------------------------------------
// File uploads
// ---------------------------------------------------------------------------
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'algaale',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation: [{ width: 1200, crop: 'limit' }]
    };
  }
});

// Separate storage for ID verification photos — authenticated delivery type
// keeps them off public URLs. Signed URLs needed to view them in the owner panel.
const idStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async () => ({
    folder: 'algaale/ids',
    type: 'authenticated',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
  })
});

const mimeFilter = (req, file, cb) => cb(null, /^image\/(jpe?g|png|webp)$/i.test(file.mimetype));

const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: mimeFilter
});

const idUpload = multer({
  storage: idStorage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: mimeFilter
});

// Payment screenshots. Cloudinary in production; without credentials (local dev)
// they land on disk under /uploads so the payment flow still works end to end.
const cloudinaryReady = !!(process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);

const proofStorage = cloudinaryReady
  ? new CloudinaryStorage({
      cloudinary: cloudinary,
      params: async () => ({
        folder: 'algaale/payments',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
      })
    })
  : multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(UPLOAD_DIR, 'payments');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) =>
        cb(null, nanoid(12) + path.extname(file.originalname || '.png').toLowerCase())
    });

const proofUpload = multer({
  storage: proofStorage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: mimeFilter
});

// Where the stored file is reachable from a browser.
function proofUrl(file) {
  return cloudinaryReady ? file.path : '/uploads/payments/' + file.filename;
}
const photoFields = C.PHOTO_CATEGORIES.map((c) => ({ name: `photo_${c}`, maxCount: 6 }));

// ---------------------------------------------------------------------------
// Middleware guards
// ---------------------------------------------------------------------------
function requireUser(req, res, next) {
  if (req.session.user) return next();
  const dest = req.originalUrl;
  const isListing = /^\/listing\//.test(dest);
  req.flash('error', isListing
    ? 'Create a free account to view this home.'
    : 'Please log in to continue.');
  res.redirect('/register?next=' + encodeURIComponent(dest));
}

function requireProvider(req, res, next) {
  const u = req.session.user;
  if (!u) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/register?next=' + encodeURIComponent(req.originalUrl));
  }
  if (u.role === 'provider' || u.role === 'owner' || u.role === 'admin') return next();
  req.flash('error', 'You need an approved provider account to do that.');
  res.redirect('/become-provider');
}

function requireOwner(req, res, next) {
  const u = req.session.user;
  if (u && u.role === 'owner') return next();
  req.flash('error', 'Access denied.');
  res.redirect('/');
}

function requireAdmin(req, res, next) {
  const u = req.session.user;
  if (u && (u.role === 'admin' || u.role === 'owner')) return next();
  req.flash('error', 'Please log in as admin to continue.');
  res.redirect('/admin/login');
}

// Support team verifies payment proofs and pays hosts out. Admin/owner inherit.
function requireSupport(req, res, next) {
  const u = req.session.user;
  if (u && (u.role === 'support' || u.role === 'admin' || u.role === 'owner')) return next();
  req.flash('error', 'Please log in as support to continue.');
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sessionUser(user) {
  return {
    id: user.id,
    fullName: user.fullName || user.name || '',
    phone: user.phone || null,
    email: user.email || null,
    role: user.role,
    providerAppStatus: user.providerApplication ? user.providerApplication.status : 'none'
  };
}

function parseAmenities(body) {
  return {
    furnished: body.furnished === 'on' || body.furnished === 'true',
    wifi:      body.wifi      === 'on' || body.wifi      === 'true',
    water:     body.water     === 'on' || body.water     === 'true',
    parking:   body.parking   === 'on' || body.parking   === 'true'
  };
}

function collectUploadedPhotos(files, existing) {
  const photos = existing ? JSON.parse(JSON.stringify(existing)) : {};
  C.PHOTO_CATEGORIES.forEach((cat) => {
    if (!photos[cat]) photos[cat] = [];
    const f = files && files[`photo_${cat}`];
    if (f && f.length) f.forEach((file) => photos[cat].push(file.path));
  });
  return photos;
}

function listingFirstPhoto(l) {
  for (const cat of C.PHOTO_CATEGORIES) {
    if (l.photos && l.photos[cat] && l.photos[cat].length) return l.photos[cat][0];
  }
  return null;
}

// All photos across every category, flattened into one array (for the carousel).
function listingPhotos(l) {
  const out = [];
  C.PHOTO_CATEGORIES.forEach((cat) => {
    if (l.photos && l.photos[cat] && l.photos[cat].length) {
      l.photos[cat].forEach((p) => out.push(p));
    }
  });
  return out;
}

// Query params that mean "the user is filtering" — used to redirect legacy
// bookmarked `/?area=…` URLs to the new `/search` page.
const SEARCH_PARAM_KEYS = [
  'q', 'area', 'type', 'period', 'audience', 'minPrice', 'maxPrice',
  'furnished', 'wifi', 'water', 'parking', 'verified', 'near_university',
  'sort', 'checkin', 'checkout', 'guests'
];

// Areas featured in the home "Popular in Addis Ababa" strip.
const POPULAR_AREAS = ['Bole', 'Piassa', 'Kazanchis', 'Gerji'];

// Rebuild a /search URL from the current query, optionally dropping one param
// (or one value of a multi-value param). Used to render removable filter chips.
function buildSearchUrl(query, omitKey, omitValue) {
  const params = new URLSearchParams();
  Object.keys(query).forEach((k) => {
    const raw = query[k];
    const values = Array.isArray(raw) ? raw : [raw];
    values.forEach((v) => {
      if (v === undefined || v === '') return;
      if (k === omitKey && (omitValue === undefined || String(v) === String(omitValue))) return;
      params.append(k, v);
    });
  });
  const qs = params.toString();
  return '/search' + (qs ? '?' + qs : '');
}

function effectiveNightly(listing, room) {
  if (room) return Number(room.nightlyRate) || 0;
  const price = Number(listing.price) || 0;
  if (listing.period === 'weekly')  return price / 7;
  if (listing.period === 'monthly') return price / 30;
  return price;
}

function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const a = new Date(checkin + 'T00:00:00');
  const b = new Date(checkout + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function computeTotals(nightly, nights) {
  const subtotal = Math.round(nightly * nights);
  const serviceFee = Math.round(subtotal * C.SERVICE_FEE_PERCENT / 100);
  return { subtotal, serviceFee, total: subtotal + serviceFee };
}

// Notification hook — called after every successful booking creation.
// Extend later (Telegram/email); the provider dashboard badge reads new
// bookings by created_at, so nothing else is required here yet.
function onBookingCreated(booking, listing) {
  if (booking) {
    console.log('[booking] new booking ' + booking.id + ' — ' +
      (listing ? listing.title : booking.listingId) + ' · ' +
      booking.checkinDate + ' → ' + booking.checkoutDate +
      ' · ' + (booking.numRooms || 1) + ' room(s)');
  }
}

// ===========================================================================
// PUBLIC: HOME
// ===========================================================================
app.get('/', wrap(async (req, res) => {
  // Legacy bookmarked filter URLs (/?area=Bole …) → the new results page.
  const hasFilter = SEARCH_PARAM_KEYS.some(
    (k) => req.query[k] !== undefined && req.query[k] !== ''
  );
  if (hasFilter) {
    const qIndex = req.originalUrl.indexOf('?');
    return res.redirect(302, '/search' + (qIndex >= 0 ? req.originalUrl.slice(qIndex) : ''));
  }

  let listings = await store.getListings();
  listings = listings.filter((l) => l.status === 'active');

  const score = (l) => (l.featured ? 2 : 0) + (l.verified ? 1 : 0);
  const byRecommended = (a, b) => (score(b) - score(a)) || (b.createdAt - a.createdAt);

  const popular = POPULAR_AREAS
    .map((area) => ({
      area,
      listings: listings.filter((l) => l.area === area).sort(byRecommended).slice(0, 4)
    }))
    .filter((g) => g.listings.length > 0);

  const reviewCounts = await store.getReviewCountsByListing();

  res.render('index', {
    filters: {},
    popular,
    firstPhoto: listingFirstPhoto,
    reviewCounts
  });
}));

// ===========================================================================
// PUBLIC: SEARCH RESULTS
// ===========================================================================
app.get('/search', wrap(async (req, res) => {
  const f = req.query;
  let listings = await store.getListings();
  listings = listings.filter((l) => l.status === 'active');

  if (f.q) {
    const q = String(f.q).toLowerCase();
    listings = listings.filter((l) =>
      l.title.toLowerCase().includes(q) ||
      (l.description || '').toLowerCase().includes(q) ||
      l.area.toLowerCase().includes(q)
    );
  }
  if (f.area) listings = listings.filter((l) => l.area === f.area);

  // `type` may arrive as a single value or an array (multiple checkboxes).
  const selectedTypes = [].concat(f.type || []).filter(Boolean);
  if (selectedTypes.length) listings = listings.filter((l) => selectedTypes.includes(l.type));

  // `audience` can arrive twice (hidden field + "Female only" checkbox share the
  // name) — collapse to the last value so the checkbox wins.
  if (Array.isArray(f.audience)) f.audience = f.audience[f.audience.length - 1];

  if (f.period)   listings = listings.filter((l) => l.period   === f.period);
  if (f.audience) listings = listings.filter((l) => l.audience === f.audience);
  if (f.minPrice) listings = listings.filter((l) => Number(l.price) >= Number(f.minPrice));
  if (f.maxPrice) listings = listings.filter((l) => Number(l.price) <= Number(f.maxPrice));
  ['furnished', 'wifi', 'water', 'parking'].forEach((a) => {
    if (f[a]) listings = listings.filter((l) => l[a]);
  });
  if (f.verified) listings = listings.filter((l) => l.verified);
  if (f.near_university) {
    listings = listings.filter((l) => {
      const t = (l.title + ' ' + (l.description || '')).toLowerCase();
      return t.includes('university') || t.includes('campus') || t.includes('college');
    });
  }

  // With dates: only show places with at least one bucket free for the range
  if (f.checkin && f.checkout && nightsBetween(f.checkin, f.checkout) > 0) {
    const bookable = await Promise.all(
      listings.map((l) => store.isListingBookable(l.id, f.checkin, f.checkout))
    );
    listings = listings.filter((_, i) => bookable[i]);
  }

  const score = (l) => (l.featured ? 2 : 0) + (l.verified ? 1 : 0);
  const sort = f.sort || 'recommended';
  listings.sort((a, b) => {
    switch (sort) {
      case 'price_asc':  return Number(a.price) - Number(b.price);
      case 'price_desc': return Number(b.price) - Number(a.price);
      case 'newest':     return b.createdAt - a.createdAt;
      case 'verified':   return (Number(!!b.verified) - Number(!!a.verified)) || (b.createdAt - a.createdAt);
      default:           return (score(b) - score(a)) || (b.createdAt - a.createdAt);
    }
  });

  // Removable active-filter chips: each links to the same URL minus that param.
  const money = res.locals.money;
  const amenityLabel = (k) => (C.AMENITIES.find((a) => a.key === k) || {}).label || k;
  const chips = [];
  if (f.q)        chips.push({ label: '“' + f.q + '”', url: buildSearchUrl(f, 'q') });
  if (f.area)     chips.push({ label: f.area, url: buildSearchUrl(f, 'area') });
  selectedTypes.forEach((t) => chips.push({ label: C.typeLabel(t), url: buildSearchUrl(f, 'type', t) }));
  if (f.period)   chips.push({ label: C.periodLabel(f.period), url: buildSearchUrl(f, 'period') });
  if (f.audience) chips.push({ label: C.audienceLabel(f.audience), url: buildSearchUrl(f, 'audience') });
  if (f.minPrice) chips.push({ label: 'From ' + money(f.minPrice) + ' birr', url: buildSearchUrl(f, 'minPrice') });
  if (f.maxPrice) chips.push({ label: 'Under ' + money(f.maxPrice) + ' birr', url: buildSearchUrl(f, 'maxPrice') });
  ['furnished', 'wifi', 'water', 'parking'].forEach((a) => {
    if (f[a]) chips.push({ label: amenityLabel(a), url: buildSearchUrl(f, a) });
  });
  if (f.verified)        chips.push({ label: 'Verified', url: buildSearchUrl(f, 'verified') });
  if (f.near_university) chips.push({ label: 'Near university', url: buildSearchUrl(f, 'near_university') });

  const reviewCounts = await store.getReviewCountsByListing();

  res.render('search', {
    listings,
    filters: f,
    selectedTypes,
    sort,
    chips,
    firstPhoto: listingFirstPhoto,
    listingPhotos,
    reviewCounts
  });
}));

// ===========================================================================
// PUBLIC: LISTING DETAIL — requires login
// ===========================================================================
app.get('/listing/:id', requireUser, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing) {
    req.flash('error', 'That listing could not be found.');
    return res.redirect('/');
  }
  const u = req.session.user;
  const isStaff = u && (u.role === 'admin' || u.role === 'owner');
  const isOwnerOfListing = u && listing.ownerId === u.id;
  // Drafts and hidden listings are invisible to guests; the owner/staff can
  // still open their own to preview (draft shows a "not visible" banner).
  if (listing.status !== 'active' && !isStaff && !isOwnerOfListing) {
    req.flash('error', 'That listing is not available.');
    return res.redirect('/');
  }
  const reviews = await store.getReviewsByListing(listing.id);
  const avg = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  const rooms = await store.getRoomsByListing(listing.id);
  let baseNightly = 0;
  if (rooms.length) baseNightly = Math.min.apply(null, rooms.map(r => r.nightlyRate));
  else baseNightly = effectiveNightly(listing, null);

  // Dates carried over from the search (so we never ask for them again)
  const checkin  = req.query.checkin  || '';
  const checkout = req.query.checkout || '';
  const guests   = Number(req.query.guests) || 1;
  const nights   = nightsBetween(checkin, checkout);

  res.render('listing', {
    listing, reviews, avg, rooms, baseNightly,
    checkin, checkout, guests,
    nights: nights > 0 ? nights : 0,
    isDraftPreview: listing.status === 'draft'
  });
}));

app.post('/listing/:id/book', requireUser, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing) {
    req.flash('error', 'That listing could not be found.');
    return res.redirect('/');
  }
  const { name, phone, message, duration } = req.body;
  if (!name || !phone) {
    req.flash('error', 'Please provide your name and phone number.');
    return res.redirect('/listing/' + listing.id);
  }
  await store.createBooking({
    id: nanoid(10),
    listingId: listing.id,
    listingTitle: listing.title,
    name, phone,
    duration: duration || '',
    message: message || '',
    status: 'pending',
    createdAt: Date.now()
  });
  req.flash('success', 'Your booking request was sent. The host will be in touch via AlgaAle.');
  res.redirect('/listing/' + listing.id);
}));

// ===========================================================================
// SHORT-STAY BOOKING (Daily / Weekly) — date picker, room picker, confirm
// ===========================================================================
app.get('/listing/:id/reserve', requireUser, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing) { req.flash('error', 'That listing could not be found.'); return res.redirect('/'); }
  const checkin = req.query.checkin, checkout = req.query.checkout;
  const guests = Number(req.query.guests) || 1;
  const nights = nightsBetween(checkin, checkout);
  if (!checkin || !checkout || !(nights > 0)) {
    req.flash('error', 'Please choose valid check-in and check-out dates.');
    return res.redirect('/listing/' + listing.id);
  }
  const rooms = await store.getRoomsByListing(listing.id);

  // One Trip.com-style booking page: room choice, room quantity, price
  // details and guest names all live here — nothing is asked twice.
  let room = null;
  if (req.query.room) {
    room = await store.getRoomById(req.query.room);
    if (!room || room.listingId !== listing.id) {
      req.flash('error', 'Invalid room selected.');
      return res.redirect('/listing/' + listing.id);
    }
  } else if (rooms.length) {
    room = rooms[0];
  }

  // Live availability per bucket for these dates (drives "X left" + qty cap)
  const buckets = await store.listingBookableUnits(listing.id, checkin, checkout);
  const availabilityByRoom = {};
  let wholeHomeAvailable = 1;
  buckets.forEach((bk) => {
    if (bk.room) availabilityByRoom[bk.room.id] = bk.available;
    else wholeHomeAvailable = bk.available;
  });
  const selectedAvailable = room ? (availabilityByRoom[room.id] || 0) : wholeHomeAvailable;
  if (selectedAvailable < 1 && !buckets.some(bk => bk.available >= 1)) {
    req.flash('error', 'Sorry — this place is fully booked for those dates. Try different dates.');
    return res.redirect('/listing/' + listing.id + '?checkin=' + encodeURIComponent(checkin) +
      '&checkout=' + encodeURIComponent(checkout) + '&guests=' + guests);
  }

  const nightly = effectiveNightly(listing, room);
  const totals = computeTotals(nightly, nights);
  res.render('book', {
    listing, rooms, room, checkin, checkout, guests, nights, nightly,
    subtotal: totals.subtotal, serviceFee: totals.serviceFee, total: totals.total,
    serviceFeePercent: C.SERVICE_FEE_PERCENT,
    availabilityByRoom, wholeHomeAvailable, selectedAvailable,
    firstPhoto: listingFirstPhoto
  });
}));

app.post('/listing/:id/pay', requireUser, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing) { req.flash('error', 'That listing could not be found.'); return res.redirect('/'); }
  const checkin = req.body.checkin, checkout = req.body.checkout;
  const guests = Number(req.body.guests) || 1;
  const nights = nightsBetween(checkin, checkout);
  if (!checkin || !checkout || !(nights > 0)) {
    req.flash('error', 'Please choose valid dates.');
    return res.redirect('/listing/' + listing.id);
  }

  let room = null;
  const rooms = await store.getRoomsByListing(listing.id);
  if (req.body.roomId) {
    room = await store.getRoomById(req.body.roomId);
    if (!room || room.listingId !== listing.id) {
      req.flash('error', 'Invalid room.'); return res.redirect('/listing/' + listing.id);
    }
  } else if (rooms.length === 1) {
    room = rooms[0];
  } else if (rooms.length > 1) {
    req.flash('error', 'Please choose a room.');
    return res.redirect('/listing/' + listing.id + '/reserve?checkin=' +
      encodeURIComponent(checkin) + '&checkout=' + encodeURIComponent(checkout) + '&guests=' + guests);
  }

  // Room quantity (Trip.com style: N rooms × nightly × nights)
  const qty = Math.min(5, Math.max(1, Number(req.body.qty) || 1));

  // Lead guest defaults to the logged-in account — never ask twice
  const u = req.session.user;
  const leadName = [req.body.guest_given_1, req.body.guest_surname_1]
    .filter(Boolean).join(' ').trim() || u.fullName;
  const phone = (req.body.phone || '').trim() || u.phone || '';
  if (!phone) {
    req.flash('error', 'Please add a phone number so the host can reach you.');
    return res.redirect('/listing/' + listing.id + '/reserve?checkin=' +
      encodeURIComponent(checkin) + '&checkout=' + encodeURIComponent(checkout) + '&guests=' + guests);
  }

  // Extra room guests + special requests folded into the booking message
  const extraGuests = [];
  for (let i = 2; i <= qty; i++) {
    const g = [req.body['guest_given_' + i], req.body['guest_surname_' + i]]
      .filter(Boolean).join(' ').trim();
    if (g) extraGuests.push('Room ' + i + ': ' + g);
  }
  const notes = [];
  if (req.body.message) notes.push(String(req.body.message).trim());
  if (extraGuests.length) notes.push('Guests — ' + extraGuests.join(' · '));

  const nightly = effectiveNightly(listing, room);
  const { subtotal, serviceFee, total } = computeTotals(nightly * qty, nights);
  const bookingId = nanoid(10);

  // The room is NOT held yet: an unpaid request consumes no inventory, and only
  // support confirming the payment turns this into a live reservation. We still
  // refuse dates that are already sold out, so nobody transfers money for a room
  // that plainly isn't there.
  const availableNow = await store.getAvailability({
    listingId: listing.id, roomId: room ? room.id : null,
    checkin, checkout
  });
  if (availableNow < qty) {
    req.flash('error', availableNow > 0
      ? 'Only ' + availableNow + ' room(s) left for those dates. Please reduce the number of rooms.'
      : 'Sorry — this place is fully booked for those dates. Try different dates.');
    return res.redirect('/listing/' + listing.id + '/reserve?checkin=' +
      encodeURIComponent(checkin) + '&checkout=' + encodeURIComponent(checkout) + '&guests=' + guests);
  }

  await store.createBooking({
    id: bookingId,
    userId: u.id,
    listingId: listing.id,
    listingTitle: listing.title,
    name: leadName,
    phone,
    duration: qty + ' room' + (qty > 1 ? 's' : ''),
    message: notes.join('\n'),
    roomId: room ? room.id : null,
    checkinDate: checkin,
    checkoutDate: checkout,
    guests,
    numRooms: qty,
    nightlyRate: nightly,
    nights,
    subtotal, serviceFee, total,
    status: 'pending',
    paymentStatus: 'awaiting_payment',
    chapaTxRef: null,
    createdAt: Date.now()
  });

  // The money side of the reservation: what the guest owes, what we keep, and
  // what the host will be paid once the guest checks in.
  const split = C.paymentSplit(total);
  await store.createPayment({
    id: nanoid(10),
    bookingId,
    userId: u.id,
    listingId: listing.id,
    paymentAmount: split.total,
    commissionAmount: split.commission,
    hotelPayoutAmount: split.payout,
    status: 'awaiting_payment',
    createdAt: Date.now()
  });

  onBookingCreated(await store.getBookingById(bookingId), listing);
  res.redirect('/booking/' + bookingId + '/payment');
}));

app.get('/booking/:id/success', requireUser, wrap(async (req, res) => {
  const booking = await store.getBookingById(req.params.id);
  if (!booking) { req.flash('error', 'Booking not found.'); return res.redirect('/'); }
  const listing = await store.getListingById(booking.listingId);
  res.render('booking-success', { booking, listing });
}));

// ===========================================================================
// GUEST PAYMENT — bank transfer + screenshot proof
// ===========================================================================
// A booking the logged-in guest owns (staff may open any, to help over the phone).
async function loadOwnBooking(req, res) {
  const booking = await store.getBookingById(req.params.id);
  const u = req.session.user;
  const isStaff = ['admin', 'owner', 'support'].includes(u.role);
  if (!booking || (booking.userId !== u.id && !isStaff)) {
    req.flash('error', 'Booking not found.');
    res.redirect('/');
    return null;
  }
  return booking;
}

app.get('/booking/:id/payment', requireUser, wrap(async (req, res) => {
  const booking = await loadOwnBooking(req, res);
  if (!booking) return;
  const payment = await store.getPaymentByBooking(booking.id);
  if (!payment) {
    req.flash('error', 'This booking has no payment attached.');
    return res.redirect('/');
  }
  const [listing, bankAccount] = await Promise.all([
    store.getListingById(booking.listingId),
    store.getActiveBankAccount()
  ]);
  res.render('payment', {
    booking, payment, listing, bankAccount,
    firstPhoto: listingFirstPhoto
  });
}));

app.post('/booking/:id/payment/screenshot', requireUser, proofUpload.single('screenshot'),
  wrap(async (req, res) => {
    const booking = await loadOwnBooking(req, res);
    if (!booking) return;
    const payment = await store.getPaymentByBooking(booking.id);
    const back = '/booking/' + booking.id + '/payment';
    if (!payment) {
      req.flash('error', 'This booking has no payment attached.');
      return res.redirect('/');
    }
    // Once support has verified the money, the proof is settled — don't let a
    // later upload quietly reopen a confirmed reservation.
    if (C.PAYMENT_CONFIRMED_STATUSES.includes(payment.status)) {
      req.flash('error', 'This payment has already been confirmed.');
      return res.redirect(back);
    }
    if (!req.file) {
      req.flash('error', 'Please attach a screenshot of your payment receipt.');
      return res.redirect(back);
    }
    await store.updatePayment(payment.id, {
      screenshotUrl: proofUrl(req.file),
      screenshotUploadedAt: Date.now(),
      paymentNote: (req.body.note || '').trim(),
      status: 'pending',
      rejectionReason: ''
    });
    await store.updateBookingPayment(booking.id, 'pending');
    console.log('[payment] proof submitted for booking ' + booking.id);
    req.flash('success', 'Payment proof received. Our support team will confirm it shortly.');
    res.redirect(back);
  }));

// Guest's own reservations, with the payment status of each.
app.get('/my/bookings', requireUser, wrap(async (req, res) => {
  const bookings = await store.getBookingsByUser(req.session.user.id);
  const payments = await store.getPaymentsByBookings(bookings.map((b) => b.id));
  res.render('my-bookings', { bookings, payments });
}));

app.post('/listing/:id/review', requireUser, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing) return res.redirect('/');
  const { name, rating, comment } = req.body;
  if (!name || !comment) {
    req.flash('error', 'Please add your name and a comment.');
    return res.redirect('/listing/' + listing.id);
  }
  await store.createReview({
    id: nanoid(10),
    listingId: listing.id,
    name,
    rating: Math.min(5, Math.max(1, Number(rating) || 5)),
    comment,
    createdAt: Date.now()
  });
  req.flash('success', 'Thanks for your review!');
  res.redirect('/listing/' + listing.id);
}));

// SVG placeholder
app.get('/placeholder.svg', (req, res) => {
  const label = (req.query.text || 'AlgaAle').slice(0, 24);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#115e59"/>
    </linearGradient></defs>
    <rect width="800" height="600" fill="url(#g)"/>
    <text x="50%" y="48%" fill="#ffffff" font-family="Segoe UI, Arial" font-size="46" font-weight="700" text-anchor="middle">AlgaAle</text>
    <text x="50%" y="58%" fill="#a7f3d0" font-family="Segoe UI, Arial" font-size="28" text-anchor="middle">${label}</text>
  </svg>`;
  res.type('image/svg+xml').send(svg);
});

// ===========================================================================
// PUBLIC AUTH: REGISTER
// ===========================================================================
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { next: req.query.next || '' });
});

app.post('/register', wrap(async (req, res) => {
  const { fullName, phone, email, password, confirmPassword } = req.body;
  const next = (req.body.next || '').trim();
  const redir = '/register' + (next ? '?next=' + encodeURIComponent(next) : '');

  if (!fullName || !phone || !password) {
    req.flash('error', 'Full name, phone number, and password are required.');
    return res.redirect(redir);
  }
  if (password !== confirmPassword) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect(redir);
  }
  if (password.length < 6) {
    req.flash('error', 'Password must be at least 6 characters.');
    return res.redirect(redir);
  }

  const phoneTrimmed = phone.trim();
  if (await store.phoneExists(phoneTrimmed)) {
    req.flash('error', 'An account with that phone number already exists. Try logging in.');
    return res.redirect(redir);
  }

  const emailTrimmed = (email || '').trim().toLowerCase();
  if (emailTrimmed && await store.emailExists(emailTrimmed)) {
    req.flash('error', 'An account with that email already exists. Try logging in.');
    return res.redirect(redir);
  }

  const user = await store.createUser({
    id: nanoid(10),
    fullName: fullName.trim(),
    phone: phoneTrimmed,
    email: emailTrimmed || null,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'seeker',
    providerApplication: { status: 'none', idType: null, idNumber: null, idImage: null, submittedAt: null, reviewedAt: null },
    createdAt: Date.now()
  });

  req.session.user = sessionUser(user);
  req.flash('success', `Welcome to AlgaAle, ${user.fullName.split(' ')[0]}!`);
  res.redirect(next || '/');
}));

// ===========================================================================
// PUBLIC AUTH: LOGIN
// ===========================================================================
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { next: req.query.next || '' });
});

app.post('/login', wrap(async (req, res) => {
  const { identifier, password } = req.body;
  const next = (req.body.next || '').trim();
  const redir = '/login' + (next ? '?next=' + encodeURIComponent(next) : '');

  const user = await store.findUserByCredential((identifier || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    req.flash('error', 'Incorrect phone / email or password.');
    return res.redirect(redir);
  }

  req.session.user = sessionUser(user);
  const firstName = (user.fullName || '').split(' ')[0];
  req.flash('success', `Welcome back, ${firstName}!`);
  res.redirect(next || '/');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ===========================================================================
// BECOME A PROVIDER
// ===========================================================================
app.get('/become-provider', requireUser, wrap(async (req, res) => {
  const u = req.session.user;
  if (u.role === 'provider') return res.redirect('/provider');
  const dbUser = await store.findUserById(u.id);
  const application = dbUser ? dbUser.providerApplication : { status: 'none' };
  res.render('become-provider', { application });
}));

app.post('/become-provider', requireUser, idUpload.single('idImage'), wrap(async (req, res) => {
  const u = req.session.user;
  if (u.role === 'provider') return res.redirect('/provider');

  const { idType, idNumber } = req.body;
  if (!idType || !idNumber) {
    req.flash('error', 'ID type and ID number are required.');
    return res.redirect('/become-provider');
  }

  const dbUser = await store.findUserById(u.id);
  if (!dbUser) return res.redirect('/');

  if (dbUser.providerApplication.status === 'approved') {
    const updated = await store.approveProvider(u.id);
    req.session.user = sessionUser(updated);
    return res.redirect('/provider');
  }

  const app = {
    status: 'pending',
    idType,
    idNumber,
    idImage: req.file ? req.file.path : (dbUser.providerApplication.idImage || null),
    submittedAt: Date.now(),
    reviewedAt: null
  };
  const updated = await store.updateProviderApplication(u.id, app);
  req.session.user = sessionUser(updated);
  req.flash('success', 'Application submitted! We will review it and get back to you.');
  res.redirect('/become-provider');
}));

// ===========================================================================
// PROVIDER DASHBOARD
// ===========================================================================
// Providers see their own listings; admin/owner see all
async function providerListings(req) {
  const u = req.session.user;
  if (u.role === 'admin' || u.role === 'owner') return store.getListings();
  return store.getListingsByOwner(u.id);
}
// A host only ever sees a reservation once support has verified the guest's
// payment. Walk-ins and legacy enquiries carry no payment row, so they stay
// visible exactly as before. (Unverified bookings are 'pending' and consume no
// inventory, so the calendar and room roster already exclude them.)
async function hostVisible(bookings) {
  const payments = await store.getPaymentsByBookings(bookings.map((b) => b.id));
  return bookings.filter((b) => {
    const p = payments[b.id];
    return !p || C.PAYMENT_CONFIRMED_STATUSES.includes(p.status);
  });
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function addDaysIso(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
// UTC-anchored day shift — unlike addDaysIso it never drifts across the
// local-timezone boundary (needed where the shifted date is compared to a raw
// ISO date string, e.g. building a half-open [date, date+1) range).
function shiftIsoDay(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

app.get('/provider', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const ids = myListings.map((l) => l.id);
  const today = todayIso();

  const all = await hostVisible(
    (await store.getBookings()).filter((b) => ids.includes(b.listingId))
  );
  const active = all.filter((b) => store.ACTIVE_STATUSES.includes(b.status));
  const arrivals = active.filter((b) => b.checkinDate === today && b.status !== 'checked_in');
  const inHouse = active.filter((b) => b.checkinDate && b.checkinDate <= today && b.checkoutDate > today);
  const departures = active.filter((b) => b.checkoutDate === today);

  // Occupancy tonight = (units in stays spanning tonight + blocked units) / total units.
  // Drafts aren't live, so their units don't count toward occupancy. We also note
  // the first incomplete wizard step for each draft (drives "Continue setup →").
  let totalUnits = 0;
  const continueStep = {};
  for (const l of myListings) {
    const rooms = await store.getRoomsByListing(l.id);
    if (l.status === 'draft') {
      continueStep[l.id] = firstIncompleteStep(l, rooms);
      continue;
    }
    totalUnits += rooms.length ? rooms.reduce((s, r) => s + (r.totalUnits || 1), 0) : 1;
  }
  const blocks = await store.getBlocksByListings(ids);
  const usedTonight = inHouse.reduce((s, b) => s + (b.numRooms || 1), 0) +
    blocks.filter((ab) => ab.startDate <= today && ab.endDate > today)
          .reduce((s, ab) => s + (ab.unitsBlocked || 1), 0);
  const occupancy = totalUnits ? Math.min(100, Math.round(usedTonight / totalUnits * 100)) : 0;

  const monthStart = new Date(today.slice(0, 8) + '01T00:00:00').getTime();
  const revenueMonth = all
    .filter((b) => (store.ACTIVE_STATUSES.includes(b.status) || b.status === 'checked_out') && b.createdAt >= monthStart)
    .reduce((s, b) => s + (Number(b.total) || 0), 0);

  const newCount = all.filter((b) => Date.now() - b.createdAt < 86400000).length;

  res.render('provider/dashboard', {
    listings: myListings,
    firstPhoto: listingFirstPhoto,
    stats: {
      arrivals: arrivals.length,
      departures: departures.length,
      inHouse: inHouse.length,
      occupancy, totalUnits, revenueMonth
    },
    recent: all.slice(0, 8),
    newCount, today, continueStep
  });
}));

// ---------------------------------------------------------------------------
// Property onboarding wizard (draft → publish) helpers
// ---------------------------------------------------------------------------
// A listing the provider (or admin/owner) may manage.
function canManageListing(req, listing) {
  const u = req.session.user;
  if (!u || !listing) return false;
  if (u.role === 'admin' || u.role === 'owner') return true;
  return listing.ownerId === u.id;
}

// Progress + gating for the stepper UI.
function setupProgress(listing, rooms) {
  const hasPhotos = listing.photos && Object.values(listing.photos).some((a) => a && a.length);
  return {
    property: true,                               // exists => step 1 done
    rooms: rooms.length > 0,                       // at least one room type
    photos: !!hasPhotos,
    // Whole-place path counts as "rooms satisfied" via a nightly price.
    publishable: !!hasPhotos && (rooms.length > 0 || Number(listing.price) > 0)
  };
}

// First step still needing attention (drives "Continue setup →").
function firstIncompleteStep(listing, rooms) {
  const p = setupProgress(listing, rooms);
  if (!p.rooms && !(Number(listing.price) > 0)) return 'rooms';
  if (!p.photos) return 'photos';
  return 'review';
}

// Parse the beds picker (beds_<type> qty fields) into a [{type,qty}] array.
function parseBeds(body) {
  const beds = [];
  C.BED_TYPES.forEach((t) => {
    const qty = Math.max(0, Math.min(4, Number(body['beds_' + t.value]) || 0));
    if (qty > 0) beds.push({ type: t.value, qty });
  });
  return beds;
}

// "101, 102, 103" -> ["101","102","103"] (deduped, order preserved).
function parseRoomNumbers(str) {
  const seen = new Set();
  return String(str || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !seen.has(s) && seen.add(s));
}

app.get('/provider/listings/new', requireProvider, (req, res) => {
  res.render('provider/setup-property', { listing: null });
});

app.post('/provider/listings', requireProvider, wrap(async (req, res) => {
  const b = req.body;
  const u = req.session.user;
  const id = nanoid(10);
  // Address line has no column — fold it into the description (§4).
  const addr = (b.addressLine || '').trim();
  const description = [b.description || '', addr ? 'Address: ' + addr : '']
    .filter(Boolean).join('\n\n');
  await store.createListing({
    id,
    ownerId: u.id,
    title: b.title,
    type: b.type,
    area: b.area,
    price: Number(b.price) || 0,
    period: b.period,
    audience: b.audience,
    ...parseAmenities(b),
    description,
    ownerName: u.fullName,
    ownerPhone: u.phone || '',
    verified: false,
    featured: false,
    status: 'draft',
    photos: {},
    checkinTime: b.checkinTime || null,
    checkoutTime: b.checkoutTime || null,
    cancellationPolicy: b.cancellationPolicy || '',
    createdAt: Date.now()
  });
  res.redirect('/provider/listings/' + id + '/setup/rooms');
}));

app.get('/provider/listings/:id/edit', requireProvider, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or you do not have permission to edit it.');
    return res.redirect('/provider');
  }
  const rooms = await store.getRoomsByListing(listing.id);
  res.render('provider/listing-form', { listing, rooms });
}));

app.post('/provider/listings/:id', requireProvider, upload.fields(photoFields), wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or you do not have permission to edit it.');
    return res.redirect('/provider');
  }
  const b = req.body;
  await store.updateListing(req.params.id, {
    title: b.title, type: b.type, area: b.area,
    price: Number(b.price) || 0, period: b.period, audience: b.audience,
    ...parseAmenities(b),
    description: b.description || '',
    ownerName: listing.ownerName,
    ownerPhone: listing.ownerPhone,
    verified: listing.verified,
    featured: listing.featured,
    status: b.status || 'active',
    photos: collectUploadedPhotos(req.files, listing.photos),
    checkinTime: b.checkinTime || listing.checkinTime,
    checkoutTime: b.checkoutTime || listing.checkoutTime,
    cancellationPolicy: b.cancellationPolicy != null ? b.cancellationPolicy : listing.cancellationPolicy
  });
  req.flash('success', 'Listing updated.');
  res.redirect('/provider');
}));

app.post('/provider/listings/:id/delete', requireProvider, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or access denied.');
    return res.redirect('/provider');
  }
  await store.deleteListing(req.params.id);
  req.flash('success', 'Listing deleted.');
  res.redirect('/provider');
}));

app.post('/provider/listings/:id/photo/delete', requireProvider, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (listing && listing.ownerId === req.session.user.id) {
    const { category, url } = req.body;
    const photos = listing.photos || {};
    if (photos[category]) {
      photos[category] = photos[category].filter((p) => p !== url);
      // Photo stored on Cloudinary - no local deletion needed
      await store.updateListingPhotos(req.params.id, photos);
    }
  }
  const back = req.body.from === 'setup'
    ? '/provider/listings/' + req.params.id + '/setup/photos'
    : '/provider/listings/' + req.params.id + '/edit';
  res.redirect(back);
}));

// --- Rooms (room/bed options under a listing) ---
app.post('/provider/listings/:id/rooms', requireProvider, upload.single('photo'), wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or access denied.');
    return res.redirect('/provider');
  }
  const b = req.body;
  const setupBack = (listing.status === 'draft' || b.from === 'setup')
    ? '/provider/listings/' + listing.id + '/setup/rooms'
    : '/provider/listings/' + listing.id + '/edit';
  if (!b.name) {
    req.flash('error', 'Room name is required.');
    return res.redirect(setupBack);
  }
  const beds = parseBeds(b);
  await store.createRoom({
    id: nanoid(10),
    listingId: listing.id,
    name: b.name,
    capacity: Number(b.capacity) || 1,
    nightlyRate: Number(b.nightlyRate) || 0,
    photo: req.file ? req.file.path : null,
    sortOrder: Number(b.sortOrder) || 0,
    totalUnits: Math.max(1, Number(b.totalUnits) || 1),
    // Derive bed_type from the first bed so the legacy UI keeps working.
    bedType: beds.length ? beds[0].type : (b.bedType || null),
    beds,
    roomNumbers: parseRoomNumbers(b.roomNumbers),
    description: b.roomDescription || '',
    createdAt: Date.now()
  });
  req.flash('success', 'Room added.');
  res.redirect(setupBack);
}));

app.post('/provider/listings/:id/rooms/:roomId', requireProvider, upload.single('photo'), wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or access denied.');
    return res.redirect('/provider');
  }
  const b = req.body;
  const setupBack = (listing.status === 'draft' || b.from === 'setup')
    ? '/provider/listings/' + listing.id + '/setup/rooms'
    : '/provider/listings/' + listing.id + '/edit';
  const room = await store.getRoomById(req.params.roomId);
  if (!room || room.listingId !== listing.id) {
    req.flash('error', 'Room not found.');
    return res.redirect(setupBack);
  }
  const newTotal = Math.max(1, Number(b.totalUnits) || room.totalUnits || 1);
  // Lowering total_units must not silently strand future bookings: check the
  // peak booked units on future nights before accepting a smaller number.
  if (newTotal < (room.totalUnits || 1)) {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(); horizon.setFullYear(horizon.getFullYear() + 1);
    const available = await store.getAvailability({
      listingId: listing.id, roomId: room.id,
      checkin: today, checkout: horizon.toISOString().slice(0, 10)
    });
    const peakBooked = (room.totalUnits || 1) - available;
    if (newTotal < peakBooked) {
      req.flash('error', `Cannot reduce to ${newTotal} unit(s): up to ${peakBooked} are already booked on future nights. Cancel those bookings first.`);
      return res.redirect(setupBack);
    }
  }
  // Only touch beds when the picker was submitted (e.g. the photos step posts
  // a photo-only form and must not wipe the room's beds).
  const hasBedFields = C.BED_TYPES.some((t) => b['beds_' + t.value] !== undefined);
  const beds = hasBedFields ? parseBeds(b) : room.beds;
  // Only touch room numbers when the field was submitted (photo-only saves omit it).
  const roomNumbers = b.roomNumbers !== undefined ? parseRoomNumbers(b.roomNumbers) : room.roomNumbers;
  await store.updateRoom(room.id, {
    name: b.name || room.name,
    capacity: Number(b.capacity) || room.capacity,
    nightlyRate: Number(b.nightlyRate) || room.nightlyRate,
    photo: req.file ? req.file.path : room.photo,
    sortOrder: Number(b.sortOrder) || room.sortOrder,
    totalUnits: newTotal,
    bedType: beds && beds.length ? beds[0].type : (b.bedType || room.bedType),
    beds: beds || [],
    roomNumbers: roomNumbers || [],
    description: b.roomDescription != null ? b.roomDescription : room.description
  });
  req.flash('success', 'Room updated.');
  res.redirect(setupBack);
}));

app.post('/provider/listings/:id/rooms/:roomId/delete', requireProvider, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or access denied.');
    return res.redirect('/provider');
  }
  const room = await store.getRoomById(req.params.roomId);
  if (room && room.listingId === listing.id) {
    await store.deleteRoom(room.id);
    req.flash('success', 'Room removed.');
  }
  const setupBack = (listing.status === 'draft' || req.body.from === 'setup')
    ? '/provider/listings/' + listing.id + '/setup/rooms'
    : '/provider/listings/' + listing.id + '/edit';
  res.redirect(setupBack);
}));

// ===========================================================================
// PROPERTY ONBOARDING WIZARD — Step 2 rooms · Step 3 photos · Step 4 review
// ===========================================================================
// Load a listing for a wizard step, enforcing ownership. Returns null (after
// redirecting) when the caller should stop.
async function loadWizardListing(req, res) {
  const listing = await store.getListingById(req.params.id);
  if (!canManageListing(req, listing)) {
    req.flash('error', 'Listing not found or you do not have permission to edit it.');
    res.redirect('/provider');
    return null;
  }
  return listing;
}

// Step 2 — room types
app.get('/provider/listings/:id/setup/rooms', requireProvider, wrap(async (req, res) => {
  const listing = await loadWizardListing(req, res);
  if (!listing) return;
  const rooms = await store.getRoomsByListing(listing.id);
  res.render('provider/setup-rooms', {
    listing, rooms, progress: setupProgress(listing, rooms)
  });
}));

// Step 3 — photos
app.get('/provider/listings/:id/setup/photos', requireProvider, wrap(async (req, res) => {
  const listing = await loadWizardListing(req, res);
  if (!listing) return;
  const rooms = await store.getRoomsByListing(listing.id);
  res.render('provider/setup-photos', {
    listing, rooms, progress: setupProgress(listing, rooms)
  });
}));

// Step 3 POST — property photos only (per-room photos reuse the room handler)
app.post('/provider/listings/:id/setup/photos', requireProvider, upload.fields(photoFields), wrap(async (req, res) => {
  const listing = await loadWizardListing(req, res);
  if (!listing) return;
  const photos = collectUploadedPhotos(req.files, listing.photos);
  await store.updateListingPhotos(listing.id, photos);
  req.flash('success', 'Photos saved.');
  res.redirect('/provider/listings/' + listing.id + '/setup/photos');
}));

// Step 4 — review & publish
app.get('/provider/listings/:id/setup/review', requireProvider, wrap(async (req, res) => {
  const listing = await loadWizardListing(req, res);
  if (!listing) return;
  const rooms = await store.getRoomsByListing(listing.id);
  res.render('provider/setup-review', {
    listing, rooms,
    progress: setupProgress(listing, rooms),
    photoCount: listingPhotos(listing).length
  });
}));

// Publish — re-run the completeness gate server-side, then go live.
app.post('/provider/listings/:id/publish', requireProvider, wrap(async (req, res) => {
  const listing = await loadWizardListing(req, res);
  if (!listing) return;
  const rooms = await store.getRoomsByListing(listing.id);
  const progress = setupProgress(listing, rooms);
  if (!progress.publishable) {
    req.flash('error', 'Add at least one photo and one room type (or a whole-place price) before publishing.');
    return res.redirect('/provider/listings/' + listing.id + '/setup/review');
  }
  // Optional admin review queue (off by default): publish → hidden for approval.
  const review = process.env.LISTING_REVIEW === '1';
  await store.updateListing(listing.id, { ...listing, status: review ? 'hidden' : 'active' });
  req.flash('success', review
    ? 'Submitted for review — we\'ll make it live shortly.'
    : 'Your property is live on AlgaAle 🎉');
  res.redirect('/provider');
}));

// ===========================================================================
// PROVIDER OPERATIONS: calendar, reservations, walk-ins, blocks
// ===========================================================================

// Legal booking status transitions ('accepted' = legacy confirmed)
const BOOKING_TRANSITIONS = {
  pending:    ['confirmed', 'cancelled'],
  confirmed:  ['checked_in', 'cancelled', 'no_show'],
  accepted:   ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['checked_out']
};

// Bucket rows for calendar / forms: one per room, one for whole-home listings
async function bucketRows(listings) {
  const rows = [];
  for (const l of listings) {
    const rooms = await store.getRoomsByListing(l.id);
    if (!rooms.length) rows.push({ listing: l, room: null, total: 1 });
    rooms.forEach((r) => rows.push({ listing: l, room: r, total: r.totalUnits || 1 }));
  }
  return rows;
}

app.get('/provider/calendar', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const ids = myListings.map((l) => l.id);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(req.query.start || '') ? req.query.start : todayIso();
  const end = addDaysIso(start, 14);
  const days = [];
  for (let i = 0; i < 14; i++) days.push(addDaysIso(start, i));

  const rows = await bucketRows(myListings);
  const bookings = await store.getActiveBookingsInRange(ids, start, end);
  const allBlocks = await store.getBlocksByListings(ids);
  const blocks = allBlocks.filter((ab) => ab.startDate < end && ab.endDate > start);

  // cells[listingId|roomId|date] = { used, blocked, names[] }
  const keyOf = (lid, rid, d) => lid + '|' + (rid || '') + '|' + d;
  const cells = {};
  const cell = (k) => (cells[k] = cells[k] || { used: 0, blocked: 0, names: [] });
  bookings.forEach((b) => {
    days.forEach((d) => {
      if (b.checkinDate <= d && b.checkoutDate > d) {
        const c = cell(keyOf(b.listingId, b.roomId, d));
        c.used += b.numRooms || 1;
        const rn = b.assignedRoomNumber ? 'Room ' + b.assignedRoomNumber + ' — ' : '';
        c.names.push(rn + b.name + (b.status === 'checked_in' ? ' · in-house' : ''));
      }
    });
  });
  blocks.forEach((ab) => {
    days.forEach((d) => {
      if (ab.startDate <= d && ab.endDate > d) {
        const c = cell(keyOf(ab.listingId, ab.roomId, d));
        c.blocked += ab.unitsBlocked || 1;
        c.names.push('Blocked' + (ab.reason ? ': ' + ab.reason : ''));
      }
    });
  });

  res.render('provider/calendar', {
    rows, days, cells, start,
    prev: addDaysIso(start, -7), next: addDaysIso(start, 7),
    blocks: allBlocks.filter((ab) => ab.endDate >= todayIso()),
    today: todayIso()
  });
}));

app.post('/provider/blocks', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const [listingId, roomId] = String(req.body.bucket || '').split('|');
  const listing = myListings.find((l) => l.id === listingId);
  const start = req.body.startDate, end = req.body.endDate;
  if (!listing || !start || !end || end <= start) {
    req.flash('error', 'Pick a room and a valid date range (end after start).');
    return res.redirect('/provider/calendar');
  }
  if (roomId) {
    const room = await store.getRoomById(roomId);
    if (!room || room.listingId !== listing.id) {
      req.flash('error', 'Invalid room.');
      return res.redirect('/provider/calendar');
    }
  }
  await store.createBlock({
    id: nanoid(10),
    listingId: listing.id,
    roomId: roomId || null,
    startDate: start,
    endDate: end,
    unitsBlocked: Math.max(1, Number(req.body.units) || 1),
    reason: req.body.reason || '',
    createdAt: Date.now()
  });
  req.flash('success', 'Dates blocked — those units no longer show as available.');
  res.redirect('/provider/calendar?start=' + encodeURIComponent(start));
}));

app.post('/provider/blocks/:id/delete', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const block = await store.getBlockById(req.params.id);
  if (block && myListings.some((l) => l.id === block.listingId)) {
    await store.deleteBlock(block.id);
    req.flash('success', 'Block removed.');
  }
  res.redirect('/provider/calendar');
}));

app.get('/provider/reservations', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const ids = myListings.map((l) => l.id);
  const today = todayIso();
  const tab = req.query.tab || 'all';
  const q = (req.query.q || '').trim().toLowerCase();

  let list = await hostVisible(
    (await store.getBookings()).filter((b) => ids.includes(b.listingId))
  );
  const isActive = (b) => store.ACTIVE_STATUSES.includes(b.status);
  if (tab === 'arrivals')   list = list.filter((b) => isActive(b) && b.checkinDate === today && b.status !== 'checked_in');
  if (tab === 'inhouse')    list = list.filter((b) => b.status === 'checked_in');
  if (tab === 'departures') list = list.filter((b) => isActive(b) && b.checkoutDate === today);
  if (tab === 'upcoming')   list = list.filter((b) => isActive(b) && b.checkinDate && b.checkinDate > today);
  if (tab === 'cancelled')  list = list.filter((b) => ['cancelled', 'no_show', 'declined'].includes(b.status));
  if (q) list = list.filter((b) =>
    (b.name || '').toLowerCase().includes(q) || (b.phone || '').includes(q));

  // Room names + numbers for the table
  const roomName = {};
  const roomsById = {};
  for (const l of myListings) {
    (await store.getRoomsByListing(l.id)).forEach((r) => { roomName[r.id] = r.name; roomsById[r.id] = r; });
  }

  // Selectable room numbers per active booking (free ones + its own current),
  // so staff can reassign; and flag active bookings still missing a number.
  const assignOptions = {};
  for (const b of list) {
    const room = b.roomId ? roomsById[b.roomId] : null;
    if (room && room.roomNumbers && room.roomNumbers.length && store.ACTIVE_STATUSES.includes(b.status)) {
      const free = await store.freeRoomNumbers(room, b.checkinDate, b.checkoutDate, b.id);
      const current = String(b.assignedRoomNumber || '').split(',').map((s) => s.trim()).filter(Boolean);
      assignOptions[b.id] = room.roomNumbers.map(String).filter((n) => free.includes(n) || current.includes(n));
    }
  }

  const payments = await store.getPaymentsByBookings(list.map((b) => b.id));
  res.render('provider/reservations', { list, tab, q, today, roomName, assignOptions, payments });
}));

app.post('/provider/reservations/:id/status', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const booking = await store.getBookingById(req.params.id);
  const back = '/provider/reservations' + (req.body.tab ? '?tab=' + encodeURIComponent(req.body.tab) : '');
  if (!booking || !myListings.some((l) => l.id === booking.listingId)) {
    req.flash('error', 'Reservation not found.');
    return res.redirect(back);
  }
  const next = req.body.status;
  const allowed = BOOKING_TRANSITIONS[booking.status] || [];
  if (!allowed.includes(next)) {
    req.flash('error', `Cannot change a ${booking.status} reservation to ${next}.`);
    return res.redirect(back);
  }
  const payment = await store.getPaymentByBooking(booking.id);

  // A booking paid for by bank transfer only becomes real when support has seen
  // the money. The host cannot short-circuit that.
  if (next === 'confirmed' && payment && !C.PAYMENT_CONFIRMED_STATUSES.includes(payment.status)) {
    req.flash('error', 'Support has not confirmed this guest\'s payment yet.');
    return res.redirect(back);
  }

  // Confirming starts consuming inventory — make sure the units still exist
  if (next === 'confirmed') {
    const available = await store.getAvailability({
      listingId: booking.listingId, roomId: booking.roomId || null,
      checkin: booking.checkinDate, checkout: booking.checkoutDate
    });
    if (available < (booking.numRooms || 1)) {
      req.flash('error', 'Not enough units left for those dates — the room has since been booked or blocked.');
      return res.redirect(back);
    }
  }
  await store.updateBookingStatus(booking.id, next);

  // Checking the guest in is what earns the host their payout — it puts the
  // reservation on support's "send payment to hosts" queue.
  if (next === 'checked_in' && payment && !payment.arrivedAt) {
    await store.updatePayment(payment.id, { arrivedAt: Date.now() });
  }

  // Entering an active state assigns a specific room number (if the room type
  // has numbers defined and one isn't already assigned).
  let assignedNote = '';
  if (next === 'confirmed' || next === 'checked_in') {
    const assigned = await store.assignRoomNumbers(booking.id);
    if (assigned && !booking.assignedRoomNumber) assignedNote = ' Room ' + assigned + ' assigned.';
  }
  req.flash('success', 'Reservation ' + next.replace('_', ' ') + '.' + assignedNote);
  res.redirect(back);
}));

// Where support should send this host's money.
app.get('/provider/payout', requireProvider, wrap(async (req, res) => {
  const me = await store.findUserById(req.session.user.id);
  res.render('provider/payout', { payout: me ? me.payout : null });
}));

app.post('/provider/payout', requireProvider, wrap(async (req, res) => {
  const b = req.body;
  await store.updateUserPayout(req.session.user.id, {
    bankName: (b.bankName || '').trim(),
    accountNumber: (b.accountNumber || '').trim(),
    accountName: (b.accountName || '').trim()
  });
  req.flash('success', 'Payout details saved.');
  res.redirect('/provider/payout');
}));

// Manually assign / reassign a specific room number to a reservation.
app.post('/provider/reservations/:id/room-number', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const booking = await store.getBookingById(req.params.id);
  const back = '/provider/reservations' + (req.body.tab ? '?tab=' + encodeURIComponent(req.body.tab) : '');
  if (!booking || !myListings.some((l) => l.id === booking.listingId)) {
    req.flash('error', 'Reservation not found.');
    return res.redirect(back);
  }
  const desired = String(req.body.roomNumber || '').trim();
  const room = booking.roomId ? await store.getRoomById(booking.roomId) : null;
  if (!desired) {
    // Empty selection clears the assignment.
    await store.updateBookingRoomNumber(booking.id, null);
    req.flash('success', 'Room number cleared.');
    return res.redirect(back);
  }
  if (!room || !room.roomNumbers.map(String).includes(desired)) {
    req.flash('error', 'That room number is not part of this room type.');
    return res.redirect(back);
  }
  const used = await store.getAssignedNumbersForRoom(room.id, booking.checkinDate, booking.checkoutDate, booking.id);
  if (used.has(desired)) {
    req.flash('error', 'Room ' + desired + ' is already occupied for those dates.');
    return res.redirect(back);
  }
  await store.updateBookingRoomNumber(booking.id, desired);
  req.flash('success', 'Room ' + desired + ' assigned.');
  res.redirect(back);
}));

// Rooms roster — every physical room grouped by type, with today's status and
// occupant. Served at /provider/rooms (and legacy /provider/occupancy).
async function roomsRoster(req, res) {
  const myListings = await providerListings(req);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayIso();
  const nextDay = shiftIsoDay(date, 1);
  const ids = myListings.map((l) => l.id);
  const bookings = await store.getActiveBookingsInRange(ids, date, nextDay);
  const blocks = (await store.getBlocksByListings(ids))
    .filter((ab) => ab.startDate <= date && ab.endDate > date);

  const groups = [];
  const totals = { occupied: 0, free: 0, blocked: 0, unassigned: 0, rooms: 0 };
  for (const l of myListings) {
    if (l.status === 'draft') continue;
    const rooms = await store.getRoomsByListing(l.id);
    const roomsOut = [];
    const unnumbered = [];   // room types with no numbers yet (prompt to add)
    for (const room of rooms) {
      if (!room.roomNumbers || !room.roomNumbers.length) {
        unnumbered.push(room);
        continue;
      }
      const roomBookings = bookings.filter((b) =>
        b.roomId === room.id && b.checkinDate <= date && b.checkoutDate > date);
      const occByNumber = {};
      roomBookings.forEach((b) => String(b.assignedRoomNumber || '').split(',')
        .map((s) => s.trim()).filter(Boolean)
        .forEach((n) => { occByNumber[n] = b; }));
      let blockedUnits = blocks.filter((ab) => ab.roomId === room.id)
        .reduce((s, ab) => s + (ab.unitsBlocked || 1), 0);
      const units = room.roomNumbers.map(String).map((n) => {
        const b = occByNumber[n];
        if (b) return { number: n, status: 'occupied', who: b.name + (b.status === 'checked_in' ? ' · in-house' : '') };
        return { number: n, status: 'free', who: '' };
      });
      for (const u of units) { if (blockedUnits <= 0) break; if (u.status === 'free') { u.status = 'blocked'; blockedUnits--; } }
      const counts = { occupied: 0, free: 0, blocked: 0 };
      units.forEach((u) => { counts[u.status]++; totals[u.status]++; });
      totals.rooms += units.length;
      const unassigned = roomBookings
        .filter((b) => !b.assignedRoomNumber)
        .reduce((s, b) => s + (b.numRooms || 1), 0);
      totals.unassigned += unassigned;
      roomsOut.push({ room, units, counts, unassigned });
    }
    if (roomsOut.length || unnumbered.length) {
      groups.push({ listing: l, rooms: roomsOut, unnumbered });
    }
  }

  res.render('provider/occupancy', {
    groups, totals, date, today: todayIso(),
    prev: shiftIsoDay(date, -1), next: shiftIsoDay(date, 1)
  });
}
app.get('/provider/rooms', requireProvider, wrap(roomsRoster));
app.get('/provider/occupancy', requireProvider, wrap(roomsRoster));

app.get('/provider/reservations/new', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const rows = await bucketRows(myListings);
  res.render('provider/reservation-form', { rows, today: todayIso() });
}));

app.post('/provider/reservations/new', requireProvider, wrap(async (req, res) => {
  const myListings = await providerListings(req);
  const b = req.body;
  const [listingId, roomId] = String(b.bucket || '').split('|');
  const listing = myListings.find((l) => l.id === listingId);
  const nights = nightsBetween(b.checkin, b.checkout);
  if (!listing || !b.name || !b.phone || !(nights > 0)) {
    req.flash('error', 'Room, guest name, phone, and valid dates are required.');
    return res.redirect('/provider/reservations/new');
  }
  let room = null;
  if (roomId) {
    room = await store.getRoomById(roomId);
    if (!room || room.listingId !== listing.id) {
      req.flash('error', 'Invalid room.');
      return res.redirect('/provider/reservations/new');
    }
  }
  const qty = Math.max(1, Number(b.qty) || 1);
  const nightly = Number(b.nightly) > 0 ? Number(b.nightly) : effectiveNightly(listing, room);
  const { subtotal, serviceFee, total } = computeTotals(nightly * qty, nights);
  const bookingId = nanoid(10);
  try {
    await store.createBookingSafe({
      id: bookingId,
      listingId: listing.id,
      listingTitle: listing.title,
      name: b.name, phone: b.phone,
      duration: qty + ' room' + (qty > 1 ? 's' : ''),
      message: ['Walk-in booking', b.notes || ''].filter(Boolean).join(' · '),
      roomId: room ? room.id : null,
      checkinDate: b.checkin, checkoutDate: b.checkout,
      guests: Math.max(1, Number(b.guests) || 1),
      numRooms: qty,
      nightlyRate: nightly, nights,
      subtotal, serviceFee, total,
      status: 'confirmed',
      paymentStatus: b.paid === 'on' ? 'paid' : 'pending',
      chapaTxRef: null,
      createdAt: Date.now()
    });
  } catch (e) {
    if (e.code === 'SOLD_OUT') {
      req.flash('error', 'Not enough units free for those dates.');
      return res.redirect('/provider/reservations/new');
    }
    throw e;
  }
  await store.assignRoomNumbers(bookingId);
  onBookingCreated(await store.getBookingById(bookingId), listing);
  req.flash('success', 'Walk-in reservation added.');
  res.redirect('/provider/reservations');
}));

// ===========================================================================
// OWNER: PROVIDER APPLICATION APPROVE / REJECT
// ===========================================================================
app.post('/owner/applications/:userId/approve', requireOwner, wrap(async (req, res) => {
  const user = await store.approveProvider(req.params.userId);
  if (!user) {
    req.flash('error', 'User not found.');
  } else {
    req.flash('success', `${user.fullName} is now an approved provider.`);
  }
  res.redirect('/admin');
}));

app.post('/owner/applications/:userId/reject', requireOwner, wrap(async (req, res) => {
  const user = await store.rejectProvider(req.params.userId);
  if (!user) {
    req.flash('error', 'User not found.');
  } else {
    req.flash('success', `Application from ${user.fullName} rejected.`);
  }
  res.redirect('/admin');
}));

// ===========================================================================
// OWNER DASHBOARD PAGES
// ===========================================================================
app.get('/owner/members', requireOwner, wrap(async (req, res) => {
  const users = await store.getUsers();
  const members = users.filter((u) => u.role !== 'admin');
  const q = (req.query.q || '').toLowerCase();
  const filtered = q
    ? members.filter((u) =>
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.phone || '').includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      )
    : members;
  const stats = {
    total: members.length,
    seekers: members.filter((u) => u.role === 'seeker').length,
    providers: members.filter((u) => u.role === 'provider').length,
    pending: members.filter((u) => u.providerApplication && u.providerApplication.status === 'pending').length
  };
  res.render('owner/members', { members: filtered, stats, q: req.query.q || '' });
}));

app.get('/owner/applications', requireOwner, wrap(async (req, res) => {
  const users = await store.getUsers();
  const pending   = users.filter((u) => u.providerApplication && u.providerApplication.status === 'pending');
  const approved  = users.filter((u) => u.providerApplication && u.providerApplication.status === 'approved');
  const rejected  = users.filter((u) => u.providerApplication && u.providerApplication.status === 'rejected');
  res.render('owner/applications', { pending, approved, rejected });
}));

app.get('/owner/listings', requireOwner, wrap(async (req, res) => {
  const listings = await store.getListings();
  const users    = await store.getUsers();
  const userMap  = {};
  users.forEach((u) => { userMap[u.id] = u; });
  const q = (req.query.q || '').toLowerCase();
  const filtered = q
    ? listings.filter((l) =>
        (l.title || '').toLowerCase().includes(q) ||
        (l.area  || '').toLowerCase().includes(q) ||
        (l.ownerName || '').toLowerCase().includes(q)
      )
    : listings;
  res.render('owner/listings', { listings: filtered, userMap, firstPhoto: listingFirstPhoto, q: req.query.q || '' });
}));

// ===========================================================================
// ADMIN AUTH
// ===========================================================================
app.get('/admin/login', (req, res) => {
  if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'owner')) {
    return res.redirect('/admin');
  }
  res.render('admin/login');
});

app.post('/admin/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const user = await store.findUserByCredential((email || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    req.flash('error', 'Invalid credentials.');
    return res.redirect('/admin/login');
  }
  if (user.role !== 'admin' && user.role !== 'owner') {
    req.flash('error', 'This account does not have admin access.');
    return res.redirect('/admin/login');
  }
  req.session.user = sessionUser(user);
  req.flash('success', `Welcome back, ${user.fullName}.`);
  res.redirect('/admin');
}));

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ===========================================================================
// ADMIN DASHBOARD
// ===========================================================================
app.get('/admin', requireAdmin, wrap(async (req, res) => {
  const [listings, bookings, reviews, users] = await Promise.all([
    store.getListings(),
    store.getBookings(),
    store.getAllReviews(),
    store.getUsers()
  ]);
  const stats = {
    listings:  listings.length,
    verified:  listings.filter((l) => l.verified).length,
    featured:  listings.filter((l) => l.featured).length,
    bookings:  bookings.length,
    pending:   bookings.filter((b) => b.status === 'pending').length,
    reviews:   reviews.length,
    users:     users.filter((u) => u.role === 'seeker' || u.role === 'provider').length,
    providers: users.filter((u) => u.role === 'provider').length
  };
  const recentBookings = bookings.slice(0, 5);
  const pendingApplications = req.session.user.role === 'owner'
    ? users.filter((u) => u.providerApplication && u.providerApplication.status === 'pending')
    : [];
  res.render('admin/dashboard', { stats, recentBookings, pendingApplications });
}));

// ===========================================================================
// ADMIN: LISTINGS
// ===========================================================================
app.get('/admin/listings', requireAdmin, wrap(async (req, res) => {
  const listings = await store.getListings();
  res.render('admin/listings', { listings, firstPhoto: listingFirstPhoto });
}));

app.get('/admin/listings/new', requireAdmin, (req, res) => {
  res.render('admin/listing-form', { listing: null });
});

app.post('/admin/listings', requireAdmin, upload.fields(photoFields), wrap(async (req, res) => {
  const b = req.body;
  await store.createListing({
    id: nanoid(10),
    ownerId: null,
    title: b.title, type: b.type, area: b.area,
    price: Number(b.price) || 0, period: b.period, audience: b.audience,
    ...parseAmenities(b),
    description: b.description || '',
    ownerName: b.ownerName || '',
    ownerPhone: b.ownerPhone || '',
    verified: b.verified === 'on',
    featured: b.featured === 'on',
    status: b.status || 'active',
    photos: collectUploadedPhotos(req.files, null),
    createdAt: Date.now()
  });
  req.flash('success', 'Listing created.');
  res.redirect('/admin/listings');
}));

app.get('/admin/listings/:id/edit', requireAdmin, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing) {
    req.flash('error', 'Listing not found.');
    return res.redirect('/admin/listings');
  }
  res.render('admin/listing-form', { listing });
}));

app.post('/admin/listings/:id', requireAdmin, upload.fields(photoFields), wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing) {
    req.flash('error', 'Listing not found.');
    return res.redirect('/admin/listings');
  }
  const b = req.body;
  await store.updateListing(req.params.id, {
    title: b.title, type: b.type, area: b.area,
    price: Number(b.price) || 0, period: b.period, audience: b.audience,
    ...parseAmenities(b),
    description: b.description || '',
    ownerName: b.ownerName || '',
    ownerPhone: b.ownerPhone || '',
    verified: b.verified === 'on',
    featured: b.featured === 'on',
    status: b.status || 'active',
    photos: collectUploadedPhotos(req.files, listing.photos)
  });
  req.flash('success', 'Listing updated.');
  res.redirect('/admin/listings');
}));

app.post('/admin/listings/:id/photo/delete', requireAdmin, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (listing) {
    const { category, url } = req.body;
    const photos = listing.photos || {};
    if (photos[category]) {
      photos[category] = photos[category].filter((p) => p !== url);
      // Photo stored on Cloudinary - no local deletion needed
      await store.updateListingPhotos(req.params.id, photos);
    }
  }
  res.redirect('/admin/listings/' + req.params.id + '/edit');
}));

app.post('/admin/listings/:id/toggle', requireAdmin, wrap(async (req, res) => {
  await store.toggleListing(req.params.id, req.body.field);
  res.redirect(req.get('referer') || '/admin/listings');
}));

app.post('/admin/listings/:id/delete', requireAdmin, wrap(async (req, res) => {
  await store.deleteListing(req.params.id);
  req.flash('success', 'Listing deleted.');
  res.redirect('/admin/listings');
}));

// ===========================================================================
// ADMIN: BOOKINGS
// ===========================================================================
app.get('/admin/bookings', requireAdmin, wrap(async (req, res) => {
  const bookings = await store.getBookings();
  res.render('admin/bookings', { bookings });
}));

app.post('/admin/bookings/:id/status', requireAdmin, wrap(async (req, res) => {
  await store.updateBookingStatus(req.params.id, req.body.status);
  res.redirect('/admin/bookings');
}));

// ===========================================================================
// SUPPORT DASHBOARD — verify payments, pay hosts out
// ===========================================================================
// Everything a support agent needs on one card: who paid, for what, and where
// the host's money should go.
async function enrichPayments(payments) {
  const out = [];
  for (const payment of payments) {
    const booking = await store.getBookingById(payment.bookingId);
    if (!booking) continue;                       // booking deleted with its listing
    const listing = await store.getListingById(payment.listingId || booking.listingId);
    const host = listing && listing.ownerId ? await store.findUserById(listing.ownerId) : null;
    const room = booking.roomId ? await store.getRoomById(booking.roomId) : null;
    out.push({ payment, booking, listing, host, room });
  }
  return out;
}

app.get('/support', requireSupport, wrap(async (req, res) => {
  const tab = ['pending', 'payouts', 'history'].includes(req.query.tab) ? req.query.tab : 'pending';

  // Proofs waiting on a human: newly submitted first, then ones we bounced back.
  const pending = await store.getPaymentsByStatus(['pending']);
  // Guest has checked in, so the host has earned their payout.
  const confirmed = await store.getPaymentsByStatus(['confirmed_by_support']);
  const payouts = confirmed.filter((p) => p.arrivedAt);
  const all = await store.getPayments();

  const q = (req.query.q || '').trim().toLowerCase();
  let rows;
  if (tab === 'pending') rows = await enrichPayments(pending);
  else if (tab === 'payouts') rows = await enrichPayments(payouts);
  else {
    rows = await enrichPayments(all);
    if (q) {
      rows = rows.filter((r) =>
        (r.booking.name || '').toLowerCase().includes(q) ||
        (r.booking.phone || '').includes(q) ||
        (r.booking.id || '').toLowerCase().includes(q) ||
        (r.booking.listingTitle || '').toLowerCase().includes(q));
    }
  }

  const bankAccount = await store.getActiveBankAccount();
  res.render('support/dashboard', {
    tab, rows, q,
    counts: { pending: pending.length, payouts: payouts.length, history: all.length },
    revenue: {
      commission: all
        .filter((p) => C.PAYMENT_CONFIRMED_STATUSES.includes(p.status))
        .reduce((s, p) => s + p.commissionAmount, 0),
      owed: payouts.filter((p) => p.status === 'confirmed_by_support')
        .reduce((s, p) => s + p.hotelPayoutAmount, 0)
    },
    bankAccount
  });
}));

// Load a payment for a support action, or redirect and return null.
async function loadPayment(req, res, back) {
  const payment = await store.getPaymentById(req.params.id);
  if (!payment) {
    req.flash('error', 'Payment not found.');
    res.redirect(back);
    return null;
  }
  return payment;
}

// Verify the money landed → the reservation goes live and the room is held.
app.post('/support/payments/:id/confirm', requireSupport, wrap(async (req, res) => {
  const back = '/support?tab=pending';
  const payment = await loadPayment(req, res, back);
  if (!payment) return;
  if (payment.status !== 'pending') {
    req.flash('error', 'That payment is not awaiting confirmation.');
    return res.redirect(back);
  }
  const booking = await store.getBookingById(payment.bookingId);
  if (!booking) {
    req.flash('error', 'The reservation behind this payment no longer exists.');
    return res.redirect(back);
  }

  // This is the first moment the room is actually held, so it can genuinely be
  // gone — someone else may have paid and been confirmed first.
  try {
    await store.confirmBookingSafe(booking.id);
  } catch (e) {
    if (e.code === 'SOLD_OUT') {
      req.flash('error', 'Those dates sold out before this payment was confirmed. ' +
        'Reject the payment and refund the guest, or move them to different dates.');
      return res.redirect(back);
    }
    throw e;
  }

  await store.updateBookingPayment(booking.id, 'paid');
  const assigned = await store.assignRoomNumbers(booking.id);
  await store.updatePayment(payment.id, {
    status: 'confirmed_by_support',
    confirmedAt: Date.now(),
    confirmedByUserId: req.session.user.id,
    supportNotes: (req.body.notes || '').trim(),
    rejectionReason: ''
  });
  console.log('[payment] ' + payment.id + ' confirmed — booking ' + booking.id + ' is live');
  req.flash('success', 'Payment confirmed. The reservation is now live in the host\'s dashboard.' +
    (assigned ? ' Room ' + assigned + ' assigned.' : ''));
  res.redirect(back);
}));

// Bad proof → tell the guest why; they can upload a corrected screenshot.
app.post('/support/payments/:id/reject', requireSupport, wrap(async (req, res) => {
  const back = '/support?tab=pending';
  const payment = await loadPayment(req, res, back);
  if (!payment) return;
  if (C.PAYMENT_CONFIRMED_STATUSES.includes(payment.status)) {
    req.flash('error', 'That payment is already confirmed — it cannot be rejected.');
    return res.redirect(back);
  }
  const reason = (req.body.reason || '').trim();
  if (!reason) {
    req.flash('error', 'Please give the guest a reason so they can fix it.');
    return res.redirect(back);
  }
  await store.updatePayment(payment.id, {
    status: 'rejected',
    rejectionReason: reason,
    supportNotes: (req.body.notes || '').trim()
  });
  await store.updateBookingPayment(payment.bookingId, 'rejected');
  req.flash('success', 'Payment rejected. The guest can upload a new screenshot.');
  res.redirect(back);
}));

// Money has been transferred to the host.
app.post('/support/payments/:id/send-to-hotel', requireSupport, wrap(async (req, res) => {
  const back = '/support?tab=payouts';
  const payment = await loadPayment(req, res, back);
  if (!payment) return;
  if (payment.status !== 'confirmed_by_support') {
    req.flash('error', 'That payment is not ready for a host payout.');
    return res.redirect(back);
  }
  if (!payment.arrivedAt) {
    req.flash('error', 'The host has not marked this guest as arrived yet.');
    return res.redirect(back);
  }
  await store.updatePayment(payment.id, {
    status: 'payment_sent_to_hotel',
    paidToHotelAt: Date.now(),
    paymentMethod: req.body.method || 'bank_transfer',
    paymentReference: (req.body.reference || '').trim(),
    supportNotes: (req.body.notes || '').trim()
  });
  console.log('[payment] ' + payment.id + ' paid out to host');
  req.flash('success', 'Host payout recorded.');
  res.redirect(back);
}));

app.post('/support/payments/:id/complete', requireSupport, wrap(async (req, res) => {
  const back = '/support?tab=history';
  const payment = await loadPayment(req, res, back);
  if (!payment) return;
  if (payment.status !== 'payment_sent_to_hotel') {
    req.flash('error', 'Only a paid-out reservation can be completed.');
    return res.redirect(back);
  }
  await store.updatePayment(payment.id, { status: 'completed', completedAt: Date.now() });
  req.flash('success', 'Reservation completed.');
  res.redirect(back);
}));

// --- The account guests transfer into ---
app.get('/support/bank-account', requireSupport, wrap(async (req, res) => {
  res.render('support/bank-account', { accounts: await store.getBankAccounts() });
}));

app.post('/support/bank-account', requireSupport, wrap(async (req, res) => {
  const b = req.body;
  if (!b.bankName || !b.accountHolderName || !b.accountNumber) {
    req.flash('error', 'Bank name, account holder and account number are required.');
    return res.redirect('/support/bank-account');
  }
  const id = nanoid(10);
  await store.createBankAccount({
    id,
    bankName: b.bankName.trim(),
    accountHolderName: b.accountHolderName.trim(),
    accountNumber: b.accountNumber.trim(),
    branch: (b.branch || '').trim(),
    instructions: (b.instructions || '').trim(),
    isActive: false,
    createdAt: Date.now()
  });
  // A brand-new account is what you want guests to use, so make it the live one.
  await store.activateBankAccount(id);
  req.flash('success', 'Bank account added and set as the active one.');
  res.redirect('/support/bank-account');
}));

app.post('/support/bank-account/:id/activate', requireSupport, wrap(async (req, res) => {
  await store.activateBankAccount(req.params.id);
  req.flash('success', 'That account is now shown to guests.');
  res.redirect('/support/bank-account');
}));

app.post('/support/bank-account/:id/delete', requireSupport, wrap(async (req, res) => {
  await store.deleteBankAccount(req.params.id);
  req.flash('success', 'Bank account removed.');
  res.redirect('/support/bank-account');
}));

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404');
});

// ---------------------------------------------------------------------------
// Error handler — turns upload/server failures into a friendly message
// instead of a bare "Internal Server Error".
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Request failed:', err);

  let msg = 'Something went wrong. Please try again.';
  if (err instanceof multer.MulterError) {
    msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'That photo is too large. Please upload images under 6 MB.'
      : 'There was a problem with the uploaded file. Please try again.';
  } else if (/cloudinary|api_key|cloud_name|Must supply/i.test(err.message || '')) {
    msg = 'Photo upload is not configured correctly. Please contact the site owner.';
  }

  req.flash('error', msg);
  res.redirect(req.get('referer') || '/');
});

// ===========================================================================
// START — seed first, then listen
// ===========================================================================
seed.run().then(() => {
  app.listen(PORT, () => {
    console.log(`  AlgaAle is running -> http://localhost:${PORT}`);
    console.log(`  Admin panel       -> http://localhost:${PORT}/admin/login`);
  });
}).catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
