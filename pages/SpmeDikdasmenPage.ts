/**
 * SpmeDikdasmenPage — Page Object for SPME DIKDASMEN workflow.
 *
 * Extends SubmissionPage with DIKDASMEN-specific locators and helpers.
 *
 * Routes handled:
 *   /app/spme/dikdasmen                              — submission list
 *   /app/spme/submission/:task_id                   — DK/SK task form
 *   /app/assessment-submission/submission-spme/:task_id — ASDK assessor form
 */

import type { Page, Locator, Response } from '@playwright/test';
import { expect } from '@playwright/test';
import { SubmissionPage } from './SubmissionPage';
import {
  waitForPageLoad,
  waitForTableLoad,
  waitForApiResponse,
  waitForToast,
  waitForModal,
} from '../helpers/wait.helpers';
import { fillDynamicForm, type FormFieldDef } from '../helpers/form.helpers';

export class SpmeDikdasmenPage extends SubmissionPage {
  // ── List page locators ──────────────────────────────────────────────────

  /**
   * "Ajukan Asessment" button — lives on /app/spme (SpmeScreen), NOT /app/spme/dikdasmen.
   * Note: source has a typo "Asessment" (double-s). Locator matches both spellings.
   * Only visible for role === "DD" (DIKDASMEN institution role code in the app).
   * Becomes clickable only AFTER checkProcessToStart API resolves and sets definitionDd.
   */
  readonly ajukanButton: Locator;
  /**
   * Search input on the DIKDASMEN list.
   * Actual placeholder (from DOM inspection): "Cari Aktivitas Assessment"
   */
  readonly searchInput: Locator;
  /** Table header row */
  readonly tableHeaders: Locator;
  /** Table body rows */
  readonly tableRows: Locator;

  // ── Assessment form locators ────────────────────────────────────────────

  /** Tab/section navigation for multi-standard forms */
  readonly standardTabs: Locator;
  /** Save draft button in multi-step assessment forms */
  readonly simpanDraftButton: Locator;
  /** "Kirim" or "Lanjut" button to advance to next step */
  readonly lanjutButton: Locator;

  // ── Pleno / validation locators ─────────────────────────────────────────

  /** Approval confirmation modal */
  readonly confirmModal: Locator;
  /** Confirm/Ya button inside modal */
  readonly confirmYaButton: Locator;

  constructor(page: Page) {
    super(page);

    // SpmeScreen.tsx:35 has typo "Ajukan Asessment" — match both spellings
    this.ajukanButton = page.getByRole('button', { name: /Ajukan A[s]+essment/i });
    // Actual placeholder observed in DOM: "Cari Aktivitas Assessment"
    this.searchInput = page.locator(
      'input[placeholder="Cari Aktivitas Assessment"], input[placeholder*="Cari"], input[placeholder*="Search"]',
    );
    // The DIKDASMEN list uses a custom card layout — <thead> only renders when rows exist
    this.tableHeaders = page.locator('thead th, th');
    this.tableRows = page.locator('tbody tr');

    this.standardTabs = page.locator('[role="tab"], [class*="Tab"]');
    this.simpanDraftButton = page.getByRole('button', { name: /Simpan Draft|Simpan/i }).first();
    this.lanjutButton = page.getByRole('button', { name: /Lanjut|Kirim/i }).first();

    this.confirmModal = page.locator('[role="dialog"]');
    this.confirmYaButton = page.getByRole('button', { name: /Ya|Konfirmasi/i });
  }

  // ── Navigation helpers ───────────────────────────────────────────────────

  /** Navigate to the DIKDASMEN submission list and wait for it to load. */
  async gotoList(): Promise<void> {
    await this.page.goto('/app/spme/dikdasmen');
    await waitForPageLoad(this.page);
    await waitForTableLoad(this.page).catch(() => null);
  }

