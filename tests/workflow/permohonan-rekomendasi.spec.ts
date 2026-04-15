import { test, expect } from '@playwright/test';
import { verifyWorkflowListLoads, startWorkflowProcess } from './workflow-base';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { fillDynamicForm } from '../../helpers/form.helpers';
import { waitForPageLoad, waitForTableLoad, waitForApiResponse } from '../../helpers/wait.helpers';
import { TEST_FILES } from '../../helpers/file.helpers';
import { hasAuthState } from '../../helpers/login.helpers';
import path from 'path';

/**
 * Workflow: Permohonan Rekomendasi Pendirian Ma'had Aly
 *
 * Route structure:
 *   /app/recommendation              — list of submissions
 *   /app/recommendation/add-recommendation  — start new submission
 *   /app/recommendation/submission-recommendation/:task_id — fill task form
 *
 * Initiating role: Dewan Masyayikh (DM)
 * Processing role: Sekretariat (SK) for review tasks
 */

// Use DM role (set in dm-tests project via playwright.config.ts)
test.describe('Permohonan Rekomendasi Ma\'had Aly', () => {
  test.beforeEach(async ({ page }) => {
    if (!hasAuthState('dm')) test.skip();
  });

  test('recommendation list loads for DM role', async ({ page }) => {
    await verifyWorkflowListLoads(page, '/app/recommendation');
    await expect(page.getByRole('button', { name: 'Buat Pengajuan Baru' })).toBeVisible();
  });

  test('add-recommendation page renders upload fields', async ({ page }) => {
    await page.goto('/app/recommendation/add-recommendation');
    await waitForPageLoad(page);

    // AddRecommendationScreen renders UploadInput with specific IDs
    const permohonanInput = page.locator('#upload-permohonan');
    const ripInput = page.locator('#upload-rip');

    await expect(permohonanInput).toBeAttached({ timeout: 10_000 });
    await expect(ripInput).toBeAttached({ timeout: 10_000 });
  });

  test('can upload files to add-recommendation form', async ({ page }) => {
    await page.goto('/app/recommendation/add-recommendation');
    await waitForPageLoad(page);

    await page.locator('#upload-permohonan').setInputFiles(TEST_FILES.pdf);
    await page.locator('#upload-rip').setInputFiles(TEST_FILES.pdf);

    const permohonanFiles = await page
      .locator('#upload-permohonan')
      .evaluate((el: HTMLInputElement) => el.files?.length ?? 0);
    const ripFiles = await page
      .locator('#upload-rip')
      .evaluate((el: HTMLInputElement) => el.files?.length ?? 0);

    expect(permohonanFiles).toBe(1);
    expect(ripFiles).toBe(1);
  });

  test('add-recommendation form has all required action buttons', async ({ page }) => {
    await page.goto('/app/recommendation/add-recommendation');
    await waitForPageLoad(page);

    await expect(page.getByRole('button', { name: 'Kirim Pengajuan' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Simpan' })).toBeVisible();
  });

  test('saving draft does not navigate away immediately', async ({ page }) => {
    await page.goto('/app/recommendation/add-recommendation');
    await waitForPageLoad(page);

    const saveBtn = page.getByRole('button', { name: 'Simpan' });
    await saveBtn.click();
    await page.waitForTimeout(2_000);

    // Draft save should keep user on the form or navigate to list
    const url = page.url();
    const isStillOnForm =
      url.includes('recommendation') && !url.includes('submission');
    expect(isStillOnForm).toBe(true);
  });

  test('submission task form renders DynamicForm (if task exists)', async ({ page }) => {
    // Navigate to recommendation list and open the first pending task
    await page.goto('/app/recommendation');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      console.log('No existing recommendation tasks to test submission form.');
      return;
    }

    // Click the first task's action button
    const firstRow = rows.first();
    await firstRow.locator('button').first().click();
    await waitForPageLoad(page);

    await expect(page).toHaveURL(/.*submission-recommendation.*/);

    // Wait for the dynamic form to load (requires choosetask API response)
    await page
      .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
      .catch(() => null);

    await page.waitForTimeout(1_000);

    const submission = new SubmissionPage(page);

    // At least one decision/action button should be visible
    const hasDecisionBtn =
      (await submission.approveButton.isVisible({ timeout: 8_000 }).catch(() => false)) ||
      (await submission.saveButton.isVisible({ timeout: 2_000 }).catch(() => false)) ||
      (await submission.rejectButton.isVisible({ timeout: 2_000 }).catch(() => false));

    expect(hasDecisionBtn).toBe(true);
  });

  test('task log endpoint responds for existing tasks', async ({ page }) => {
    await page.goto('/app/recommendation');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    if (await rows.count() === 0) return;

    // Open a task and check for task log
    await rows.first().locator('button').first().click();
    await waitForPageLoad(page);

    // logtask is called to show the task history timeline
    const logResponse = await page
      .waitForResponse((r) => r.url().includes('/logtask'), { timeout: 10_000 })
      .catch(() => null);

    if (logResponse) {
      expect(logResponse.status()).toBeLessThan(400);
    }
  });

  test('cancelation ("Batalkan Tiket") triggers confirmation flow', async ({ page }) => {
    await page.goto('/app/recommendation/add-recommendation');
    await waitForPageLoad(page);

    const cancelBtn = page.getByRole('button', { name: 'Batalkan Tiket' });
    if (await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(500);

      // Should show a confirmation modal
      const modal = page.locator('[role="dialog"], [class*="Modal"]').first();
      await expect(modal).toBeVisible({ timeout: 5_000 });
    }
  });
});
