/**
 * Global Teardown — runs ONCE after all test projects complete.
 *
 * Cleans up any data created during the test run to keep the test database tidy.
 * Test IDs are stored in a shared temp file written by specs during the run.
 */

import { test as teardown } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { createApiClient } from '../helpers/api.client';

const CLEANUP_REGISTRY = path.resolve(__dirname, '../test-results/cleanup-registry.json');

interface CleanupRegistry {
  userIds?: string[];
  processIds?: string[];
}

teardown('clean up test data', async () => {
  if (!fs.existsSync(CLEANUP_REGISTRY)) {
    console.log('No cleanup registry found — nothing to delete.');
    return;
  }

  const registry: CleanupRegistry = JSON.parse(fs.readFileSync(CLEANUP_REGISTRY, 'utf-8'));
  const api = createApiClient();

  // Login with admin credentials to get a cleanup token
  let token: string;
  try {
    const loginResp = await api.post<{ data: { token: string } }>('/login', {
      email: process.env.TEST_ADMIN_EMAIL,
      password: process.env.TEST_ADMIN_PASSWORD,
    });
    token = loginResp.data.token;
  } catch (err) {
    console.warn('Could not log in for teardown — skipping cleanup.', err);
    return;
  }

  const authedApi = api.withToken(token);

  // Delete test-created users
  for (const userId of registry.userIds ?? []) {
    try {
      await authedApi.delete(`/user/${userId}`);
      console.log(`✓ Deleted test user: ${userId}`);
    } catch {
      console.warn(`⚠ Could not delete user ${userId} — may have already been removed.`);
    }
  }

  // Remove the registry file
  fs.unlinkSync(CLEANUP_REGISTRY);
  console.log('Teardown complete.');
});
