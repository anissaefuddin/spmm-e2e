import type { Browser, BrowserContext, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { buildAuthCookies } from './auth.helpers';
import { TEST_USERS, type RoleKey } from '../test-data/users';

const AUTH_DIR = path.resolve(__dirname, '../auth');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:1235/api';

/**
 * loginAs(role, browser) — Programmatic login helper.
 *
 * Returns a browser context pre-authenticated as the given role.
 * Strategy (in order of preference):
 *   1. Load existing storageState from auth/<role>-auth.json (fastest)
 *   2. Fresh API login + cookie injection (if state file missing or expired)
 *
 * Usage in tests that need to switch roles dynamically:
 *
 *   const ctx = await loginAs('dm', browser);
 *   const page = await ctx.newPage();
 *   await page.goto('/app/recommendation');
 *   // ... assertions ...
 *   await ctx.close();
 *
 * Usage in global.setup.ts already handles bulk state creation.
 * Use this helper in individual tests that need a non-default role context.
 */
export async function loginAs(role: RoleKey, browser: Browser): Promise<BrowserContext> {
  const user = TEST_USERS[role];
  const stateFile = path.join(AUTH_DIR, user.authStateFile);

  // Fast path: existing storageState IF the cookies still authenticate.
  // The JWTs issued by /api/login expire after 2 hours, which is shorter than
  // a long workflow run — without this check, late-stage tests get 401s from
  // tokens that were valid when global-setup ran but expired by test time.
  if (fs.existsSync(stateFile)) {
    const context = await browser.newContext({ storageState: stateFile });
    const isValid = await context.request
      .get(`${API_BASE}/user/detail-me`, { failOnStatusCode: false })
      .then((r) => r.ok())
      .catch(() => false);
    if (isValid) return context;

    console.warn(`[loginAs] cached auth for "${role}" rejected by API (401) — refreshing`);
    await context.close();
  }

  // Slow path: fresh API login → build cookies → overwrite state file
  const loginResp = await axios.post(`${API_BASE}/login`, {
    email: user.email,
    password: user.password,
  });
  // API returns camelCase `refreshToken` (verified in global.setup.ts).
  // Tolerate snake_case too in case the backend ever changes.
  const token = loginResp.data.data.token;
  const refresh_token = loginResp.data.data.refreshToken ?? loginResp.data.data.refresh_token;
  if (!token || !refresh_token) {
    throw new Error(
      `[loginAs ${role}] /api/login response missing token or refreshToken. ` +
      `Got keys: ${Object.keys(loginResp.data.data ?? {}).join(', ')}`,
    );
  }

  let userData: Record<string, unknown>;
  try {
    const profileResp = await axios.get(`${API_BASE}/user/detail`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    userData = profileResp.data.data;
  } catch {
    const profileResp = await axios.get(`${API_BASE}/user/detail-me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    userData = profileResp.data.data;
  }

  const cookies = buildAuthCookies(token, refresh_token, userData as Parameters<typeof buildAuthCookies>[2]);
  const context = await browser.newContext();
  await context.addCookies(cookies);

  // Persist for future calls in this test run
  await context.storageState({ path: stateFile });
  return context;
}

/**
 * loginAsPage(role, browser) — Convenience wrapper.
 * Returns a new Page already authenticated as the given role.
 * Caller is responsible for closing the page's context.
 */
export async function loginAsPage(role: RoleKey, browser: Browser): Promise<{ page: Page; context: BrowserContext }> {
  const context = await loginAs(role, browser);
  const page = await context.newPage();
  return { page, context };
}

/**
 * getStorageStatePath(role) — Get the path to a role's auth state file.
 * Useful for test.use({ storageState: getStorageStatePath('ta') }) in spec files.
 */
export function getStorageStatePath(role: RoleKey): string {
  return path.join(AUTH_DIR, TEST_USERS[role].authStateFile);
}

/**
 * hasAuthState(role) — Check if an auth state file exists for a role.
 * Use in beforeAll to skip tests when credentials are not configured.
 */
export function hasAuthState(role: RoleKey): boolean {
  return fs.existsSync(path.join(AUTH_DIR, TEST_USERS[role].authStateFile));
}
