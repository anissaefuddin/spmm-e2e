/**
 * Global Setup — runs ONCE before any test project starts.
 *
 * For each of the 10 system roles this file:
 *   1. Calls POST /api/login via axios (no browser overhead)
 *   2. Calls GET /api/user/detail to get the full user object
 *   3. Builds the 4 cookies ProtectedRoute expects:
 *        token, refresh_token, detailUser (JSON), role (JSON)
 *   4. Injects those cookies into a fresh browser context
 *   5. Saves the context storageState to auth/<role>-auth.json
 *
 * Tests then load storageState and skip the login UI entirely.
 * This is ~10x faster than logging in through the browser per test.
 *
 * If a role's credentials are not set in .env.test, setup for that role
 * is skipped gracefully (tests requiring that role will be skipped at runtime).
 */

import { test as setup } from '@playwright/test';
import axios from 'axios';
import path from 'path';
import { buildAuthCookies, type UserDetailData } from '../helpers/auth.helpers';
import { TEST_USERS, ALL_ROLE_KEYS } from '../test-data/users';

const API_BASE = process.env.API_BASE_URL;
const AUTH_DIR = path.resolve(__dirname, '../auth');

if (!API_BASE) {
  throw new Error(
    'API_BASE_URL is not set. Copy .env.test.example → .env.test and fill in values.',
  );
}

interface LoginResponse {
  status: number;
  message: string;
  data: { token: string; refreshToken: string };
}

interface ProfileResponse {
  status: number;
  message: string;
  data: UserDetailData;
}

async function fetchUserProfile(token: string): Promise<UserDetailData> {
  const headers = { Authorization: `Bearer ${token}` };
  // Try primary endpoint first, fall back to alternate
  try {
    const r = await axios.get<ProfileResponse>(`${API_BASE}/user/detail`, { headers });
    return r.data.data;
  } catch {
    const r = await axios.get<ProfileResponse>(`${API_BASE}/user/detail-me`, { headers });
    return r.data.data;
  }
}

// Generate one setup test per role
for (const roleKey of ALL_ROLE_KEYS) {
  const user = TEST_USERS[roleKey];

  setup(`create auth state: ${user.role_name} (${roleKey})`, async ({ browser }) => {
    // Gracefully skip roles without credentials in .env.test
    if (!user.email || user.email.endsWith('@spmm.test') && !process.env[user.envEmailKey]) {
      console.warn(
        `⚠ Skipping auth state for "${user.role_name}" — ` +
          `set ${user.envEmailKey} and ${user.envPasswordKey} in .env.test`,
      );
      return;
    }

    let token: string;
    let refreshToken: string;

    try {
      const loginResp = await axios.post<LoginResponse>(`${API_BASE}/login`, {
        email: user.email,
        password: user.password,
      });
      token = loginResp.data.data.token;
      refreshToken = loginResp.data.data.refreshToken;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ Login failed for "${user.role_name}" (${user.email}): ${msg}`);
      console.warn('   Auth state will not be created for this role.');
      return;
    }

    let userData: UserDetailData;
    try {
      userData = await fetchUserProfile(token);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠ Profile fetch failed for "${user.role_name}": ${msg}`);
      return;
    }

    // Build the 4 cookies ProtectedRoute checks
    const cookies = buildAuthCookies(token, refreshToken, userData);

    // Inject into a browser context and persist
    const context = await browser.newContext();
    await context.addCookies(cookies);
    await context.storageState({ path: path.join(AUTH_DIR, user.authStateFile) });
    await context.close();

    console.log(
      `✓ Auth state: auth/${user.authStateFile} ` +
        `(role: ${userData.roles?.[0]?.role_code ?? user.role_code})`,
    );
  });
}
