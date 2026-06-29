const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');

const db = require('./lib/db');
const seed = require('./lib/seed');
const C = require('./lib/constants');
const { UPLOAD_DIR } = require('./lib/paths');

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_EMAIL = 'genkaleab@gmail.com';

seed.run();

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

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'alga-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }
  })
);
app.use(flash());

app.use((req, res, next) => {
  res.locals.C = C;
  res.locals.user = req.session.user || null;
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error')
  };
  res.locals.path = req.path;
  res.locals.money = (n) => Number(n).toLocaleString('en-US');
  next();
});

// ---------------------------------------------------------------------------
// File uploads
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${nanoid(6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(null, false);
  }
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

function getListing(id) {
  return db.read().listings.find((l) => l.id === id);
}

function parseAmenities(body) {
  return {
    furnished: body.furnished === 'on' || body.furnished === 'true',
    wifi: body.wifi === 'on' || body.wifi === 'true',
    water: body.water === 'on' || body.water === 'true',
    parking: body.parking === 'on' || body.parking === 'true'
  };
}

function collectUploadedPhotos(files, existing) {
  const photos = existing ? JSON.parse(JSON.stringify(existing)) : {};
  C.PHOTO_CATEGORIES.forEach((cat) => {
    if (!photos[cat]) photos[cat] = [];
    const f = files && files[`photo_${cat}`];
    if (f && f.length) {
      f.forEach((file) => photos[cat].push('/uploads/' + file.filename));
    }
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
// PUBLIC: HOME — visible to everyone
// ===========================================================================
app.get('/', (req, res) => {
  const data = db.read();
  const f = req.query;

  let listings = data.listings.filter((l) => l.status !== 'hidden');

  if (f.q) {
    const q = f.q.toLowerCase();
    listings = listings.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        (l.description || '').toLowerCase().includes(q) ||
        l.area.toLowerCase().includes(q)
    );
  }
  if (f.area) listings = listings.filter((l) => l.area === f.area);
  if (f.type) listings = listings.filter((l) => l.type === f.type);
  if (f.period) listings = listings.filter((l) => l.period === f.period);
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

  const reviewCounts = {};
  data.reviews.forEach((r) => {
    reviewCounts[r.listingId] = (reviewCounts[r.listingId] || 0) + 1;
  });

  res.render('index', {
    listings,
    filters: f,
    firstPhoto: listingFirstPhoto,
    reviewCounts,
    total: data.listings.length
  });
});

// ===========================================================================
// PUBLIC: LISTING DETAIL — requires login
// ===========================================================================
app.get('/listing/:id', requireUser, (req, res) => {
  const data = db.read();
  const listing = data.listings.find((l) => l.id === req.params.id);
  if (!listing) {
    req.flash('error', 'That listing could not be found.');
    return res.redirect('/');
  }
  const reviews = data.reviews
    .filter((r) => r.listingId === listing.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  const avg =
    reviews.length > 0
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
      : null;
  res.render('listing', { listing, reviews, avg });
});

app.post('/listing/:id/book', requireUser, (req, res) => {
  const data = db.read();
  const listing = data.listings.find((l) => l.id === req.params.id);
  if (!listing) {
    req.flash('error', 'That listing could not be found.');
    return res.redirect('/');
  }
  const { name, phone, message, duration } = req.body;
  if (!name || !phone) {
    req.flash('error', 'Please provide your name and phone number.');
    return res.redirect('/listing/' + listing.id);
  }
  data.bookings.push({
    id: nanoid(10),
    listingId: listing.id,
    listingTitle: listing.title,
    name,
    phone,
    duration: duration || '',
    message: message || '',
    status: 'pending',
    createdAt: Date.now()
  });
  db.write(data);
  req.flash('success', 'Your booking request was sent. The host will be in touch via AlgaAle.');
  res.redirect('/listing/' + listing.id);
});

app.post('/listing/:id/review', requireUser, (req, res) => {
  const data = db.read();
  const listing = data.listings.find((l) => l.id === req.params.id);
  if (!listing) return res.redirect('/');
  const { name, rating, comment } = req.body;
  if (!name || !comment) {
    req.flash('error', 'Please add your name and a comment.');
    return res.redirect('/listing/' + listing.id);
  }
  data.reviews.push({
    id: nanoid(10),
    listingId: listing.id,
    name,
    rating: Math.min(5, Math.max(1, Number(rating) || 5)),
    comment,
    createdAt: Date.now()
  });
  db.write(data);
  req.flash('success', 'Thanks for your review!');
  res.redirect('/listing/' + listing.id);
});

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

app.post('/register', (req, res) => {
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

  const data = db.read();

  const phoneTrimmed = phone.trim();
  if (data.users.some((u) => u.phone && u.phone === phoneTrimmed)) {
    req.flash('error', 'An account with that phone number already exists. Try logging in.');
    return res.redirect(redir);
  }
  const emailTrimmed = (email || '').trim().toLowerCase();
  if (emailTrimmed && data.users.some((u) => u.email && u.email.toLowerCase() === emailTrimmed)) {
    req.flash('error', 'An account with that email already exists. Try logging in.');
    return res.redirect(redir);
  }

  const user = {
    id: nanoid(10),
    fullName: fullName.trim(),
    phone: phoneTrimmed,
    email: emailTrimmed || null,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'seeker',
    providerApplication: { status: 'none', idType: null, idNumber: null, idImage: null, submittedAt: null, reviewedAt: null },
    createdAt: Date.now()
  };

  data.users.push(user);
  db.write(data);

  req.session.user = sessionUser(user);
  req.flash('success', `Welcome to AlgaAle, ${user.fullName.split(' ')[0]}!`);
  res.redirect(next || '/');
});

// ===========================================================================
// PUBLIC AUTH: LOGIN
// ===========================================================================
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { next: req.query.next || '' });
});

app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  const next = (req.body.next || '').trim();
  const redir = '/login' + (next ? '?next=' + encodeURIComponent(next) : '');

  const data = db.read();
  const id = (identifier || '').trim();
  const user = data.users.find(
    (u) =>
      (u.phone && u.phone === id) ||
      (u.email && u.email.toLowerCase() === id.toLowerCase())
  );

  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    req.flash('error', 'Incorrect phone / email or password.');
    return res.redirect(redir);
  }

  req.session.user = sessionUser(user);
  const firstName = (user.fullName || user.name || '').split(' ')[0];
  req.flash('success', `Welcome back, ${firstName}!`);
  res.redirect(next || '/');
});

