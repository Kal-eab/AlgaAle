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

const SERVICE_FEE_PERCENT = 12; // AlgaAle fee added on top of the subtotal

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
  typeLabel,
  periodLabel,
  audienceLabel,
  bedsLabel
};
