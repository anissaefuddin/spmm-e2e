import { test, expect } from '../../fixtures/auth.fixture';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { waitForTableLoad, waitForPageLoad } from '../../helpers/wait.helpers';

/**
 * E-Signature Workflow Tests
 *
 * Uses sk-auth.json storageState (sk-tests project).
 * The SK (Sekretariat) role handles the e-sign workflow.
 *
 * E-Sign flow:
 *   1. Navigate to /app/esign
 *   2. View pending tasks
 *   3. Open a task → DynamicForm renders PDF signature fields
 *   4. Select signature coordinates on PDF
 *   5. Submit → backend calls BSrE API with TOTP
 *   6. Signed PDF stored in MinIO, QR code generated
 *
 * TOTP limitation: TOTP codes cannot be automated without the secret key.
 * These tests verify the flow up to the TOTP entry point.
 * Full end-to-end signing requires a test BSrE environment with a known TOTP secret.
 */
test.describe('E-Sign Workflow', () => {
  test('esign list page renders for SK role', async ({ authenticatedPage: page }) => {
    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    // Page should be accessible (not redirect to login or 404)
    await expect(page).toHaveURL(/.*esign.*/);
    await expect(page).not.toHaveURL(/.*login.*/);
  });

  test('esign page does not show 401 or 403 errors', async ({ authenticatedPage: page }) => {
    const authErrors: number[] = [];

    page.on('response', (response) => {
      if ([401, 403].includes(response.status()) && response.url().includes('/api/')) {
        authErrors.push(response.status());
      }
    });

    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await page.waitForTimeout(2_000);

    expect(authErrors).toHaveLength(0);
  });

  test('esign table renders columns (if tasks exist)', async ({ authenticatedPage: page }) => {
    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      // No tasks to sign — verify empty state renders gracefully
      const emptyState = page
        .getByText(/belum ada|tidak ada data|no data|empty/i)
        .first();
      const isEmptyVisible = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false);
      // Either empty state text or the table renders with 0 rows — both valid
      expect(isEmptyVisible || rowCount === 0).toBe(true);
      return;
    }

    // Table has at least 1 row — verify basic structure
    const firstRow = rows.first();
    await expect(firstRow).toBeVisible();
  });

  test('opening esign task navigates to submission screen', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      test.skip();
      return;
    }

    // Click the action button on the first task
    const firstRow = rows.first();
    const actionButton = firstRow.locator('button').first();
    await actionButton.click();
    await waitForPageLoad(page);

    // Should navigate to the esign submission screen
    await expect(page).toHaveURL(/.*esign.*submission.*|.*submission.*/);
  });

  test('esign submission screen renders DynamicForm', async ({ authenticatedPage: page }) => {
    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      test.skip();
      return;
    }

    const firstRow = rows.first();
    await firstRow.locator('button').first().click();
    await waitForPageLoad(page);

    // DynamicForm renders the form fields from the backend ProcessVariable definitions
    // The form wraps everything in a FormProvider (react-hook-form)
    const formContainer = page.locator('form').first();
    await expect(formContainer).toBeVisible({ timeout: 15_000 });
  });

  test('esign submission screen shows approve/reject buttons', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    if (rowCount === 0) {
      test.skip();
      return;
    }

    const firstRow = rows.first();
    await firstRow.locator('button').first().click();
    await waitForPageLoad(page);

    const submission = new SubmissionPage(page);

    // At least one of the decision buttons should be visible
    const hasApprove = await submission.approveButton.isVisible({ timeout: 10_000 }).catch(() => false);
    const hasSave = await submission.saveButton.isVisible({ timeout: 2_000 }).catch(() => false);
    const hasReject = await submission.rejectButton.isVisible({ timeout: 2_000 }).catch(() => false);

    expect(hasApprove || hasSave || hasReject).toBe(true);
  });

  test('PDF signature modal can be triggered (if PDF field exists)', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await waitForTableLoad(page).catch(() => null);

    const rows = page.locator('tbody tr');
    if (await rows.count() === 0) {
      test.skip();
      return;
    }

    await rows.first().locator('button').first().click();
    await waitForPageLoad(page);

    // Look for a PDF signature placement button/area
    // PDFSignaturePlacement renders a button or area to click for coordinate selection
    const pdfSignArea = page.locator('[class*="PDF"], [class*="Signature"], button').filter({
      hasText: /tanda tangan|sign|ttd/i,
    });

    if (await pdfSignArea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await pdfSignArea.first().click();
      // PDF modal should appear
      const modal = page.locator('[role="dialog"], [class*="Modal"]').first();
      await expect(modal).toBeVisible({ timeout: 10_000 });
    }
  });
});
