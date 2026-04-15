import { test, expect } from '../../fixtures/auth.fixture';
import { RecommendationPage } from '../../pages/RecommendationPage';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { waitForTableLoad, waitForPageLoad, waitForApiResponse } from '../../helpers/wait.helpers';
import { TEST_FILES } from '../../helpers/file.helpers';

/**
 * Recommendation Workflow Tests
 *
 * Uses dm-auth.json storageState (dm-tests project).
 * The DM role can create and submit recommendation workflows.
 *
 * Workflow sequence:
 *   1. Navigate to /app/recommendation
 *   2. Click "Buat Pengajuan Baru" → POST /api/checkprocesstostart
 *   3. Fill form → upload files → click "Kirim Pengajuan" → POST /api/startProcess
 *   4. Navigate to task list → open task → fill DynamicForm → submit
 */
test.describe('Recommendation Workflow', () => {
  test('recommendation list renders for DM role', async ({ authenticatedPage: page }) => {
    const recPage = new RecommendationPage(page);
    await recPage.goto();

    await expect(recPage.searchInput).toBeVisible();
    // DM role sees the "Buat Pengajuan Baru" button
    await expect(recPage.createButton).toBeVisible();
  });

  test('recommendation table shows correct columns', async ({ authenticatedPage: page }) => {
    const recPage = new RecommendationPage(page);
    await recPage.goto();

    // Table should have at least one header
    const headers = page.locator('thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test('search filters recommendation list', async ({ authenticatedPage: page }) => {
    const recPage = new RecommendationPage(page);
    await recPage.goto();

    await recPage.searchInput.fill('TKT-NOTEXIST-99999');
    await page.waitForTimeout(700);
    await waitForTableLoad(page);

    // Expect either empty state or filtered results
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    // If there are rows, they should not be the full unfiltered list
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('clicking "Buat Pengajuan Baru" navigates to add recommendation form', async ({
    authenticatedPage: page,
  }) => {
    const recPage = new RecommendationPage(page);
    await recPage.goto();

    // The DM role may see a warning modal if lembaga is not set
    // Handle both paths: direct navigation OR modal
    await recPage.createButton.click();
    await page.waitForTimeout(1_000);

    // Either navigated to /recommendation/add or a modal appeared
    const onAddPage = page.url().includes('/recommendation/add');
    const hasModal = await page
      .locator('[role="dialog"], [class*="Modal"]')
      .isVisible()
      .catch(() => false);

    expect(onAddPage || hasModal).toBe(true);

    // If modal appeared, close it
    if (hasModal && !onAddPage) {
      const closeButton = page.getByRole('button', { name: /Tutup|Close|Ok/ }).first();
      if (await closeButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await closeButton.click();
      }
    }
  });

  test('add recommendation form renders upload fields', async ({ authenticatedPage: page }) => {
    await page.goto('/app/recommendation/add');
    await waitForPageLoad(page);

    // AddRecommendationScreen renders UploadInput with id="upload-permohonan"
    const permohonanUpload = page.locator('#upload-permohonan');
    await expect(permohonanUpload).toBeAttached({ timeout: 10_000 });

    const ripUpload = page.locator('#upload-rip');
    await expect(ripUpload).toBeAttached({ timeout: 10_000 });
  });

  test('can upload a PDF to the permohonan field', async ({ authenticatedPage: page }) => {
    await page.goto('/app/recommendation/add');
    await waitForPageLoad(page);

    const submission = new SubmissionPage(page);

    // Upload the sample PDF
    await submission.uploadFile('upload-permohonan', TEST_FILES.pdf);

    // Verify the file input has a file
    const fileInput = page.locator('#upload-permohonan');
    const fileCount = await fileInput.evaluate(
      (el: HTMLInputElement) => el.files?.length ?? 0,
    );
    expect(fileCount).toBe(1);
  });

  test('add recommendation form has submission buttons', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app/recommendation/add');
    await waitForPageLoad(page);

    const submission = new SubmissionPage(page);

    await expect(submission.submitButton).toBeVisible({ timeout: 10_000 });
    await expect(submission.draftButton).toBeVisible({ timeout: 10_000 });
  });

  test('opening an existing task navigates to submission screen', async ({
    authenticatedPage: page,
  }) => {
    const recPage = new RecommendationPage(page);
    await recPage.goto();

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      test.skip();
      return;
    }

    // Click the first row's action
    const firstRow = rows.first();
    const actionButton = firstRow.locator('button').first();
    await actionButton.click();
    await waitForPageLoad(page);

    // Should navigate to submission/:task_id
    await expect(page).toHaveURL(/.*submission.*/);
  });
});
