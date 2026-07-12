/** Shared domain constants used across views and routes. */

const AREAS = [
  'Bole',
  'CMC',
  'Megenagna',
  'Piassa',
  'Sarbet',
  'Mexico',
  'Kazanchis',
  'Gerji',
  'Summit',
  'Ayat'
];

const TYPES = [
  { value: 'bed', label: 'Single bed' },
  { value: 'shared_room', label: 'Shared room' },
  { value: 'hostel', label: 'Student hostel' },
  { value: 'spare_room', label: 'Family home spare room' },
  { value: 'studio', label: 'Studio apartment' },
  { value: 'condo', label: 'Condominium' },
  { value: 'guesthouse', label: 'Guest house' },
  { value: 'pension', label: 'Pension' },
  { value: 'apartment', label: 'Apartment' }
];

const PERIODS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
];

const AUDIENCES = [
  { value: 'any', label: 'Anyone' },
  { value: 'female', label: 'Female only' },
  { value: 'male', label: 'Male only' },
  { value: 'family', label: 'Family' },
  { value: 'student', label: 'Student' }
];

// Guests pay the room subtotal — nothing is added on top. AlgaAle earns from the
// commission it withholds when paying the host out, not from a guest-side fee.
const SERVICE_FEE_PERCENT = 0;

// Withheld from the guest's payment; the host is paid the remainder.
const COMMISSION_PERCENT = 10;

// Split a guest payment into what AlgaAle keeps and what the host is paid.
// commission + payout always equals amount exactly, so the books balance.
function paymentSplit(amount) {
  const total = Math.round(Number(amount) || 0);
  const commission = Math.round(total * COMMISSION_PERCENT / 100);
  return { total, commission, payout: total - commission };
}

// Lifecycle of a reservation payment (bank transfer + screenshot proof).
//   awaiting_payment    — booking made, guest hasn't sent proof yet
//   pending             — screenshot submitted, waiting on support
//   rejected            — support rejected the proof; guest can re-upload
//   confirmed_by_support— payment verified, reservation live for the host
//   payment_sent_to_hotel — support has transferred the host's payout
//   completed           — payout reconciled, nothing left to do
const PAYMENT_STATUSES = [
  'awaiting_payment', 'pending', 'rejected',
  'confirmed_by_support', 'payment_sent_to_hotel', 'completed'
];

// Guest-facing wording for each payment status.
const PAYMENT_LABELS = {
  awaiting_payment:     'Awaiting your payment',
  pending:              'Waiting for confirmation',
  rejected:             'Payment proof rejected',
  confirmed_by_support: 'Reservation confirmed',
  payment_sent_to_hotel:'Guest arrived — host paid',
  completed:            'Completed'
};

function paymentLabel(status) {
  return PAYMENT_LABELS[status] || status;
}

// Payments in these states mean the reservation is real: the host may see it,
// and it consumes inventory. Anything earlier is an unverified hold-less request.
const PAYMENT_CONFIRMED_STATUSES = ['confirmed_by_support', 'payment_sent_to_hotel', 'completed'];

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'telebirr',      label: 'Telebirr' },
  { value: 'cbe_birr',      label: 'CBE Birr' },
  { value: 'cash',          label: 'Cash' }
];

const PHOTO_CATEGORIES = ['bedroom', 'bathroom', 'outside', 'kitchen'];

const AMENITIES = [
  { key: 'furnished', label: 'Furnished' },
  { key: 'wifi', label: 'WiFi' },
  { key: 'water', label: 'Water available' },
  { key: 'parking', label: 'Parking' }
];

// Predefined bed options for the room-type wizard (Trip.com-style bed picker).
const BED_TYPES = [
  { value: 'single', label: 'Single bed' },
  { value: 'double', label: 'Double bed' },
  { value: 'queen',  label: 'Queen bed' },
  { value: 'king',   label: 'King bed' },
  { value: 'sofa',   label: 'Sofa bed' },
  { value: 'bunk',   label: 'Bunk bed' }
];

// [{type,qty}] -> "1 King bed + 1 Sofa bed"
function bedsLabel(beds) {
  if (!beds || !beds.length) return '';
  return beds
    .map((b) => b.qty + ' ' + (BED_TYPES.find((t) => t.value === b.type) || { label: b.type }).label + (b.qty > 1 ? 's' : ''))
    .join(' + ');
}

function typeLabel(value) {
  const t = TYPES.find((x) => x.value === value);
  return t ? t.label : value;
}

function periodLabel(value) {
  const p = PERIODS.find((x) => x.value === value);
  return p ? p.label : value;
}

function audienceLabel(value) {
  const a = AUDIENCES.find((x) => x.value === value);
  return a ? a.label : value;
}

module.exports = {
  AREAS,
  TYPES,
  PERIODS,
  AUDIENCES,
  PHOTO_CATEGORIES,
  AMENITIES,
  BED_TYPES,
  SERVICE_FEE_PERCENT,
  COMMISSION_PERCENT,
  PAYMENT_STATUSES,
  PAYMENT_LABELS,
  PAYMENT_CONFIRMED_STATUSES,
  PAYMENT_METHODS,
  paymentSplit,
  paymentLabel,
  typeLabel,
  periodLabel,
  audienceLabel,
  bedsLabel
};
