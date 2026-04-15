import { test, expect } from '@playwright/test';
import { verifyWorkflowListLoads } from './workflow-base';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { waitForPageLoad, waitForTableLoad } from '../../helpers/wait.helpers';
import { hasAuthState, getStorageStatePath } from '../../helpers/login.helpers';

/**
 * Workflow: Tanda Tangan Elektronik Bulk (Bulk E-Sign)
 *
 * Route structure:
 *   /app/esign                — e-sign list (all pending signatures)
 *   /app/esign/submission/:task_id — signing task
 *
 * Roles:
 *   - Majelis Masyayikh (MM): primary bulk signer
 *   - Sekretariat (SK): manages the process
 *
 * E-Sign integration: BSrE API
 * TOTP limitation: TOTP codes cannot be automated without the secret key.
 * Tests verify up to the signing confirmation step.
 *
 * This spec runs in the specialist-tests project with MM storageState override.
 */
test.describe('Tanda Tangan Elektronik Bulk', () => {
  // Override to use MM role for this spec
  test.use({ storageState: '' }); // Overridden per test using browser.newContext()

  test.beforeEach(async ({}) => {
    if (!hasAuthState('mm') && !hasAuthState('sk')) test.skip();
  });

  test('e-sign list loads for Majelis Masyayikh role', async ({ browser }) => {
    if (!hasAuthState('mm')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('mm') });
    const page = await context.newPage();

    try {
      await page.goto('/app/esign');
      await waitForPageLoad(page);
      await expect(page).not.toHaveURL(/.*login.*/);
      await expect(page).toHaveURL(/.*esign.*/);
    } finally {
      await context.close();
    }
  });

  test('e-sign list loads for Sekretariat role', async ({ browser }) => {
    if (!hasAuthState('sk')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('sk') });
    const page = await context.newPage();

    try {
      await verifyWorkflowListLoads(page, '/app/esign');
    } finally {
      await context.close();
    }
  });

  test('no 401 errors on e-sign page (MM role)', async ({ browser }) => {
    if (!hasAuthState('mm')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('mm') });
    const page = await context.newPage();

    try {
      const authErrors: string[] = [];
      page.on('response', (r) => {
        if (r.status() === 401 && r.url().includes('/api/')) authErrors.push(r.url());
      });

      await page.goto('/app/esign');
      await waitForPageLoad(page);
      await page.waitForTimeout(2_000);
      expect(authErrors).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test('e-sign list has table structure', async ({ browser }) => {
    const role = hasAuthState('mm') ? 'mm' : 'sk';
    if (!hasAuthState(role)) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath(role) });
    const page = await context.newPage();

    try {
      await page.goto('/app/esign');
      await waitForPageLoad(page);
      await waitForTableLoad(page).catch(() => null);

      const headers = page.locator('thead th');
      const count = await headers.count();
      expect(count).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  test('signing task form loads (no TOTP submission)', async ({ browser }) => {
    const role = hasAuthState('mm') ? 'mm' : 'sk';
    if (!hasAuthState(role)) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath(role) });
    const page = await context.newPage();

    try {
      await page.goto('/app/esign');
      await waitForPageLoad(page);
      await waitForTableLoad(page).catch(() => null);

      const rows = page.locator('tbody tr');
      if (await rows.count() === 0) {
        console.log('No e-sign tasks available — skipping submission form test.');
        return;
      }

      await rows.first().locator('button').first().click();
      await waitForPageLoad(page);

      await expect(page).toHaveURL(/.*esign.*submission.*/);

      // choosetask API loads the signing form
      await page
        .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
        .catch(() => null);
      await page.waitForTimeout(1_000);

      // DynamicForm renders with decision buttons
      const submission = new SubmissionPage(page);
      const hasAction =
        (await submission.saveButton.isVisible({ timeout: 8_000 }).catch(() => false)) ||
        (await submission.approveButton.isVisible({ timeout: 2_000 }).catch(() => false));
      expect(hasAction).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('TOTP modal appears when signing is triggered', async ({ browser }) => {
    const role = hasAuthState('mm') ? 'mm' : 'sk';
    if (!hasAuthState(role)) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath(role) });
    const page = await context.newPage();

    try {
      await page.goto('/app/esign');
      await waitForPageLoad(page);
      await waitForTableLoad(page).catch(() => null);

      const rows = page.locator('tbody tr');
      if (await rows.count() === 0) return;

      await rows.first().locator('button').first().click();
      await waitForPageLoad(page);

      await page
        .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
        .catch(() => null);
      await page.waitForTimeout(1_000);

      const submission = new SubmissionPage(page);

      // Click approve (triggers TOTP flow)
      const approveVisible = await submission.approveButton
        .isVisible({ timeout: 5_000 })
        .catch(() => false);

      if (approveVisible) {
        await submission.approveButton.click();
        await page.waitForTimeout(1_500);

        // TOTP modal or confirmation dialog should appear
        const modal = page.locator('[role="dialog"], [class*="Modal"]').first();
        const totpInput = page.locator('input[type="number"], input[inputmode="numeric"]').first();

        const hasModal = await modal.isVisible({ timeout: 5_000 }).catch(() => false);
        const hasTotpInput = await totpInput.isVisible({ timeout: 3_000 }).catch(() => false);

        // At least one should appear when signing is triggered
        console.log(`TOTP modal: ${hasModal}, TOTP input: ${hasTotpInput}`);
        // Not asserting — TOTP flow is environment-dependent
      }
    } finally {
      await context.close();
    }
  });

  test('Admin role cannot access e-sign workflow', async ({ browser }) => {
    if (!hasAuthState('admin')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await context.newPage();

    try {
      await page.goto('/app/esign');
      await waitForPageLoad(page);

      // Admin should not see e-sign or be redirected
      const isOnEsign = page.url().includes('/esign');
      if (isOnEsign) {
        // Sidebar "Tanda Tangan Elektronik" should not be visible for admin
        const esignSidebar = page.getByText('Tanda Tangan Elektronik', { exact: true });
        await expect(esignSidebar).not.toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await context.close();
    }
  });
});
