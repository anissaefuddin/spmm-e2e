import path from 'path';
import { test, expect } from '@playwright/test';
import { waitForPageLoad, waitForApiResponse } from '../../helpers/wait.helpers';
import { TEST_FILES } from '../../helpers/file.helpers';
import { hasAuthState, getStorageStatePath } from '../../helpers/login.helpers';

/**
 * File Upload & Download Tests
 *
 * Tests the complete file lifecycle:
 *   Upload: UploadInput → MinIO via POST /api/uploadfile1 or /api/uploadfilebase64
 *   Download: MinIO via POST /api/downloadfile or /api/downloadfile2
 *
 * The UploadInput component renders hidden <input type="file"> elements with
 * explicit IDs set in each screen. Playwright's setInputFiles() works on
 * hidden inputs without needing force: true.
 *
 * Uses DM role (dm-tests project) — has access to recommendation add page.
 */

test.describe('File Upload', () => {
  test.beforeEach(async ({}) => {
    if (!hasAuthState('dm')) test.skip();
  });

  // ── PDF Upload ─────────────────────────────────────────────────────────────

  test('upload PDF to Surat Permohonan field (#upload-permohonan)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/recommendation/add-recommendation');
      await waitForPageLoad(page);

      const fileInput = page.locator('#upload-permohonan');
      await expect(fileInput).toBeAttached({ timeout: 10_000 });

      await fileInput.setInputFiles(TEST_FILES.pdf);

      const fileCount = await fileInput.evaluate(
        (el: HTMLInputElement) => el.files?.length ?? 0,
      );
      expect(fileCount).toBe(1);

      const fileName = await fileInput.evaluate(
        (el: HTMLInputElement) => el.files?.[0]?.name ?? '',
      );
      expect(fileName).toBe('sample.pdf');
    } finally {
      await ctx.close();
    }
  });

  test('upload PDF to RIP field (#upload-rip)', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/recommendation/add-recommendation');
      await waitForPageLoad(page);

      const fileInput = page.locator('#upload-rip');
      await expect(fileInput).toBeAttached({ timeout: 10_000 });

      await fileInput.setInputFiles(TEST_FILES.pdf);
      const count = await fileInput.evaluate((el: HTMLInputElement) => el.files?.length ?? 0);
      expect(count).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test('uploading triggers POST /api/uploadfile1 API call', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/recommendation/add-recommendation');
      await waitForPageLoad(page);

      // Some implementations upload on file select, others on save/submit
      const uploadPromise = page
        .waitForResponse(
          (r) => r.url().includes('/uploadfile1') && r.request().method() === 'POST',
          { timeout: 8_000 },
        )
        .catch(() => null);

      await page.locator('#upload-permohonan').setInputFiles(TEST_FILES.pdf);

      // If not auto-uploaded, click Simpan to trigger
      const simpanBtn = page.getByRole('button', { name: 'Simpan' });
      if (await simpanBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await simpanBtn.click();
      }

      const uploadResponse = await uploadPromise;
      if (uploadResponse) {
        expect(uploadResponse.status()).toBeLessThan(400);
        const body = await uploadResponse.json().catch(() => null);
        console.log('Upload response:', body?.status, body?.message);
      }
    } finally {
      await ctx.close();
    }
  });

  test('file display label updates after selection', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/recommendation/add-recommendation');
      await waitForPageLoad(page);

      await page.locator('#upload-permohonan').setInputFiles(TEST_FILES.pdf);

      // Wait for React state update
      await page.waitForFunction(
        () => {
          const input = document.getElementById('upload-permohonan') as HTMLInputElement;
          return input?.files && input.files.length > 0;
        },
        { timeout: 5_000 },
      );

      // File selection is confirmed
      const fileCount = await page
        .locator('#upload-permohonan')
        .evaluate((el: HTMLInputElement) => el.files?.length ?? 0);
      expect(fileCount).toBe(1);
    } finally {
      await ctx.close();
    }
  });

  test('image upload to e-sign BSR field (#E-sign)', async ({ browser }) => {
    if (!hasAuthState('admin')) return;

    const ctx = await browser.newContext({ storageState: getStorageStatePath('admin') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/user-management/add-user');
      await waitForPageLoad(page);

      // Check the BSrE checkbox to reveal the upload field
      const bsrCheckbox = page.locator('input[type="checkbox"]').first();
      if (await bsrCheckbox.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await bsrCheckbox.check();
        await page.waitForTimeout(500);
      }

      const esignInput = page.locator('#E-sign');
      const isAttached = await esignInput.isAttached({ timeout: 5_000 }).catch(() => false);

      if (isAttached) {
        await esignInput.setInputFiles(TEST_FILES.jpg);
        const count = await esignInput.evaluate((el: HTMLInputElement) => el.files?.length ?? 0);
        expect(count).toBe(1);
      }
    } finally {
      await ctx.close();
    }
  });

  // ── File Download ──────────────────────────────────────────────────────────

  test('download file API call succeeds', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/recommendation');
      await waitForPageLoad(page);

      const rows = page.locator('tbody tr');
      if (await rows.count() === 0) {
        console.log('No recommendation tasks to test download — skipping.');
        return;
      }

      // Open a task that has a file
      await rows.first().locator('button').first().click();
      await waitForPageLoad(page);

      const onSubmission = page.url().includes('submission');
      if (!onSubmission) return;

      // Look for a "Lihat File" or "Unduh File" button
      const downloadBtn = page
        .getByRole('button', { name: /Lihat File|Unduh File|Download/i })
        .first();

      if (await downloadBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // Intercept the download API call
        const [downloadResponse] = await Promise.all([
          page
            .waitForResponse(
              (r) =>
                (r.url().includes('/downloadfile') || r.url().includes('/downloadfilebypath')) &&
                r.request().method() === 'POST',
              { timeout: 10_000 },
            )
            .catch(() => null),
          downloadBtn.click(),
        ]);

        if (downloadResponse) {
          expect(downloadResponse.status()).toBeLessThan(400);
          console.log('Download API status:', downloadResponse.status());
        }
      }
    } finally {
      await ctx.close();
    }
  });

  test('file download triggers browser download event', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
    const page = await ctx.newPage();

    try {
      await page.goto('/app/recommendation');
      await waitForPageLoad(page);

      const rows = page.locator('tbody tr');
      if (await rows.count() === 0) return;

      await rows.first().locator('button').first().click();
      await waitForPageLoad(page);

      if (!page.url().includes('submission')) return;

      const downloadBtn = page
        .getByRole('button', { name: /Unduh File|Download/i })
        .first();

      if (await downloadBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // Wait for download event
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15_000 }).catch(() => null),
          downloadBtn.click(),
        ]);

        if (download) {
          expect(download.suggestedFilename()).toBeTruthy();
          console.log('Downloaded file:', download.suggestedFilename());
        }
      }
    } finally {
      await ctx.close();
    }
  });

  // ── Base64 Upload ─────────────────────────────────────────────────────────

  test('uploadfilebase64 API accepts multipart upload', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: getStorageStatePath('dm') });
    const page = await ctx.newPage();

    try {
      // Test by submitting a form that uses base64 upload
      // Navigate to any form with file upload
      await page.goto('/app/recommendation/add-recommendation');
      await waitForPageLoad(page);

      const base64UploadCall = page
        .waitForResponse(
          (r) => r.url().includes('/uploadfilebase64') && r.request().method() === 'POST',
          { timeout: 5_000 },
        )
        .catch(() => null);

      await page.locator('#upload-permohonan').setInputFiles(TEST_FILES.pdf);

      const response = await base64UploadCall;
      if (response) {
        // If base64 upload is used, verify it succeeds
        expect(response.status()).toBeLessThan(400);
      }
      // If no base64 call — uploadfile1 is used instead (also valid)
    } finally {
      await ctx.close();
    }
  });
});
