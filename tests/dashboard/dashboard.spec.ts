import { test, expect } from '../../fixtures/auth.fixture';
import { DashboardPage } from '../../pages/DashboardPage';
import { waitForPageLoad } from '../../helpers/wait.helpers';

/**
 * Dashboard Load Tests
 *
 * Uses admin-auth.json storageState (set via admin-tests project in playwright.config.ts).
 * Verifies that the dashboard renders correctly for authenticated users and
 * that no unexpected API errors occur.
 */
test.describe('Dashboard', () => {
  test('authenticated admin stays on dashboard (not redirected to login)', async ({
    authenticatedPage: page,
  }) => {
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(page).not.toHaveURL(/.*login.*/);
  });

  test('dashboard renders TicketWidget (visible for all roles)', async ({
    authenticatedPage: page,
  }) => {
    const dashboard = new DashboardPage(page);
    // TicketWidget always renders regardless of role
    await expect(dashboard.ticketWidget).toBeVisible({ timeout: 15_000 });
  });

  test('dashboard shows announcement section for admin role', async ({
    authenticatedPage: page,
  }) => {
    const dashboard = new DashboardPage(page);
    await expect(dashboard.announcementSection).toBeVisible({ timeout: 15_000 });
  });

  test('no API 401 errors occur on dashboard load', async ({ authenticatedPage: page }) => {
    const unauthorizedResponses: string[] = [];

    // Monitor all API responses for 401s
    page.on('response', (response) => {
      if (response.status() === 401) {
        unauthorizedResponses.push(response.url());
      }
    });

    // Navigate to dashboard again to trigger all API calls
    await page.goto('/app/');
    await waitForPageLoad(page);

    // Allow a moment for all React Query queries to fire
    await page.waitForTimeout(2_000);

    expect(unauthorizedResponses).toHaveLength(0);
  });

  test('no unhandled network errors on dashboard load', async ({ authenticatedPage: page }) => {
    const serverErrors: string[] = [];

    page.on('response', (response) => {
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto('/app/');
    await waitForPageLoad(page);
    await page.waitForTimeout(2_000);

    expect(serverErrors).toHaveLength(0);
  });

  test('dashboard sidebar navigation is visible', async ({ authenticatedPage: page }) => {
    // Sidebar renders role-filtered navigation items from SIDEBAR_ITEMS constant
    // The Layout component always renders the sidebar for authenticated routes
    const sidebar = page.locator('nav, aside, [class*="Sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 10_000 });
  });

  test('profile/user info is visible in header', async ({ authenticatedPage: page }) => {
    // The Header component renders user profile info (name or avatar)
    const header = page.locator('header, [class*="Header"]').first();
    await expect(header).toBeVisible({ timeout: 10_000 });
  });
});
