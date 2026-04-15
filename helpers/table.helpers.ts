/**
 * Table Helper Utilities
 *
 * Reusable functions for table interaction and assertion across all spec files.
 * Designed for the SPMM CMS table-heavy modules (Lembaga, Lembaga-DM, etc.).
 *
 * The custom ProfileTable component uses TanStack React Table v8 and renders:
 *   thead > tr > th   — column headers (with sort chevron icons)
 *   tbody > tr        — data rows (or "Tidak ada data" empty row)
 *   pagination bar    — "Menampilkan X–Y dari Z data" text on the left,
 *                        windowed page-number buttons + prev/next on the right
 *
 * Data fetching:
 *   - React Query with `placeholderData: (prev) => prev` (old rows stay visible during refetch)
 *   - Loading overlay (Loader2 spinner) appears on the table during isFetching
 *   - Search input has a 400ms debounce before the API call fires
 *   - Filter dropdowns (Select component) batch state change + page reset
 */

import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

// ── Wait Utilities ────────────────────────────────────────────────────────────

/**
 * Wait for the table to finish loading (skeleton rows disappear, loading overlay gone).
 */
export async function waitForTableReady(page: Page, timeoutMs = 15_000): Promise<void> {
  // Wait for skeleton rows to disappear
  await page.waitForFunction(
    () => document.querySelectorAll('tbody td div[class*="Skeleton"]').length === 0,
    { timeout: timeoutMs },
  );
  // Wait for loading overlay to disappear (Loader2 spinner over the table)
  await page.waitForFunction(
    () => document.querySelectorAll('div[class*="LoadingOverlay"] svg').length === 0,
    { timeout: timeoutMs },
  ).catch(() => {
    // overlay may never appear if fetch was instant — that's fine
  });
  // Ensure at least one real tr exists (data row or empty-state row)
  await page.waitForSelector('tbody tr', { timeout: 10_000 });
}

/**
 * Wait for the Lembaga or Lembaga-DM API response.
 */
export async function waitForLembagaApi(
  page: Page,
  endpoint: '/lembaga' | '/lembaga/dm' | '/dewan-masyayikh',
  timeoutMs = 15_000,
): Promise<void> {
  await page.waitForResponse(
    (r) =>
      r.url().includes(endpoint) &&
      r.request().method() === 'GET' &&
      r.status() < 400,
    { timeout: timeoutMs },
  );
  // Buffer for React to re-render after API response
  await page.waitForTimeout(300);
}

/**
 * Wait for the DM detail API response (/dewan-masyayikh/:id).
 */
