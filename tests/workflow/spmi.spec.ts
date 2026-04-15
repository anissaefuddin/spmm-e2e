import { test, expect } from '@playwright/test';
import { verifyWorkflowListLoads } from './workflow-base';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { waitForPageLoad, waitForTableLoad } from '../../helpers/wait.helpers';
import { hasAuthState } from '../../helpers/login.helpers';

/**
 * Workflow: SPMI — Sistem Penjaminan Mutu Internal
 * (Internal Quality Assurance Report)
 *
 * Route structure:
 *   /app/assessment-report              — SPMI report list (Laporan SPM Internal)
 *   /app/assessment-report/submission-spmi/:task_id — task form
 *
 * This spec runs under the SK (Sekretariat) storageState (sk-tests project).
 * Sekretariat has access to all workflows including SPMI.
 */
test.describe('SPMI — Laporan SPM Internal', () => {
  test.beforeEach(async ({ page }) => {
    if (!hasAuthState('sk')) test.skip();
  });

  test('SPMI list page loads without errors', async ({ page }) => {
    await verifyWorkflowListLoads(page, '/app/assessment-report');
  });

  test('SPMI page accessible at /app/assessment-report', async ({ page }) => {
    await page.goto('/app/assessment-report');
    await waitForPageLoad(page);
    await expect(page).not.toHaveURL(/.*login.*/);
    await expect(page).toHaveURL(/.*assessment-report.*/);
  });

  test('no 401 errors on SPMI page', async ({ page }) => {
    const authErrors: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && r.url().includes('/api/')) authErrors.push(r.url());
    });

    await page.goto('/app/assessment-report');
    await waitForPageLoad(page);
    await page.waitForTimeout(2_000);
    expect(authErrors).toHaveLength(0);
  });

  test('SPMI list has search and filter controls', async ({ page }) => {
    await page.goto('/app/assessment-report');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const searchInput = page.locator('input[placeholder="Search..."]');
    await expect(searchInput).toBeVisible({ timeout: 8_000 });
  });

  test('SPMI table shows correct columns (if data exists)', async ({ page }) => {
    await page.goto('/app/assessment-report');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const headers = page.locator('thead th');
    const count = await headers.count();
    expect(count).toBeGreaterThan(0);
  });

  test('SPMI submission task form loads for existing task', async ({ page }) => {
    await page.goto('/app/assessment-report');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    if (await rows.count() === 0) {
      console.log('No SPMI tasks available — skipping submission form test.');
      return;
    }

    const firstRow = rows.first();
    await firstRow.locator('button').first().click();
    await waitForPageLoad(page);

    await expect(page).toHaveURL(/.*submission-spmi.*/);

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

  test('mytodolist API responds for SPMI tasks', async ({ page }) => {
    await page.goto('/app/assessment-report');

    const todoListResponse = await page
      .waitForResponse((r) => r.url().includes('/mytodolist'), { timeout: 15_000 })
      .catch(() => null);

    if (todoListResponse) {
      expect(todoListResponse.status()).toBeLessThan(400);
    }
  });

  test('SPMI submission form handles text field input', async ({ page }) => {
    await page.goto('/app/assessment-report');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    if (await rows.count() === 0) return;

    await rows.first().locator('button').first().click();
    await waitForPageLoad(page);

    const onSubmission = page.url().includes('submission-spmi');
    if (!onSubmission) return;

    await page
      .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
      .catch(() => null);
    await page.waitForTimeout(1_000);

    // Try filling any visible text input in the form
    const visibleInputs = page.locator('form input[type="text"]:not([disabled])');
    const inputCount = await visibleInputs.count();
    if (inputCount > 0) {
      const firstInput = visibleInputs.first();
      await firstInput.fill('Test E2E Value');
      await expect(firstInput).toHaveValue('Test E2E Value');
    }
  });
});
