# SPMM E2E Testing Guide

End-to-end tests for the SPMM CMS, built with [Playwright](https://playwright.dev/).

---

## Prerequisites

| Requirement | Version | Purpose |
|---|---|---|
| Node.js | >= 18 | Runtime |
| npm | >= 9 | Package manager |
| Backend (Spring Boot) | Running on `:1235` | API for login, data, workflows |
| Frontend CMS (Vite) | Running on `:3000` | The app under test |
| PostgreSQL | Running, seeded with test data | Test accounts must exist |

Both backend and frontend must be running before you start the tests.

```bash
# Terminal 1 — Backend
cd apps/syamil/spmm-be
./mvnw -pl apps spring-boot:run

# Terminal 2 — Frontend
cd apps/syamil/spmm-cms
cp .env.example .env          # set VITE_API_BASE_URL=http://localhost:1235/api
npm install --legacy-peer-deps
npm run dev                    # or: npm run preview (uses port 3000)
```

---

## Quick Start

```bash
cd apps/syamil/e2e

# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npx playwright install chromium

# 3. Configure test credentials
cp .env.test.example .env.test
# Edit .env.test — fill in credentials for all 10 roles (see below)

# 4. Create auth state files for all roles (run once)
npm run test:setup

# 5. Run the full test suite
npm test
```

---

## Environment Configuration

### `.env.test`

Copy from `.env.test.example` and fill in real credentials:

```env
# URLs
BASE_URL=http://localhost:3000           # Frontend (Vite dev or preview)
API_BASE_URL=http://localhost:1235/api   # Backend API
COOKIE_DOMAIN=localhost                  # Cookie domain for auth injection

# Test accounts — one per role (10 total)
TEST_ADMIN_EMAIL=admin@example.com
TEST_ADMIN_PASSWORD=SecurePassword123!
TEST_DM_EMAIL=dm@example.com
TEST_DM_PASSWORD=SecurePassword123!
# ... (see .env.test.example for all 10 roles)
```

### Test accounts

Each of the 10 system roles needs a dedicated test account in the database:

| Role Key | Role Name | What it tests |
|---|---|---|
| `admin` | Admin | User management, Lembaga & Dewan Masyayikh pages |
| `dm` | Dewan Masyayikh | Recommendation workflow, data input |
| `sk` | Sekretariat | All workflows, SPMI, Help desk |
| `ta` | Tenaga Ahli | SPME Mahad Aly + SPME DIKDASMEN |
| `mm` | Majelis Masyayikh | E-sign bulk + SPME |
| `asdk` | Asessor Dikdasmen | SPME DIKDASMEN only |
| `mha` | Ma'had Aly | SPME Mahad Aly only |
| `dk` | DIKDASMEN | SPME DIKDASMEN only |
| `tas` | Tenaga Asisten | SPME Mahad Aly only |
| `asma` | Assessor Ma'had Aly | SPME Mahad Aly only |

If a role's credentials are missing from `.env.test`, setup for that role is skipped and tests requiring it are automatically skipped at runtime.

---

## Running Tests

### NPM Scripts

```bash
npm test                # Full suite (all projects, all phases)
npm run test:headed     # With visible browser window
npm run test:ui         # Playwright interactive UI mode
npm run test:debug      # Debug mode (step through tests)
npm run test:report     # Open the HTML report from last run
```

### Run by Role / Project

```bash
npm run test:setup      # Phase 1: Create auth state files only
npm run test:admin      # Admin tests (user management, lembaga, lembaga-dm)
npm run test:dm         # Dewan Masyayikh tests (recommendation, file upload)
npm run test:sk         # Sekretariat tests (e-sign, SPMI, help desk)
```

### Run Specific Projects

```bash
npx playwright test --project=access-control
npx playwright test --project=multi-role-login
npx playwright test --project=specialist-tests
```

### Run a Single Test File

```bash
npx playwright test tests/admin/lembaga-dewan.spec.ts
npx playwright test tests/auth/login.spec.ts
npx playwright test tests/workflow/permohonan-rekomendasi.spec.ts
```

### Run by Test Name (grep)

```bash
npx playwright test -g "search triggers API"
npx playwright test -g "pagination"
npx playwright test -g "Lembaga-DM"
```

### Debugging a Failing Test

```bash
# Step-by-step debugger with Inspector
npx playwright test tests/admin/lembaga-dewan.spec.ts --debug

# Show browser + slow motion (500ms between actions)
npx playwright test tests/admin/lembaga-dewan.spec.ts --headed --slow-mo=500

# Generate trace on every test (viewable with trace viewer)
npx playwright test --trace on
npx playwright show-trace test-results/<test-folder>/trace.zip
```

---

## Test Execution Phases

Playwright runs tests in a specific order defined in `playwright.config.ts`:

```
Phase 1: global-setup          → Creates auth/<role>-auth.json for all 10 roles (API login, no browser)
Phase 2: unauthenticated       → Login, register, reset-password (no auth state)
Phase 3: admin-tests           → User management, Lembaga, Lembaga-DM, dashboard
Phase 4: dm-tests              → Recommendation workflow, file upload
Phase 5: sk-tests              → E-sign, SPMI, help desk
Phase 6: specialist-tests      → SPME Mahad Aly, SPME DIKDASMEN, E-sign bulk
Phase 7: access-control        → Multi-role access assertions
Phase 8: multi-role-login      → Login as each role, verify redirect
Phase 9: global-teardown       → Cleans up test-created data (users, processes)
```

Each phase depends on `global-setup` completing first. Within a phase, tests run in parallel (2 workers locally, 4 in CI).

---

## Project Structure

```
e2e/
├── .env.test                  # Credentials (gitignored — copy from .env.test.example)
├── .env.test.example          # Template with all 10 role placeholders
├── playwright.config.ts       # Projects, phases, timeouts, reporters
├── package.json               # Scripts and dependencies
├── tsconfig.json              # TypeScript config
│
├── auth/                      # Generated auth state files (gitignored)
│   ├── admin-auth.json        # Created by global-setup
│   ├── dm-auth.json
│   └── ...                    # One file per role
│
├── setup/
│   ├── global.setup.ts        # Phase 1: API login → cookie injection → save state
│   └── global.teardown.ts     # Phase 9: Delete test-created users/processes
│
├── helpers/                   # Reusable utilities
│   ├── auth.helpers.ts        # Cookie builder for ProtectedRoute compatibility
│   ├── login.helpers.ts       # loginAs(role), hasAuthState(role), getStorageStatePath(role)
│   ├── table.helpers.ts       # Table interaction: search, pagination, sort, filters, modals
│   ├── api.client.ts          # Axios wrapper for direct API calls in tests
│   ├── wait.helpers.ts        # Generic wait utilities
│   ├── form.helpers.ts        # Form interaction utilities
│   └── file.helpers.ts        # File upload utilities
│
├── pages/                     # Page Object Models (POM)
│   ├── LoginPage.ts
│   ├── DashboardPage.ts
│   ├── UserManagementPage.ts
│   ├── AddUserPage.ts
│   ├── RecommendationPage.ts
│   ├── SubmissionPage.ts
│   ├── RegisterPage.ts
│   └── ForgotPasswordPage.ts
│
├── test-data/
│   ├── users.ts               # All 10 role definitions, TestUser type, createNewUserPayload()
│   ├── roles.ts               # Role constants
│   └── workflow.ts            # Workflow test data
│
├── tests/                     # Test specs organized by feature
│   ├── auth/
│   │   ├── login.spec.ts
│   │   ├── register.spec.ts
│   │   ├── reset-password.spec.ts
│   │   └── multi-role-login.spec.ts
│   ├── admin/
│   │   ├── lembaga-dewan.spec.ts      # Lembaga & Dewan Masyayikh regression tests
│   │   └── user-management.spec.ts
│   ├── dashboard/
│   │   └── dashboard.spec.ts
│   ├── workflow/
│   │   ├── workflow-base.ts           # Shared workflow test utilities
│   │   ├── permohonan-rekomendasi.spec.ts
│   │   ├── helpdesk.spec.ts
│   │   ├── spmi.spec.ts
│   │   ├── spme-mahadaly.spec.ts
│   │   ├── spme-dikdasmen.spec.ts
│   │   └── esign-bulk.spec.ts
│   ├── access-control/
│   │   └── role-access.spec.ts
│   └── file/
│       └── file-upload-download.spec.ts
│
├── test-results/              # Generated (gitignored)
│   ├── screenshots/           # Full-page PNGs from screenshot() calls
│   └── cleanup-registry.json  # IDs of test-created data, read by teardown
│
└── playwright-report/         # HTML report (gitignored, view with npm run test:report)
```

---

## Key Helpers Reference

### `table.helpers.ts` — Table Interaction

The workhorse for Lembaga, Lembaga-DM, and any future table-based modules:

```typescript
// Wait for data to load
await waitForLembagaApi(page, '/lembaga');    // or '/lembaga/dm'
await waitForTableReady(page);

// Read table state
const rowCount = await getTableRowCount(page);
const firstRow = await getFirstRowText(page);
const headers  = await getColumnHeaders(page);
const values   = await getColumnValues(page, 2);  // column index

// Search (400ms debounce)
await applySearchFilter(page, 'Al Azhar', '/lembaga');
await clearSearchFilter(page, '/lembaga');

// Filter dropdown
await selectFilterOption(page, 'Semua Status', 'Aktif');

// Pagination
await clickPaginationNext(page);
await clickPaginationPrev(page);
await clickPageNumber(page, 5);
const active   = await getActivePage(page);      // 1-based
const info     = await getDataInfoText(page);     // "Menampilkan 1–10 dari 349988 data"
const prevOff  = await isPrevPageDisabled(page);  // true on page 1
const nextOff  = await isNextPageDisabled(page);  // true on last page

// Sort
await clickColumnSort(page, 'NSPP');

// Row interaction
await clickTableRow(page, 0);
const modal = await waitForModal(page);

// Column assertion
const { found, missing } = await assertColumnsExist(page, ['NSPP', 'Email']);
```

### `login.helpers.ts` — Auth State

```typescript
import { loginAs, loginAsPage, hasAuthState, getStorageStatePath } from '../helpers/login.helpers';

// Skip if role isn't configured
if (!hasAuthState('admin')) test.skip();

// Get pre-built auth state path (for storageState option)
const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });

// Programmatic login — returns authenticated context
const ctx = await loginAs('dm', browser);
const page = await ctx.newPage();

// Convenience — returns both page and context
const { page, context } = await loginAsPage('sk', browser);
```

---

## Writing New Tests

### Template for a new table-based module

```typescript
import { test, expect } from '@playwright/test';
import {
  waitForTableReady,
  waitForLembagaApi,
  getTableRowCount,
  applySearchFilter,
  clickPaginationNext,
  getActivePage,
  getDataInfoText,
  assertColumnsExist,
} from '../../helpers/table.helpers';
import { hasAuthState, getStorageStatePath } from '../../helpers/login.helpers';

test.describe('My Module — Table Tests', () => {
  test.beforeEach(async ({}) => {
    if (!hasAuthState('admin')) test.skip();
  });

  test('page loads with data', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/my-module');
      // wait for your API endpoint
      await page.waitForResponse(r => r.url().includes('/my-endpoint') && r.status() < 400);
      await waitForTableReady(page);

      const rowCount = await getTableRowCount(page);
      expect(rowCount).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });
});
```

### Conventions

1. **Always use `try/finally/ctx.close()`** — prevents browser context leaks.
2. **Screenshot at key steps** — `await screenshot(page, 'step-name')` saves to `test-results/screenshots/`.
3. **Wait for API, then wait for table** — always call `waitForLembagaApi` (or your own response waiter) before `waitForTableReady`.
4. **Use `hasAuthState()` in beforeEach** — gracefully skips tests when a role isn't configured.
5. **Don't hardcode waits** — use `waitForResponse`, `waitForSelector`, or `waitForFunction` instead of `waitForTimeout`.

---

## Lembaga & Dewan Masyayikh Test Coverage

The `tests/admin/lembaga-dewan.spec.ts` file covers 25 tests across both modules:

### Section A — Lembaga (`/app/lembaga`)

| Test | What it verifies |
|---|---|
| Table loads with data rows | API call succeeds, rows render |
| Expected columns present | NSPP, Nama Lembaga, Status, Jenis Lembaga |
| Correct row count (max 10) | Default page size respected |
| Search triggers API with `?search=` | Debounced input fires API, URL contains search param |
| Search shows loading spinner | Loader2 icon visible during debounce window |
| Status filter dropdown visible | "Semua Status" rendered |
| Jenis Lembaga filter visible | "Semua Jenis Lembaga" rendered |
| Status "Aktif" sends `?status=1` | Select dropdown → API query param verified |
| Page 1 active on load | `aria-current="page"` on button "1" |
| Prev button disabled on page 1 | `disabled` attribute present |
| Next button loads page 2 | First row changes, active page becomes 2 |
| Click page number 3 | Direct jump, first row changes, active page = 3 |
| Data info text matches pattern | `"Menampilkan X–Y dari Z data"` regex |
| Filter resets page to 1 | Navigate to page 2 → change filter → page resets |
| Sort chevron icons visible | 4+ SVGs in thead |
| Sort click changes icon | Click NSPP header → directional chevron |
| Row click navigates to detail | URL changes to `/lembaga/detail-lembaga` |

### Section B — Lembaga DM (`/app/lembaga-dm`)

| Test | What it verifies |
|---|---|
| Table loads with data rows | API call to `/lembaga/dm` succeeds |
| All 5 columns present | NSPP, Nama Pondok Pesantren, Status, Email, Status Akun |
| Correct row count (max 10) | Default page size respected |
| Search triggers API with `?search=` | Debounced input fires `/lembaga/dm?search=` |
| Status filter visible + sends `?status=1` | Dropdown works, API param verified |
| Page 1 active, prev disabled | Initial pagination state correct |
| Next button loads page 2 | Server-side pagination works |
| Data info text present | `"Menampilkan X–Y dari Z data"` |
| Row click navigates to DM detail | URL changes to `/lembaga-dm/detail/:id` |
| Surat Keterangan shows toast | Eye icon click → no file picker, toast "belum tersedia" appears |

### Section C — Cross-module

| Test | What it verifies |
|---|---|
| Navigate between both pages | Both render data rows |
| No console errors on load | No uncaught exceptions |
| Non-admin role blocked | DM role cannot see Lembaga table |

---

## Viewing Reports

After a test run:

```bash
# Open the HTML report in your browser
npm run test:report

# Screenshots from explicit screenshot() calls
ls test-results/screenshots/

# Playwright traces (on failure or with --trace on)
npx playwright show-trace test-results/<test-folder>/trace.zip
```

The HTML report includes:
- Pass/fail status per test
- Duration and retries
- Screenshots on failure
- Video recordings on failure (if `video: 'retain-on-failure'` is set)
- Trace files for step-by-step replay

---

## CI Integration

The config auto-detects CI via `process.env.CI`:

| Setting | Local | CI |
|---|---|---|
| Retries | 0 (fail fast) | 2 (flaky retry) |
| Workers | 2 | 4 (parallel) |
| `forbidOnly` | false | true (prevents `.only` from shipping) |
| Reporter | `html` + `list` | `html` + `list` + `github` (annotations) |

To run in CI:

```bash
CI=true npm test
```

---

## Troubleshooting

### "API_BASE_URL is not set"
Copy `.env.test.example` to `.env.test` and fill in the values.

### Auth state creation fails
- Verify the backend is running on `:1235`
- Verify the test accounts exist in the database
- Check credentials in `.env.test` match the database

### Tests time out waiting for table
- Ensure the frontend is running on the `BASE_URL` port (default `:3000`)
- Ensure the frontend's `.env` has `VITE_API_BASE_URL=http://localhost:1235/api`
- Check the backend isn't returning errors (check backend console logs)

### "Tidak ada data" shown but data exists
- Backend needs `countQuery` in native `@Query` annotations (see `LembagasRepository.java`)
- Backend `Meta` class needs `@JsonProperty("total_elements")` (see `LembagaListResponse.java`)

### Playwright browsers not installed
```bash
npx playwright install chromium
```

### Stale auth state
Delete the `auth/` folder and re-run setup:
```bash
rm -rf auth/
npm run test:setup
```
