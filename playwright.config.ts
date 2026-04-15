import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env.test') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,

  // CI: retry flaky tests twice. Local: fail fast.
  retries: process.env.CI ? 2 : 0,

  // CI: 4 parallel workers. Local: 2 to avoid dev server thrashing.
  workers: process.env.CI ? 4 : 2,

  // Per-test timeout — React Query fetches can be slow
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    ...(process.env.CI ? ([['github']] as [['github']]) : []),
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Consistent viewport to avoid styled-components responsive breakpoint flakiness
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    // ── Phase 1: Create auth state files for all 10 roles ──────────────────
    {
      name: 'global-setup',
      testDir: './setup',
      testMatch: /global\.setup\.ts/,
    },

    // ── Phase 2: Unauthenticated flows (no storageState) ───────────────────
    {
      name: 'unauthenticated',
      testMatch: [
        /auth\/login\.spec\.ts/,
        /auth\/register\.spec\.ts/,
        /auth\/reset-password\.spec\.ts/,
      ],
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['global-setup'],
    },

    // ── Phase 3: Admin role — user management ──────────────────────────────
    {
      name: 'admin-tests',
      testMatch: [
        /user-management\/.+\.spec\.ts/,
        /admin\/.+\.spec\.ts/,
        /dashboard\/.+\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: './auth/admin-auth.json',
      },
      dependencies: ['global-setup'],
    },

    // ── Phase 4: Dewan Masyayikh — recommendation workflow ─────────────────
    {
      name: 'dm-tests',
      testMatch: [
        /recommendation\/.+\.spec\.ts/,
        /file-upload\/.+\.spec\.ts/,
        /file\/.+\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: './auth/dm-auth.json',
      },
      dependencies: ['global-setup'],
    },

    // ── Phase 5: Sekretariat — all workflows, full access ──────────────────
    {
      name: 'sk-tests',
      testMatch: [
        /esign\/.+\.spec\.ts/,
        /workflow\/spmi\.spec\.ts/,
        /workflow\/helpdesk\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: './auth/sk-auth.json',
      },
      dependencies: ['global-setup'],
    },

    // ── Phase 6: Specialist roles — SPME workflows ─────────────────────────
    // ta, mm, asdk, mha, dk, tas, asma
    // Each workflow spec uses test.use() to pick the right storageState
    {
      name: 'specialist-tests',
      testMatch: [
        /workflow\/spme-.+\.spec\.ts/,
        /workflow\/esign-bulk\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        // Default to TA (Tenaga Ahli) — individual tests override with test.use()
        storageState: './auth/ta-auth.json',
      },
      dependencies: ['global-setup'],
    },

    // ── Phase 7: Role-based access control (multi-role) ────────────────────
    {
      name: 'access-control',
      testMatch: /access-control\/.+\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['global-setup'],
    },

    // ── Phase 8: Multi-role login tests ────────────────────────────────────
    {
      name: 'multi-role-login',
      testMatch: /auth\/multi-role-login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['global-setup'],
    },

    // ── Phase 9: Cleanup ───────────────────────────────────────────────────
    {
      name: 'global-teardown',
      testDir: './setup',
      testMatch: /global\.teardown\.ts/,
      dependencies: [
        'admin-tests',
        'dm-tests',
        'sk-tests',
        'specialist-tests',
        'access-control',
        'unauthenticated',
        'multi-role-login',
      ],
    },
  ],
});
