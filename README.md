# 🛏️ Alga

**Find affordable beds, rooms, and rentals across Addis Ababa in minutes.**

Alga is a marketplace for *affordable* housing in Addis Ababa — single beds, shared
rooms, student hostels, family spare rooms, studios, condos, guest houses and
pensions. It is built for the person moving to Addis for work, university,
business, interviews or medical treatment — not the tourist.

This repository is a runnable MVP: a public marketplace plus an **admin / host
dashboard** where you log in and list your beds.

---

## ✨ What's included

**Public site**
- Hero search + browse page
- Filters: area, type, rental term (daily / weekly / monthly), suitable-for
  (female / male / family / student), max price, amenities (furnished, WiFi,
  water, parking), and "verified only"
- Area chips: Bole, CMC, Megenagna, Piassa, Sarbet, Mexico, Kazanchis…
- Listing detail page with **photos grouped by bedroom / bathroom / outside /
  kitchen** (people hate surprises)
- ✅ Verified and ★ Featured badges — verified & featured listings rank higher
- Reviews on each listing
- "Request to book" — chat-first booking request, no phone numbers shared until
  the host accepts (reduces scams)

**Admin / host dashboard** (`/admin`)
- Log in as admin
- Create / edit / delete listings with all fields above
- Upload photos per category
- Toggle **Verified** and **Featured**, hide/show listings
- View and accept/decline incoming booking requests
- Dashboard stats

---

## 🚀 Run it

Requirements: **Node.js 18+** (works on 22).

```bash
cd alga
npm install
npm start
```

Then open:

- Public site → http://localhost:3000
- Admin login → http://localhost:3000/admin/login

### Default admin login

| Email           | Password   |
| --------------- | ---------- |
| `admin@alga.et` | `admin123` |

> Change these via a `.env` file (see `.env.example`). The admin account and a
> few sample listings are seeded automatically on first run.

---

## 🗂️ Project structure

```
alga/
├── server.js              # Express app + all routes
├── lib/
│   ├── db.js              # tiny JSON-file data store (no native deps)
│   ├── constants.js       # areas, types, periods, amenities
│   └── seed.js            # seeds admin + sample listings on first run
├── views/                 # EJS templates
│   ├── index.ejs          # browse / search
│   ├── listing.ejs        # listing detail + booking + reviews
│   ├── admin/             # login, dashboard, listings, form, bookings
│   └── partials/          # header / footer
├── public/
│   ├── css/styles.css     # all styling
│   └── uploads/           # uploaded listing photos
└── data/db.json           # created on first run
```

Data is stored in `data/db.json`. Delete that file to reset to a fresh seed.

---

## 💡 Revenue model (built into the roadmap)

The product is designed around marketplace economics rather than listing fees:

1. **Commission** on each successful booking (e.g. 5%)
2. **Featured listings** — pay to appear at the top
3. **Verification fee** — Alga team visits, verifies, uploads pro photos
4. **Professional photography**
5. **Landlord subscriptions** (unlimited listings + analytics)
6. **Ads** (internet, furniture, moving, banks, universities)
7. **Utility referrals** (internet install, cleaning, furniture, water tanks)

The `Verified` and `Featured` flags in the admin panel are the first hooks for
(2) and (3).

---

## 🛣️ Suggested next steps

- Real database (PostgreSQL) + ORM
- In-app chat between guest and host
- Map view per area
- Host self-signup (currently admin-managed for the launch phase, where you
  hire students to collect 500 listings in Bole / CMC / Megenagna / Piassa
  before opening it up)
- Payments + commission collection (Telebirr / Chapa)

---

Built as an MVP. Launch narrow (Addis only), get listings first, then expand.
