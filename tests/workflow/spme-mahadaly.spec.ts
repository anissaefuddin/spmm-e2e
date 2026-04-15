import { test, expect } from '@playwright/test';
import { verifyWorkflowListLoads } from './workflow-base';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { waitForPageLoad, waitForTableLoad } from '../../helpers/wait.helpers';
import { hasAuthState, getStorageStatePath } from '../../helpers/login.helpers';

/**
 * Workflow: SPME Ma'had Aly
 * (External Quality Assessment — Islamic boarding schools)
 *
 * Route structure:
 *   /app/spme              — category picker (MahadAly / DIKDASMEN)
 *   /app/spme/mahadaly     — Ma'had Aly submission list
 *   /app/spme/submission/:task_id — task form
 *   /app/assessment-submission/submission-spme/:task_id — assessor task form
 *
 * Roles:
 *   - Tenaga Ahli (TA): fills SPME Ma'had Aly assessments
 *   - Tenaga Asisten (TAS): assists with Ma'had Aly assessment
 *   - Assessor Ma'had Aly (ASMA): performs the assessment
 *   - Majelis Masyayikh (MM): reviews/approves SPME
 *   - Sekretariat (SK): manages the full workflow
 *
 * This spec runs in the specialist-tests project.
 * It uses the TA auth state by default, but also tests with SK for workflow management.
 */

// Default to TA role (from specialist-tests project = ta-auth.json)
test.describe("SPME Ma'had Aly", () => {
  test.beforeEach(async ({}) => {
    if (!hasAuthState('ta') && !hasAuthState('sk')) test.skip();
  });

  test('SPME category picker page loads at /app/spme', async ({ page }) => {
    // Use SK role for broad access
    if (hasAuthState('sk')) {
      test.use({ storageState: getStorageStatePath('sk') });
    }
    await page.goto('/app/spme');
    await waitForPageLoad(page);
    await expect(page).not.toHaveURL(/.*login.*/);
    await expect(page).toHaveURL(/.*spme.*/);
  });

  test('Ma\'had Aly list accessible at /app/spme/mahadaly', async ({ page }) => {
    await verifyWorkflowListLoads(page, '/app/spme/mahadaly');
  });

  test('no 401 errors on SPME Ma\'had Aly page', async ({ page }) => {
    const authErrors: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && r.url().includes('/api/')) authErrors.push(r.url());
    });

    await page.goto('/app/spme/mahadaly');
    await waitForPageLoad(page);
    await page.waitForTimeout(2_000);
    expect(authErrors).toHaveLength(0);
  });

  test('SPME Ma\'had Aly list has search functionality', async ({ page }) => {
    await page.goto('/app/spme/mahadaly');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const searchInput = page.locator('input[placeholder="Search..."]');
    await expect(searchInput).toBeVisible({ timeout: 8_000 });
  });

  test('SPME table columns render correctly', async ({ page }) => {
    await page.goto('/app/spme/mahadaly');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const headers = page.locator('thead th');
    const count = await headers.count();
    expect(count).toBeGreaterThan(0);
  });

  test('SPME Ma\'had Aly submission task opens DynamicForm', async ({ page }) => {
    await page.goto('/app/spme/mahadaly');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    if (await rows.count() === 0) {
      console.log('No SPME Ma\'had Aly tasks — skipping.');
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

  test('assessment-submission page loads for assessor role (ASMA)', async ({ browser }) => {
    if (!hasAuthState('asma')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('asma') });
    const page = await context.newPage();

    try {
      await page.goto('/app/assessment-submission');
      await waitForPageLoad(page);
      await expect(page).not.toHaveURL(/.*login.*/);
    } finally {
      await context.close();
    }
  });

  test('Tenaga Asisten can access SPME Ma\'had Aly', async ({ browser }) => {
    if (!hasAuthState('tas')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('tas') });
    const page = await context.newPage();

    try {
      await page.goto('/app/spme/mahadaly');
      await waitForPageLoad(page);
      await expect(page).not.toHaveURL(/.*login.*/);
    } finally {
      await context.close();
    }
  });

  test('Majelis Masyayikh can access SPME', async ({ browser }) => {
    if (!hasAuthState('mm')) {
      test.skip();
      return;
    }

    const context = await browser.newContext({ storageState: getStorageStatePath('mm') });
    const page = await context.newPage();

    try {
      await page.goto('/app/spme');
      await waitForPageLoad(page);
      await expect(page).not.toHaveURL(/.*login.*/);
    } finally {
      await context.close();
    }
  });
});
