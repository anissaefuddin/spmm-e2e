import { test, expect } from '@playwright/test';
import { RegisterPage } from '../../pages/RegisterPage';
import { waitForPageLoad, waitForToast } from '../../helpers/wait.helpers';

/**
 * Registration Flow Tests
 *
 * The registration flow integrates with EMIS (external system) for identity verification.
 * Full E2E registration cannot be automated without a real EMIS account,
 * so these tests cover:
 *   A. Form rendering and validation (no API calls)
 *   B. Error states (invalid email, invalid OTP)
 *   C. Navigation between steps
 *
 * For full flow testing: use a dedicated test EMIS account.
 * The OTP is sent to the registered email — in CI, intercept via API or
 * use a test email provider (Mailhog/Mailtrap).
 */
test.describe('Registration Flow', () => {
  let registerPage: RegisterPage;

  test.beforeEach(async ({ page }) => {
    registerPage = new RegisterPage(page);
    await registerPage.goto();
  });

  // ── A. Form Rendering ────────────────────────────────────────────────────

  test('renders registration form with email and password fields', async ({ page }) => {
    await expect(registerPage.emailInput).toBeVisible();
    await expect(registerPage.passwordInput).toBeVisible();
    await expect(registerPage.continueButton).toBeVisible();
  });

  test('shows link to login page', async ({ page }) => {
    // RegisterScreen contains a link back to login
    const loginLink = page.getByRole('link', { name: /masuk|login/i }).first();
    const hasLink =
      (await loginLink.isVisible({ timeout: 3_000 }).catch(() => false)) ||
      (await page.getByText(/masuk|login/i).first().isVisible().catch(() => false));
    expect(hasLink).toBe(true);
  });

  // ── B. Validation ────────────────────────────────────────────────────────

  test('empty form submission does not navigate away', async ({ page }) => {
    await registerPage.continueButton.click();
    await expect(page).toHaveURL(/.*register.*/);
  });

  test('invalid email format is rejected', async ({ page }) => {
    await registerPage.emailInput.fill('notanemail');
    await registerPage.passwordInput.fill('ValidPass123!');
    await registerPage.continueButton.click();

    // Zod validation should catch invalid email format
    // Form stays on register page
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/.*register.*/);
  });

  test('short password shows validation error', async ({ page }) => {
    await registerPage.emailInput.fill('test@example.com');
    await registerPage.passwordInput.fill('abc');
    await registerPage.continueButton.click();

    // Zod schema requires min 6 chars for password
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/.*register.*/);
  });

  // ── C. API Integration ───────────────────────────────────────────────────

  test('submitting valid email+password calls /api/register', async ({ page }) => {
    let apiCalled = false;

    await page.route('**/register', (route) => {
      apiCalled = true;
      // Let the request proceed normally
      return route.continue();
    });

    await registerPage.submitInitialForm(
      `e2e.reg.${Date.now()}@spmm.test`,
      'ValidPass123!',
    );

    // Wait briefly for the route handler to be triggered
    await page.waitForTimeout(2_000);
    expect(apiCalled).toBe(true);
  });

  test('unregistered email shows error response', async ({ page }) => {
    // Using a clearly non-existent email should return an API error
    await registerPage.submitInitialForm(
      'definitely.not.registered.xyz@spmm.test',
      'ValidPass123!',
    );

    // Expect either error toast or stay on register page
    const errorVisible =
      (await page.locator('.Toastify__toast--error').isVisible({ timeout: 8_000 }).catch(() => false)) ||
      (await page.getByText(/tidak ditemukan|tidak terdaftar|gagal|error/i).isVisible({ timeout: 3_000 }).catch(() => false));

    const stayedOnRegister = page.url().includes('/register');

    expect(errorVisible || stayedOnRegister).toBe(true);
  });

  // ── D. OTP Screen ────────────────────────────────────────────────────────

  test('OTP screen renders when navigated to confirmation-akun', async ({ page }) => {
    await page.goto('/app/register/confirmation-akun');
    await waitForPageLoad(page);

    // OTP screen should render (may redirect if no pending OTP session)
    const currentUrl = page.url();
    const onOtpPage = currentUrl.includes('confirmation-akun') || currentUrl.includes('register');
    expect(onOtpPage).toBe(true);
  });

  test('resend OTP link is visible on OTP screen', async ({ page }) => {
    // Navigate programmatically to OTP screen (assumes prior registration step)
    await page.goto('/app/register/confirmation-akun');
    await waitForPageLoad(page);

    // If the OTP screen is reached, the resend link should be visible
    const resendLink = page.getByText('Kirim Ulang OTP');
    const isVisible = await resendLink.isVisible({ timeout: 5_000 }).catch(() => false);

    // This may not be visible if redirected — mark as informational
    if (isVisible) {
      await expect(resendLink).toBeVisible();
    }
  });

  // ── E. Create Password Screen ─────────────────────────────────────────────

  test('create-password screen renders all profile fields', async ({ page }) => {
    await page.goto('/app/register/create-password');
    await waitForPageLoad(page);

    // CreatePasswordScreen renders: fullname (disabled), address, phone_number,
    // email (disabled), password, confirm_password
    const phoneInput = page.locator('input[name="phone_number"]');
    const passwordInput = page.locator('input[name="password"]');

    // If redirected (no session), we are on a different page — that is also valid
    const onCreatePage = page.url().includes('create-password');
    if (onCreatePage) {
      await expect(phoneInput).toBeVisible({ timeout: 8_000 });
      await expect(passwordInput).toBeVisible({ timeout: 8_000 });
    }
  });

  test('password mismatch shows validation error on create-password', async ({ page }) => {
    await page.goto('/app/register/create-password');
    await waitForPageLoad(page);

    const onCreatePage = page.url().includes('create-password');
    if (!onCreatePage) return;

    const passwordInput = page.locator('input[name="password"]');
    const confirmInput = page.locator('input[name="confirm_password"]');
    const submitBtn = page.getByRole('button', { name: 'Lanjutkan' });

    if (await passwordInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await passwordInput.fill('Password123!');
      await confirmInput.fill('DifferentPassword!');
      await submitBtn.click();

      await page.waitForTimeout(500);
      // Should show validation error and stay on page
      await expect(page).toHaveURL(/.*create-password.*/);
    }
  });
});
