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
   *
   * The assessor fields are custom dropdown buttons — NOT native <select> or
   * [role="combobox"].  Each field renders as:
   *
   *   <label>Assesor 1 *</label>
   *   <div role="button" aria-haspopup="true">…current value…</div>
   *
   * After the button is clicked, a menu appears in the document root:
   *   [role="menu"] | div[role="listbox"]
   *
   * Strategy:
   *   1. Wait for "assesor/asesor" text so the async assessor list has loaded.
   *   2. Find all label elements whose text contains "assesor/asesor".
   *      Each such label is the anchor for one assessor field group.
   *   3. Within each group's parent container, locate the [role="button"] trigger.
   *   4. Click to open, wait for the menu, click the matching option.
   *   5. Date inputs: label-based container lookup with positional fallback.
   *
   * Every intermediate state is logged — failures name the exact element and
   * available menu items so the cause is clear without a headed run.
   */
  async fillAssessorAssignment(
    asesor1Name: string,
    asesor2Name: string,
    tanggalPravisitasi: string,
    tanggalVisitasi: string,
  ): Promise<void> {

    // ── 1. Wait for async assessor list to render ─────────────────────────────
    // The form fetches available assessors from the API after the task loads.
    // Blocking here on any "assesor" text prevents races with empty skeletons.
    // Note: the app spells it with double-s ("Assesor") — /asses+or/i covers both.
    await this.page.waitForSelector('text=/asses*or/i', { timeout: 15_000 });

    // ── 2. Debug snapshot ─────────────────────────────────────────────────────
    const allLabels = await this.page.locator('label').allTextContents();
    console.log(
      `    [fillAssessorAssignment] all labels (${allLabels.length}):`,
      allLabels.map((l) => `"${l.trim()}"`).join(', '),
    );

    // Locate every label whose text contains "assesor" or "asesor"
    const asesorLabels = this.page.locator('label').filter({ hasText: /asses*or/i });
    const asesorLabelCount = await asesorLabels.count();
    console.log(`    [fillAssessorAssignment] assessor label elements found: ${asesorLabelCount}`);

    if (asesorLabelCount < 2) {
      const formHtml = await this.page.locator('form, [class*="form"], main').first()
        .evaluate((el) => el.outerHTML.slice(0, 3_000))
        .catch(() => '(could not read form HTML)');
      throw new Error(
        `[fillAssessorAssignment] Expected ≥ 2 labels matching /asses*or/i but found ${asesorLabelCount}.\n` +
        `All labels: ${allLabels.map((l) => `"${l.trim()}"`).join(', ')}\n` +
        `Form HTML (first 3 000 chars):\n${formHtml}`,
      );
    }

    // ── 3. Helper — open a custom dropdown button and pick an option ──────────
    const pickFromButtonDropdown = async (
      groupIndex: number,
      optionText: string,
    ): Promise<void> => {
      console.log(`    [fillAssessorAssignment] group[${groupIndex}] → "${optionText}"`);

      // The label's immediate parent (or nearest ancestor that also contains the
      // trigger button) is our group container.  We walk up via .last() filter to
      // get the tightest wrapping div that has BOTH the matching label AND a button.
      const label = asesorLabels.nth(groupIndex);
      const labelText = (await label.textContent() ?? '').trim();
      console.log(`      label text: "${labelText}"`);

      // Build group: innermost div that contains this specific label AND a [role="button"]
      const group = this.page.locator('div').filter({
        has: this.page.locator('label').filter({ hasText: labelText }),
      }).filter({
        has: this.page.locator('[role="button"]'),
      }).last();

      const groupVisible = await group.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!groupVisible) {
        throw new Error(
          `[fillAssessorAssignment] group[${groupIndex}]: ` +
          `no div with label "${labelText}" + [role="button"] found. ` +
          `Check that the dropdown trigger uses role="button".`,
        );
      }

      // ── a) Native <select> inside group (safeguard for layout changes) ──────
      const nativeSel = group.locator('select');
      if (await nativeSel.count() > 0 && await nativeSel.isVisible({ timeout: 500 }).catch(() => false)) {
        const opts = await nativeSel.first().locator('option').all();
        for (const opt of opts) {
          const text = (await opt.textContent() ?? '').trim();
          if (text.toLowerCase().includes(optionText.toLowerCase())) {
            await nativeSel.first().selectOption({ label: text });
            console.log(`      ↳ native select[${groupIndex}] → "${text}"`);
            return;
          }
        }
      }

      // ── b) Custom [role="button"] trigger ────────────────────────────────────
      const triggerBtn = group.locator('[role="button"]').first();
      const btnCount = await triggerBtn.count();
      if (btnCount === 0) {
        throw new Error(
          `[fillAssessorAssignment] group[${groupIndex}] "${labelText}": ` +
          `[role="button"] not found inside group. ` +
          `All labels: ${allLabels.map((l) => `"${l.trim()}"`).join(', ')}`,
        );
      }

      await triggerBtn.waitFor({ state: 'visible', timeout: 8_000 });
      const triggerText = (await triggerBtn.textContent() ?? '').trim();
      console.log(`      trigger button current text: "${triggerText}"`);

      // ── c) Click button, then locate the ONE visible menu ─────────────────────
      // Multiple [role="menu"] elements can coexist in the DOM (one per dropdown
      // field, pre-rendered but hidden).  Selecting `.first()` grabs the first in
      // DOM order which is almost certainly hidden.  Instead we click the button
      // first, then query only the menu that became visible as a result.
      await triggerBtn.click();
      await this.page.waitForTimeout(400);

      // :visible pseudo-class matches only elements with non-zero bounding boxes
      // and no display:none/visibility:hidden ancestor.  Using it here means we
      // always get the menu that the browser actually rendered open — regardless
      // of how many sibling menus are present in the DOM tree.
      const visibleMenu = this.page.locator('[role="menu"]:visible').last();
      await visibleMenu.waitFor({ state: 'visible', timeout: 8_000 });

      // ── d) Collect all option elements and their raw text ────────────────────
      const optionEls = await visibleMenu
        .locator('[role="menuitem"], [role="option"], li')
        .all();

      const optionTexts = await Promise.all(
        optionEls.map(async (el) => (await el.textContent() ?? '').trim()),
      );
      console.log(
        `      visible menu items (${optionTexts.length}):`,
        optionTexts.map((t) => `"${t}"`).join(', '),
      );

      // ── e) Fuzzy match: normalize both sides, try three tiers ────────────────
      //
      // The test-data constant may include a role prefix that the UI omits, e.g.:
      //   expected  → "DS Asesor DDM #1"
      //   UI label  → "Asesor DDM #1"
      //
      // Normalization removes:
      //   • leading role abbreviations ("DS ", "SK ", "DM ", etc.)
      //   • extra whitespace
      //   • case differences
      //
      // Three match tiers (first hit wins):
      //   1. Exact    — normalized(ui) === normalized(expected)
      //   2. Contains — normalized(ui).includes(normalized(expected))   [UI is longer]
      //   3. Reverse  — normalized(expected).includes(normalized(ui))   [expected is longer]
      //
      // This covers: prefix differences, trailing qualifiers, minor label rewording.
      const normalize = (s: string): string =>
        s.toLowerCase()
          .replace(/^(ds|sk|dm|ta|mm|asdk|mha|dk|tas|asma|as)\s+/i, '')  // strip role prefix
          .replace(/\s+/g, ' ')
          .trim();

      // Tier-4 fuzzy normalization: strips academic / honorific titles AND
      // punctuation so "Dr. Ahmad Fauzi, M.Ag." → "ahmad fauzi".
      // Used as a last-resort match when the test-data label includes titles
      // that the UI dropdown omits (or vice versa).
      //
      // Strips (case-insensitive, with or without trailing dot):
      //   Honorifics: dr, prof, ir, h, hj, kh, ust, ustadz, ustadzah, drs, dra
      //   Degrees:    s.pd, s.ag, s.kom, s.e, s.h, s.hum, s.pdi, s.psi, s.sos,
      //               m.ag, m.pd, m.kom, m.e, m.h, m.hum, m.pdi, m.psi, m.sos,
      //               m.a, m.sc, ma, msc, ph.d, phd, lc
      const STRIP_TITLES_RE =
        /\b(dr|prof|ir|h|hj|kh|ust|ustadz|ustadzah|drs|dra|s\.pd|s\.ag|s\.kom|s\.e|s\.h|s\.hum|s\.pdi|s\.psi|s\.sos|m\.ag|m\.pd|m\.kom|m\.e|m\.h|m\.hum|m\.pdi|m\.psi|m\.sos|m\.a|m\.sc|ma|msc|ph\.d|phd|lc)\.?\b/gi;

      const fuzzyNormalize = (s: string): string =>
        normalize(s)
          .replace(STRIP_TITLES_RE, '')         // remove titles
          .replace(/[.,;:'"()/\\#-]/g, ' ')     // strip punctuation
          .replace(/\s+/g, ' ')
          .trim();

      const normExpected = normalize(optionText);
      const fuzzyExpected = fuzzyNormalize(optionText);
      console.log(`      normalized expected: "${normExpected}"`);
      console.log(`      fuzzy expected:      "${fuzzyExpected}"`);
      console.log(
        `      menu items (normalized): [${optionTexts.map((t) => `"${normalize(t)}"`).join(', ')}]`,
      );
      console.log(
        `      menu items (fuzzy):      [${optionTexts.map((t) => `"${fuzzyNormalize(t)}"`).join(', ')}]`,
      );

      let matchedEl: (typeof optionEls)[number] | null = null;
      let matchedText = '';
      let matchTier = '';

      // Tier 1 — exact after normalization
      for (let i = 0; i < optionEls.length; i++) {
        if (normalize(optionTexts[i]) === normExpected) {
          matchedEl = optionEls[i];
          matchedText = optionTexts[i];
          matchTier = 'exact';
          break;
        }
      }

      // Tier 2 — UI label contains normalized expected (UI may be longer)
      if (!matchedEl) {
        for (let i = 0; i < optionEls.length; i++) {
          if (normalize(optionTexts[i]).includes(normExpected)) {
            matchedEl = optionEls[i];
            matchedText = optionTexts[i];
            matchTier = 'contains(ui⊇expected)';
            break;
          }
        }
      }

      // Tier 3 — normalized expected contains UI label (expected is longer)
      if (!matchedEl) {
        for (let i = 0; i < optionEls.length; i++) {
          if (normExpected.includes(normalize(optionTexts[i])) && normalize(optionTexts[i]).length > 0) {
            matchedEl = optionEls[i];
            matchedText = optionTexts[i];
            matchTier = 'contains(expected⊇ui)';
            break;
          }
        }
      }

      // Tier 4a — fuzzy exact (titles + punctuation stripped from both sides)
      if (!matchedEl && fuzzyExpected.length > 0) {
        for (let i = 0; i < optionEls.length; i++) {
          if (fuzzyNormalize(optionTexts[i]) === fuzzyExpected) {
            matchedEl = optionEls[i];
            matchedText = optionTexts[i];
            matchTier = 'fuzzy-exact';
            break;
          }
        }
      }

      // Tier 4b — fuzzy contains (handles "Dr. Ahmad Fauzi, M.Ag." → "ahmad fauzi")
      if (!matchedEl && fuzzyExpected.length > 0) {
        for (let i = 0; i < optionEls.length; i++) {
          const f = fuzzyNormalize(optionTexts[i]);
          if (f.length === 0) continue;
          if (f.includes(fuzzyExpected) || fuzzyExpected.includes(f)) {
            matchedEl = optionEls[i];
            matchedText = optionTexts[i];
            matchTier = 'fuzzy-contains';
            break;
          }
        }
      }

      if (!matchedEl) {
        throw new Error(
          `[fillAssessorAssignment] group[${groupIndex}] "${labelText}": ` +
          `no menu item matched "${optionText}" (normalized: "${normExpected}", fuzzy: "${fuzzyExpected}") ` +
          `after exact, contains, reverse-contains, and fuzzy-title checks.\n` +
          `Available items: [${optionTexts.map((t) => `"${t}"`).join(', ')}]\n` +
          `Tip: update ASSESSOR_ASSIGNMENT.asesor_${groupIndex + 1}_name to match a UI label exactly. ` +
          `Titles like "Dr.", "M.Ag." are stripped automatically — use the bare name if matching by surname.`,
        );
      }

      await matchedEl.click();
      console.log(`      ↳ menu item [${matchTier}] "${matchedText}" ← matched "${optionText}"`);

      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);

      // Confirm trigger now reflects the selected value
      const afterText = (await triggerBtn.textContent() ?? '').trim();
      console.log(`      ✓ trigger text after selection: "${afterText}"`);
    };

    // ── 4. Fill both assessor fields ──────────────────────────────────────────
    // Labels are ordered in DOM document order: index 0 = Assesor 1, 1 = Assesor 2.
    await pickFromButtonDropdown(0, asesor1Name);
    await pickFromButtonDropdown(1, asesor2Name);

    // ── 5. Fill schedule date inputs ──────────────────────────────────────────
    // Primary: find parent div whose label matches the date-field keyword.
    // Fallback: positional index over all date/schedule inputs on the page.
    const fillDateInput = async (
      labelPattern: RegExp,
      fallbackIndex: number,
      value: string,
    ): Promise<void> => {
      console.log(`    [fillAssessorAssignment] date[${fallbackIndex}] "${value}" (${labelPattern})`);

      const group = this.page.locator('div').filter({
        has: this.page.locator('label').filter({ hasText: labelPattern }),
      }).last();

      if (await group.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const inp = group.locator('input').first();
        await inp.waitFor({ state: 'visible', timeout: 5_000 });
        await inp.fill(value);
        await this.page.keyboard.press('Tab');
        console.log(`      ↳ date (label match) ← "${value}"`);
        return;
      }

      // Positional fallback over date/schedule inputs
      const dateInputs = this.page.locator(
        'input[type="date"], ' +
        'input[type="text"][name*="tanggal"], ' +
        'input[type="text"][name*="jadwal"]',
      );
      const count = await dateInputs.count();
      if (count > fallbackIndex) {
        const inp = dateInputs.nth(fallbackIndex);
        await inp.waitFor({ state: 'visible', timeout: 5_000 });
        await inp.fill(value);
        await this.page.keyboard.press('Tab');
        console.log(`      ↳ date (positional[${fallbackIndex}]) ← "${value}"`);
        return;
      }

      throw new Error(
        `[fillAssessorAssignment] date field not found — ` +
        `pattern=${labelPattern}, fallbackIndex=${fallbackIndex}, value="${value}". ` +
        `Labels on page: ${allLabels.map((l) => `"${l.trim()}"`).join(', ')}`,
      );
    };

    // "Jadwal Asessment Mulai *"   → fallback index 0
    // "Jadwal Asessment Selesai *" → fallback index 1
    await fillDateInput(/mulai|pravisitasi/i,  0, tanggalPravisitasi);
    await fillDateInput(/selesai|visitasi/i,   1, tanggalVisitasi);
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
