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
  SERVICE_FEE_PERCENT,
  typeLabel,
  periodLabel,
  audienceLabel
};
