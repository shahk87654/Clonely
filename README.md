# Clonely Pro

Clonely Pro is a full-stack website analysis and rebuilding workspace. It fetches authorized public websites, maps their structure, collects assets, generates editable projects, and exports deployable packages.

> Only analyze and rebuild websites that you own or have permission to copy. Review generated output and third-party licenses before deployment.

## What It Does

1. Authenticate users into private workspaces.
2. Analyze a public URL for technologies, routes, components, assets, SEO, accessibility, and performance signals.
3. Crawl related pages and collect permitted assets.
4. Rebuild the source as a mirror, AI-cleaned project, AI upgrade, or framework migration.
5. Generate projects for Static HTML, PHP, Laravel, WordPress, Next.js, Nuxt, React, Vue, ASP.NET, Express, and Node.
6. Store project files, reports, metadata, and usage in the local development workspace.
7. Edit generated files, chat about a project, and export ZIP, Git, Docker, Plesk, cPanel, or FTP packages when allowed by the plan.

## Product Areas

### Landing and marketing

- Product-led landing page at `/`.
- Pricing cards hydrated from the backend plan catalog.
- Signup links preserve the selected plan with `?plan=free`, `?plan=pro`, or `?plan=team`.
- Legal footer links for Privacy, Terms, and Acceptable Use.

### Workspace

- Dashboard with project totals, usage, recent projects, and quick actions.
- New Clone wizard with five steps: URL, mode, output format, export format, and review.
- Projects table with search and filters.
- File Editor for generated project files.
- Reports with overall quality, SEO, accessibility, performance, technology, asset, route, and project metrics.
- AI Chat with project-aware rule-based suggestions.
- Billing with current usage, plan activation, and plan features.
- Settings with profile details, security information, and Team member management.

### Legal pages

- `/privacy`
- `/terms`
- `/acceptable-use`

These pages are intentionally concise development-stage policies and should be reviewed by the service owner or legal counsel before production use.

## Plan Entitlements

| Feature | Starter | Pro | Team |
| --- | --- | --- | --- |
| Price | $0 | $29/month | $99/month |
| Clones | 3/month | 50/month | 500/month |
| URL analyses | 15/month | 200/month | 2,000/month |
| Output formats | Static HTML | All 11 | All 11 |
| AI rebuild and upgrade | No | Yes | Yes |
| Framework migration | No | Yes | Yes |
| Export formats | ZIP only | All configured formats | All configured formats |
| Team seats | 1 | 1 | 10 |
| Shared workspace | No | No | Yes |
| Usage analytics | No | Priority processing | Yes |

Billing currently uses a demo provider. Plan activation updates the workspace immediately and does not charge a card. Connect a real payment provider before production billing.

## Local Setup

### Requirements

- Node.js 18 or newer
- npm
- Network access for crawling target websites and loading the Google Fonts used by the frontend

### Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

For a non-watch process:

```bash
npm start
```

To use another port in PowerShell:

