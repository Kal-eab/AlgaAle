'use strict';
require('dotenv').config();
const path    = require('path');
const fs      = require('fs');
const express = require('express');
const session = require('express-session');
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

app.use(session({
  secret: process.env.SESSION_SECRET || 'alga-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));
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

// ===========================================================================
// PUBLIC: HOME
// ===========================================================================
app.get('/', wrap(async (req, res) => {
  const f = req.query;
  let listings = await store.getListings();
  listings = listings.filter((l) => l.status !== 'hidden');

  if (f.q) {
    const q = f.q.toLowerCase();
    listings = listings.filter((l) =>
      l.title.toLowerCase().includes(q) ||
      (l.description || '').toLowerCase().includes(q) ||
      l.area.toLowerCase().includes(q)
    );
  }
  if (f.area)     listings = listings.filter((l) => l.area     === f.area);
  if (f.type)     listings = listings.filter((l) => l.type     === f.type);
  if (f.period)   listings = listings.filter((l) => l.period   === f.period);
  if (f.audience) listings = listings.filter((l) => l.audience === f.audience);
  if (f.maxPrice) listings = listings.filter((l) => Number(l.price) <= Number(f.maxPrice));
  ['furnished', 'wifi', 'water', 'parking'].forEach((a) => {
    if (f[a]) listings = listings.filter((l) => l[a]);
  });
  if (f.verified) listings = listings.filter((l) => l.verified);

  listings.sort((a, b) => {
    const score = (l) => (l.featured ? 2 : 0) + (l.verified ? 1 : 0);
    if (score(b) !== score(a)) return score(b) - score(a);
    return b.createdAt - a.createdAt;
  });

  const reviewCounts = await store.getReviewCountsByListing();
  const all = await store.getListings();

  res.render('index', {
    listings,
    filters: f,
    firstPhoto: listingFirstPhoto,
    reviewCounts,
    total: all.length
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
  if (listing.status === 'hidden' && !isStaff && !isOwnerOfListing) {
    req.flash('error', 'That listing is not available.');
    return res.redirect('/');
  }
  const reviews = await store.getReviewsByListing(listing.id);
  const avg = reviews.length > 0
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
    : null;
  res.render('listing', { listing, reviews, avg });
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
app.get('/provider', requireProvider, wrap(async (req, res) => {
  const myListings = await store.getListingsByOwner(req.session.user.id);
  res.render('provider/dashboard', { listings: myListings, firstPhoto: listingFirstPhoto });
}));

app.get('/provider/listings/new', requireProvider, (req, res) => {
  res.render('provider/listing-form', { listing: null });
});

app.post('/provider/listings', requireProvider, upload.fields(photoFields), wrap(async (req, res) => {
  const b = req.body;
  const u = req.session.user;
  await store.createListing({
    id: nanoid(10),
    ownerId: u.id,
    title: b.title,
    type: b.type,
    area: b.area,
    price: Number(b.price) || 0,
    period: b.period,
    audience: b.audience,
    ...parseAmenities(b),
    description: b.description || '',
    ownerName: u.fullName,
    ownerPhone: u.phone || '',
    verified: false,
    featured: false,
    status: 'active',
    photos: collectUploadedPhotos(req.files, null),
    createdAt: Date.now()
  });
  req.flash('success', 'Listing created and is now live.');
  res.redirect('/provider');
}));

app.get('/provider/listings/:id/edit', requireProvider, wrap(async (req, res) => {
  const listing = await store.getListingById(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or you do not have permission to edit it.');
    return res.redirect('/provider');
  }
  res.render('provider/listing-form', { listing });
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
    photos: collectUploadedPhotos(req.files, listing.photos)
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
  res.redirect('/provider/listings/' + req.params.id + '/edit');
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
