import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { TEST_USERS } from '../../test-data/users';
import { waitForPageLoad, waitForToast } from '../../helpers/wait.helpers';

/**
 * Login Flow Tests
 *
 * These run WITHOUT a pre-authenticated storageState (login project in playwright.config.ts).
 * Covers: form rendering, validation, error handling, successful auth.
 */
test.describe('Login', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('renders all login form elements', async ({ page }) => {
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
    await expect(loginPage.forgotPasswordLink).toBeVisible();
  });

  test('email field accepts text input', async () => {
    await loginPage.fillEmail('test@example.com');
    await expect(loginPage.emailInput).toHaveValue('test@example.com');
  });

  test('password field masks input', async () => {
    await loginPage.fillPassword('secret123');
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
  });

  test('password toggle button reveals password', async ({ page }) => {
    await loginPage.fillPassword('secret123');
    // The TextInput with showPasswordToggle renders an eye icon button
    const toggleButton = page.locator('button[type="button"]').filter({
      has: page.locator('[data-lucide="eye"], [data-lucide="eye-off"]'),
    });
    if (await toggleButton.isVisible()) {
      await toggleButton.click();
      await expect(loginPage.passwordInput).toHaveAttribute('type', 'text');
    }
  });

  test('does not navigate away when form is empty and submitted', async ({ page }) => {
    // react-hook-form with mode='onChange' prevents submission on empty required fields
    // Submit button may be disabled or form validation blocks the API call
    await loginPage.submit();
    // Should still be on login page
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('shows error for wrong credentials', async ({ page }) => {
    await loginPage.login('wrong@example.com', 'wrongpassword');

    // Wait for either error toast or inline error message
    const errorToast = page.locator('.Toastify__toast--error');
    const errorText = page.getByText(/gagal|invalid|salah|error/i);

    await Promise.race([
      errorToast.waitFor({ state: 'visible', timeout: 10_000 }),
      errorText.waitFor({ state: 'visible', timeout: 10_000 }),
    ]);

    // Still on login page (no navigation)
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('successful login redirects to dashboard and sets token cookie', async ({ page }) => {
    // Intercept the login API call to verify correct payload is sent
    const [loginResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/login') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      loginPage.login(TEST_USERS.admin.email, TEST_USERS.admin.password),
    ]);

    expect(loginResponse.status()).toBe(200);

    // Wait for profile fetch + cookie set + navigation
    await waitForPageLoad(page);

    // ProtectedRoute checks: token cookie + detailUser.roles array + role.role_code
    // If login succeeded and all cookies were set, we land on /app/
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 15_000 });
    await expect(page).not.toHaveURL(/.*login.*/);

    // Verify the token cookie was set by the login flow
    const cookies = await page.context().cookies();
    const tokenCookie = cookies.find((c) => c.name === 'token');
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie?.value).toBeTruthy();

    const detailUserCookie = cookies.find((c) => c.name === 'detailUser');
    expect(detailUserCookie).toBeDefined();
    const detailUser = JSON.parse(detailUserCookie?.value ?? '{}');
    expect(Array.isArray(detailUser.roles)).toBe(true);
    expect(detailUser.roles.length).toBeGreaterThan(0);
  });

  test('login API sends correct JSON payload', async ({ page }) => {
    let capturedBody: unknown;

    await page.route('**/login', async (route) => {
      const request = route.request();
      capturedBody = JSON.parse(request.postData() ?? '{}');
      await route.continue();
    });

    await loginPage.login(TEST_USERS.admin.email, TEST_USERS.admin.password);

    // Wait for route handler to be called
    await page.waitForResponse((r) => r.url().includes('/login'), { timeout: 10_000 });

    expect(capturedBody).toMatchObject({
      email: TEST_USERS.admin.email,
      password: TEST_USERS.admin.password,
    });
  });
});
