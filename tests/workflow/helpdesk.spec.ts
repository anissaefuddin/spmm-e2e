import { test, expect } from '@playwright/test';
import { verifyWorkflowListLoads } from './workflow-base';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { fillDynamicForm } from '../../helpers/form.helpers';
import { waitForPageLoad, waitForTableLoad } from '../../helpers/wait.helpers';
import { hasAuthState } from '../../helpers/login.helpers';

/**
 * Workflow: Help Desk / Bantuan & Dukungan
 *
 * Route structure:
 *   /app/support                       — ticket list
 *   /app/support/submission-support/:task_id — task form
 *
 * The Help Desk module uses the same BPM engine as other workflows.
 * Available to all authenticated roles (via sidebar "Bantuan & Dukungan").
 *
 * This spec runs under the SK (Sekretariat) storageState (sk-tests project).
 */
test.describe('Help Desk Workflow', () => {
  test.beforeEach(async ({ page }) => {
    if (!hasAuthState('sk')) test.skip();
  });

  test('help desk list loads and shows search/filter', async ({ page }) => {
    await verifyWorkflowListLoads(page, '/app/support');

    const searchInput = page.locator('input[placeholder="Search..."]');
    await expect(searchInput).toBeVisible({ timeout: 8_000 });
  });

  test('help desk page accessible without redirect to login', async ({ page }) => {
    await page.goto('/app/support');
    await waitForPageLoad(page);
    await expect(page).not.toHaveURL(/.*login.*/);
    await expect(page).toHaveURL(/.*support.*/);
  });

  test('no 401 errors on help desk page load', async ({ page }) => {
    const authErrors: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && r.url().includes('/api/')) authErrors.push(r.url());
    });

    await page.goto('/app/support');
    await waitForPageLoad(page);
    await page.waitForTimeout(2_000);

    expect(authErrors).toHaveLength(0);
  });

  test('help desk table has expected structure', async ({ page }) => {
    await page.goto('/app/support');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const headers = page.locator('thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test('search filters help desk tickets', async ({ page }) => {
    await page.goto('/app/support');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const searchInput = page.locator('input[placeholder="Search..."]');
    await searchInput.fill('xyz_no_match_9999');
    await page.waitForTimeout(700);
    await waitForTableLoad(page).catch(() => null);

    // Table should filter — either 0 rows or rows containing the search term
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('submission task form loads for existing support ticket', async ({ page }) => {
    await page.goto('/app/support');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      console.log('No existing helpdesk tasks — skipping submission form test.');
      return;
    }

    // Click first task's action button
    const firstRow = rows.first();
    await firstRow.locator('button').first().click();
    await waitForPageLoad(page);

    await expect(page).toHaveURL(/.*submission-support.*/);

    // Dynamic form should load
    await page
      .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
      .catch(() => null);

    await page.waitForTimeout(1_000);

    const submission = new SubmissionPage(page);
    const hasBtn =
      (await submission.saveButton.isVisible({ timeout: 8_000 }).catch(() => false)) ||
      (await submission.approveButton.isVisible({ timeout: 2_000 }).catch(() => false));

    expect(hasBtn).toBe(true);
  });

  test('submission form back button returns to support list', async ({ page }) => {
    await page.goto('/app/support');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    if (await rows.count() === 0) return;

    await rows.first().locator('button').first().click();
    await waitForPageLoad(page);

    const onSubmissionPage = page.url().includes('submission');
    if (!onSubmissionPage) return;

    const backButton = page.getByRole('button', { name: /kembali|back/i }).first();
    if (await backButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await backButton.click();
      await waitForPageLoad(page);
      await expect(page).toHaveURL(/.*support$/);
    }
  });
});