// Public logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ===========================================================================
// BECOME A PROVIDER
// ===========================================================================
app.get('/become-provider', requireUser, (req, res) => {
  const u = req.session.user;
  if (u.role === 'provider') return res.redirect('/provider');

  const data = db.read();
  const dbUser = data.users.find((x) => x.id === u.id);
  const application = dbUser ? dbUser.providerApplication : { status: 'none' };
  res.render('become-provider', { application });
});

app.post('/become-provider', requireUser, upload.single('idImage'), (req, res) => {
  const u = req.session.user;
  if (u.role === 'provider') return res.redirect('/provider');

  const { idType, idNumber } = req.body;
  if (!idType || !idNumber) {
    req.flash('error', 'ID type and ID number are required.');
    return res.redirect('/become-provider');
  }

  const data = db.read();
  const dbUser = data.users.find((x) => x.id === u.id);
  if (!dbUser) return res.redirect('/');

  if (dbUser.providerApplication.status === 'approved') {
    dbUser.role = 'provider';
    req.session.user = sessionUser(dbUser);
    db.write(data);
    return res.redirect('/provider');
  }

  dbUser.providerApplication = {
    status: 'pending',
    idType,
    idNumber,
    idImage: req.file ? '/uploads/' + req.file.filename : (dbUser.providerApplication.idImage || null),
    submittedAt: Date.now(),
    reviewedAt: null
  };
  db.write(data);

  req.session.user = sessionUser(dbUser);
  req.flash('success', 'Application submitted! We will review it and get back to you.');
  res.redirect('/become-provider');
});

