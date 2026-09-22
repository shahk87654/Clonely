# Clonely Pro

Clonely Pro is a website cloning, analyzing, and rebuilding workspace for turning authorized public websites into clean, editable projects.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the landing page. The app uses local JSON storage for development. Set `JWT_SECRET` before using it outside a local environment.

## Features
- AI-powered component extraction
- Multi-format project scaffold generation (React, Vue, Laravel, etc.)
- Deep asset extraction and CSS rewriting
- Reports for SEO, accessibility, performance, assets, routes, and technologies
- Starter, Pro, and Team plan restrictions
- Team workspace member management
- Legal pages at `/privacy`, `/terms`, and `/acceptable-use`

## Verification

```bash
npm test
npm run verify:endpoints
```

## UI snapshots

The `snapshots/` directory contains desktop and mobile captures of the landing page, legal pages, auth pages, and authenticated dashboard views:

- `landing.png`
- `privacy.png`, `terms.png`, `acceptable-use.png`
- `login.png`, `signup.png`
- `app-dashboard.png`, `app-reports.png`, `app-billing.png`, `app-settings.png`

All rights reserved.
