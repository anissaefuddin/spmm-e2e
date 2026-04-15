import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

/**
 * Direct HTTP API client for E2E test setup and teardown.
 *
 * This bypasses the browser entirely. Use it in:
 *   - global.setup.ts  → login + fetch profile to build auth cookies
 *   - global.teardown.ts → delete test-created users, processes, etc.
 *
 * Never use this in spec files — tests should use the real browser.
 */
export class APIClient {
  private readonly http: AxiosInstance;

  constructor(baseURL: string, token?: string) {
    this.http = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 15_000,
    });
  }

  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.http.post<T>(url, data, config);
    return response.data;
  }

  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.http.get<T>(url, config);
    return response.data;
  }

  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.http.put<T>(url, data, config);
    return response.data;
  }

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.http.delete<T>(url, config);
    return response.data;
  }

  /** Return a new client instance with an Authorization header attached */
  withToken(token: string): APIClient {
    return new APIClient(this.http.defaults.baseURL!, token);
  }
}

/** Singleton factory — reads from env, safe to call multiple times */
export function createApiClient(token?: string): APIClient {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error('API_BASE_URL env variable is not set');
  return new APIClient(base, token);
}