// ===========================================================================
// PROVIDER DASHBOARD
// ===========================================================================
app.get('/provider', requireProvider, (req, res) => {
  const data = db.read();
  const myListings = data.listings
    .filter((l) => l.ownerId === req.session.user.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  res.render('provider/dashboard', { listings: myListings, firstPhoto: listingFirstPhoto });
});

app.get('/provider/listings/new', requireProvider, (req, res) => {
  res.render('provider/listing-form', { listing: null });
});

app.post('/provider/listings', requireProvider, upload.fields(photoFields), (req, res) => {
  const data = db.read();
  const b = req.body;
  const u = req.session.user;
  const listing = {
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
  };
  data.listings.push(listing);
  db.write(data);
  req.flash('success', 'Listing created! It will appear publicly once reviewed.');
  res.redirect('/provider');
});

app.get('/provider/listings/:id/edit', requireProvider, (req, res) => {
  const listing = getListing(req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or you do not have permission to edit it.');
    return res.redirect('/provider');
  }
  res.render('provider/listing-form', { listing });
});

app.post('/provider/listings/:id', requireProvider, upload.fields(photoFields), (req, res) => {
  const data = db.read();
  const idx = data.listings.findIndex((l) => l.id === req.params.id);
  if (idx === -1 || data.listings[idx].ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or you do not have permission to edit it.');
    return res.redirect('/provider');
  }
  const b = req.body;
  const existing = data.listings[idx];
  data.listings[idx] = {
    ...existing,
    title: b.title,
    type: b.type,
    area: b.area,
    price: Number(b.price) || 0,
    period: b.period,
    audience: b.audience,
    ...parseAmenities(b),
    description: b.description || '',
    status: b.status || 'active',
    photos: collectUploadedPhotos(req.files, existing.photos)
  };
  db.write(data);
  req.flash('success', 'Listing updated.');
  res.redirect('/provider');
});

app.post('/provider/listings/:id/delete', requireProvider, (req, res) => {
  const data = db.read();
  const listing = data.listings.find((l) => l.id === req.params.id);
  if (!listing || listing.ownerId !== req.session.user.id) {
    req.flash('error', 'Listing not found or access denied.');
    return res.redirect('/provider');
  }
  data.listings = data.listings.filter((l) => l.id !== req.params.id);
  db.write(data);
  req.flash('success', 'Listing deleted.');
  res.redirect('/provider');
});

app.post('/provider/listings/:id/photo/delete', requireProvider, (req, res) => {
  const data = db.read();
  const listing = data.listings.find(
    (l) => l.id === req.params.id && l.ownerId === req.session.user.id
  );
  if (listing) {
    const { category, url } = req.body;
    if (listing.photos && listing.photos[category]) {
      listing.photos[category] = listing.photos[category].filter((p) => p !== url);
      const filePath = path.join(UPLOAD_DIR, path.basename(url));
      if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
      db.write(data);
    }
  }
  res.redirect('/provider/listings/' + req.params.id + '/edit');
});

// ===========================================================================
// OWNER: APPROVE / REJECT PROVIDER APPLICATIONS
// ===========================================================================
app.post('/owner/applications/:userId/approve', requireOwner, (req, res) => {
  const data = db.read();
  const user = data.users.find((u) => u.id === req.params.userId);
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin');
  }
  user.role = 'provider';
  user.providerApplication.status = 'approved';
  user.providerApplication.reviewedAt = Date.now();
  db.write(data);
  req.flash('success', `${user.fullName} is now an approved provider.`);
  res.redirect('/admin');
});

app.post('/owner/applications/:userId/reject', requireOwner, (req, res) => {
  const data = db.read();
  const user = data.users.find((u) => u.id === req.params.userId);
  if (!user) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin');
  }
  user.providerApplication.status = 'rejected';
  user.providerApplication.reviewedAt = Date.now();
  db.write(data);
  req.flash('success', `Application from ${user.fullName} rejected.`);
  res.redirect('/admin');
});

// ===========================================================================
// ADMIN AUTH
// ===========================================================================
app.get('/admin/login', (req, res) => {
  if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'owner')) {
    return res.redirect('/admin');
  }
  res.render('admin/login');
});

app.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  const data = db.read();
  const user = data.users.find(
    (u) =>
      (u.email && u.email.toLowerCase() === (email || '').toLowerCase()) ||
      (u.phone && u.phone === (email || '').trim())
  );
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    req.flash('error', 'Invalid credentials.');
    return res.redirect('/admin/login');
  }
  if (user.role !== 'admin' && user.role !== 'owner') {
    req.flash('error', 'This account does not have admin access.');
    return res.redirect('/admin/login');
  }
  req.session.user = sessionUser(user);
  req.flash('success', `Welcome back, ${user.fullName || user.name}.`);
  res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ===========================================================================
// ADMIN DASHBOARD
// ===========================================================================
app.get('/admin', requireAdmin, (req, res) => {
  const data = db.read();
  const stats = {
    listings: data.listings.length,
    verified: data.listings.filter((l) => l.verified).length,
    featured: data.listings.filter((l) => l.featured).length,
    bookings: data.bookings.length,
    pending: data.bookings.filter((b) => b.status === 'pending').length,
    reviews: data.reviews.length,
    users: data.users.filter((u) => u.role === 'seeker' || u.role === 'provider').length,
    providers: data.users.filter((u) => u.role === 'provider').length
  };
  const recentBookings = [...data.bookings].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const pendingApplications = req.session.user.role === 'owner'
    ? data.users.filter((u) => u.providerApplication && u.providerApplication.status === 'pending')
    : [];
  res.render('admin/dashboard', { stats, recentBookings, pendingApplications });
});

