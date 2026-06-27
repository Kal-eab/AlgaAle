/**
 * Seeds the database on first run:
 *  - one admin account (credentials printed to console / in README)
 *  - a handful of sample Addis Ababa listings so the marketplace looks alive.
 */
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const db = require('./db');
const { PHOTO_CATEGORIES } = require('./constants');

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@alga.et';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function emptyPhotos() {
  const obj = {};
  PHOTO_CATEGORIES.forEach((c) => (obj[c] = []));
  return obj;
}

function sampleListings() {
  const now = Date.now();
  const base = [
    {
      title: 'Clean single bed in shared student room — Bole',
      type: 'bed',
      area: 'Bole',
      price: 3500,
      period: 'monthly',
      audience: 'male',
      furnished: true,
      wifi: true,
      water: true,
      parking: false,
      verified: true,
      featured: true,
      ownerName: 'Selam G.',
      ownerPhone: '+251 91 234 5678',
      description:
        'A single bed in a tidy two-person room, 10 minutes walk from Bole Medhanialem. Perfect for a working professional or student. Shared bathroom and kitchen. Quiet, safe compound with a guard.'
    },
    {
      title: 'Furnished studio apartment near CMC Roundabout',
      type: 'studio',
      area: 'CMC',
      price: 12000,
      period: 'monthly',
      audience: 'any',
      furnished: true,
      wifi: true,
      water: true,
      parking: true,
      verified: true,
      featured: false,
      ownerName: 'Daniel T.',
      ownerPhone: '+251 92 111 2233',
      description:
        'Bright self-contained studio with private bathroom and kitchenette. Backup water tank, fiber internet, and a private parking spot. Ideal for someone relocating to Addis for work.'
    },
    {
      title: 'Female-only spare room in family home — Megenagna',
      type: 'spare_room',
      area: 'Megenagna',
      price: 6000,
      period: 'monthly',
      audience: 'female',
      furnished: true,
      wifi: false,
      water: true,
      parking: false,
      verified: false,
      featured: false,
      ownerName: 'W/ro Aster',
      ownerPhone: '+251 93 444 5566',
      description:
        'A warm spare room in a family home, meals can be arranged. Very safe area, close to Megenagna transport hub. Female tenants only please.'
    },
    {
      title: 'Daily room in guest house — Piassa',
      type: 'guesthouse',
      area: 'Piassa',
      price: 700,
      period: 'daily',
      audience: 'any',
      furnished: true,
      wifi: true,
      water: true,
      parking: false,
      verified: true,
      featured: true,
      ownerName: 'Abebe Pension',
      ownerPhone: '+251 94 777 8899',
      description:
        'Affordable daily room right in the heart of Piassa, great for short trips, interviews, or medical visits. Hot shower, clean linens, daily cleaning.'
    },
    {
      title: 'Two beds in student hostel near Sarbet',
      type: 'hostel',
      area: 'Sarbet',
      price: 2800,
      period: 'monthly',
      audience: 'student',
      furnished: true,
      wifi: true,
      water: false,
      parking: false,
      verified: false,
      featured: false,
      ownerName: 'Hostel Manager',
      ownerPhone: '+251 95 222 3344',
      description:
        'Beds available in a friendly student hostel close to several colleges. Study desk, shared kitchen, weekly cleaning. Water by tanker when city water is off.'
    },
    {
      title: 'Weekly furnished condo — Kazanchis',
      type: 'condo',
      area: 'Kazanchis',
      price: 4500,
      period: 'weekly',
      audience: 'any',
      furnished: true,
      wifi: true,
      water: true,
      parking: true,
      verified: true,
      featured: false,
      ownerName: 'Helen M.',
      ownerPhone: '+251 96 555 6677',
      description:
        'One-bedroom condo rented by the week, fully furnished. Central location near offices and embassies. Lift, 24/7 security, generator backup.'
    }
  ];

  return base.map((l) => ({
    id: nanoid(10),
    ...l,
    photos: emptyPhotos(),
    createdAt: now - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 30),
    status: 'active'
  }));
}

function run() {
  const data = db.read();
  let changed = false;

  if (!data.users.some((u) => u.email === ADMIN_EMAIL)) {
    data.users.push({
      id: nanoid(10),
      email: ADMIN_EMAIL,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      name: 'Alga Admin',
      role: 'admin',
      createdAt: Date.now()
    });
    changed = true;
    console.log(`\n  Seeded admin account -> ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}\n`);
  }

  if (data.listings.length === 0) {
    data.listings = sampleListings();
    changed = true;
    console.log(`  Seeded ${data.listings.length} sample listings.`);
  }

  if (changed) db.write(data);
}

module.exports = { run, ADMIN_EMAIL, ADMIN_PASSWORD };