export async function waitForDmDetailApi(
  page: Page,
  timeoutMs = 15_000,
): Promise<void> {
  await page.waitForResponse(
    (r) =>
      /\/dewan-masyayikh\/[^/?]+/.test(r.url()) &&
      r.request().method() === 'GET' &&
      r.status() < 400,
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(300);
}

/**
 * Wait for the EMIS detail API response (/user/detaillembaga).
 */
export async function waitForEmisApi(
  page: Page,
  timeoutMs = 20_000,
): Promise<void> {
  await page.waitForResponse(
    (r) =>
      r.url().includes('/user/detaillembaga') &&
      r.request().method() === 'POST' &&
      r.status() < 400,
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(300);
}

/**
 * Wait for the EMIS sync API response (POST /sync-emis/:id).
 * This is the new endpoint that fetches EMIS data AND triggers background DB sync.
 */
export async function waitForSyncEmisApi(
  page: Page,
  timeoutMs = 25_000,
): Promise<void> {
  await page.waitForResponse(
    (r) =>
      r.url().includes('/sync-emis/') &&
      r.request().method() === 'POST' &&
      r.status() < 400,
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(300);
}

// ── Row Count & Content ───────────────────────────────────────────────────────

/**
 * Get the number of visible data rows in tbody.
 * Returns 0 if only the "Tidak ada data" empty-state row exists.
 */
export async function getTableRowCount(page: Page): Promise<number> {
  const rows = page.locator('tbody tr');
  const count = await rows.count();

  // Check for the empty-state row
  if (count === 1) {
    const text = (await rows.first().textContent())?.trim() ?? '';
    if (text === 'Tidak ada data') return 0;
  }

  // Filter out rows that are purely skeleton placeholders
  let dataRowCount = 0;
  for (let i = 0; i < count; i++) {
    const hasSkeleton = await rows.nth(i).locator('div[class*="Skeleton"]').count();
    if (hasSkeleton === 0) dataRowCount++;
  }
  return dataRowCount;
}

/**
 * Get the text content of the first visible data row.
 * Returns all cell text concatenated with ' | ' for easy comparison.
 */
export async function getFirstRowText(page: Page): Promise<string> {
  await waitForTableReady(page);
  const firstRow = page.locator('tbody tr').first();
  const cells = firstRow.locator('td');
  const count = await cells.count();

  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = (await cells.nth(i).textContent())?.trim() ?? '';
    texts.push(text);
  }
  return texts.join(' | ');
}

/**
 * Get text content of a specific column in all rows.
 */
export async function getColumnValues(page: Page, columnIndex: number): Promise<string[]> {
  const rows = page.locator('tbody tr');
  const count = await rows.count();
  const values: string[] = [];

  for (let i = 0; i < count; i++) {
    const cell = rows.nth(i).locator('td').nth(columnIndex);
    const text = (await cell.textContent())?.trim() ?? '';
    values.push(text);
  }
  return values;
}

// ── Filter / Search ───────────────────────────────────────────────────────────

/**
 * Apply a search filter using the NSPP/name search input.
 * Both Lembaga and Lembaga-DM use the same placeholder text.
 * The input is debounced at 400ms before the API call fires.
 */
export async function applySearchFilter(
  page: Page,
  searchTerm: string,
  endpoint: '/lembaga' | '/lembaga/dm' = '/lembaga',
): Promise<void> {
  const searchInput = page.locator(
    'input[placeholder="Cari berdasarkan NSPP atau nama lembaga"]',
  );
  await searchInput.waitFor({ state: 'visible', timeout: 10_000 });

  await searchInput.clear();
  await searchInput.fill(searchTerm);

  // Wait for the debounced API call (400ms debounce + network round-trip)
  await waitForLembagaApi(page, endpoint, 10_000).catch(() => {
    // API may not fire if React Query deduplicates — still continue
  });

  await waitForTableReady(page);
}

/**
 * Clear the search filter and wait for table to restore full data.
 */
export async function clearSearchFilter(
  page: Page,
  endpoint: '/lembaga' | '/lembaga/dm' = '/lembaga',
): Promise<void> {
  const searchInput = page.locator(
    'input[placeholder="Cari berdasarkan NSPP atau nama lembaga"]',
  );
  await searchInput.clear();
  await waitForLembagaApi(page, endpoint, 10_000).catch(() => null);
  await waitForTableReady(page);
}

/**
 * Select an option from a filter dropdown (Select component).
 * Clicks the dropdown, then clicks the matching option text.
 */
export async function selectFilterOption(
  page: Page,
  placeholder: string,
  optionLabel: string,
): Promise<void> {
  // The Select component renders a div with the placeholder/selected text
  const dropdown = page.locator('div').filter({ hasText: new RegExp(`^${placeholder}$`) }).first()
    .or(page.getByText(placeholder, { exact: true }).first());

  await dropdown.click();
  // Wait for dropdown options to appear, then click the target
  const option = page.getByText(optionLabel, { exact: true }).first();
  await option.waitFor({ state: 'visible', timeout: 5_000 });
  await option.click();
}

// ── Pagination ────────────────────────────────────────────────────────────────

/**
 * Click the "next page" pagination button.
 * ProfileTable renders: <button aria-label="Next page"> with a ChevronRight icon.
 */
export async function clickPaginationNext(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Next page' });
  await btn.waitFor({ state: 'visible', timeout: 8_000 });
  await btn.click();
}

/**
 * Click the "previous page" pagination button.
 * ProfileTable renders: <button aria-label="Previous page"> with a ChevronLeft icon.
 */
export async function clickPaginationPrev(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: 'Previous page' });
  await btn.waitFor({ state: 'visible', timeout: 8_000 });
  await btn.click();
}

/**
 * Click a specific page number button in the pagination bar.
 */
export async function clickPageNumber(page: Page, pageNum: number): Promise<void> {
  const btn = page.getByRole('button', { name: `Go to page ${pageNum}` });
  await btn.waitFor({ state: 'visible', timeout: 5_000 });
  await btn.click();
}