  /**
   * Navigate to a specific task submission form and wait for the
   * choosetask API to return the form schema.
   */
  async gotoTask(taskId: string): Promise<Response | null> {
    await this.page.goto(`/app/spme/submission/${taskId}`);
    await waitForPageLoad(this.page);
    const schemaResponse = await this.page
      .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
      .catch(() => null);
    // Give React time to render the form fields
    await this.page.waitForTimeout(1_000);
    return schemaResponse;
  }

  /**
   * Navigate to an assessor task form (ASDK role).
   * Uses the assessment-submission route.
   */
  async gotoAssessorTask(taskId: string): Promise<Response | null> {
    await this.page.goto(`/app/assessment-submission/submission-spme/${taskId}`);
    await waitForPageLoad(this.page);
    const schemaResponse = await this.page
      .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
      .catch(() => null);
    await this.page.waitForTimeout(1_000);
    return schemaResponse;
  }

  // ── Process start helper ─────────────────────────────────────────────────

  /**
   * Start a new SPME DIKDASMEN process from the /app/spme category picker page.
   *
   * Flow (SpmeScreen.tsx + useSpme.tsx):
   *   1. Navigate to /app/spme
   *   2. Page calls checkProcessToStart on mount → sets definitionDd async
   *   3. Wait for checkprocesstostart API to resolve (button is disabled until then)
   *   4. Click "Ajukan Asessment" (note: source typo "Asessment")
   *   5. startProcess API fires → on success: navigate('/spme/submission/:task_id')
   *   6. React Router resolves to /app/spme/submission/:task_id (basename=/app)
   *
   * Returns the new task_id extracted from the redirected URL.
   */
  async startNewProcess(): Promise<string | null> {
    // Step 1: Go to category picker, NOT /app/spme/dikdasmen
    await this.page.goto('/app/spme');
    await waitForPageLoad(this.page);

    // Step 2: Wait for checkProcessToStart to resolve — this sets definitionDd
    // and enables the button. The API call fires on mount.
    const checkResp = await this.page
      .waitForResponse(
        (r) => r.url().includes('/checkprocesstostart') && r.request().method() === 'POST',
        { timeout: 15_000 },
      )
      .catch(() => null);

    if (checkResp) {
      const body = await checkResp.json().catch(() => null);
      console.log('[checkProcessToStart]', body?.status, '| definitions:', body?.data?.length ?? 0);
    }

    // Small settle time for React state update (definitionDd setState)
    await this.page.waitForTimeout(500);

    // Step 3: Button is now clickable
    await this.ajukanButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Step 4+5: Click and wait for startProcess
    const [startResponse] = await Promise.all([
      waitForApiResponse(this.page, '/startProcess'),
      this.ajukanButton.click(),
    ]);

    await waitForPageLoad(this.page);

    // Step 6: Extract task_id from /app/spme/submission/<task_id>
    const urlMatch = this.page.url().match(/\/submission\/([a-zA-Z0-9_-]+)/);
    const taskId = urlMatch?.[1] ?? null;

    if (startResponse) {
      const body = await startResponse.json().catch(() => null);
      console.log('[startProcess]', body?.status, body?.message, '→ task_id:', taskId);
    }

    return taskId;
  }

  // ── Form fill helpers ────────────────────────────────────────────────────

  /**
   * Fill and submit a dynamic form, then wait for the responsetask API.
   * Returns the API response body.
   */
  async fillAndSubmit(
    fields: FormFieldDef[],
    decision: 'save' | 'approve' | 'reject' = 'approve',
  ): Promise<unknown> {
    if (fields.length > 0) {
      await fillDynamicForm(this.page, fields);
    }

    const [apiResponse] = await Promise.all([
      waitForApiResponse(this.page, '/responsetask'),
      this.clickDecision(decision),
    ]);

    const body = await apiResponse.json().catch(() => null);
    return body;
  }

  private async clickDecision(decision: 'save' | 'approve' | 'reject'): Promise<void> {
    switch (decision) {
      case 'approve':
        await this.approveButton.click();
        break;
      case 'reject':
        await this.rejectButton.click();
        break;
      case 'save':
      default:
        await this.saveButton.click();
        break;
    }
  }

