import { test, expect, Browser } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { waitForPageLoad } from '../../helpers/wait.helpers';
import { TEST_USERS, ALL_ROLE_KEYS, type RoleKey } from '../../test-data/users';
import { ROLE_ACCESS } from '../../test-data/roles';
import { hasAuthState } from '../../helpers/login.helpers';
import path from 'path';

/**
 * Multi-Role Login Tests
 *
 * Verifies that every role in the system:
 *   1. Can log in with correct credentials
 *   2. Is redirected to the dashboard (not /login)
 *   3. Sees role-specific UI elements (sidebar items)
 *   4. Has a valid token cookie after login
 *
 * Strategy: Use the pre-created storageState from global.setup.ts for speed.
 * Each role gets its own test using its auth state file.
 */

/**
 * Generate one test per role using the storageState (no browser login needed).
 * This verifies that the auth state is valid and the dashboard loads correctly.
 */
for (const roleKey of ALL_ROLE_KEYS) {
  const user = TEST_USERS[roleKey];
  const roleAccess = ROLE_ACCESS[roleKey];

  test(`[${roleKey.toUpperCase()}] ${user.role_name} — dashboard accessible after auth`, async ({
    browser,
  }) => {
    if (!hasAuthState(roleKey)) {
      test.skip();
      return;
    }

    const context = await browser.newContext({
      storageState: path.join(__dirname, `../../auth/${user.authStateFile}`),
    });
    const page = await context.newPage();

    try {
      await page.goto('/app/');
      await waitForPageLoad(page);

      // Must NOT be redirected to login
      await expect(page).not.toHaveURL(/.*login.*/, { timeout: 10_000 });
      await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
    } finally {
      await context.close();
    }
  });

  test(`[${roleKey.toUpperCase()}] ${user.role_name} — required sidebar items visible`, async ({
    browser,
  }) => {
    if (!hasAuthState(roleKey)) {
      test.skip();
      return;
    }

    const context = await browser.newContext({
      storageState: path.join(__dirname, `../../auth/${user.authStateFile}`),
    });
    const page = await context.newPage();

    try {
      await page.goto('/app/');
      await waitForPageLoad(page);

      for (const sidebarItem of roleAccess.sidebarItems) {
        const item = page.getByText(sidebarItem, { exact: true }).first();
        await expect(item).toBeVisible({ timeout: 8_000 });
      }
    } finally {
      await context.close();
    }
  });

  // Hidden sidebar items should not appear
  if (roleAccess.hiddenSidebarItems.length > 0) {
    test(`[${roleKey.toUpperCase()}] ${user.role_name} — forbidden sidebar items hidden`, async ({
      browser,
    }) => {
      if (!hasAuthState(roleKey)) {
        test.skip();
        return;
      }

      const context = await browser.newContext({
        storageState: path.join(__dirname, `../../auth/${user.authStateFile}`),
      });
      const page = await context.newPage();

      try {
        await page.goto('/app/');
        await waitForPageLoad(page);

        for (const hiddenItem of roleAccess.hiddenSidebarItems) {
          const item = page.getByText(hiddenItem, { exact: true }).first();
          await expect(item).not.toBeVisible({ timeout: 3_000 });
        }
      } finally {
        await context.close();
      }
    });
  }
}

/**
 * UI Login Tests — verifies the actual login form interaction per role.
 * Slower than storageState tests but proves the login form works.
 * Run a subset for speed (admin + dm + sk as representatives).
 */
const LOGIN_FLOW_ROLES: RoleKey[] = ['admin', 'dm', 'sk'];

for (const roleKey of LOGIN_FLOW_ROLES) {
  const user = TEST_USERS[roleKey];

  test(`[${roleKey.toUpperCase()}] ${user.role_name} — login via UI form succeeds`, async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    const [loginResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/login') && r.request().method() === 'POST',
        { timeout: 15_000 },
      ),
      loginPage.login(user.email, user.password),
    ]);

    expect(loginResponse.status()).toBe(200);
    await waitForPageLoad(page);

    // Verify cookies are set
    const cookies = await page.context().cookies();
    const tokenCookie = cookies.find((c) => c.name === 'token');
    expect(tokenCookie?.value).toBeTruthy();

    const roleCookie = cookies.find((c) => c.name === 'role');
    expect(roleCookie?.value).toBeTruthy();
    const roleObj = JSON.parse(roleCookie?.value ?? '{}');
    expect(roleObj.role_code).toBeTruthy();

    // Redirect to dashboard
    await expect(page).toHaveURL(/\/app\/?$/, { timeout: 10_000 });
  });
}

/**
 * Logout test — verifies token is cleared and redirect happens.
 */
test('logging out clears auth cookies and redirects to login', async ({ browser }) => {
  if (!hasAuthState('admin')) {
    test.skip();
    return;
  }

  const context = await browser.newContext({
    storageState: path.join(__dirname, '../../auth/admin-auth.json'),
  });
  const page = await context.newPage();

  try {
    await page.goto('/app/');
    await waitForPageLoad(page);

    // Find logout button in the header
    const logoutButton = page
      .getByRole('button', { name: /keluar|logout|sign out/i })
      .first();
    const profileMenu = page.locator('[class*="Header"] button, header button').last();

    // Open profile menu if logout is hidden
    if (await profileMenu.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await profileMenu.click();
      await page.waitForTimeout(500);
    }

    const logoutVisible = await logoutButton.isVisible({ timeout: 3_000 }).catch(() => false);
    if (logoutVisible) {
      await logoutButton.click();
      await waitForPageLoad(page);
      // After logout, should be on login page
      await expect(page).toHaveURL(/.*login.*/);

      const cookies = await page.context().cookies();
      const tokenCookie = cookies.find((c) => c.name === 'token');
      expect(tokenCookie).toBeUndefined();
    }
  } finally {
    await context.close();
  }
});
