import { test, expect } from '@playwright/test';
import { verifyWorkflowListLoads } from './workflow-base';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { waitForPageLoad, waitForTableLoad } from '../../helpers/wait.helpers';
import { hasAuthState, getStorageStatePath } from '../../helpers/login.helpers';

/**
 * Workflow: SPME DIKDASMEN
 * (External Quality Assessment — Formal Education / DIKDASMEN)
 *
 * Route structure:
 *   /app/spme                             — category picker
 *   /app/spme/dikdasmen                   — DIKDASMEN submission list
 *   /app/spme/submission/:task_id         — task form
 *   /app/assessment-submission/submission-spme/:task_id — assessor form
 *
 * Roles:
 *   - Tenaga Ahli (TA): core assessor
 *   - Asessor Dikdasmen (ASDK): performs DIKDASMEN assessment
 *   - DIKDASMEN (DK): institution under review
 *   - Majelis Masyayikh (MM): approval
 *   - Sekretariat (SK): workflow management
 */
test.describe('SPME DIKDASMEN', () => {
  test.beforeEach(async ({}) => {
    if (!hasAuthState('ta') && !hasAuthState('sk')) test.skip();
  });

  test('SPME DIKDASMEN list accessible at /app/spme/dikdasmen', async ({ page }) => {
    await verifyWorkflowListLoads(page, '/app/spme/dikdasmen');
  });

  test('no 401 errors on SPME DIKDASMEN page', async ({ page }) => {
    const authErrors: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && r.url().includes('/api/')) authErrors.push(r.url());
    });

    await page.goto('/app/spme/dikdasmen');
    await waitForPageLoad(page);
    await page.waitForTimeout(2_000);
    expect(authErrors).toHaveLength(0);
  });

  test('DIKDASMEN list has table structure', async ({ page }) => {
    await page.goto('/app/spme/dikdasmen');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const headers = page.locator('thead th');
    expect(await headers.count()).toBeGreaterThan(0);
  });

  test('DIKDASMEN submission task opens DynamicForm', async ({ page }) => {
    await page.goto('/app/spme/dikdasmen');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    if (await rows.count() === 0) {
      console.log('No SPME DIKDASMEN tasks — skipping submission form test.');
      return;
    }

    await rows.first().locator('button').first().click();
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*submission.*/);

    await page
      .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
      .catch(() => null);
    await page.waitForTimeout(1_000);

    const submission = new SubmissionPage(page);
    const hasAction =
      (await submission.saveButton.isVisible({ timeout: 8_000 }).catch(() => false)) ||
      (await submission.approveButton.isVisible({ timeout: 2_000 }).catch(() => false));
    expect(hasAction).toBe(true);
  });

  test('Asessor Dikdasmen can access SPME DIKDASMEN', async ({ browser }) => {
    if (!hasAuthState('asdk')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('asdk') });
    const page = await context.newPage();

    try {
      await page.goto('/app/assessment-submission');
      await waitForPageLoad(page);
      await expect(page).not.toHaveURL(/.*login.*/);
    } finally {
      await context.close();
    }
  });

  test('DIKDASMEN role can access assessment submission', async ({ browser }) => {
    if (!hasAuthState('dk')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('dk') });
    const page = await context.newPage();

    try {
      await page.goto('/app/assessment-submission');
      await waitForPageLoad(page);
      await expect(page).not.toHaveURL(/.*login.*/);
    } finally {
      await context.close();
    }
  });

  test('DIKDASMEN role cannot access recommendation workflow', async ({ browser }) => {
    if (!hasAuthState('dk')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('dk') });
    const page = await context.newPage();

    try {
      await page.goto('/app/recommendation');
      await waitForPageLoad(page);

      // Should either redirect to dashboard or show empty/forbidden state
      // DK role does not have recommendation access
      const onRecommendation = page.url().includes('/recommendation');
      if (onRecommendation) {
        // No "Buat Pengajuan Baru" button should be visible for non-DM roles
        const createBtn = page.getByRole('button', { name: 'Buat Pengajuan Baru' });
        await expect(createBtn).not.toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await context.close();
    }
  });
});