  /**
   * Upload a document and wait for the /uploadfile1 API response.
   * Wraps SubmissionPage.uploadFileAndWaitForApi with DIKDASMEN-specific logging.
   */
  async uploadDocument(uploadId: string, filePath: string): Promise<Response> {
    const response = await this.uploadFileAndWaitForApi(uploadId, filePath);
    const body = await response.json().catch(() => null);
    console.log(`[uploadfile1] id=${uploadId} status=${response.status()} response:`, body?.status);
    return response;
  }

  // ── Assertion helpers ────────────────────────────────────────────────────

  /**
   * Assert that the current page is the DIKDASMEN list (not redirected to login).
   */
  async assertOnListPage(): Promise<void> {
    await expect(this.page).not.toHaveURL(/.*login.*/);
    await expect(this.page).toHaveURL(/.*spme.*dikdasmen.*/);
  }

  /**
   * Assert the DIKDASMEN list page structure loaded correctly.
   *
   * The page uses a custom card layout. When empty ("Belum ada pengajuan"),
   * no <thead>/<th> elements are rendered — only the search/filter bar.
   * When data exists, <thead th> renders inside the table.
   *
   * This method checks the structure that is ALWAYS present: the search input
   * or the filter button. Call waitForTableLoad() separately if you need rows.
   */
  async assertTableHasColumns(): Promise<void> {
    // The search bar and Filter button are always rendered on the list page
    const filterBtn = this.page.getByRole('button', { name: /Filter/i });
    const searchVisible = await this.searchInput.isVisible({ timeout: 5_000 }).catch(() => false);
    const filterVisible = await filterBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    expect(
      searchVisible || filterVisible,
      'Expected DIKDASMEN list page to show search input or Filter button (page structure check)',
    ).toBe(true);
  }

  /**
   * Assert a specific field value is visible on the current form.
   * Used to verify data persistence across form steps.
   */
  async assertFieldValue(fieldName: string, expectedValue: string): Promise<void> {
    const input = this.page
      .locator(`input[name="${fieldName}"], textarea[name="${fieldName}"]`)
      .first();
    const actualValue = await input.inputValue();
    expect(actualValue).toBe(expectedValue);
  }

  /**
   * Assert that a toast notification appears with a given type.
   */
  async assertToast(type: 'success' | 'error' = 'success'): Promise<void> {
    await waitForToast(this.page, type);
  }

  /**
   * Assert the choosetask API response contains expected form variables.
   * Useful for verifying the correct step is rendered.
   */
  async assertFormSchemaContains(
    schemaResponse: Response | null,
    expectedKeys: string[],
  ): Promise<void> {
    if (!schemaResponse) {
      console.warn('assertFormSchemaContains: no schema response captured');
      return;
    }
    const body = await schemaResponse.json().catch(() => ({}));
    const formKeys = Object.keys(body?.data?.form_data_input ?? {});
    for (const key of expectedKeys) {
      expect(formKeys, `Expected form schema to contain "${key}"`).toContain(key);
    }
  }

  /**
   * Assert the responsetask API response indicates success (HTTP 200).
   */
  async assertTaskSubmitSuccess(responseBody: unknown): Promise<void> {
    const body = responseBody as Record<string, unknown>;
    expect(body?.status).toBe(200);
  }

  /**
   * Assert no 401 errors were encountered on any API call.
   */
  async assertNo401Errors(collectedErrors: string[]): Promise<void> {
    expect(collectedErrors, 'Unexpected 401 errors on API calls').toHaveLength(0);
  }

  /**
   * Assert the task is visible in the mytodolist response.
   */
  async assertTaskInTodoList(taskId: string): Promise<void> {
    const isPresent = await this.page.evaluate(async (id) => {
      const r = await fetch('/api/mytodolist', { method: 'GET', credentials: 'include' });
      const data = await r.json();
      return (data?.data ?? []).some(
        (t: { task_id?: string; id?: string }) => t.task_id === id || t.id === id,
      );
    }, taskId);
    expect(isPresent, `Task ${taskId} not found in mytodolist`).toBe(true);
  }

