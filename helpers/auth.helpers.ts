import type { Cookie } from '@playwright/test';

const DOMAIN = process.env.COOKIE_DOMAIN || 'localhost';

export interface UserDetailData {
  fullname: string;
  email: string;
  roles: Array<{ role_code: string; role_name: string }>;
  lembaga?: string;
  type_lembaga?: string;
  nomor_statistik?: string;
  institution_id?: string;
  [key: string]: unknown;
}

/**
 * Build the 4 cookies that ProtectedRoute checks:
 *   1. token           — Bearer token for API requests
 *   2. refresh_token   — Used for token refresh
 *   3. detailUser      — JSON string, must have .roles (array with at least one item)
 *   4. role            — JSON string with role_code property
 *
 * These mirror exactly what the useLogin hook stores via js-cookie after a
 * successful login + profile fetch in the real application.
 */
export function buildAuthCookies(
  token: string,
  refreshToken: string,
  userData: UserDetailData,
): Cookie[] {
  const primaryRole = userData.roles[0];
  const nowSeconds = Math.floor(Date.now() / 1000);
  const oneDaySeconds = 86_400;

  const base: Omit<Cookie, 'name' | 'value' | 'expires'> = {
    domain: DOMAIN,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  };

  return [
    {
      ...base,
      name: 'token',
      value: token,
      expires: nowSeconds + oneDaySeconds,
    },
    {
      ...base,
      name: 'refresh_token',
      value: refreshToken,
      expires: nowSeconds + oneDaySeconds * 7,
    },
    {
      ...base,
      // js-cookie stores raw JSON without URI encoding by default
      name: 'detailUser',
      value: JSON.stringify(userData),
      expires: nowSeconds + oneDaySeconds,
    },
    {
      ...base,
      name: 'role',
      value: JSON.stringify(primaryRole),
      expires: nowSeconds + oneDaySeconds,
    },
  ];
}