```powershell
$env:PORT = "3100"
npm run dev
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Express HTTP port |
| `JWT_SECRET` | Development fallback | Signs authentication tokens; set a strong value outside local development |
| `NODE_ENV` | Unset | Enables secure auth cookies when set to `production` |
| `BASE_URL` | Used by endpoint verification | Base URL for API verification |
| `TARGET_URL` | Verification server URL | Target URL analyzed by endpoint verification |

Do not commit `.env` files, credentials, JWT secrets, local users, generated exports, or runtime storage.

## Architecture

```text
backend/server.js              Express server and frontend routes
backend/api/routes.js          Authenticated API, analysis, rebuild, reports, exports, chat
backend/auth/index.js          Users, JWT sessions, plans, usage, entitlements, Team seats
backend/storage/index.js       Local storage paths and project access helpers
backend/analyzer.js             HTML, technology, SEO, accessibility, and performance analysis
backend/crawler.js              Website crawling and page discovery
backend/asset-collector.js     Asset download and collection
backend/project-generator.js   Project generation orchestration
backend/generators/             Static HTML, PHP, Next.js, and scaffold generators
backend/exporters/              Export preset writers
backend/reporter.js             Report and Markdown report generation
engine/                         Accessibility, SEO, optimizer, extraction, and generation modules
frontend/landing.html           Public landing page
frontend/index.html             Authenticated single-page workspace shell
frontend/app.js                 Workspace controller and API client
frontend/auth-pages.js          Login and signup controller
frontend/landing.js             Public plan catalog hydration
frontend/style.css              Shared application, marketing, auth, and legal styles
tests/                          Analyzer and generator regression tests
scripts/verify-endpoints.js     End-to-end API verification script
snapshots/                      Desktop and mobile UI captures
```

## HTTP Routes

### Public routes

| Route | Page |
| --- | --- |
| `/` | Landing page |
| `/pricing` | Landing page pricing section |
| `/login` | Login |
| `/signup` | Signup |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/acceptable-use` | Acceptable use policy |
| `/app` | Authenticated workspace shell |

### Authentication and account API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/plans` | Public plan catalog |
| `POST` | `/api/auth/signup` | Create account and optional selected plan |
| `POST` | `/api/auth/login` | Authenticate account |
| `POST` | `/api/auth/logout` | Clear auth cookie |
| `GET` | `/api/auth/me` | Read current user and entitlements |
| `PATCH` | `/api/account` | Update name and company |
| `POST` | `/api/billing/subscribe` | Activate a plan through demo billing |

### Team API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/team/members` | List Team members; Team plan required |
| `POST` | `/api/team/members` | Add an invited member within the seat limit |
| `DELETE` | `/api/team/members/:memberId` | Remove a Team member |