// ===========================================================================
// ADMIN: LISTINGS
// ===========================================================================
app.get('/admin/listings', requireAdmin, (req, res) => {
  const data = db.read();
  const listings = [...data.listings].sort((a, b) => b.createdAt - a.createdAt);
  res.render('admin/listings', { listings, firstPhoto: listingFirstPhoto });
});

app.get('/admin/listings/new', requireAdmin, (req, res) => {
  res.render('admin/listing-form', { listing: null });
});

app.post('/admin/listings', requireAdmin, upload.fields(photoFields), (req, res) => {
  const data = db.read();
  const b = req.body;
  const listing = {
    id: nanoid(10),
    ownerId: null,
    title: b.title,
    type: b.type,
    area: b.area,
    price: Number(b.price) || 0,
    period: b.period,
    audience: b.audience,
    ...parseAmenities(b),
    description: b.description || '',
    ownerName: b.ownerName || '',
    ownerPhone: b.ownerPhone || '',
    verified: b.verified === 'on',
    featured: b.featured === 'on',
    status: b.status || 'active',
    photos: collectUploadedPhotos(req.files, null),
    createdAt: Date.now()
  };
  data.listings.push(listing);
  db.write(data);
  req.flash('success', 'Listing created.');
  res.redirect('/admin/listings');
});

app.get('/admin/listings/:id/edit', requireAdmin, (req, res) => {
  const listing = getListing(req.params.id);
  if (!listing) {
    req.flash('error', 'Listing not found.');
    return res.redirect('/admin/listings');
  }
  res.render('admin/listing-form', { listing });
});

app.post('/admin/listings/:id', requireAdmin, upload.fields(photoFields), (req, res) => {
  const data = db.read();
  const idx = data.listings.findIndex((l) => l.id === req.params.id);
  if (idx === -1) {
    req.flash('error', 'Listing not found.');
    return res.redirect('/admin/listings');
  }
  const b = req.body;
  const existing = data.listings[idx];
  data.listings[idx] = {
    ...existing,
    title: b.title,
    type: b.type,
    area: b.area,
    price: Number(b.price) || 0,
    period: b.period,
    audience: b.audience,
    ...parseAmenities(b),
    description: b.description || '',
    ownerName: b.ownerName || '',
    ownerPhone: b.ownerPhone || '',
    verified: b.verified === 'on',
    featured: b.featured === 'on',
    status: b.status || 'active',
    photos: collectUploadedPhotos(req.files, existing.photos)
  };
  db.write(data);
  req.flash('success', 'Listing updated.');
  res.redirect('/admin/listings');
});

app.post('/admin/listings/:id/photo/delete', requireAdmin, (req, res) => {
  const data = db.read();
  const listing = data.listings.find((l) => l.id === req.params.id);
  if (listing) {
    const { category, url } = req.body;
    if (listing.photos[category]) {
      listing.photos[category] = listing.photos[category].filter((p) => p !== url);
      const filePath = path.join(UPLOAD_DIR, path.basename(url));
      if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
      db.write(data);
    }
  }
  res.redirect('/admin/listings/' + req.params.id + '/edit');
});

app.post('/admin/listings/:id/toggle', requireAdmin, (req, res) => {
  const data = db.read();
  const listing = data.listings.find((l) => l.id === req.params.id);
  if (listing) {
    const field = req.body.field;
    if (['verified', 'featured'].includes(field)) {
      listing[field] = !listing[field];
    } else if (field === 'status') {
      listing.status = listing.status === 'hidden' ? 'active' : 'hidden';
    }
    db.write(data);
  }
  res.redirect(req.get('referer') || '/admin/listings');
});

app.post('/admin/listings/:id/delete', requireAdmin, (req, res) => {
  const data = db.read();
  data.listings = data.listings.filter((l) => l.id !== req.params.id);
  db.write(data);
  req.flash('success', 'Listing deleted.');
  res.redirect('/admin/listings');
});

// ===========================================================================
// ADMIN: BOOKINGS
// ===========================================================================
app.get('/admin/bookings', requireAdmin, (req, res) => {
  const data = db.read();
  const bookings = [...data.bookings].sort((a, b) => b.createdAt - a.createdAt);
  res.render('admin/bookings', { bookings });
});

app.post('/admin/bookings/:id/status', requireAdmin, (req, res) => {
  const data = db.read();
  const booking = data.bookings.find((bk) => bk.id === req.params.id);
  if (booking) {
    booking.status = req.body.status || booking.status;
    db.write(data);
  }
  res.redirect('/admin/bookings');
});

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, () => {
  console.log(`  AlgaAle is running -> http://localhost:${PORT}`);
  console.log(`  Admin panel       -> http://localhost:${PORT}/admin/login`);
});
