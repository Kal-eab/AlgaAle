'use strict';
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const store = require('./store');
const { PHOTO_CATEGORIES } = require('./constants');

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@alga.et';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Wubalem@12';
const OWNER_EMAIL    = 'genkaleab@gmail.com';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'Kaleab@12';
const OWNER_PHONE    = process.env.OWNER_PHONE    || '+251900000000';
const SUPPORT_EMAIL    = process.env.SUPPORT_EMAIL    || 'mamokaleab530@gmail.com';
const SUPPORT_PASSWORD = process.env.SUPPORT_PASSWORD || '123456';
const SUPPORT_PHONE    = process.env.SUPPORT_PHONE    || '+251900000001';

function emptyPhotos() {
  const obj = {};
  PHOTO_CATEGORIES.forEach((c) => (obj[c] = []));
  return obj;
}

function emptyProviderApp() {
  return { status: 'none', idType: null, idNumber: null, idImage: null, submittedAt: null, reviewedAt: null };
}

function sampleListings() {
  const now = Date.now();
  return [
    {
      title: 'Clean single bed in shared student room — Bole',
      type: 'bed', area: 'Bole', price: 3500, period: 'monthly', audience: 'male',
      furnished: true, wifi: true, water: true, parking: false,
      verified: true, featured: true,
      ownerName: 'Selam G.', ownerPhone: '+251 91 234 5678',
      description: 'A single bed in a tidy two-person room, 10 minutes walk from Bole Medhanialem. Perfect for a working professional or student. Shared bathroom and kitchen. Quiet, safe compound with a guard.'
    },
    {
      title: 'Furnished studio apartment near CMC Roundabout',
      type: 'studio', area: 'CMC', price: 12000, period: 'monthly', audience: 'any',
      furnished: true, wifi: true, water: true, parking: true,
      verified: true, featured: false,
      ownerName: 'Daniel T.', ownerPhone: '+251 92 111 2233',
      description: 'Bright self-contained studio with private bathroom and kitchenette. Backup water tank, fiber internet, and a private parking spot. Ideal for someone relocating to Addis for work.'
    },
    {
      title: 'Female-only spare room in family home — Megenagna',
      type: 'spare_room', area: 'Megenagna', price: 6000, period: 'monthly', audience: 'female',
      furnished: true, wifi: false, water: true, parking: false,
      verified: false, featured: false,
      ownerName: 'W/ro Aster', ownerPhone: '+251 93 444 5566',
      description: 'A warm spare room in a family home, meals can be arranged. Very safe area, close to Megenagna transport hub. Female tenants only please.'
    },
    {
      title: 'Daily room in guest house — Piassa',
      type: 'guesthouse', area: 'Piassa', price: 700, period: 'daily', audience: 'any',
      furnished: true, wifi: true, water: true, parking: false,
      verified: true, featured: true,
      ownerName: 'Abebe Pension', ownerPhone: '+251 94 777 8899',
      description: 'Affordable daily room right in the heart of Piassa, great for short trips, interviews, or medical visits. Hot shower, clean linens, daily cleaning.'
    },
    {
      title: 'Two beds in student hostel near Sarbet',
      type: 'hostel', area: 'Sarbet', price: 2800, period: 'monthly', audience: 'student',
      furnished: true, wifi: true, water: false, parking: false,
      verified: false, featured: false,
      ownerName: 'Hostel Manager', ownerPhone: '+251 95 222 3344',
      description: 'Beds available in a friendly student hostel close to several colleges. Study desk, shared kitchen, weekly cleaning.'
    },
    {
      title: 'Weekly furnished condo — Kazanchis',
      type: 'condo', area: 'Kazanchis', price: 4500, period: 'weekly', audience: 'any',
      furnished: true, wifi: true, water: true, parking: true,
      verified: true, featured: false,
      ownerName: 'Helen M.', ownerPhone: '+251 96 555 6677',
      description: 'One-bedroom condo rented by the week, fully furnished. Central location near offices and embassies. Lift, 24/7 security, generator backup.'
    },
    {
      title: 'Modern studio apartment — Bole Atlas',
      type: 'studio', area: 'Bole', price: 9500, period: 'monthly', audience: 'any',
      furnished: true, wifi: true, water: true, parking: true,
      verified: true, featured: true,
      ownerName: 'Yonas B.', ownerPhone: '+251 91 555 1212',
      description: 'Sleek self-contained studio a short walk from Bole Atlas. Backup water, fiber WiFi, private parking and 24/7 guard. Move-in ready.'
    },
    {
      title: 'Cozy daily guest house room — Bole Medhanialem',
      type: 'guesthouse', area: 'Bole', price: 950, period: 'daily', audience: 'any',
      furnished: true, wifi: true, water: true, parking: true,
      verified: true, featured: false,
      ownerName: 'Bole Guest House', ownerPhone: '+251 92 333 4455',
      description: 'Comfortable daily room minutes from Bole Medhanialem church. Hot shower, daily cleaning, breakfast on request — ideal for short visits.'
    },
    {
      title: 'Shared room near AAU campus — Bole',
      type: 'shared_room', area: 'Bole', price: 3200, period: 'monthly', audience: 'student',
      furnished: true, wifi: true, water: true, parking: false,
      verified: false, featured: false,
      ownerName: 'Mekdes A.', ownerPhone: '+251 93 777 2211',
      description: 'A friendly shared room close to the university campus, perfect for students. Study desk, shared kitchen, quiet compound. Walking distance to college.'
    },
    {
      title: 'Bright single bed in shared flat — Piassa',
      type: 'bed', area: 'Piassa', price: 3000, period: 'monthly', audience: 'male',
      furnished: true, wifi: true, water: false, parking: false,
      verified: true, featured: false,
      ownerName: 'Getachew L.', ownerPhone: '+251 94 121 3434',
      description: 'A single bed in a clean shared flat in the heart of historic Piassa. Close to transport, shops and cafés. Great for a working professional.'
    },
    {
      title: 'Weekly furnished condo — Piassa',
      type: 'condo', area: 'Piassa', price: 5000, period: 'weekly', audience: 'any',
      furnished: true, wifi: true, water: true, parking: false,
      verified: true, featured: true,
      ownerName: 'Rahel T.', ownerPhone: '+251 95 909 8877',
      description: 'One-bedroom condo rented weekly, fully furnished with central heating of hot water. Steps from Piassa landmarks, lift and 24/7 security.'
    },
    {
      title: 'Furnished studio near Kazanchis offices',
      type: 'studio', area: 'Kazanchis', price: 11000, period: 'monthly', audience: 'any',
      furnished: true, wifi: true, water: true, parking: true,
      verified: true, featured: true,
      ownerName: 'Nardos F.', ownerPhone: '+251 96 434 5566',
      description: 'Bright studio steps from the Kazanchis business district and embassies. Private bathroom, kitchenette, generator backup and parking.'
    },
    {
      title: 'Single bed in shared room — Kazanchis',
      type: 'bed', area: 'Kazanchis', price: 2600, period: 'monthly', audience: 'female',
      furnished: true, wifi: true, water: true, parking: false,
      verified: false, featured: false,
      ownerName: 'Sara M.', ownerPhone: '+251 91 246 8100',
      description: 'A tidy single bed in a two-person room for female tenants. Central Kazanchis location, shared kitchen and bathroom, safe compound.'
    },
    {
      title: 'Verified studio apartment — Gerji',
      type: 'studio', area: 'Gerji', price: 8500, period: 'monthly', audience: 'any',
      furnished: true, wifi: true, water: true, parking: true,
      verified: true, featured: true,
      ownerName: 'Biruk H.', ownerPhone: '+251 92 778 9090',
      description: 'A modern self-contained studio in a quiet Gerji neighbourhood. Backup water tank, fiber internet and a private parking spot.'
    },
    {
      title: 'Daily room in guest house — Gerji Mebrat Hail',
      type: 'guesthouse', area: 'Gerji', price: 800, period: 'daily', audience: 'any',
      furnished: true, wifi: true, water: true, parking: true,
      verified: false, featured: false,
      ownerName: 'Gerji Guest House', ownerPhone: '+251 93 565 7878',
      description: 'Affordable daily room near Gerji Mebrat Hail, great for short stays and visits. Clean linens, hot shower and secure parking.'
    },
    {
      title: 'Shared room for students — Gerji',
      type: 'shared_room', area: 'Gerji', price: 2900, period: 'monthly', audience: 'student',
      furnished: true, wifi: true, water: false, parking: false,
      verified: false, featured: false,
      ownerName: 'Tsion G.', ownerPhone: '+251 94 353 6262',
      description: 'A welcoming shared room close to several colleges, ideal for students. Study space, shared kitchen and a calm compound near campus.'
    }
  ].map((l) => ({
    id: nanoid(10),
    ownerId: null,
    ...l,
    photos: emptyPhotos(),
    createdAt: now - Math.floor(Math.random() * 1000 * 60 * 60 * 24 * 30),
    status: 'active'
  }));
}

