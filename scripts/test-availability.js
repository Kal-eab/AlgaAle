'use strict';
/**
 * Availability engine unit test — runs against the JSON store in a temp dir.
 *   node scripts/test-availability.js
 * Exits non-zero on failure. Proves: the overlap rule, half-open same-day
 * turnover, blocks consuming units, non-active statuses NOT consuming,
 * and SOLD_OUT enforcement in createBookingSafe.
 */
process.env.DATA_DIR = require('os').tmpdir() + '/algaale-avail-test-' + Date.now();
delete process.env.DATABASE_URL; // force JSON mode

const assert = require('assert');
const store = require('../lib/store');

let n = 0;
function check(name, actual, expected) {
  n++;
  assert.strictEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  console.log(`  ok ${n} — ${name}`);
}

(async () => {
  // Seed: one listing with a 2-unit room bucket, plus a whole-home listing
  await store.createListing({ id: 'L1', title: 'Test Hotel', type: 'guesthouse', area: 'Bole', price: 1000, period: 'daily', createdAt: Date.now() });
  await store.createListing({ id: 'L2', title: 'Whole Home', type: 'apartment', area: 'Bole', price: 2000, period: 'daily', createdAt: Date.now() });
  await store.createRoom({ id: 'R1', listingId: 'L1', name: 'Standard', capacity: 2, nightlyRate: 700, totalUnits: 2, createdAt: Date.now() });

  const B = (id, status, ci, co, numRooms, roomId) => ({
    id, listingId: 'L1', listingTitle: 'Test Hotel', name: 'G' + id, phone: '1',
    status, checkinDate: ci, checkoutDate: co, numRooms, roomId: roomId || 'R1',
    nights: 1, createdAt: Date.now()
  });

  // Empty bucket → both units free
  check('empty bucket', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-10', checkout: '2030-07-12' }), 2);

  // One confirmed booking Jul 10–12 (nights 10, 11) takes 1 unit
  await store.createBookingSafe(B('b1', 'confirmed', '2030-07-10', '2030-07-12', 1));
  check('one confirmed booking', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-10', checkout: '2030-07-12' }), 1);

  // Half-open: checkout day (Jul 12) is FREE for a new check-in
  check('same-day turnover', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-12', checkout: '2030-07-14' }), 2);

  // Overlap rule: a stay Jul 11–13 overlaps night Jul 11 → only 1 left
  check('overlap rule', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-11', checkout: '2030-07-13' }), 1);

  // pending / cancelled / checked_out do NOT consume
  await store.createBookingSafe(B('b2', 'pending', '2030-07-10', '2030-07-12', 1));
  await store.createBookingSafe(B('b3', 'cancelled', '2030-07-10', '2030-07-12', 1));
  await store.createBookingSafe(B('b4', 'checked_out', '2030-07-10', '2030-07-12', 1));
  check('inactive statuses ignored', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-10', checkout: '2030-07-12' }), 1);

  // checked_in DOES consume — second unit gone
  await store.createBookingSafe(B('b5', 'checked_in', '2030-07-11', '2030-07-13', 1));
  check('checked_in consumes', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-11', checkout: '2030-07-12' }), 0);

  // SOLD_OUT: a third confirmed booking over the full nights must throw
  let threw = null;
  try { await store.createBookingSafe(B('b6', 'confirmed', '2030-07-11', '2030-07-12', 1)); }
  catch (e) { threw = e.code; }
  check('createBookingSafe blocks overbooking', threw, 'SOLD_OUT');

  // Cancelling b1 releases its unit immediately (availability is computed).
  // Range Jul 10–12: night Jul 10 now has 0 used, night Jul 11 has b5 → peak 1.
  await store.updateBookingStatus('b1', 'cancelled');
  check('cancellation releases inventory', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-10', checkout: '2030-07-12' }), 1);

  // Range Jul 10–11 covers night Jul 10 only; b5 (Jul 11–13) doesn't touch it.
  check('night before checked_in stay is free', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-07-10', checkout: '2030-07-11' }), 2);

  // Blocks consume exactly like bookings
  await store.createBlock({ id: 'blk1', listingId: 'L1', roomId: 'R1', startDate: '2030-08-01', endDate: '2030-08-03', unitsBlocked: 2, reason: 'maintenance', createdAt: Date.now() });
  check('block consumes units', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-08-01', checkout: '2030-08-02' }), 0);
  check('block end date free (half-open)', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-08-03', checkout: '2030-08-04' }), 2);

  // Whole-home listing (no rooms rows): single implicit unit
  check('whole-home starts free', await store.getAvailability({ listingId: 'L2', roomId: null, checkin: '2030-07-10', checkout: '2030-07-12' }), 1);
  await store.createBookingSafe({ id: 'h1', listingId: 'L2', name: 'H', phone: '1', status: 'confirmed', checkinDate: '2030-07-10', checkoutDate: '2030-07-12', numRooms: 1, roomId: null, nights: 2, createdAt: Date.now() });
  check('whole-home books out', await store.getAvailability({ listingId: 'L2', roomId: null, checkin: '2030-07-11', checkout: '2030-07-13' }), 0);
  check('isListingBookable false when full', await store.isListingBookable('L2', '2030-07-10', '2030-07-12'), false);
  check('isListingBookable true elsewhere', await store.isListingBookable('L2', '2030-08-10', '2030-08-12'), true);

  // num_rooms: booking 2 units at once fills the bucket
  await store.createBookingSafe(B('b7', 'confirmed', '2030-09-01', '2030-09-03', 2));
  check('multi-unit booking fills bucket', await store.getAvailability({ listingId: 'L1', roomId: 'R1', checkin: '2030-09-01', checkout: '2030-09-02' }), 0);

  console.log(`\nAll ${n} availability checks passed.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