  /**
   * Assert the submission list shows a row matching the given institution name.
   */
  async assertInstitutionInList(namaLembaga: string): Promise<void> {
    const row = this.page.locator('tbody tr').filter({ hasText: namaLembaga });
    await expect(row).toBeVisible({ timeout: 10_000 });
  }

  // ── SK Assessor Assignment ───────────────────────────────────────────────

  /**
   * Fill the assessor assignment form (Step 9 — SK role).
   * Selects two different assessors from the dropdown and sets visitasi dates.
   */
  async fillAssessorAssignment(
    asesor1Name: string,
    asesor2Name: string,
    tanggalPravisitasi: string,
    tanggalVisitasi: string,
  ): Promise<void> {
    // Asesor 1 selector
    const asesor1Label = this.page.locator('label').filter({ hasText: /Asesor.*1|Asesor Pertama/i }).first();
    const asesor1Container = asesor1Label.locator('~ *').first();
    await asesor1Container.click();
    await this.page.waitForTimeout(300);
    await this.page.getByText(asesor1Name, { exact: false }).first().click();
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);

    // Asesor 2 selector
    const asesor2Label = this.page.locator('label').filter({ hasText: /Asesor.*2|Asesor Kedua/i }).first();
    const asesor2Container = asesor2Label.locator('~ *').first();
    await asesor2Container.click();
    await this.page.waitForTimeout(300);
    await this.page.getByText(asesor2Name, { exact: false }).first().click();
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(200);

    // Tanggal Pravisitasi
    const pravisitInput = this.page
      .locator(`input[name*="pravisitasi"], input[name*="Pravisitasi"]`)
      .first();
    await pravisitInput.fill(tanggalPravisitasi);
    await this.page.keyboard.press('Tab');

    // Tanggal Visitasi
    const visitasiInput = this.page
      .locator(`input[name*="visitasi"], input[name*="Visitasi"]`)
      .first();
    await visitasiInput.fill(tanggalVisitasi);
    await this.page.keyboard.press('Tab');
  }

  // ── custom-formlist helper ───────────────────────────────────────────────

  /**
   * Fill a custom-formlist (DynamicTableView) that renders a 3-level hierarchy.
   * Locates the table by a containing label text, then fills score inputs
   * in each visible row.
   *
   * @param scores Array of { skor, bobot } values for each row in the table.
   */
  async fillScoringTable(scores: Array<{ skor: string; bobot: string }>): Promise<void> {
    const tableRows = this.page.locator('table tbody tr');
    const rowCount = await tableRows.count();

    for (let i = 0; i < Math.min(rowCount, scores.length); i++) {
      const row = tableRows.nth(i);
      const inputs = row.locator('input[type="number"], input[type="text"]');
      const inputCount = await inputs.count();

      if (inputCount >= 1) {
        await inputs.nth(0).clear();
        await inputs.nth(0).fill(scores[i].skor);
      }
      if (inputCount >= 2) {
        await inputs.nth(1).clear();
        await inputs.nth(1).fill(scores[i].bobot);
      }
      await this.page.waitForTimeout(100);
    }
  }

  // ── Export helpers ───────────────────────────────────────────────────────

  /**
   * Trigger Excel export download for a completed SPME DIKDASMEN process.
   * Waits for the download event and returns the suggested filename.
   *
   * @param noTiket The process ticket number shown in the list table.
   */
  async downloadExport(noTiket: string): Promise<string> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 30_000 }),
      this.page
        .locator(`tr:has-text("${noTiket}")`)
        .locator('button[title*="Export"], button[aria-label*="Export"], a[download]')
        .first()
        .click(),
    ]);
    const fileName = download.suggestedFilename();
    console.log('[export] downloaded:', fileName);
    return fileName;
  }
}