async function run() {
  await store.initSchema();

  // Legacy admin account
  const adminExists = await store.findUserByCredential(ADMIN_EMAIL);
  if (!adminExists) {
    await store.createUser({
      id: nanoid(10),
      fullName: 'AlgaAle Admin',
      phone: null,
      email: ADMIN_EMAIL,
      passwordHash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
      role: 'admin',
      providerApplication: emptyProviderApp(),
      createdAt: Date.now()
    });
    console.log(`  Admin seeded -> ${ADMIN_EMAIL}`);
  }

  // Platform owner account
  const ownerExists = await store.findUserByCredential(OWNER_EMAIL);
  if (!ownerExists) {
    await store.createUser({
      id: nanoid(10),
      fullName: 'AlgaAle Owner',
      phone: OWNER_PHONE,
      email: OWNER_EMAIL,
      passwordHash: bcrypt.hashSync(OWNER_PASSWORD, 10),
      role: 'owner',
      providerApplication: emptyProviderApp(),
      createdAt: Date.now()
    });
    console.log(`  Owner seeded -> ${OWNER_EMAIL}`);
  }

  // Support team account — verifies payment screenshots and pays hosts out.
  const supportExists = await store.findUserByCredential(SUPPORT_EMAIL);
  if (!supportExists) {
    await store.createUser({
      id: nanoid(10),
      fullName: 'AlgaAle Support',
      phone: SUPPORT_PHONE,
      email: SUPPORT_EMAIL,
      passwordHash: bcrypt.hashSync(SUPPORT_PASSWORD, 10),
      role: 'support',
      providerApplication: emptyProviderApp(),
      createdAt: Date.now()
    });
    console.log(`  Support seeded -> ${SUPPORT_EMAIL}`);
  }

  // Force admin & owner passwords to the configured values on every boot,
  // so updating them above (or via env vars) updates the existing accounts too.
  const adminAcct = await store.findUserByCredential(ADMIN_EMAIL);
  if (adminAcct) await store.updateUserPassword(adminAcct.id, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  const ownerAcct = await store.findUserByCredential(OWNER_EMAIL);
  if (ownerAcct) await store.updateUserPassword(ownerAcct.id, bcrypt.hashSync(OWNER_PASSWORD, 10));
  const supportAcct = await store.findUserByCredential(SUPPORT_EMAIL);
  if (supportAcct) await store.updateUserPassword(supportAcct.id, bcrypt.hashSync(SUPPORT_PASSWORD, 10));

  // Placeholder deposit account so the payment page is never blank in dev.
  // Support must replace it with the real one at /support/bank-account before
  // taking money — the page flags it as a placeholder until they do.
  const accounts = await store.getBankAccounts();
  if (accounts.length === 0) {
    await store.createBankAccount({
      id: nanoid(10),
      bankName: process.env.BANK_NAME || 'Commercial Bank of Ethiopia',
      accountHolderName: process.env.BANK_ACCOUNT_NAME || 'AlgaAle (PLACEHOLDER — update me)',
      accountNumber: process.env.BANK_ACCOUNT_NUMBER || '1000000000000',
      branch: process.env.BANK_BRANCH || 'Bole, Addis Ababa',
      instructions: 'Transfer the exact amount, then upload a screenshot of the receipt.',
      isActive: true,
      createdAt: Date.now()
    });
    console.log('  Placeholder bank account seeded — update it at /support/bank-account');
  }

  // Sample listings
  const listings = await store.getListings();
  if (listings.length === 0) {
    const samples = sampleListings();
    for (const l of samples) await store.createListing(l);
    console.log(`  Seeded ${samples.length} sample listings.`);
  }

  console.log(`\n  Owner login   -> ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`  Owner phone   -> ${OWNER_PHONE}`);
  console.log(`  Support login -> ${SUPPORT_EMAIL} / ${SUPPORT_PASSWORD}\n`);
}

module.exports = { run, ADMIN_EMAIL, OWNER_EMAIL, SUPPORT_EMAIL };
