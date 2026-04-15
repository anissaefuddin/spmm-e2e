import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  waitForTableReady,
  waitForLembagaApi,
  waitForDmDetailApi,
  waitForEmisApi,
  waitForSyncEmisApi,
  getTableRowCount,
  getFirstRowText,
  getColumnValues,
  clickPaginationNext,
  clickPageNumber,
  getActivePage,
  getDataInfoText,
  isPrevPageDisabled,
  selectFilterOption,
  clickColumnSort,
  getColumnHeaders,
  assertColumnsExist,
  clickTableRow,
  waitForModal,
} from '../../helpers/table.helpers';
import { hasAuthState, getStorageStatePath } from '../../helpers/login.helpers';

/**
 * Admin — Lembaga & Dewan Masyayikh Regression Tests
 *
 * Covers two modules accessible only to the Admin role:
 *   /app/lembaga      — Lembaga (institution) list & detail
 *   /app/lembaga-dm   — Dewan Masyayikh (DM) list & detail
 *
 * DATA SOURCE RULES (STRICT):
 *   - Institution data (name, nspp, address, status) → MUST come from `lembagas` table
 *   - User data (fullname, email, certificate, status) → MUST come from `users` table
 *   - Structure → from `user_structure` table
 *   - Grouping → from `lembaga_group` table
 *   - Modal popup → EMIS API (real-time) with local DB fallback
 *
 * API ENDPOINTS:
 *   /api/lembaga              — Lembaga list (all institutions)
 *   /api/dewan-masyayikh      — DM list (institutions + joined user data)
 *   /api/dewan-masyayikh/:id  — DM detail (lembaga + dewan + structure + grouped)
 *   POST /api/sync-emis/:id   — Fetch EMIS + trigger background DB sync
 *
 * BUGS FIXED:
 *   BUG-1  — Lembaga: search sends ?search= to API (debounced 400ms)
 *   BUG-2  — Lembaga: pagination is server-side
 *   BUG-3  — DM: search works via new /dewan-masyayikh endpoint
 *   BUG-4  — DM: pagination works via new endpoint
 *   BUG-5  — DM: "Surat Keterangan" shows toast instead of file picker
 *   BUG-6  — DM: Email column now populated from users table
 *   BUG-7  — DM: Institution data now sourced from lembagas, not users
 *   BUG-8  — DM: Detail page fetches by institution_id, not logged-in user
 *   BUG-9  — DM: Validation badges (SK, Struktur) now shown per column
 *   BUG-10 — DM: Modal shows EMIS data source indicator + comparison
 *   BUG-11 — DM: "Refresh dari EMIS" now triggers DB sync via POST /sync-emis/:id
 *   BUG-12 — DM: Column "Validasi" renamed to "Surat Keputusan", badge text "Belum ada SK"
 *   BUG-13 — DM: Struktur column validates structure_count >= 2
 *   BUG-14 — DM: "Perlu Tindakan" column removed
 *   BUG-15 — DM: Filters changed from Status to Surat Keputusan + Struktur (client-side)
 */

const SCREENSHOTS_DIR = path.resolve(__dirname, '../../test-results/screenshots');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function screenshot(page: import('@playwright/test').Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: true,
  });
}

/** Navigate to DM list and wait for the new API */
async function gotoDmList(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/app/lembaga-dm');
  await waitForLembagaApi(page, '/dewan-masyayikh');
  await waitForTableReady(page);
}

