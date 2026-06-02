# Project Folder Structure

```
Dacs Web/
├── index.html                          # Public marketing website
├── admin.html                          # Internal admin dashboard
├── firestore.rules                     # Firebase Firestore security rules
│
├── assets/                             # Static assets
│   ├── images/
│   │   ├── DACS-TRANSPARENT.png        # Company logo
│   │   ├── background.jpg              # Website background image
│   │   └── portfolio/                  # Project portfolio images
│   │       ├── DaCs_AIRBNB PROFILE.pdf (1).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (2).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (3).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (4).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (5).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (6).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (7).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (8).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (9).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (10).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (11).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (12).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (13).png
│   │       ├── DaCs_AIRBNB PROFILE.pdf (14).png
│   │       ├── 7.png
│   │       ├── 9.png
│   │       ├── 11.png
│   │       ├── 13.png
│   │       ├── 14.png
│   │       ├── 16.png
│   │       └── 18.png
│   ├── screenshots/                    # Testing/reference screenshots
│   │   └── 2026-02-10T*.png            # (10 archived screenshots)
│   └── video/
│       └── Outview of Deluxe Junction.mp4
│
├── css/                                # Stylesheets
│   ├── styles.css                      # Public website styles
│   ├── admin.css                       # Admin dashboard base styles
│   ├── expenses-module.css             # Expenses tracker styles
│   ├── expenses-mvp.css                # Expenses MVP design overrides
│   ├── overhead-module.css             # Overhead module styles
│   ├── construction-module.css         # Construction module base styles
│   └── construction-module-items.css   # Construction multi-item styles
│
├── js/                                 # JavaScript files
│   ├── firebase-config.js              # Firebase initialization (shared)
│   ├── script.js                       # Public website scripts
│   ├── admin.js                        # Admin dashboard core logic
│   ├── expenses-module.js              # Budget & expenses tracker module
│   ├── overhead-module.js              # Overhead expenses module
│   └── construction-module.js          # Construction management module
│
└── docs/                               # Documentation
    ├── EXPENSES_README.md              # Expenses module documentation
    ├── OVERHEAD_FIREBASE_SETUP.md      # Overhead Firebase setup guide
    └── STAFF_ACCOUNT_SETUP.md          # Staff account setup guide
```

## Overview

| Folder | Purpose |
|--------|---------|
| `assets/` | All static media — images, video, screenshots |
| `assets/images/` | Logo and background used across the site |
| `assets/images/portfolio/` | Project portfolio images shown on public site |
| `assets/screenshots/` | Archived testing screenshots (not used in site) |
| `assets/video/` | Project reference video files |
| `css/` | All stylesheets, one per page/module |
| `js/` | All JavaScript, one per page/module |
| `docs/` | Setup guides and module documentation |

## Entry Points

| File | URL |
|------|-----|
| `index.html` | Public website (`/`) |
| `admin.html` | Admin dashboard (`/admin.html`) |