/**
 * Get the currently active page number from the pagination bar.
 * Returns the 1-based page number, or 0 if no active page is found.
 */
export async function getActivePage(page: Page): Promise<number> {
  const activeBtn = page.locator('button[aria-current="page"]');
  const isVisible = await activeBtn.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!isVisible) return 0;
  const text = (await activeBtn.textContent())?.trim() ?? '0';
  return parseInt(text, 10) || 0;
}

/**
 * Get the "Menampilkan X–Y dari Z data" info text from the pagination bar.
 * Returns empty string if not found.
 */
export async function getDataInfoText(page: Page): Promise<string> {
  const dataInfo = page.locator('span').filter({ hasText: /Menampilkan.*dari.*data/ }).first();
  const isVisible = await dataInfo.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!isVisible) return '';
  return (await dataInfo.textContent())?.trim() ?? '';
}

/**
 * Check whether the Next page button is disabled.
 */
export async function isNextPageDisabled(page: Page): Promise<boolean> {
  const btn = page.getByRole('button', { name: 'Next page' });
  return btn.isDisabled();
}

/**
 * Check whether the Previous page button is disabled.
 */
export async function isPrevPageDisabled(page: Page): Promise<boolean> {
  const btn = page.getByRole('button', { name: 'Previous page' });
  return btn.isDisabled();
}

// ── Sort ─────────────────────────────────────────────────────────────────────

/**
 * Click a column header to toggle its sort state.
 * Headers cycle: none → asc → desc → none.
 */
export async function clickColumnSort(page: Page, headerText: string): Promise<void> {
  const header = page.locator('thead th').filter({ hasText: headerText }).first();
  await header.waitFor({ state: 'visible', timeout: 5_000 });
  await header.click();
}

// ── Column Headers ────────────────────────────────────────────────────────────

/**
 * Get all visible column header texts from thead.
 * Note: sort icons are inline SVGs, not text — textContent only captures the label.
 */
export async function getColumnHeaders(page: Page): Promise<string[]> {
  const headers = page.locator('thead th');
  const count = await headers.count();
  const texts: string[] = [];

  for (let i = 0; i < count; i++) {
    const text = (await headers.nth(i).textContent())?.trim() ?? '';
    if (text) texts.push(text);
  }
  return texts;
}

/**
 * Assert that specific column headers exist in the table.
 */
export async function assertColumnsExist(
  page: Page,
  expectedColumns: string[],
): Promise<{ found: string[]; missing: string[] }> {
  const actual = await getColumnHeaders(page);
  const found: string[] = [];
  const missing: string[] = [];

  for (const col of expectedColumns) {
    if (actual.some((h) => h.includes(col))) {
      found.push(col);
    } else {
      missing.push(col);
    }
  }

  return { found, missing };
}

// ── Modal ─────────────────────────────────────────────────────────────────────

/**
 * Click a specific table row by its index (0-based).
 */
export async function clickTableRow(page: Page, rowIndex: number): Promise<void> {
  const rows = page.locator('tbody tr');
  await rows.nth(rowIndex).waitFor({ state: 'visible', timeout: 8_000 });
  await rows.nth(rowIndex).click();
}

/**
 * Wait for a modal to become visible.
 */
export async function waitForModal(page: Page, timeoutMs = 8_000): Promise<Locator> {
  const modal = page
    .locator('[role="dialog"], [class*="Modal"][class*="Container"], [class*="ModalWrapper"]')
    .first();
  await modal.waitFor({ state: 'visible', timeout: timeoutMs });
  return modal;
}

/**
 * Login helper — to be used in beforeAll when global auth state is not available.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  const adminEmail = process.env.TEST_ADMIN_EMAIL || 'test.admin@spmm.test';
  const adminPassword = process.env.TEST_ADMIN_PASSWORD || 'TestAdmin123!';

  await page.goto('/app/login');

  const emailInput = page.locator('input[name="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 15_000 });

  await emailInput.fill(adminEmail);
  await page.locator('input[name="password"]').fill(adminPassword);

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/login') && r.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    page.getByRole('button', { name: 'Masuk' }).click(),
  ]);

  await page.waitForURL(/\/app\/?$/, { timeout: 15_000 });
}