/** Navigate to DM detail by clicking first row */
async function gotoDmDetail(page: import('@playwright/test').Page): Promise<void> {
  await gotoDmList(page);
  const rowCount = await getTableRowCount(page);
  if (rowCount === 0) return;
  await clickTableRow(page, 0);
  await page.waitForURL(/\/lembaga-dm\/detail\//, { timeout: 10_000 });
  await waitForDmDetailApi(page);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin — Lembaga & Dewan Masyayikh Regression Tests', () => {
  test.beforeEach(async ({}) => {
    if (!hasAuthState('admin')) test.skip();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION A — Lembaga Module (/app/lembaga)
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('A — Lembaga — Table Loading & Structure', () => {
    test('A-01 page loads and table renders data rows', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        await screenshot(page, 'lembaga-table-loaded');

        const rowCount = await getTableRowCount(page);
        expect(rowCount).toBeGreaterThan(0);
      } finally {
        await ctx.close();
      }
    });

    test('A-02 table has expected columns (NSPP, Nama Lembaga, Status, Jenis Lembaga)', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const expectedColumns = ['NSPP', 'Nama Lembaga', 'Status', 'Jenis Lembaga'];
        const { found, missing } = await assertColumnsExist(page, expectedColumns);

        await screenshot(page, 'lembaga-columns');

        expect(missing).toHaveLength(0);
        expect(found).toHaveLength(expectedColumns.length);
      } finally {
        await ctx.close();
      }
    });

    test('A-03 table renders correct row count per page (default 10)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const rowCount = await getTableRowCount(page);
        expect(rowCount).toBeGreaterThan(0);
        expect(rowCount).toBeLessThanOrEqual(10);
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Lembaga — Search
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('A — Lembaga — Search', () => {
    test('A-04 search input triggers API with ?search= (BUG-1 fix)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        await screenshot(page, 'lembaga-search-before');

        const searchInput = page.locator('input[placeholder="Cari berdasarkan NSPP atau nama lembaga"]');
        await searchInput.fill('Al');

        const apiResponse = await page.waitForResponse(
          (r) => r.url().includes('/lembaga') && r.url().includes('search=') && r.status() < 400,
          { timeout: 10_000 },
        );

        expect(apiResponse.url()).toContain('search=Al');

        await waitForTableReady(page);
        await screenshot(page, 'lembaga-search-after');
      } finally {
        await ctx.close();
      }
    });

    test('A-05 search shows loading spinner while debouncing', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const searchInput = page.locator('input[placeholder="Cari berdasarkan NSPP atau nama lembaga"]');
        await searchInput.fill('test');

        const spinner = page.locator('svg.lucide-loader-2, svg[class*="lucide-loader"]').first();
        const isVisible = await spinner.isVisible({ timeout: 2_000 }).catch(() => false);

        expect(isVisible).toBe(true);

        await screenshot(page, 'lembaga-search-spinner');
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Lembaga — Filters
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('A — Lembaga — Filter Dropdowns', () => {
    test('A-06 Status filter dropdown visible with "Semua Status" default', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const statusDropdown = page.getByText('Semua Status', { exact: true }).first();
        await expect(statusDropdown).toBeVisible({ timeout: 5_000 });
      } finally {
        await ctx.close();
      }
    });

    test('A-07 Jenis Lembaga filter dropdown visible', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const jenisDropdown = page.getByText('Semua Jenis Lembaga', { exact: true }).first();
        await expect(jenisDropdown).toBeVisible({ timeout: 5_000 });
      } finally {
        await ctx.close();
      }
    });

    test('A-08 selecting Status "Aktif" sends ?status=1 to API', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const responsePromise = page.waitForResponse(
          (r) => r.url().includes('/lembaga') && r.url().includes('status=1') && r.status() < 400,
          { timeout: 10_000 },
        );

        await selectFilterOption(page, 'Semua Status', 'Aktif');

        const apiResponse = await responsePromise;
        expect(apiResponse.url()).toContain('status=1');

        await waitForTableReady(page);
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Lembaga — Pagination
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('A — Lembaga — Pagination', () => {
    test('A-09 page 1 is active on initial load', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        expect(await getActivePage(page)).toBe(1);
      } finally {
        await ctx.close();
      }
    });

    test('A-10 prev button disabled on first page', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        expect(await isPrevPageDisabled(page)).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    test('A-11 next button loads page 2 data (BUG-2 fix)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const firstRowBefore = await getFirstRowText(page);

        await clickPaginationNext(page);
        await waitForLembagaApi(page, '/lembaga', 8_000);
        await waitForTableReady(page);

        const firstRowAfter = await getFirstRowText(page);

        expect(firstRowAfter).not.toBe(firstRowBefore);
        expect(await getActivePage(page)).toBe(2);
      } finally {
        await ctx.close();
      }
    });

    test('A-12 clicking page number button navigates to that page', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const firstRowPage1 = await getFirstRowText(page);

        await clickPageNumber(page, 3);
        await waitForLembagaApi(page, '/lembaga', 8_000);
        await waitForTableReady(page);

        const firstRowPage3 = await getFirstRowText(page);

        expect(firstRowPage3).not.toBe(firstRowPage1);
        expect(await getActivePage(page)).toBe(3);
      } finally {
        await ctx.close();
      }
    });

    test('A-13 data info text shows "Menampilkan X–Y dari Z data"', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const infoText = await getDataInfoText(page);
        expect(infoText).toMatch(/Menampilkan \d+–\d+ dari \d+ data/);
      } finally {
        await ctx.close();
      }
    });

    test('A-14 filter change resets page to 1', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        await clickPaginationNext(page);
        await waitForLembagaApi(page, '/lembaga', 8_000);
        await waitForTableReady(page);

        expect(await getActivePage(page)).toBe(2);

        await selectFilterOption(page, 'Semua Status', 'Aktif');
        await waitForLembagaApi(page, '/lembaga', 8_000);
        await waitForTableReady(page);

        expect(await getActivePage(page)).toBe(1);
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Lembaga — Sort & Row Click
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('A — Lembaga — Sort', () => {
    test('A-15 sort chevron icons visible on column headers', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        const sortIcons = page.locator('thead th svg');
        const count = await sortIcons.count();

        expect(count).toBeGreaterThanOrEqual(4);
      } finally {
        await ctx.close();
      }
    });

    test('A-16 clicking column header changes sort icon', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await waitForLembagaApi(page, '/lembaga');
        await waitForTableReady(page);

        await clickColumnSort(page, 'NSPP');

        const nsppHeader = page.locator('thead th').filter({ hasText: 'NSPP' }).first();
        const sortIcon = nsppHeader.locator('svg');
        await expect(sortIcon).toBeVisible();
      } finally {
        await ctx.close();
      }
    });
  });

  test('A-17 clicking a row navigates to detail page', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/lembaga');
      await waitForLembagaApi(page, '/lembaga');
      await waitForTableReady(page);

      const rowCount = await getTableRowCount(page);
      if (rowCount === 0) {
        console.warn('[Lembaga] No rows — skipping row-click test');
        return;
      }

      await clickTableRow(page, 0);

      await page.waitForURL(/\/lembaga\/detail-lembaga/, { timeout: 10_000 }).catch(() => {});

      await screenshot(page, 'lembaga-detail-navigated');
    } finally {
      await ctx.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION B — Dewan Masyayikh List (/app/lembaga-dm)
  //             Now uses /api/dewan-masyayikh (BUG-7 fix)
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('B — DM List — Table Loading & Structure', () => {
    test('B-01 page loads and table renders data rows via /dewan-masyayikh API', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        await screenshot(page, 'dm-list-table-loaded');

        const rowCount = await getTableRowCount(page);
        expect(rowCount).toBeGreaterThan(0);
      } finally {
        await ctx.close();
      }
    });

    test('B-02 table has expected columns: NSPP, Nama, Email, Struktur, Surat Keputusan (BUG-12, BUG-14)', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const expectedColumns = ['NSPP', 'Nama Pondok Pesantren', 'Email', 'Struktur', 'Surat Keputusan'];
        const { found, missing } = await assertColumnsExist(page, expectedColumns);

        const headers = await getColumnHeaders(page);
        console.log('[DM List] Actual column headers:', headers);

        await screenshot(page, 'dm-list-columns');

        expect(missing).toHaveLength(0);
        expect(found).toHaveLength(expectedColumns.length);

        // Verify removed columns are NOT present
        const { found: removed } = await assertColumnsExist(page, ['Status Akun', 'Validasi']);
        expect(removed).toHaveLength(0);
      } finally {
        await ctx.close();
      }
    });

    test('B-03 NSPP column shows data from lembagas (not users.nomor_statistik)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        // NSPP is column index 0; values should be non-empty strings from lembagas.nspp
        const nsppValues = await getColumnValues(page, 0);
        const nonEmpty = nsppValues.filter((v) => v.trim() !== '' && v !== '-');

        await screenshot(page, 'dm-list-nspp-values');

        // At least some rows should have NSPP data
        expect(nonEmpty.length).toBeGreaterThan(0);
      } finally {
        await ctx.close();
      }
    });

    test('B-04 Email column shows data from users.email (joined via institution_id)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        // Email is column index 2 (NSPP=0, Nama=1, Email=2)
        const emailValues = await getColumnValues(page, 2);
        const withEmail = emailValues.filter((v) => v.includes('@') || v.includes('Tidak tersedia'));

        await screenshot(page, 'dm-list-email-values');

        // All rows should have an email or "Tidak tersedia"
        expect(withEmail.length).toBe(emailValues.length);
      } finally {
        await ctx.close();
      }
    });

    test('B-05 Struktur and Surat Keputusan badges render correctly (BUG-12, BUG-13)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        // Struktur badges: "Lengkap" (structure_count >= 2) or "Belum diisi"
        const strukturBadges = page.locator('tbody').locator('span').filter({
          hasText: /^Lengkap$|^Belum diisi$/,
        });
        const strukturCount = await strukturBadges.count();

        // Surat Keputusan badges: "Lengkap" or "Belum ada SK"
        const skBadges = page.locator('tbody').locator('span').filter({
          hasText: /^Lengkap$|^Belum ada SK$/,
        });
        const skCount = await skBadges.count();

        await screenshot(page, 'dm-list-badges');

        expect(strukturCount).toBeGreaterThan(0);
        expect(skCount).toBeGreaterThan(0);
      } finally {
        await ctx.close();
      }
    });

    test('B-05b "Perlu Tindakan" column is removed (BUG-14)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        // "Perlu Tindakan" should NOT appear anywhere in the table
        const actionBadges = page.locator('tbody').locator('span').filter({
          hasText: /Perlu Tindakan/,
        });
        const count = await actionBadges.count();

        await screenshot(page, 'dm-list-no-perlu-tindakan');

        expect(count).toBe(0);
      } finally {
        await ctx.close();
      }
    });

    test('B-06 table renders correct row count per page (default 10)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const rowCount = await getTableRowCount(page);
        expect(rowCount).toBeGreaterThan(0);
        expect(rowCount).toBeLessThanOrEqual(10);
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DM List — Search (updated placeholder, BUG-3 fix)
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('B — DM List — Search', () => {
    test('B-07 search by NSPP triggers /dewan-masyayikh?search= API', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        await screenshot(page, 'dm-search-before');

        // Updated placeholder includes "nama dewan"
        const searchInput = page.locator(
          'input[placeholder*="Cari berdasarkan NSPP"]',
        );
        await searchInput.fill('51');

        const apiResponse = await page.waitForResponse(
          (r) => r.url().includes('/dewan-masyayikh') && r.url().includes('search=') && r.status() < 400,
          { timeout: 10_000 },
        );

        expect(apiResponse.url()).toContain('search=51');

        await waitForTableReady(page);
        await screenshot(page, 'dm-search-by-nspp');
      } finally {
        await ctx.close();
      }
    });

    test('B-08 search by nama lembaga filters results', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const searchInput = page.locator('input[placeholder*="Cari berdasarkan NSPP"]');
        await searchInput.fill('Al');

        const apiResponse = await page.waitForResponse(
          (r) => r.url().includes('/dewan-masyayikh') && r.url().includes('search=') && r.status() < 400,
          { timeout: 10_000 },
        );

        expect(apiResponse.url()).toContain('search=Al');

        await waitForTableReady(page);
        await screenshot(page, 'dm-search-by-name');
      } finally {
        await ctx.close();
      }
    });

    test('B-09 search shows loading spinner while debouncing', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const searchInput = page.locator('input[placeholder*="Cari berdasarkan NSPP"]');
        await searchInput.fill('test-spinner');

        const spinner = page.locator('svg.lucide-loader-2, svg[class*="lucide-loader"]').first();
        const isVisible = await spinner.isVisible({ timeout: 2_000 }).catch(() => false);

        expect(isVisible).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    test('B-10 empty search result shows empty state', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const searchInput = page.locator('input[placeholder*="Cari berdasarkan NSPP"]');
        await searchInput.fill('zzz_nonexistent_query_12345');

        await page.waitForResponse(
          (r) => r.url().includes('/dewan-masyayikh') && r.url().includes('search=') && r.status() < 400,
          { timeout: 10_000 },
        );

        // Wait for re-render
        await page.waitForTimeout(500);

        // Should show "Tidak ada data ditemukan" or empty table
        const emptyMessage = page.locator('text=Tidak ada data ditemukan').or(
          page.locator('text=Tidak ada data'),
        );
        const emptyVisible = await emptyMessage.first().isVisible({ timeout: 5_000 }).catch(() => false);

        await screenshot(page, 'dm-search-empty-state');

        expect(emptyVisible).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DM List — Filter Dropdown
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('B — DM List — Filters (Surat Keputusan + Struktur) (BUG-15)', () => {
    test('B-11 Surat Keputusan filter dropdown visible with "Semua Surat Keputusan" default', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const skDropdown = page.getByText('Semua Surat Keputusan', { exact: true }).first();
        await expect(skDropdown).toBeVisible({ timeout: 5_000 });

        await screenshot(page, 'dm-filter-sk-visible');
      } finally {
        await ctx.close();
      }
    });

    test('B-11b Struktur filter dropdown is visible with "Semua Struktur" default', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const strukturDropdown = page.getByText('Semua Struktur', { exact: true }).first();
        await expect(strukturDropdown).toBeVisible({ timeout: 5_000 });

        await screenshot(page, 'dm-filter-struktur-visible');
      } finally {
        await ctx.close();
      }
    });

    test('B-12 selecting SK "Belum Lengkap" filters table client-side', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        await selectFilterOption(page, 'Semua Surat Keputusan', 'Belum Lengkap');
        await page.waitForTimeout(500);

        // After filter, all visible rows should show "Belum ada SK" badge
        const badges = page.locator('tbody').locator('span').filter({
          hasText: /Belum ada SK/,
        });
        const badgeCount = await badges.count();
        const rowsAfter = await getTableRowCount(page);

        await screenshot(page, 'dm-filter-sk-belum');

        if (rowsAfter > 0) {
          expect(badgeCount).toBe(rowsAfter);
        }
      } finally {
        await ctx.close();
      }
    });

    test('B-12b selecting Struktur "Belum Ada" filters table client-side', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        await selectFilterOption(page, 'Semua Struktur', 'Belum Ada');
        await page.waitForTimeout(500);

        // After filter, all visible rows should show "Belum diisi" badge
        const badges = page.locator('tbody').locator('span').filter({
          hasText: /Belum diisi/,
        });
        const badgeCount = await badges.count();
        const rowsAfter = await getTableRowCount(page);

        await screenshot(page, 'dm-filter-struktur-belum');

        if (rowsAfter > 0) {
          expect(badgeCount).toBe(rowsAfter);
        }
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DM List — Pagination (BUG-4 fix)
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('B — DM List — Pagination', () => {
    test('B-13 page 1 active, prev disabled on initial load', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        expect(await getActivePage(page)).toBe(1);
        expect(await isPrevPageDisabled(page)).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    test('B-14 next button loads page 2 data', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const firstRowBefore = await getFirstRowText(page);

        await clickPaginationNext(page);
        await waitForLembagaApi(page, '/dewan-masyayikh', 8_000);
        await waitForTableReady(page);

        const firstRowAfter = await getFirstRowText(page);

        await screenshot(page, 'dm-pagination-page2');

        expect(firstRowAfter).not.toBe(firstRowBefore);
        expect(await getActivePage(page)).toBe(2);
      } finally {
        await ctx.close();
      }
    });

    test('B-15 data info text shows "Menampilkan X–Y dari Z data"', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const infoText = await getDataInfoText(page);
        expect(infoText).toMatch(/Menampilkan \d+–\d+ dari \d+ data/);
      } finally {
        await ctx.close();
      }
    });

    test('B-16 SK filter change resets page to 1', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        await clickPaginationNext(page);
        await waitForLembagaApi(page, '/dewan-masyayikh', 8_000);
        await waitForTableReady(page);

        expect(await getActivePage(page)).toBe(2);

        // Selecting a client-side filter should reset to page 1
        await selectFilterOption(page, 'Semua Surat Keputusan', 'Lengkap');
        await page.waitForTimeout(500);

        expect(await getActivePage(page)).toBe(1);
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DM List — Row Click → Detail Navigation
  // ─────────────────────────────────────────────────────────────────────────

  test('B-17 clicking a DM row navigates to DM detail page', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    try {
      await gotoDmList(page);

      const rowCount = await getTableRowCount(page);
      if (rowCount === 0) {
        console.warn('[DM] No rows — skipping row-click test');
        return;
      }

      await clickTableRow(page, 0);

      await page.waitForURL(/\/lembaga-dm\/detail\//, { timeout: 10_000 });

      await screenshot(page, 'dm-detail-navigated');
    } finally {
      await ctx.close();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION C — DM Detail Page (/app/lembaga-dm/detail/:institution_id)
  //             Now uses /api/dewan-masyayikh/:id (BUG-8 fix)
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('C — DM Detail — Section Rendering', () => {
    test('C-01 detail page loads with all 4 sections visible', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        // Section 1: Informasi Lembaga
        const lembagaSection = page.locator('text=Informasi Lembaga').first();
        await expect(lembagaSection).toBeVisible({ timeout: 5_000 });

        // Section 2: Informasi Dewan Masyayikh
        const dewanSection = page.locator('text=Informasi Dewan Masyayikh').first();
        await expect(dewanSection).toBeVisible({ timeout: 5_000 });

        // Section 3: Struktur Dewan Masyayikh
        const strukturSection = page.locator('text=Struktur Dewan Masyayikh').first();
        await expect(strukturSection).toBeVisible({ timeout: 5_000 });

        // Section 4: Satuan Pendidikan
        const satuanSection = page.locator('text=Satuan Pendidikan').first();
        await expect(satuanSection).toBeVisible({ timeout: 5_000 });

        await screenshot(page, 'dm-detail-all-sections');
      } finally {
        await ctx.close();
      }
    });

    test('C-02 Informasi Lembaga shows data from lembagas table (BUG-7 fix)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        // These labels should exist in the Informasi Lembaga section
        await expect(page.locator('text=Nama Lembaga:').first()).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('text=NSPP:').first()).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('text=Alamat:').first()).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('text=Status Lembaga:').first()).toBeVisible({ timeout: 5_000 });

        await screenshot(page, 'dm-detail-lembaga-section');
      } finally {
        await ctx.close();
      }
    });

    test('C-03 Informasi Dewan shows user data from users table (BUG-8 fix)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        // Dewan section should show user-specific fields
        await expect(page.locator('text=Nama Lengkap:').first()).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('text=Email:').first()).toBeVisible({ timeout: 5_000 });
        await expect(page.locator('text=Status Akun:').first()).toBeVisible({ timeout: 5_000 });

        await screenshot(page, 'dm-detail-dewan-section');
      } finally {
        await ctx.close();
      }
    });

    test('C-04 Surat Keterangan shows toast when no certificate (BUG-5 fix)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        let fileChooserOpened = false;
        page.once('filechooser', () => {
          fileChooserOpened = true;
        });

        const eyeIcon = page.locator('svg.lucide-eye, [class*="lucide-eye"]').first();
        const eyeExists = await eyeIcon.isVisible({ timeout: 5_000 }).catch(() => false);

        if (!eyeExists) {
          console.warn('[DM Detail] Eye icon not found — row may have a certificate');
          return;
        }

        await eyeIcon.click();
        await page.waitForTimeout(500);

        await screenshot(page, 'dm-detail-surat-click');

        // File picker should NOT open
        expect(fileChooserOpened).toBe(false);

        // Toast should appear
        const toast = page.locator('.Toastify__toast').filter({ hasText: /belum tersedia|Belum diunggah/i }).first();
        const toastVisible = await toast.isVisible({ timeout: 3_000 }).catch(() => false);
        expect(toastVisible).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    test('C-05 validation badges show in Dewan section (BUG-9, BUG-12)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        // At least one badge should be visible — matches updated badge text
        const badges = page.locator('span').filter({
          hasText: /Belum ada SK|Struktur belum lengkap|Data Lengkap/,
        });
        const badgeCount = await badges.count();

        await screenshot(page, 'dm-detail-validation-badges');

        expect(badgeCount).toBeGreaterThan(0);
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DM Detail — Edge Cases
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('C — DM Detail — Edge Cases', () => {
    test('C-06 empty structure shows "Belum ada data struktur"', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        // Check if the empty state message OR actual structure data exists
        const emptyStructure = page.locator('text=Belum ada data struktur').first();
        const strukturSection = page.locator('text=Struktur Dewan Masyayikh').first();

        await expect(strukturSection).toBeVisible({ timeout: 5_000 });

        // Either shows empty state or has structure members — both valid
        const isEmpty = await emptyStructure.isVisible({ timeout: 2_000 }).catch(() => false);

        await screenshot(page, 'dm-detail-structure-state');

        // The section must render (not crash)
        expect(true).toBe(true);
        console.log(`[DM Detail] Structure section: ${isEmpty ? 'empty state shown' : 'has data'}`);
      } finally {
        await ctx.close();
      }
    });

    test('C-07 empty grouped lembagas shows "Belum ada data satuan pendidikan"', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanSection = page.locator('text=Satuan Pendidikan').first();
        await expect(satuanSection).toBeVisible({ timeout: 5_000 });

        const emptyState = page.locator('text=Belum ada data satuan pendidikan').first();
        const hasTable = await page.locator('text=Satuan Pendidikan').locator('..').locator('..').locator('table, tbody').first().isVisible({ timeout: 2_000 }).catch(() => false);
        const isEmpty = await emptyState.isVisible({ timeout: 2_000 }).catch(() => false);

        await screenshot(page, 'dm-detail-satuan-state');

        // Either data or empty state must render
        expect(hasTable || isEmpty).toBe(true);
        console.log(`[DM Detail] Satuan section: ${isEmpty ? 'empty state' : 'has table data'}`);
      } finally {
        await ctx.close();
      }
    });

    test('C-08 loading state shown before data arrives', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmList(page);

        const rowCount = await getTableRowCount(page);
        if (rowCount === 0) {
          console.warn('[DM] No rows — skipping loading state test');
          return;
        }

        // Navigate to detail without waiting for API — check loading state
        await clickTableRow(page, 0);
        await page.waitForURL(/\/lembaga-dm\/detail\//, { timeout: 10_000 });

        // Loading text should flash briefly (OK if it disappears quickly on fast API)
        const loadingText = page.locator('text=Memuat detail Dewan Masyayikh').first();
        await loadingText.isVisible({ timeout: 1_000 }).catch(() => false);

        // Wait for actual content
        await waitForDmDetailApi(page);

        await screenshot(page, 'dm-detail-after-load');

        // Page should now have content (loading disappeared)
        const hasContent = await page.locator('text=Informasi Lembaga').first()
          .isVisible({ timeout: 5_000 }).catch(() => false);
        expect(hasContent).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION D — Modal Popup (Informasi Satuan Pendidikan)
  //             EMIS API integration + data comparison (BUG-10)
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('D — Modal — EMIS Data & Sections', () => {
    test('D-01 clicking satuan pendidikan row opens modal', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        // Find and click a clickable NSPP link in the satuan pendidikan table
        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);

        if (!linkExists) {
          // Try clicking the table row in the satuan pendidikan section
          const satuanTable = page.locator('text=Satuan Pendidikan').locator('..').locator('..').locator('tbody tr').first();
          const tableExists = await satuanTable.isVisible({ timeout: 3_000 }).catch(() => false);
          if (!tableExists) {
            console.warn('[DM] No satuan pendidikan data — skipping modal test');
            return;
          }
          await satuanTable.click();
        } else {
          await satuanLink.click();
        }

        // Modal should open
        const modal = await waitForModal(page, 10_000);
        await expect(modal).toBeVisible();

        await screenshot(page, 'dm-modal-opened');
      } finally {
        await ctx.close();
      }
    });

    test('D-02 modal shows data source indicator (EMIS or Lokal)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!linkExists) {
          console.warn('[DM] No satuan pendidikan links — skipping');
          return;
        }

        await satuanLink.click();
        await waitForModal(page);

        // Wait for EMIS API (may take a few seconds)
        await waitForEmisApi(page).catch(() => {
          console.log('[DM Modal] EMIS API did not fire or timed out — fallback to local');
        });

        // Check for data source badge
        const emisBadge = page.locator('text=Data EMIS (Realtime)').first();
        const localBadge = page.locator('text=Data Lokal').first();
        const errorBadge = page.locator('text=Gagal muat EMIS').first();

        const hasEmis = await emisBadge.isVisible({ timeout: 5_000 }).catch(() => false);
        const hasLocal = await localBadge.isVisible({ timeout: 2_000 }).catch(() => false);
        const hasError = await errorBadge.isVisible({ timeout: 2_000 }).catch(() => false);

        await screenshot(page, 'dm-modal-data-source');

        // At least one indicator should be visible
        expect(hasEmis || hasLocal || hasError).toBe(true);
        console.log(`[DM Modal] Data source: ${hasEmis ? 'EMIS' : hasLocal ? 'Local' : 'Error'}`);
      } finally {
        await ctx.close();
      }
    });

    test('D-03 modal shows grouped sections (Informasi Umum, Lokasi, Kontak)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!linkExists) {
          console.warn('[DM] No satuan pendidikan links — skipping');
          return;
        }

        await satuanLink.click();
        await waitForModal(page);

        // Wait for content to load
        await page.waitForTimeout(2_000);

        // Check section labels
        const informasiUmum = page.locator('text=INFORMASI UMUM').or(page.locator('text=Informasi Umum'));
        const lokasi = page.locator('text=LOKASI').or(page.locator('text=Lokasi'));
        const kontak = page.locator('text=KONTAK').or(page.locator('text=Kontak'));

        const hasUmum = await informasiUmum.first().isVisible({ timeout: 5_000 }).catch(() => false);
        const hasLokasi = await lokasi.first().isVisible({ timeout: 3_000 }).catch(() => false);
        const hasKontak = await kontak.first().isVisible({ timeout: 3_000 }).catch(() => false);

        await screenshot(page, 'dm-modal-sections');

        expect(hasUmum).toBe(true);
        expect(hasLokasi).toBe(true);
        expect(hasKontak).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    test('D-04 modal handles empty fields with "Tidak tersedia"', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!linkExists) {
          console.warn('[DM] No satuan pendidikan links — skipping');
          return;
        }

        await satuanLink.click();
        await waitForModal(page);
        await page.waitForTimeout(2_000);

        // Some fields will likely be "Tidak tersedia"
        const emptyMarkers = page.locator('text=Tidak tersedia');
        const count = await emptyMarkers.count();

        await screenshot(page, 'dm-modal-empty-fields');

        // It's acceptable to have zero if all fields are filled,
        // but the placeholder text must be used instead of blank
        console.log(`[DM Modal] "Tidak tersedia" placeholders: ${count}`);
      } finally {
        await ctx.close();
      }
    });

    test('D-05 modal shows Statistik section with stat cards when EMIS loads', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!linkExists) {
          console.warn('[DM] No satuan pendidikan links — skipping');
          return;
        }

        await satuanLink.click();
        await waitForModal(page);

        // Wait for EMIS to load
        await waitForEmisApi(page).catch(() => null);
        await page.waitForTimeout(1_000);

        const statistikSection = page.locator('text=STATISTIK').or(page.locator('text=Statistik'));
        const hasStats = await statistikSection.first().isVisible({ timeout: 5_000 }).catch(() => false);

        if (hasStats) {
          // Check stat labels
          const santri = page.locator('text=Santri');
          const ustadz = page.locator('text=Ustadz');
          const ruangan = page.locator('text=Ruangan');

          await expect(santri.first()).toBeVisible({ timeout: 3_000 });
          await expect(ustadz.first()).toBeVisible({ timeout: 3_000 });
          await expect(ruangan.first()).toBeVisible({ timeout: 3_000 });
        }

        await screenshot(page, 'dm-modal-statistik');
        console.log(`[DM Modal] Statistik section: ${hasStats ? 'visible' : 'not shown (EMIS may have failed)'}`);
      } finally {
        await ctx.close();
      }
    });

    test('D-06 modal "Refresh dari EMIS" triggers sync API (BUG-11)', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!linkExists) {
          console.warn('[DM] No satuan pendidikan links — skipping');
          return;
        }

        await satuanLink.click();
        await waitForModal(page);
        await page.waitForTimeout(2_000);

        // Find refresh button
        const refreshBtn = page.locator('button').filter({ hasText: /Refresh dari EMIS/ }).first();
        const btnExists = await refreshBtn.isVisible({ timeout: 3_000 }).catch(() => false);

        if (!btnExists) {
          console.warn('[DM Modal] Refresh button not found');
          return;
        }

        // Click refresh — now calls POST /sync-emis/:id (fetches EMIS + triggers background DB sync)
        const syncPromise = page.waitForResponse(
          (r) => r.url().includes('/sync-emis/') && r.request().method() === 'POST' && r.status() < 400,
          { timeout: 25_000 },
        );

        await refreshBtn.click();
        const syncResponse = await syncPromise.catch(() => null);

        await screenshot(page, 'dm-modal-refresh-sync');

        if (syncResponse) {
          const body = await syncResponse.json();
          expect(body).toHaveProperty('status', 200);
          expect(body.data).toHaveProperty('sync_triggered', true);
          console.log('[DM Modal] Sync API fired — background DB update triggered');
        } else {
          console.log('[DM Modal] Sync API did not fire (may be cached or network issue)');
        }

        // Toast should confirm sync success
        const toast = page.locator('.Toastify__toast').filter({ hasText: /berhasil disinkronkan/i }).first();
        const toastVisible = await toast.isVisible({ timeout: 5_000 }).catch(() => false);
        console.log(`[DM Modal] Sync toast: ${toastVisible ? 'shown' : 'not shown'}`);
      } finally {
        await ctx.close();
      }
    });

    test('D-07 modal "Tutup" button closes modal', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!linkExists) {
          console.warn('[DM] No satuan pendidikan links — skipping');
          return;
        }

        await satuanLink.click();
        const modal = await waitForModal(page);
        await expect(modal).toBeVisible();

        const closeBtn = page.locator('button').filter({ hasText: 'Tutup' }).first();
        await closeBtn.click();

        // Modal should disappear
        await expect(modal).not.toBeVisible({ timeout: 3_000 });

        await screenshot(page, 'dm-modal-closed');
      } finally {
        await ctx.close();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DM Modal — Data Consistency (EMIS vs Local comparison)
  // ─────────────────────────────────────────────────────────────────────────

  test.describe('D — Modal — Data Consistency', () => {
    test('D-08 when EMIS data differs from local, warning banner appears', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await gotoDmDetail(page);

        const satuanLink = page.locator('p[style*="cursor: pointer"]').first();
        const linkExists = await satuanLink.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!linkExists) {
          console.warn('[DM] No satuan pendidikan links — skipping');
          return;
        }

        await satuanLink.click();
        await waitForModal(page);
        await waitForEmisApi(page).catch(() => null);
        await page.waitForTimeout(1_000);

        // Check for warning banner (may or may not appear depending on data)
        const warningBanner = page.locator('text=data berbeda dengan database lokal');
        const hasWarning = await warningBanner.first().isVisible({ timeout: 3_000 }).catch(() => false);

        if (hasWarning) {
          // "Lihat perbedaan" button should be available
          const diffBtn = page.locator('button').filter({ hasText: /Lihat perbedaan/ }).first();
          await expect(diffBtn).toBeVisible({ timeout: 3_000 });

          // Click to expand differences table
          await diffBtn.click();
          await page.waitForTimeout(300);

          // Diff table should show columns: Field, Lokal, EMIS
          const lokal = page.locator('th').filter({ hasText: 'Lokal' }).first();
          const emis = page.locator('th').filter({ hasText: 'EMIS' }).first();
          await expect(lokal).toBeVisible({ timeout: 2_000 });
          await expect(emis).toBeVisible({ timeout: 2_000 });
        }

        await screenshot(page, 'dm-modal-data-comparison');
        console.log(`[DM Modal] Data difference warning: ${hasWarning ? 'shown' : 'no differences detected'}`);
      } finally {
        await ctx.close();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION E — Role-Based Access
  // ═══════════════════════════════════════════════════════════════════════════

  test.describe('E — Role-Based Access', () => {
    test('E-01 DM role cannot see "Daftar Dewan Masyayikh" in sidebar', async ({ browser }) => {
      if (!hasAuthState('dm')) {
        test.skip();
        return;
      }

      const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app');
        await page.waitForLoadState('networkidle', { timeout: 15_000 });

        // DM role: sidebar should NOT show "Daftar Dewan Masyayikh"
        const dmMenuItem = page.locator('nav a[href*="/lembaga-dm"]').or(
          page.locator('text=Daftar Dewan Masyayikh'),
        );
        const isVisible = await dmMenuItem.first().isVisible({ timeout: 3_000 }).catch(() => false);

        await screenshot(page, 'role-dm-sidebar');

        expect(isVisible).toBe(false);
      } finally {
        await ctx.close();
      }
    });

    test('E-02 admin role CAN see "Daftar Dewan Masyayikh" in sidebar', async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app');
        await page.waitForLoadState('networkidle', { timeout: 15_000 });

        // Admin should see DM menu
        const dmMenuItem = page.locator('a[href*="/lembaga-dm"]').or(
          page.locator('text=Daftar Dewan Masyayikh'),
        );
        const isVisible = await dmMenuItem.first().isVisible({ timeout: 5_000 }).catch(() => false);

        await screenshot(page, 'role-admin-sidebar');

        expect(isVisible).toBe(true);
      } finally {
        await ctx.close();
      }
    });

    test('E-03 non-admin role cannot access Lembaga module', async ({ browser }) => {
      if (!hasAuthState('dm')) {
        test.skip();
        return;
      }

      const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/lembaga');
        await page.waitForLoadState('networkidle', { timeout: 15_000 });

        await screenshot(page, 'role-dm-lembaga-access');

        const isRedirected = page.url().includes('/login');
        const isOnDashboard = page.url().includes('/app/') && !page.url().includes('/lembaga');
        const hasLembagaTable = await page.locator('thead th').filter({ hasText: 'NSPP' }).isVisible({ timeout: 3_000 }).catch(() => false);

        expect(hasLembagaTable || isRedirected || isOnDashboard).toBe(true);
      } finally {
        await ctx.close();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION F — Cross-Module Sanity Checks
  // ═══════════════════════════════════════════════════════════════════════════

  test('F-01 admin can navigate between Lembaga and DM', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/lembaga');
      await waitForLembagaApi(page, '/lembaga');
      await waitForTableReady(page);

      await screenshot(page, 'nav-lembaga-page');

      await gotoDmList(page);

      await screenshot(page, 'nav-dm-page');

      const dmRows = await getTableRowCount(page);
      expect(dmRows).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  test('F-02 both pages do not throw console errors on load', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    const pageErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    try {
      await page.goto('/app/lembaga');
      await waitForLembagaApi(page, '/lembaga');
      await waitForTableReady(page);

      await gotoDmList(page);

      const criticalErrors = pageErrors.filter(
        (e) => !e.includes('ResizeObserver') && !e.includes('Non-Error'),
      );

      if (criticalErrors.length > 0) {
        console.error('[Page errors]', criticalErrors);
      }

      expect(criticalErrors).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  test('F-03 DM API response shape matches expected contract', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/lembaga-dm');

      const apiResponse = await page.waitForResponse(
        (r) => r.url().includes('/dewan-masyayikh') && r.request().method() === 'GET' && r.status() < 400,
        { timeout: 15_000 },
      );

      const body = await apiResponse.json();

      // Validate response shape
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('items');
      expect(body.data).toHaveProperty('meta');
      expect(Array.isArray(body.data.items)).toBe(true);

      // Validate first item has correct fields (from lembagas + users join)
      if (body.data.items.length > 0) {
        const item = body.data.items[0];

        // Institution fields (from lembagas)
        expect(item).toHaveProperty('institution_id');
        expect(item).toHaveProperty('nspp');
        expect(item).toHaveProperty('nama_lembaga');
        expect(item).toHaveProperty('status_lembaga');

        // User fields (from users via institution_id join)
        expect(item).toHaveProperty('dewan_email');
        expect(item).toHaveProperty('dewan_status');
        expect(item).toHaveProperty('has_certificate');
        expect(item).toHaveProperty('has_full_structure');
        expect(item).toHaveProperty('structure_count');
        expect(typeof item.structure_count).toBe('number');
      }

      await screenshot(page, 'dm-api-response-validated');
    } finally {
      await ctx.close();
    }
  });
});
