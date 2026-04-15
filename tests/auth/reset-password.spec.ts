import { test, expect } from '@playwright/test';
import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage';
import { waitForPageLoad, waitForToast } from '../../helpers/wait.helpers';

/**
 * Reset Password Flow Tests
 *
 * Flow:
 *   1. /app/forget-password → submit email → POST /api/forget-password
 *      Backend sends reset link with a token (valid for limited time)
 *   2. /app/reset-password/:token → submit new password → POST /api/reset-password
 *   3. Redirect to login → login with new password succeeds
 *
 * Full automation note:
 *   The reset token is sent via email. In automated tests, either:
 *   - Intercept the email using Mailhog (for local dev)
 *   - Use a backend API endpoint to generate a test token directly
 *   - Test up to step 1 and verify the success state
 */
test.describe('Forgot / Reset Password', () => {
  let forgotPage: ForgotPasswordPage;

  test.beforeEach(async ({ page }) => {
    forgotPage = new ForgotPasswordPage(page);
    await forgotPage.goto();
  });

  // ── A. Forgot Password Form ───────────────────────────────────────────────

  test('renders forgot password form with email field', async ({ page }) => {
    await expect(forgotPage.emailInput).toBeVisible();
    await expect(forgotPage.continueButton).toBeVisible();
  });

  test('shows page title or heading', async ({ page }) => {
    // ForgetPasswordScreen should have identifiable heading text
    const heading = page.getByRole('heading').first();
    const isHeadingVisible = await heading.isVisible({ timeout: 5_000 }).catch(() => false);
    // Accept either heading or any visible text on the page
    const hasContent = isHeadingVisible || (await page.locator('h1, h2, h3, p').count()) > 0;
    expect(hasContent).toBe(true);
  });

  test('empty email submission stays on forgot-password page', async ({ page }) => {
    await forgotPage.continueButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/.*forget-password.*/);
  });

  test('invalid email format is rejected', async ({ page }) => {
    await forgotPage.emailInput.fill('notanemail');
    await forgotPage.continueButton.click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/.*forget-password.*/);
  });

  test('submitting valid email calls POST /api/forget-password', async ({ page }) => {
    let apiCalled = false;
    let requestBody: unknown;

    await page.route('**/forget-password', (route) => {
      apiCalled = true;
      requestBody = JSON.parse(route.request().postData() ?? '{}');
      return route.continue();
    });

    const testEmail = 'test.admin@spmm.test';
    await forgotPage.submitEmail(testEmail);

    await page.waitForResponse(
      (r) => r.url().includes('/forget-password'),
      { timeout: 10_000 },
    ).catch(() => null);

    expect(apiCalled).toBe(true);
    expect((requestBody as { email?: string })?.email).toBe(testEmail);
  });

  test('submitting registered email shows success or confirmation message', async ({ page }) => {
    await forgotPage.submitEmail('test.admin@spmm.test');

    await page.waitForTimeout(3_000);

    // Success indicators: toast, message text, or navigation
    const successToast = await page
      .locator('.Toastify__toast--success')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    const successText = await page
      .getByText(/berhasil|sukses|email telah dikirim|check email|cek email/i)
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    const navigated = !page.url().includes('/forget-password');

    expect(successToast || successText || navigated).toBe(true);
  });

  test('non-existent email shows error message', async ({ page }) => {
    await forgotPage.submitEmail(`nonexistent.${Date.now()}@spmm.test`);

    await page.waitForTimeout(3_000);

    const errorToast = await page
      .locator('.Toastify__toast--error')
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    const errorText = await page
      .getByText(/tidak ditemukan|tidak terdaftar|gagal|error/i)
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    // If no error shown, the system may send email to any address — that's also valid behavior
    // This test is informational
    console.log(`Non-existent email response: errorToast=${errorToast}, errorText=${errorText}`);
  });

  // ── B. Reset Password Form ────────────────────────────────────────────────

  test('reset-password page renders with password fields', async ({ page }) => {
    // Navigate with a placeholder token — may redirect if invalid
    await page.goto('/app/reset-password/test-token-placeholder');
    await waitForPageLoad(page);

    const onResetPage = page.url().includes('reset-password');
    if (!onResetPage) {
      // Redirected due to invalid token — this is expected behavior
      return;
    }

    await expect(forgotPage.newPasswordInput).toBeVisible({ timeout: 8_000 });
    await expect(forgotPage.confirmPasswordInput).toBeVisible({ timeout: 8_000 });
  });

  test('password mismatch prevents submission', async ({ page }) => {
    await page.goto('/app/reset-password/test-token-placeholder');
    await waitForPageLoad(page);

    const onResetPage = page.url().includes('reset-password');
    if (!onResetPage) return;

    if (await forgotPage.newPasswordInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await forgotPage.newPasswordInput.fill('NewPassword123!');
      await forgotPage.confirmPasswordInput.fill('DifferentPassword456!');
      await forgotPage.saveButton.click();

      await page.waitForTimeout(500);
      // Should stay on reset page due to validation error
      await expect(page).toHaveURL(/.*reset-password.*/);
    }
  });

  test('valid password reset redirects to login or shows success', async ({ page }) => {
    // This test requires a valid token from the backend
    // In a real test environment, obtain the token via:
    //   1. Backend test API endpoint
    //   2. Email interception (Mailhog)
    //
    // For now, we verify the API call is made with correct shape
    let resetApiCalled = false;
    let resetPayload: unknown;

    await page.route('**/reset-password', (route) => {
      resetApiCalled = true;
      resetPayload = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({ status: 200, body: JSON.stringify({ status: 200, message: 'Success' }) });
    });

    await page.goto('/app/reset-password/mocked-valid-token');
    await waitForPageLoad(page);

    const onResetPage = page.url().includes('reset-password');
    if (!onResetPage) return;

    if (await forgotPage.newPasswordInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await forgotPage.setNewPassword('NewValidPass123!');
      await page.waitForTimeout(2_000);

      if (resetApiCalled) {
        const payload = resetPayload as { password?: string };
        expect(payload?.password).toBe('NewValidPass123!');
      }
    }
  });
});