### Analysis and project API

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/analyze` | Analyze a URL and increment analysis usage |
| `POST` | `/api/rebuild` | Crawl, collect, rebuild, report, and export a project |
| `POST` | `/api/migrate` | Run a framework migration rebuild |
| `GET` | `/api/projects` | List projects owned by the current user |
| `GET` | `/api/project/:projectId` | Read project metadata and report |
| `GET` | `/api/project/:projectId/files` | List generated files |
| `GET` | `/api/project/:projectId/file` | Read one generated file |
| `POST` | `/api/project/:projectId/file` | Save one generated file |
| `GET` | `/api/project/:projectId/inspector` | Read project inspection data |
| `GET` | `/api/report/:projectId` | Read a generated report |
| `POST` | `/api/export` | Create an export package |
| `GET` | `/api/download/:zipName` | Download an authorized ZIP |
| `POST` | `/api/chat` | Send project-aware chat request |

All workspace APIs require a valid Bearer token or auth cookie. Project access is checked against the owning user. Usage and plan gates are enforced server-side; UI locks are only a convenience layer.

## Storage

Development data is stored locally:

```text
storage/users.json          Local accounts; ignored by Git
storage/projects/           Generated project files; ignored by Git
storage/reports/            Report JSON; ignored by Git
storage/exports/             Export copies; ignored by Git
storage/cache/               Temporary export and crawl data; ignored by Git
backend/output/              Legacy/generated report metadata
output/                      Generated ZIP output; ignored by Git
```

The application creates required directories on startup. Delete local storage only when you intentionally want to remove development accounts and generated projects.

## Security and Production Notes

- Replace the development JWT fallback with a strong `JWT_SECRET`.
- Run behind HTTPS so production auth cookies can use `Secure`.
- Add rate limiting, CSRF protection, request auditing, and production database storage before launch.
- Replace demo billing with a real payment provider and webhook-driven subscription state.
- Add an email provider for Team invitations; current invitations are stored with `invited` status only.
- Validate target URL ownership and crawler policy for your use case.
- Review downloaded assets, generated code, third-party licenses, and robots/terms restrictions.
- Do not expose local storage directories through a production static server.

## Verification

Run the focused test suites:

```bash
npm test
npm run test:analyzer
npm run test:generator
```

Run the end-to-end API verification against a running server:

```bash
npm run dev
npm run verify:endpoints
```

The endpoint verifier signs up a temporary user, activates Pro, checks projects and reports, runs analysis and rebuild, verifies files and exports, downloads the ZIP, tests chat, and exercises migration.

## UI Snapshots

The `snapshots/` directory contains desktop (`1440x1000`) and mobile (`390x844`) captures. The gallery uses compact previews so the README stays readable; select any preview to open the full-size image.

<details open>
<summary><strong>Landing</strong></summary>
<br />

<table>
	<tr>
		<th>Desktop</th>
		<th>Mobile</th>
	</tr>
	<tr>
		<td><a href="snapshots/desktop/landing.png"><img src="snapshots/desktop/landing.png" alt="Landing desktop snapshot" width="420" /></a></td>
		<td><a href="snapshots/mobile/landing.png"><img src="snapshots/mobile/landing.png" alt="Landing mobile snapshot" width="180" /></a></td>
	</tr>
</table>
</details>

<details>
<summary><strong>Auth and legal pages</strong></summary>
<br />

| Page | Desktop | Mobile |
| --- | --- | --- |
| Login | [<img src="snapshots/desktop/login.png" alt="Login desktop" width="260" />](snapshots/desktop/login.png) | [<img src="snapshots/mobile/login.png" alt="Login mobile" width="120" />](snapshots/mobile/login.png) |
| Signup | [<img src="snapshots/desktop/signup.png" alt="Signup desktop" width="260" />](snapshots/desktop/signup.png) | [<img src="snapshots/mobile/signup.png" alt="Signup mobile" width="120" />](snapshots/mobile/signup.png) |
| Privacy | [<img src="snapshots/desktop/privacy.png" alt="Privacy desktop" width="260" />](snapshots/desktop/privacy.png) | [<img src="snapshots/mobile/privacy.png" alt="Privacy mobile" width="120" />](snapshots/mobile/privacy.png) |
| Terms | [<img src="snapshots/desktop/terms.png" alt="Terms desktop" width="260" />](snapshots/desktop/terms.png) | [<img src="snapshots/mobile/terms.png" alt="Terms mobile" width="120" />](snapshots/mobile/terms.png) |
| Acceptable Use | [<img src="snapshots/desktop/acceptable-use.png" alt="Acceptable Use desktop" width="260" />](snapshots/desktop/acceptable-use.png) | [<img src="snapshots/mobile/acceptable-use.png" alt="Acceptable Use mobile" width="120" />](snapshots/mobile/acceptable-use.png) |
</details>

<details>
<summary><strong>Workspace views</strong></summary>
<br />

| View | Desktop | Mobile |
| --- | --- | --- |
| Dashboard | [<img src="snapshots/desktop/app-dashboard.png" alt="Dashboard desktop" width="260" />](snapshots/desktop/app-dashboard.png) | [<img src="snapshots/mobile/app-dashboard.png" alt="Dashboard mobile" width="120" />](snapshots/mobile/app-dashboard.png) |
| Reports | [<img src="snapshots/desktop/app-reports.png" alt="Reports desktop" width="260" />](snapshots/desktop/app-reports.png) | [<img src="snapshots/mobile/app-reports.png" alt="Reports mobile" width="120" />](snapshots/mobile/app-reports.png) |
| Billing | [<img src="snapshots/desktop/app-billing.png" alt="Billing desktop" width="260" />](snapshots/desktop/app-billing.png) | [<img src="snapshots/mobile/app-billing.png" alt="Billing mobile" width="120" />](snapshots/mobile/app-billing.png) |
| Settings | [<img src="snapshots/desktop/app-settings.png" alt="Settings desktop" width="260" />](snapshots/desktop/app-settings.png) | [<img src="snapshots/mobile/app-settings.png" alt="Settings mobile" width="120" />](snapshots/mobile/app-settings.png) |
</details>

## License

This project is proprietary. All rights reserved.
