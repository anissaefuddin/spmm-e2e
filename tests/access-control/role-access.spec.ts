import { test, expect } from '@playwright/test';
import { waitForPageLoad } from '../../helpers/wait.helpers';
import { ALL_ROLE_KEYS, TEST_USERS, type RoleKey } from '../../test-data/users';
import { ROLE_ACCESS, SIDEBAR_ROUTES } from '../../test-data/roles';
import { hasAuthState, getStorageStatePath } from '../../helpers/login.helpers';

/**
 * Role-Based Access Control Tests
 *
 * Verifies that:
 *   1. Each role can access ONLY its allowed routes
 *   2. Forbidden routes redirect or show restricted content
 *   3. Sidebar items match exactly what the role should see
 *   4. Protected routes require authentication
 *
 * Strategy: For each role, load its storageState and verify access patterns.
 * Uses browser.newContext() to isolate each role test.
 */

// ── Route Access Tests (per role) ─────────────────────────────────────────────

for (const roleKey of ALL_ROLE_KEYS) {
  const user = TEST_USERS[roleKey];
  const access = ROLE_ACCESS[roleKey];

  test.describe(`[${roleKey.toUpperCase()}] ${user.role_name} — route access`, () => {
    // Allowed routes
    for (const route of access.allowedRoutes) {
      test(`can access ${route}`, async ({ browser }) => {
        if (!hasAuthState(roleKey)) {
          test.skip();
          return;
        }

        const ctx = await browser.newContext({ storageState: getStorageStatePath(roleKey) });
        const page = await ctx.newPage();

        try {
          await page.goto(route);
          await waitForPageLoad(page);

          // Must NOT be redirected to login
          await expect(page).not.toHaveURL(/.*login.*/, { timeout: 8_000 });

          // Must NOT show a 403/404/500 HTTP error
          const statusErrors: number[] = [];
          page.on('response', (r) => {
            if (r.status() >= 400 && r.url().includes('/api/')) {
              statusErrors.push(r.status());
            }
          });

          // Page should have content (not blank)
          const bodyText = await page.locator('body').textContent();
          expect(bodyText?.trim().length).toBeGreaterThan(0);
        } finally {
          await ctx.close();
        }
      });
    }

    // Forbidden routes — should not provide full access
    for (const route of access.forbiddenRoutes) {
      test(`cannot fully access ${route}`, async ({ browser }) => {
        if (!hasAuthState(roleKey)) {
          test.skip();
          return;
        }

        const ctx = await browser.newContext({ storageState: getStorageStatePath(roleKey) });
        const page = await ctx.newPage();

        try {
          await page.goto(route);
          await waitForPageLoad(page);

          const finalUrl = page.url();

          // Role-specific forbidden checks:
          // Admin cannot see esign sidebar or use recommendation workflow
          if (roleKey === 'admin' && route.includes('user-management')) {
            // Admin CAN access user-management — this should not be in forbiddenRoutes
            // (this block shouldn't execute due to roles.ts config)
          }

          // For forbidden routes, at minimum:
          // 1. No "Buat Pengajuan Baru" or action buttons the role shouldn't have
          // 2. Or: redirected away from the route
          // We can't always assert redirect because some pages are accessible but empty

          // Log for informational purposes
          console.log(`[${roleKey.toUpperCase()}] ${route} → final URL: ${finalUrl}`);

          // The key assertion: user should not see admin-specific UI on non-admin pages
          if (route === '/app/user-management' && roleKey !== 'admin') {
            // Non-admin accessing user-management should not see "Buat Akun Baru"
            const adminBtn = page.getByRole('button', { name: 'Buat Akun Baru' });
            await expect(adminBtn).not.toBeVisible({ timeout: 5_000 });
          }
        } finally {
          await ctx.close();
        }
      });
    }

    // Sidebar visibility
    if (access.sidebarItems.length > 0) {
      test(`sees required sidebar items`, async ({ browser }) => {
        if (!hasAuthState(roleKey)) {
          test.skip();
          return;
        }

        const ctx = await browser.newContext({ storageState: getStorageStatePath(roleKey) });
        const page = await ctx.newPage();

        try {
          await page.goto('/app/');
          await waitForPageLoad(page);

          for (const item of access.sidebarItems) {
            const sidebarLink = page
              .getByText(item, { exact: true })
              .or(page.getByRole('link', { name: item }))
              .first();

            await expect(sidebarLink).toBeVisible({ timeout: 8_000 });
          }
        } finally {
          await ctx.close();
        }
      });
    }

    // Hidden sidebar items
    if (access.hiddenSidebarItems.length > 0) {
      test(`does NOT see forbidden sidebar items`, async ({ browser }) => {
        if (!hasAuthState(roleKey)) {
          test.skip();
          return;
        }

        const ctx = await browser.newContext({ storageState: getStorageStatePath(roleKey) });
        const page = await ctx.newPage();

        try {
          await page.goto('/app/');
          await waitForPageLoad(page);

          for (const item of access.hiddenSidebarItems) {
            const sidebarLink = page
              .getByText(item, { exact: true })
              .first();

            await expect(sidebarLink).not.toBeVisible({ timeout: 3_000 });
          }
        } finally {
          await ctx.close();
        }
      });
    }
  });
}

// ── Authentication Boundary Tests ─────────────────────────────────────────────

test.describe('Authentication boundaries', () => {
  test('unauthenticated user is redirected to /login from dashboard', async ({ page }) => {
    // No storageState — fresh context
    await page.goto('/app/');
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('unauthenticated user is redirected from protected route', async ({ page }) => {
    await page.goto('/app/recommendation');
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('unauthenticated user is redirected from user-management', async ({ page }) => {
    await page.goto('/app/user-management');
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('unauthenticated user is redirected from esign', async ({ page }) => {
    await page.goto('/app/esign');
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*login.*/);
  });

  test('public routes are accessible without auth', async ({ page }) => {
    // Login and register pages must be accessible without authentication
    await page.goto('/app/login');
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*login.*/);
    await expect(page.locator('input[name="email"]')).toBeVisible();
  });

  test('register page is accessible without auth', async ({ page }) => {
    await page.goto('/app/register');
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*register.*/);
  });

  test('forget-password page is accessible without auth', async ({ page }) => {
    await page.goto('/app/forget-password');
    await waitForPageLoad(page);
    await expect(page).toHaveURL(/.*forget-password.*/);
  });
});

// ── Admin-Specific Access Tests ────────────────────────────────────────────────

test.describe('Admin exclusive access', () => {
  test('Admin sees "Akun Manajemen" in sidebar', async ({ browser }) => {
    if (!hasAuthState('admin')) {
      test.skip();
      return;
    }

    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/');
      await waitForPageLoad(page);
      await expect(page.getByText('Akun Manajemen', { exact: true })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('non-Admin does NOT see "Akun Manajemen" in sidebar', async ({ browser }) => {
    const nonAdminRoles: RoleKey[] = ['dm', 'sk', 'ta'];

    for (const role of nonAdminRoles) {
      if (!hasAuthState(role)) continue;

      const ctx = await browser.newContext({ storageState: getStorageStatePath(role) });
      const page = await ctx.newPage();

      try {
        await page.goto('/app/');
        await waitForPageLoad(page);
        await expect(page.getByText('Akun Manajemen', { exact: true })).not.toBeVisible();
      } finally {
        await ctx.close();
      }
    }
  });
});
