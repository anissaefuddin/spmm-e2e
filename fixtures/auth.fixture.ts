import { test as base, expect } from '@playwright/test';
import { waitForPageLoad } from '../helpers/wait.helpers';

type AuthFixtures = {
  /**
   * A page that is already authenticated (via storageState set in playwright.config.ts).
   * Navigates to the dashboard on setup and verifies no redirect to /login occurred.
   * Use this in all tests that require an authenticated user.
   */
  authenticatedPage: import('@playwright/test').Page;
};

export const test = base.extend<AuthFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // storageState is already set per-project in playwright.config.ts
    // Navigate to the dashboard root and verify auth cookies are accepted
    await page.goto('/app/');
    await waitForPageLoad(page);

    // If ProtectedRoute rejected the cookies, we would have been redirected
    await expect(page).not.toHaveURL(/.*login.*/);

    await use(page);
  },
});

export { expect };
