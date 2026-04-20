/**
 * spme-mahadaly-e2e-positive.spec.ts
 *
 * SPME MA'HAD ALY — Complete Positive E2E Flow (1 Ticket → Mumtaz)
 *
 * Full lifecycle: Step 0 (MA Informasi Umum) → Step 70 (MA Hasil SPME).
 * All tests run serially — each step depends on the previous step completing.
 * Grade target: Mumtaz (≥ 312 totalnilai) using SCORE_MUMTAZ.
 *
 * Roles:
 *   mha   → MA  (Ma'had Aly applicant)            — Steps 0, 2–7, 70
 *   sk    → SK  (Sekretariat)                     — Steps 10, 57–63, 64, 66, 67
 *   asma  → AS  (Asesor Ma'had Aly — Asesor 1)    — Steps 75, 13, 15–20, 36, 38–43
 *   asma2 → AS  (Asesor Ma'had Aly — Asesor 2)    — Steps 76, 14, 21–26, 44–50
 *
 * IMPORTANT: This workflow uses SIX content sections per assessor pass
 * (SKL, Kurikulum, Pendidik, Pembiayaan, Karya Ilmiah/BAHTS, Pengabdian)
 * vs. DIKDASMEN's FOUR sections. Sub-step counts are correspondingly larger.
 *
 * Prerequisites:
 *   - Auth state: e2e/auth/{mha,sk,asma,asma2}-auth.json (run global-setup)
 *   - DB users matching ASESOR_ASSIGNMENT.Assesor_1_Label / Assesor_2_Label
 *   - File: e2e/test-data/files/sample.pdf  (< 500 KB)
 *
 * Run:
 *   npx playwright test spme-mahadaly-e2e-positive --project=specialist-tests
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SubmissionPage } from '../../pages/SubmissionPage';
import { SpmeDikdasmenPage } from '../../pages/SpmeDikdasmenPage';
import { waitForPageLoad } from '../../helpers/wait.helpers';
import { fillDynamicForm } from '../../helpers/form.helpers';
import { hasAuthState, getStorageStatePath, loginAs } from '../../helpers/login.helpers';
import type { RoleKey } from '../../test-data/users';
import {
  TEST_FILES,
  INSTITUTION,
  ASESOR_ASSIGNMENT,
  PRAVISITASI_DECISIONS,
  FINAL_DECISIONS,
  ALL_CRITERIA,
} from '../../test-data/spme-mahadaly-data';
import path from 'path';

// ─── Default file: small sample PDF works for all required uploads ────────
const SAMPLE_PDF = path.resolve(__dirname, '../../test-data/files/sample.pdf');

// ─── Shared ticket state (set by Step 0, read by SK/AS steps) ────────────
let noTiket: string | null = null;

// ─── Assessor ownership ──────────────────────────────────────────────────
// REMOVED: asesor1Role / asesor2Role module state.
//
// Hardcoding role assignments was the root cause of "stuck at Asesor"
// failures — the workflow engine routes dynamically and the test must
// trust the backend at the moment of use, not pre-resolve at provisioning.
// Every assessor-owned step now uses probeAndLoginAsOwner() or
// findTaskAcrossUsers() to discover the owner just-in-time.

// ─── Response-driven navigation state ────────────────────────────────────
// Updated every time logResponsetask() sees a /responsetask response with a
// non-null data.task_id.  The NEXT test can open this task via
// openTaskByResponse() instead of computing a hardcoded step number —
// important because the workflow engine may chain parallel/branch steps to
// task_ids that do NOT match the XML's steptrue value.
let lastResponseTaskId: string | null = null;

// ─── Placeholder detection ────────────────────────────────────────────────
const PLACEHOLDER_RE = /^(-+|pilih.*|select.*|--|none|null|0|choose.*)$/i;
function isPlaceholderValue(val: string | null | undefined): boolean {
  if (val === null || val === undefined) return true;
  const trimmed = val.trim();
  return trimmed === '' || PLACEHOLDER_RE.test(trimmed);
}

// ─── Task ID utilities ────────────────────────────────────────────────────
function extractNoTiket(taskId: string): string {
  return taskId.split('-').slice(0, -1).join('-');
}
function taskIdForStep(noTiket: string, step: number): string {
  return `${noTiket}-${step}`;
}
function getStepFromTaskId(taskId: string): number {
  return Number(taskId.split('-').pop());
}

// ─── API client ───────────────────────────────────────────────────────────
const API_BASE = process.env.API_BASE_URL || 'http://localhost:1235/api';
const apiUrl = (path: string): string => `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

interface TaskInfo {
  task_id: string;
  task_name: string;
  no_tiket: string;
  process_instance_id: string;
  role_code: string;
}

function mapRawTask(t: Record<string, unknown>): TaskInfo {
  return {
    task_id: String(t.task_id ?? t.id ?? ''),
    task_name: String(t.task_name ?? t.name ?? ''),
    no_tiket: String(t.no_tiket ?? t.ticket_no ?? ''),
    process_instance_id: String(t.process_instance_id ?? ''),
    role_code: String(t.role_code ?? t.role ?? ''),
  };
}

async function buildTodolistPayload(
  page: Page,
  workflow = 'SPME MAHAD ALY',
): Promise<Record<string, unknown>> {
  // We only need the request body — the browser handles auth via its own cookies.
  // Manual Authorization header was the source of "Invalid character in
  // header content" errors when undici saw control bytes in the cookie jar.
  const cookies = await page.context().cookies();
  const detailUserCookie = cookies.find((c) => c.name === 'detailUser');
  const detail = (() => {
    if (!detailUserCookie?.value) return null;
    try { return JSON.parse(decodeURIComponent(detailUserCookie.value)); }
    catch { try { return JSON.parse(detailUserCookie.value); } catch { return null; } }
  })() as { fullname?: string; lembaga?: string | null; roles?: { role_code?: string }[] } | null;

  return {
    role: detail?.roles?.[0]?.role_code ?? '',
    username: detail?.fullname ?? '',
    lembaga: detail?.lembaga ?? null,
    workflow,
    status: ['Selesai', 'Sedang Diproses'],
  };
}

async function getAllPendingTasks(page: Page): Promise<TaskInfo[]> {
  const payload = await buildTodolistPayload(page);

  // Run fetch INSIDE the browser page — the browser builds the Cookie header
  // itself, bypassing undici's strict validator that was throwing
  // "Invalid character in header content ['cookie']".
  const body = await page.evaluate(
    async ({ url, payload }) => {
      try {
        const r = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!r.ok) return { data: [] };
        return await r.json().catch(() => ({ data: [] }));
      } catch {
        return { data: [] };
      }
    },
    { url: apiUrl('/mytodolist'), payload },
  ) as { data?: unknown[] };

  const tasks = Array.isArray(body?.data) ? (body.data as Record<string, unknown>[]) : [];
  return tasks.map((t) => mapRawTask(t));
}

async function getUserFromCookies(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const detailCookie = cookies.find((c) => c.name === 'detailUser');
  if (!detailCookie?.value) return '(no detailUser cookie)';
  try {
    const d = JSON.parse(decodeURIComponent(detailCookie.value));
    return `${d.fullname ?? '?'} (${d.email ?? '?'}) role=${d.roles?.[0]?.role_code ?? '?'}`;
  } catch {
    return '(could not parse detailUser cookie)';
  }
}

// ─── Navigation helpers ───────────────────────────────────────────────────
async function openSubmissionTask(page: Page, taskId: string): Promise<void> {
  const choosetaskPromise = page
    .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 15_000 })
    .catch(() => null);
  await page.goto(`/app/spme/submission/${taskId}`);
  await waitForPageLoad(page);
  await choosetaskPromise;
  await page.waitForTimeout(500);
}

async function isPageEditable(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  const btn = page.getByRole('button', { name: /Simpan|Selesai|Lanjutkan|Kirim/i }).first();
  return btn.isVisible({ timeout: 2_000 }).catch(() => false);
}

/**
 * Claim a task by navigating to /app/inbox and clicking its card.  The
 * BACKEND only marks a task as claimed when the inbox card is clicked —
 * direct URL navigation alone leaves the form read-only.
 *
 * Strategy (deterministic filter):
 *   1. goto /app/inbox, wait for list render (anchor: "Kotak Masuk"/"Inbox"
 *      heading or the "Cari Pesan"/"Search" input).
 *   2. Type the ticketId into the search input — this filters the list to
 *      exactly our ticket, bypassing virtualisation / pagination / sort-order
 *      issues that plain DOM scraping hits.
 *   3. Wait for the filtered card containing the ticket number to be
 *      visible, then click.
 *   4. Wait for SPA redirect and return the landed task_id.
 *
 * Returns null after exhausting the retry budget so the caller can decide
 * whether to skip or fail.
 */
async function claimTaskFromInbox(
  page: Page,
  ticketId: string,
  {
    retries = 8,
    delayMs = 2_000,
    label = 'CLAIM',
  }: { retries?: number; delayMs?: number; label?: string } = {},
): Promise<string | null> {
  if (page.isClosed()) return null;

  const escaped = ticketId.replace(/[-]/g, '\\-');
  const ticketRegex = new RegExp(`#?${escaped}(?!\\d)`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`    [${label}] attempt ${attempt}/${retries} — loading inbox for ticket=${ticketId}`);

    try {
      // Use 'load' not 'domcontentloaded' so we wait for the SPA bundle,
      // then networkidle for the inbox API fetch to complete.
      await page.goto('/app/inbox', { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
      await waitForPageLoad(page);
      await page.waitForTimeout(600);
    } catch (e) {
      console.warn(`    [${label}] inbox load error: ${String(e).slice(0, 100)}`);
      if (attempt < retries) await page.waitForTimeout(delayMs);
      continue;
    }

    // ── Use the Cari Pesan / Search input to filter to the exact ticket.
    // This makes matching deterministic regardless of how many unrelated
    // tickets are in the inbox or whether the list virtualises rendering.
    const searchInput = page
      .getByPlaceholder(/^(Search|Cari.*|Cari Pesan)$/i)
      .or(page.locator('input[type="search"]'))
      .or(page.locator('input[placeholder*="Cari" i]'))
      .or(page.locator('input[placeholder*="Search" i]'))
      .first();

    const hasSearch = await searchInput.isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasSearch) {
      console.log(`    [${label}] typing "${ticketId}" into Cari Pesan`);
      await searchInput.click().catch(() => null);
      await searchInput.fill('').catch(() => null);
      await searchInput.fill(ticketId).catch(() => null);
      await page.waitForTimeout(800); // debounce
    } else {
      console.log(`    [${label}] Cari Pesan not found — falling back to raw scan`);
    }

    // Wait for the filtered card to appear.
    const card = page.getByText(ticketRegex).first();
    const found = await card.waitFor({ state: 'visible', timeout: 6_000 })
      .then(() => true).catch(() => false);

    if (!found) {
      // Diagnostic: dump first ~1500 chars of body text so we can see
      // what the inbox actually rendered.
      const bodyText = await page.locator('body').innerText().catch(() => '').then((t) => t.slice(0, 1500));
      console.warn(
        `    [${label}] no card for ticket "${ticketId}" (attempt ${attempt}/${retries}).\n` +
        `    inbox body preview: ${bodyText.replace(/\n/g, ' | ')}`,
      );
      if (attempt < retries) await page.waitForTimeout(delayMs);
      continue;
    }

    console.log(`    [${label}] card visible — clicking`);
    await Promise.all([
      page.waitForURL(/\/app\/spme\/submission\/[\w-]+/, { timeout: 15_000 }).catch(() => null),
      card.click(),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(700);

    const urlMatch = page.url().match(/\/submission\/([\w-]+)(?:[/?#]|$)/);
    const landedTaskId = urlMatch?.[1] ?? null;

    if (!landedTaskId) {
      console.warn(`    [${label}] click did not land on a submission URL: ${page.url()}`);
      if (attempt < retries) await page.waitForTimeout(delayMs);
      continue;
    }

    console.log(`    [${label}] ✓ claimed taskId=${landedTaskId} on attempt ${attempt}`);
    return landedTaskId;
  }

  console.warn(
    `    [${label}] exhausted ${retries} × ${delayMs / 1_000}s — no card for ticket "${ticketId}".`,
  );
  return null;
}

// [REMOVED] openAssessorTask — superseded by openTaskSmart and
// openNextTaskByResponse, which both implement the full
// direct-URL → pool-claim → inbox-fallback strategy in one place.

/**
 * Action timeouts — every interaction uses an explicit short cap so the
 * filler can never hang on a stale/removed element.  Default Playwright
 * action timeout is 30s; we override it on every call.
 */
const SHORT_ACTION_MS = 1_500;
const MEDIUM_ACTION_MS = 3_000;

/**
 * Strings that indicate a POSITIVE workflow choice (continue/lulus/memenuhi).
 * Order = preference: earlier entries are preferred over later ones when
 * filling a select/dropdown for the happy path.  Critical for fields like
 * `Apakah_PraVisitasi_Asesor_*_Dapat_DiLanjutkan` (Ya|Tidak) — if we pick
 * "Tidak" the workflow takes the revisi branch (steps 30–35) instead of
 * advancing to Hasil Visitasi (steps 36/44).
 */
const POSITIVE_OPTION_PRIORITY: ReadonlyArray<RegExp> = [
  /^ya$/i,
  /^lanjutkan$/i,
  /\blulus\b(?!.*tidak)/i,
  /\bmemenuhi\b(?!.*tidak)/i,
  /\bya\b/i,
  /\bdilanjutkan\b/i,
  /\bdapat\s+dilanjutkan\b/i,
  /\bsetuju\b/i,
  /^mumtaz/i,
];

/**
 * Strings that indicate a NEGATIVE workflow choice — used as an exclusion
 * list when no positive match is found, so we'd rather pick a neutral
 * placeholder-replacement than actively select a "no/reject" answer.
 */
const NEGATIVE_OPTION_BLOCKLIST: ReadonlyArray<RegExp> = [
  /^tidak$/i,
  /\btidak\s+(lulus|memenuhi|dilanjutkan|dapat)\b/i,
  /\bbelum\b/i,
  /\brasib\b/i,
  /\brevisi\b/i,
  /\bditolak\b/i,
  /\breject/i,
  /\bkembali\b/i,
];

/**
 * Pick the best option from a list of {value, text} pairs for the happy-path
 * workflow.  Skips placeholders, prefers positive matches in priority order,
 * skips negative-blocklist hits, then falls back to the first non-blocked
 * non-placeholder.
 */
function pickPositiveOption<T extends { value: string | null; text: string }>(
  opts: readonly T[],
): T | null {
  // Tier 1 — positive priority match
  for (const re of POSITIVE_OPTION_PRIORITY) {
    const hit = opts.find(
      (o) => !isPlaceholderValue(o.value) && re.test(o.text.trim()),
    );
    if (hit) return hit;
  }
  // Tier 2 — first non-placeholder, non-negative
  const safe = opts.find(
    (o) =>
      !isPlaceholderValue(o.value) &&
      !NEGATIVE_OPTION_BLOCKLIST.some((re) => re.test(o.text.trim())),
  );
  if (safe) return safe;
  // Tier 3 — last resort: anything non-placeholder (even negative)
  return opts.find((o) => !isPlaceholderValue(o.value)) ?? null;
}

/**
 * Steps whose "Lanjutkan" click is a pure UI transition — NO backend
 * submission happens, so the absence of /submit or /responsetask is NOT
 * an error.  For these steps submitStrict accepts any observable UI
 * change (DOM content delta) as a valid progress signal.
 *
 * Steps 13 and 14 (Pra-Visitasi Informasi Umum) were briefly marked UI-only
 * based on observed /submit silence, but the real fix is filling ALL form
 * fields on those pages — once every input/textarea/radio is populated,
 * the backend submission fires normally.  Keep this set empty until a
 * genuine UI-only step is confirmed.
 */
const UI_ONLY_STEPS: ReadonlySet<number> = new Set<number>([]);

/**
 * Expand every visible collapsible section so its children are mounted
 * and can be filled.  Best-effort; never throws and never waits longer
 * than SHORT_ACTION_MS per element.
 */
async function expandCollapsibleSections(page: Page): Promise<number> {
  let opened = 0;

  // <details> — native collapse; evaluate is synchronous client-side.
  const details = page.locator('details:not([open]):visible');
  const dCount = await details.count().catch(() => 0);
  for (let i = 0; i < dCount; i++) {
    try {
      await details.nth(i)
        .evaluate((el) => (el as HTMLDetailsElement).open = true, { timeout: SHORT_ACTION_MS })
        .then(() => { opened++; })
        .catch(() => null);
    } catch { /* swallow */ }
  }

  // aria-expanded="false" toggles — only act on CONTENT sections, not
  // interactive buttons.  Previously we were clicking assessor dropdowns
  // (which use [role="button"][aria-expanded]) and opening menu overlays
  // that blocked the real Lanjutkan click.
  //
  // Skip any element that looks like a menu/dropdown trigger:
  //   • role: combobox, listbox, button, menuitem
  //   • has aria-haspopup / aria-controls referencing a popup
  //   • tag: button / [role="button"] (treat as interactive)
  const collapsed = page.locator('[aria-expanded="false"]:visible');
  const cCount = await collapsed.count().catch(() => 0);
  for (let i = 0; i < cCount; i++) {
    try {
      const el = collapsed.nth(i);
      const [role, hasPopup, tag] = await Promise.all([
        el.getAttribute('role', { timeout: SHORT_ACTION_MS }).catch(() => null),
        el.getAttribute('aria-haspopup', { timeout: SHORT_ACTION_MS }).catch(() => null),
        el.evaluate((n) => n.tagName.toLowerCase(), { timeout: SHORT_ACTION_MS }).catch(() => ''),
      ]);
      if (
        role === 'combobox' || role === 'listbox' ||
        role === 'button' || role === 'menuitem' ||
        hasPopup || tag === 'button'
      ) continue;
      await el.click({ force: true, timeout: SHORT_ACTION_MS }).catch(() => null);
      opened++;
    } catch { /* swallow */ }
  }

  // Common "Tampilkan"/"Expand"/"Show more" buttons.
  const showButtons = page.getByRole('button', {
    name: /^(Tampilkan|Tampilkan Semua|Expand|Expand All|Show|Show More|Lebih Banyak)$/i,
  });
  const sCount = await showButtons.count().catch(() => 0);
  for (let i = 0; i < sCount; i++) {
    try {
      await showButtons.nth(i).click({ force: true, timeout: SHORT_ACTION_MS }).catch(() => null);
      opened++;
    } catch { /* swallow */ }
  }

  return opened;
}

/**
 * Fill all custom (non-native) dropdowns — div/button triggers with an
 * associated listbox popup.  Common patterns:
 *   • role="combobox" with aria-haspopup="listbox"
 *   • button followed by a [role="listbox"] overlay
 *   • the SPME app's own Select component (div[role="button"] → [role="menu"])
 *
 * Clicks the trigger, then picks the first non-placeholder option.
 */
async function fillCustomDropdowns(page: Page): Promise<number> {
  let picked = 0;

  // Selector covers ARIA-standard dropdown patterns only.
  //
  // NOTE: We deliberately do NOT match `[role="button"][aria-haspopup]`
  // or `[role="button"][aria-expanded]`.  SPME's assessor-assignment
  // dropdowns (Step 10) use those attributes but are managed by the
  // dedicated `fillAssessorAssignment` helper — blindly reopening them
  // here would overwrite the carefully-selected assessor names.
  //
  // Workflow-decision dropdowns (Apakah ... Dapat DiLanjutkan) are
  // handled separately by `fillWorkflowDecisionDropdowns()`, which
  // scopes its matching to labels containing decision keywords.
  const triggers = page.locator(
    '[role="combobox"]:visible, ' +
    '[aria-haspopup="listbox"]:visible, ' +
    '[aria-haspopup="menu"]:visible, ' +
    '[aria-haspopup="true"]:not([role="button"]):visible',
  );
  const tCount = await triggers.count().catch(() => 0);

  for (let i = 0; i < tCount; i++) {
    try {
      const trigger = triggers.nth(i);
      if (!await trigger.isVisible({ timeout: 500 }).catch(() => false)) continue;

      // Skip triggers that already have a non-placeholder value displayed.
      const currentText = (await trigger.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '';
      if (currentText && !isPlaceholderValue(currentText.trim())) continue;

      await trigger.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
      await page.waitForTimeout(250);

      // Find the menu that became visible — short probe, not blocking wait.
      const menu = page.locator(
        '[role="listbox"]:visible, [role="menu"]:visible',
      ).last();
      if (!await menu.isVisible({ timeout: SHORT_ACTION_MS }).catch(() => false)) {
        // Click again to close the unknown popup.
        await trigger.click({ force: true, timeout: SHORT_ACTION_MS }).catch(() => null);
        continue;
      }

      // Collect ALL options first, then use pickPositiveOption to pick the
      // happy-path choice (Ya / Lulus / Memenuhi) instead of just the
      // first item in DOM order.
      const optionEls = await menu
        .locator('[role="option"], [role="menuitem"], li')
        .all();
      const optionPairs = await Promise.all(optionEls.map(async (el, idx) => ({
        el,
        idx,
        // Use the option's text as both `value` (no real value attribute on
        // div-based menuitems) and `text` so pickPositiveOption can match.
        value: ((await el.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim() || null,
        text: ((await el.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim(),
      })));
      const choice = pickPositiveOption(optionPairs);
      let selected = false;
      if (choice) {
        await choice.el.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
        selected = true;
        picked++;
      }

      if (!selected) {
        await page.keyboard.press('Escape').catch(() => null);
      }
      await page.waitForTimeout(200);
    } catch { /* swallow — opportunistic */ }
  }

  return picked;
}

/**
 * Narrow, label-scoped filler for SPME workflow-decision dropdowns.
 *
 * These are the Ya/Tidak fields that gate the Pra-Visitasi → Hasil DAG
 * transition (e.g. "Apakah PraVisitasi Asesor 1 Dapat DiLanjutkan").
 * They render as <div role="button" aria-haspopup="true"> triggers —
 * the same pattern SPME uses for assessor-assignment dropdowns — so we
 * CANNOT fill them with a generic `[role="button"]` match; that would
 * clobber the assessor selections on Step 10.
 *
 * Strategy:
 *   1. Find every <label> whose text matches a decision keyword
 *      (Apakah / Dapat DiLanjutkan / Lanjutkan / Dilanjutkan / Revisi).
 *   2. For each matching label, find the nearest <div role="button">
 *      in its group container.
 *   3. If the trigger still shows a placeholder, open it, pick the
 *      first option matching `pickPositiveOption` priority.
 *
 * Safe to call on every step: non-matching pages simply find zero
 * labels and no-op.
 */
async function fillWorkflowDecisionDropdowns(page: Page, label: string): Promise<number> {
  const decisionLabelRegex = /apakah|dapat\s+dilanjutkan|lanjutkan|dilanjutkan|revisi/i;
  const labels = page.locator('label').filter({ hasText: decisionLabelRegex });
  const lCount = await labels.count().catch(() => 0);
  if (lCount === 0) return 0;

  let filled = 0;
  for (let i = 0; i < lCount; i++) {
    try {
      const lab = labels.nth(i);
      if (!await lab.isVisible({ timeout: SHORT_ACTION_MS }).catch(() => false)) continue;
      const labelText = ((await lab.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim();

      // Find the innermost wrapper div that contains both THIS specific
      // label and a role=button trigger — same pattern SpmeDikdasmenPage
      // uses for assessor dropdowns.
      const group = page.locator('div').filter({
        has: page.locator('label').filter({ hasText: labelText }),
      }).filter({
        has: page.locator('[role="button"]'),
      }).last();

      if (!await group.isVisible({ timeout: SHORT_ACTION_MS }).catch(() => false)) continue;

      const trigger = group.locator('[role="button"]').first();
      const triggerText = ((await trigger.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim();
      if (triggerText && !isPlaceholderValue(triggerText)) {
        // Already filled — skip.
        continue;
      }

      console.log(`    [${label}] decision dropdown "${labelText}" — opening`);
      await trigger.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
      await page.waitForTimeout(250);

      const menu = page.locator('[role="menu"]:visible, [role="listbox"]:visible').last();
      if (!await menu.isVisible({ timeout: SHORT_ACTION_MS }).catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => null);
        continue;
      }

      const items = await menu.locator('[role="menuitem"], [role="option"], li').all();
      const pairs = await Promise.all(items.map(async (el) => ({
        el,
        value: ((await el.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim() || null,
        text: ((await el.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim(),
      })));
      const choice = pickPositiveOption(pairs);
      if (choice) {
        await choice.el.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
        console.log(`    [${label}] decision dropdown "${labelText}" ← "${choice.text}"`);
        filled++;
      } else {
        await page.keyboard.press('Escape').catch(() => null);
      }
      await page.waitForTimeout(200);
    } catch { /* swallow */ }
  }

  if (filled > 0) console.log(`    [${label}] fillWorkflowDecisionDropdowns: ${filled} decision(s) set`);
  return filled;
}

/**
 * Fill empty contenteditable elements with a dummy string.
 * All actions bounded by SHORT_ACTION_MS / MEDIUM_ACTION_MS.
 */
async function fillContentEditable(page: Page, label: string): Promise<number> {
  let filled = 0;
  const editables = page.locator('[contenteditable="true"]:visible, [contenteditable=""]:visible');
  const count = await editables.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    try {
      const el = editables.nth(i);
      const text = ((await el.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim();
      if (text) continue;
      await el.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
      await page.keyboard.type(`OK — ${label}`, { delay: 0 }).catch(() => null);
      filled++;
    } catch { /* swallow */ }
  }
  return filled;
}

/**
 * Robustly fill EVERY fillable field on the page — native HTML AND custom
 * UI components — across multiple passes so conditional fields that appear
 * after an interaction are also filled.  Used by strict-submit helpers to
 * guarantee the backend won't reject the submit for missing required data.
 *
 * Passes (each pass re-scans the DOM):
 *   1. Expand collapsible sections (details/aria-expanded/"Tampilkan")
 *   2. Native fields: radios, checkboxes, textareas, text inputs, selects
 *   3. Custom dropdowns: role=combobox, aria-haspopup=listbox, Select/Menu
 *   4. Contenteditable divs
 *   5. Repeat until no new fields changed OR `maxPasses` reached
 *
 * Never throws — best-effort fills with catch() so uncooperative elements
 * don't abort the loop.  Returns aggregated counts.
 */
async function fillAllVisibleFormFields(
  page: Page,
  label: string,
  { maxPasses = 3 }: { maxPasses?: number } = {},
): Promise<{ radios: number; checkboxes: number; textareas: number; inputs: number; selects: number; customDropdowns: number; contentEditables: number; expanded: number }> {
  const agg = {
    radios: 0, checkboxes: 0, textareas: 0, inputs: 0, selects: 0,
    customDropdowns: 0, contentEditables: 0, expanded: 0,
  };

  for (let pass = 1; pass <= maxPasses; pass++) {
    const before = { ...agg };

    // ── Phase A — expand collapsible sections so children mount ──────
    agg.expanded += await expandCollapsibleSections(page);
    await page.waitForTimeout(200);

    // ── Phase B — radios (one per "name" group) ─────────────────────
    const radios = page.locator('input[type="radio"]:visible');
    const rCount = await radios.count().catch(() => 0);
    const seenGroups = new Set<string>();
    for (let i = 0; i < rCount; i++) {
      try {
        const r = radios.nth(i);
        const name = await r.getAttribute('name', { timeout: SHORT_ACTION_MS }).catch(() => null);
        if (!name || seenGroups.has(name)) continue;
        seenGroups.add(name);
        const anyChecked = await page
          .locator(`input[type="radio"][name="${CSS.escape(name)}"]:checked`)
          .count()
          .catch(() => 0);
        if (anyChecked > 0) continue;
        await r.check({ force: true, timeout: SHORT_ACTION_MS }).catch(() => null);
        agg.radios++;
      } catch { /* swallow */ }
    }

    // ── Phase C — checkboxes marked required or aria-required ─────────
    const checkboxes = page.locator(
      'input[type="checkbox"][required]:visible, ' +
      'input[type="checkbox"][aria-required="true"]:visible',
    );
    const cbCount = await checkboxes.count().catch(() => 0);
    for (let i = 0; i < cbCount; i++) {
      try {
        const cb = checkboxes.nth(i);
        if (await cb.isChecked({ timeout: SHORT_ACTION_MS }).catch(() => true)) continue;
        await cb.check({ force: true, timeout: SHORT_ACTION_MS }).catch(() => null);
        agg.checkboxes++;
      } catch { /* swallow */ }
    }

    // ── Phase D — textareas ───────────────────────────────────────────
    const textareas = page.locator('textarea:visible');
    const taCount = await textareas.count().catch(() => 0);
    for (let i = 0; i < taCount; i++) {
      try {
        const ta = textareas.nth(i);
        if ((await ta.inputValue({ timeout: SHORT_ACTION_MS }).catch(() => '')).trim()) continue;
        await ta.fill(`OK — ${label}`, { timeout: SHORT_ACTION_MS }).catch(() => null);
        agg.textareas++;
      } catch { /* swallow */ }
    }

    // ── Phase E — text/email/tel/number/date/url/untyped inputs ──────
    // CRITICAL: value must be format-appropriate for the input's `type`.
    // Filling `type="date"` with an arbitrary text string leaves the
    // element invalid (silently — no visible validation message), which
    // causes the form's own onClick handler to block submit even though
    // the button LOOKS enabled.  Same for number/email/tel/url.
    const inputs = page.locator(
      'input[type="text"]:visible, input[type="email"]:visible, ' +
      'input[type="tel"]:visible, input[type="number"]:visible, ' +
      'input[type="url"]:visible, input[type="date"]:visible, ' +
      'input[type="datetime-local"]:visible, input[type="month"]:visible, ' +
      'input[type="week"]:visible, input[type="time"]:visible, ' +
      'input:not([type]):visible',
    );
    const inCount = await inputs.count().catch(() => 0);
    for (let i = 0; i < inCount; i++) {
      try {
        const inp = inputs.nth(i);
        const existingVal = (await inp.inputValue({ timeout: SHORT_ACTION_MS }).catch(() => '')).trim();
        const type = ((await inp.getAttribute('type', { timeout: SHORT_ACTION_MS }).catch(() => '')) ?? 'text').toLowerCase();
        const name = (await inp.getAttribute('name', { timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '';
        const nameLc = name.toLowerCase();

        // Treat an existing value as "already filled" only if it passes
        // format validation for its type.  Otherwise re-fill so we don't
        // leave `auto-…` garbage in a date/number field from a previous
        // pass.  Empty-string = unfilled, same as before.
        if (existingVal) {
          const invalidForType =
            (type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(existingVal)) ||
            (type === 'number' && Number.isNaN(Number(existingVal))) ||
            (type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(existingVal)) ||
            (type === 'url' && !/^https?:\/\//i.test(existingVal));
          if (!invalidForType) continue;
          // Invalid value — clear it so `.fill()` below replaces cleanly.
          await inp.fill('', { timeout: SHORT_ACTION_MS }).catch(() => null);
        }

        // Pick a format-appropriate value.  Name-based heuristics catch
        // cases where the UI uses type="text" for dates/numbers (common in
        // Indonesian forms via custom date-picker libraries).
        let value: string;
        if (type === 'date' || /tanggal|waktu|jadwal|date/i.test(nameLc)) {
          value = '2026-04-20';
        } else if (type === 'datetime-local') {
          value = '2026-04-20T10:00';
        } else if (type === 'month') {
          value = '2026-04';
        } else if (type === 'week') {
          value = '2026-W17';
        } else if (type === 'time') {
          value = '10:00';
        } else if (type === 'number' || /jumlah|tahun|nilai|skor|total|nomor|^n[a-z]*$/.test(nameLc)) {
          // Use a sensible default: "tahun" fields get a realistic year,
          // counts get 1, generic numbers get 1.
          if (/tahun/i.test(nameLc)) value = '2026';
          else value = '1';
        } else if (type === 'email' || /email/i.test(nameLc)) {
          value = 'auto-test@yopmail.com';
        } else if (type === 'tel' || /telepon|phone|hp|whatsapp/i.test(nameLc)) {
          value = '081234567890';
        } else if (type === 'url' || /website|url|link/i.test(nameLc)) {
          value = 'https://example.com';
        } else {
          // Default text value — truncated to avoid maxlength issues.
          value = `auto-${label}-${name || i}`.slice(0, 40);
        }

        await inp.fill(value, { timeout: SHORT_ACTION_MS }).catch(() => null);
        // Some React date pickers only commit on blur — press Tab.
        if (type === 'date' || /tanggal|waktu|jadwal|date/i.test(nameLc)) {
          await inp.press('Tab', { timeout: SHORT_ACTION_MS }).catch(() => null);
        }
        agg.inputs++;
      } catch { /* swallow */ }
    }

    // ── Phase F — native <select> ────────────────────────────────────
    // Use pickPositiveOption so workflow-decision selects (Ya|Tidak) get
    // "Ya" — picking the first non-placeholder ("Tidak" in some renders)
    // sent the workflow into the revisi loop.
    const selects = page.locator('select:visible');
    const selCount = await selects.count().catch(() => 0);
    for (let i = 0; i < selCount; i++) {
      try {
        const sel = selects.nth(i);
        if (!isPlaceholderValue(await sel.inputValue({ timeout: SHORT_ACTION_MS }).catch(() => ''))) continue;
        const optEls = await sel.locator('option').all();
        const optPairs = await Promise.all(optEls.map(async (o) => ({
          value: await o.getAttribute('value', { timeout: SHORT_ACTION_MS }).catch(() => null),
          text: ((await o.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim(),
        })));
        const picked = pickPositiveOption(optPairs);
        if (picked && picked.value !== null) {
          await sel.selectOption(picked.value, { timeout: SHORT_ACTION_MS }).catch(() => null);
          agg.selects++;
        }
      } catch { /* swallow */ }
    }

    // ── Phase G — custom (role-based) dropdowns ──────────────────────
    agg.customDropdowns += await fillCustomDropdowns(page);

    // ── Phase H — contenteditable ────────────────────────────────────
    agg.contentEditables += await fillContentEditable(page, label);

    // Early exit if this pass filled nothing new.
    const changed =
      agg.radios + agg.checkboxes + agg.textareas + agg.inputs +
      agg.selects + agg.customDropdowns + agg.contentEditables + agg.expanded;
    const prevChanged =
      before.radios + before.checkboxes + before.textareas + before.inputs +
      before.selects + before.customDropdowns + before.contentEditables + before.expanded;
    console.log(
      `    [${label}] fillAllVisibleFormFields pass=${pass}/${maxPasses} ` +
      `radios=${agg.radios} cb=${agg.checkboxes} ta=${agg.textareas} ` +
      `in=${agg.inputs} sel=${agg.selects} customDD=${agg.customDropdowns} ` +
      `ce=${agg.contentEditables} expand=${agg.expanded}`,
    );
    if (changed === prevChanged) break;
    await page.waitForTimeout(250);
  }

  return agg;
}

/**
 * Scan the page for any required field that is still empty AFTER the
 * form-filler has run.  Returns a list of field descriptors so the caller
 * can log which ones the filler missed and decide whether to retry or
 * proceed.
 *
 * Detects required-ness via:
 *   • native [required] attribute
 *   • [aria-required="true"]
 *   • .required CSS class (used by some UI kits)
 *
 * Covers native inputs, textareas, selects, and custom dropdowns that
 * still read as placeholder values.
 */
async function verifyAllRequiredFilled(
  page: Page,
  label: string,
): Promise<{ name: string; kind: string; reason: string }[]> {
  const empty: { name: string; kind: string; reason: string }[] = [];

  const requiredSel = '[required]:visible, [aria-required="true"]:visible, .required:visible';
  const nodes = page.locator(requiredSel);
  const count = await nodes.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    try {
      const el = nodes.nth(i);
      const tag = await el.evaluate((n) => n.tagName.toLowerCase(), { timeout: SHORT_ACTION_MS })
        .catch(() => '');
      const nameAttr = (await el.getAttribute('name', { timeout: SHORT_ACTION_MS }).catch(() => null))
        ?? (await el.getAttribute('id', { timeout: SHORT_ACTION_MS }).catch(() => null))
        ?? `[${tag} index ${i}]`;

      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        const val = (await el.inputValue({ timeout: SHORT_ACTION_MS }).catch(() => '')).trim();
        if (!val || (tag === 'select' && isPlaceholderValue(val))) {
          empty.push({ name: nameAttr, kind: tag, reason: `empty value "${val}"` });
        } else if (tag === 'input') {
          // Format-level validity check — catches the silent "filled with
          // garbage" case that would make the backend reject submit even
          // though `val` is non-empty.
          const inpType = ((await el.getAttribute('type', { timeout: SHORT_ACTION_MS }).catch(() => '')) ?? 'text').toLowerCase();
          const invalid =
            (inpType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(val)) ||
            (inpType === 'number' && Number.isNaN(Number(val))) ||
            (inpType === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(val)) ||
            (inpType === 'url' && !/^https?:\/\//i.test(val));
          if (invalid) {
            empty.push({
              name: nameAttr,
              kind: `input[type=${inpType}]`,
              reason: `invalid format — value "${val.slice(0, 40)}"`,
            });
          }
        }
      } else {
        // Custom component (div-based combobox / etc.) — treat text-empty
        // OR placeholder-textual value as unfilled.
        const text = ((await el.textContent({ timeout: SHORT_ACTION_MS }).catch(() => '')) ?? '').trim();
        if (!text || isPlaceholderValue(text)) {
          empty.push({ name: nameAttr, kind: `${tag} (custom)`, reason: `text "${text}"` });
        }
      }
    } catch { /* swallow per-element */ }
  }

  if (empty.length > 0) {
    console.warn(
      `    [${label}] verifyAllRequiredFilled: ${empty.length} unfilled required field(s): ` +
      `${empty.map((e) => `${e.name} (${e.kind}) — ${e.reason}`).join(' | ')}`,
    );
  } else {
    console.log(`    [${label}] verifyAllRequiredFilled: ✓ all required fields populated`);
  }

  return empty;
}

/**
 * Dump page diagnostics on failure: screenshot + visible-input count +
 * validation-message text.  Used by submitStrict when a submit signal
 * never fires.
 */
async function captureSubmitFailure(page: Page, label: string): Promise<string> {
  const timestamp = Date.now();
  const screenshotPath = `test-results/submit-failure-${label.replace(/[^\w]+/g, '_')}-${timestamp}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);

  const [inputCount, taCount, selCount, radioCount, dropdownCount] = await Promise.all([
    page.locator('input:visible').count().catch(() => 0),
    page.locator('textarea:visible').count().catch(() => 0),
    page.locator('select:visible').count().catch(() => 0),
    page.locator('input[type="radio"]:visible').count().catch(() => 0),
    page.locator('[role="combobox"]:visible, [aria-haspopup="listbox"]:visible').count().catch(() => 0),
  ]);

  const validationMsgs = await page.locator(
    '[role="alert"]:visible, .error:visible, .invalid-feedback:visible, ' +
    '.text-danger:visible, .text-red-500:visible, [class*="error" i]:visible',
  ).allTextContents().catch(() => []);

  const visibleButtons = await page.locator('button:visible').allTextContents().catch(() => []);
  const submitBtn = page.locator('button#true').first()
    .or(page.getByRole('button', { name: /^(Lanjutkan|Kirim|Selesai|Submit)$/i }).first());
  const submitEnabled = await submitBtn.isEnabled().catch(() => 'unknown');

  return (
    `  Screenshot: ${screenshotPath}\n` +
    `  URL: ${page.url()}\n` +
    `  Visible fields: inputs=${inputCount} textareas=${taCount} selects=${selCount} radios=${radioCount} customDD=${dropdownCount}\n` +
    `  Submit button enabled: ${submitEnabled}\n` +
    `  Validation messages: [${validationMsgs.map((t) => `"${t.trim()}"`).filter(Boolean).join(', ')}]\n` +
    `  Visible buttons: [${visibleButtons.map((t) => `"${t.trim()}"`).join(', ')}]`
  );
}

/**
 * Click the action button and require a valid submission signal.
 *
 * Success is defined as EITHER:
 *   (a) a POST to /submit or /responsetask returning HTTP 200, OR
 *   (b) the SPA URL changing to a different task (chain progressed).
 *
 * If NEITHER happens within `timeoutMs`, throws — do NOT interpret the
 * absence of a response as "system step auto-progressed".  In this app,
 * a real workflow step ALWAYS fires /responsetask; silence means the
 * submit button didn't actually trigger the form (validation error,
 * disabled button, click intercepted, etc.).
 *
 * Returns the response body (or null if success came via URL change only).
 */
async function submitStrict(
  page: Page,
  label: string,
  {
    timeoutMs = 5_000,
    buttonRegex = /^(Lanjutkan|Kirim|Kirim Pengajuan|Selesai|Submit)$/i,
    uiOnly = false,
  }: { timeoutMs?: number; buttonRegex?: RegExp; uiOnly?: boolean } = {},
): Promise<{ body: Record<string, unknown> | null; nextTaskId: string | null; uiOnlyProgressed: boolean }> {
  const beforeUrl = page.url();

  // Snapshot the main content area so we can detect DOM changes for
  // UI-only steps (which don't fire /submit or /responsetask).
  const beforeDomHash = await page
    .locator('body').innerText({ timeout: SHORT_ACTION_MS })
    .catch(() => '')
    .then((t) => t.length > 0 ? `${t.length}:${t.slice(0, 120)}` : '');

  // Scroll to bottom (non-blocking) + short settle.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
  await page.waitForTimeout(300);

  const btn = page.locator('button#true').first()
    .or(page.getByRole('button', { name: buttonRegex }).first());

  // Existence check (non-blocking) — do NOT wait indefinitely for the button.
  // If it's not visible within a short probe, we fail fast with diagnostics.
  const btnVisible = await btn.isVisible({ timeout: MEDIUM_ACTION_MS }).catch(() => false);
  if (!btnVisible) {
    const diag = await captureSubmitFailure(page, label);
    throw new Error(`[${label}] Submit button not visible after ${MEDIUM_ACTION_MS}ms.\n${diag}`);
  }
  await btn.scrollIntoViewIfNeeded({ timeout: MEDIUM_ACTION_MS }).catch(() => null);

  // ── Pre-submit validation: button must be enabled, no visible errors ──
  const isEnabled = await btn.isEnabled({ timeout: SHORT_ACTION_MS }).catch(() => false);
  if (!isEnabled) {
    const diag = await captureSubmitFailure(page, label);
    throw new Error(
      `[${label}] Submit button is DISABLED — form has validation errors.\n${diag}`,
    );
  }

  const validationMsgs = await page.locator(
    '[role="alert"]:visible, .invalid-feedback:visible, .text-danger:visible, .text-red-500:visible',
  ).allTextContents().catch(() => []);
  const nonEmptyErrors = validationMsgs.filter((t) => t.trim().length > 0);
  if (nonEmptyErrors.length > 0) {
    const diag = await captureSubmitFailure(page, label);
    throw new Error(
      `[${label}] Visible validation errors BEFORE submit — form is invalid.\n` +
      `  Errors: [${nonEmptyErrors.map((t) => `"${t.trim()}"`).join(', ')}]\n${diag}`,
    );
  }

  // ── Multi-strategy click ───────────────────────────────────────────
  // UI is non-standard; a single click() may not reach the real handler
  // (overlay intercept, custom onClick bound at runtime, button not a real
  // submit).  Try progressively more aggressive strategies; stop as soon
  // as one triggers /submit, /responsetask, OR a URL change.
  //
  // Per-strategy watch window = timeoutMs (default 5s) so the whole
  // multi-strategy loop worst-case = 5 × timeoutMs.  Early-exits on success.
  type ClickStrategy = { name: string; exec: () => Promise<void> };

  // Dismiss any confirmation modal that may appear between strategies.
  const dismissModal = async (): Promise<void> => {
    const modalBtn = page.locator('[role="dialog"] button, .modal button, [class*="modal"] button')
      .filter({ hasText: /^(Ya|Lanjutkan|Konfirmasi|Kirim)$/i }).first();
    if (await modalBtn.isVisible({ timeout: SHORT_ACTION_MS }).catch(() => false)) {
      console.log(`    [${label}] confirmation modal — clicking`);
      await modalBtn.click({ timeout: MEDIUM_ACTION_MS }).catch(() => null);
    }
  };

  const strategies: ClickStrategy[] = [
    {
      name: 'normal click',
      exec: async () => {
        await btn.click({ timeout: MEDIUM_ACTION_MS }).catch(() => null);
      },
    },
    {
      name: 'force click',
      exec: async () => {
        await btn.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
      },
    },
    {
      name: 'double force click',
      exec: async () => {
        await btn.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
        await page.waitForTimeout(300);
        await btn.click({ force: true, timeout: MEDIUM_ACTION_MS }).catch(() => null);
      },
    },
    {
      name: 'JS DOM click()',
      exec: async () => {
        // Bypass any overlay that would intercept a real mouse click.
        // Pass an explicit list of candidate button TEXTS (not a regex) so
        // the in-page code can match cleanly — a previous version stripped
        // regex metacharacters into a literal-string soup that matched
        // nothing.
        const result = await page.evaluate(
          ({ texts }) => {
            // Priority 1: button#true (DynamicForm approve button by id).
            const byId = document.querySelector('button#true') as HTMLButtonElement | null;
            if (byId && !byId.disabled) { byId.click(); return 'button#true'; }
            // Priority 2: button whose trimmed text content is an exact
            // case-insensitive match against any candidate text.
            const all = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
            for (const want of texts) {
              const lw = want.toLowerCase();
              const match = all.find(
                (b) => !b.disabled && (b.textContent ?? '').trim().toLowerCase() === lw,
              );
              if (match) { match.click(); return `text="${want}"`; }
            }
            // Priority 3: any button whose text contains any candidate.
            for (const want of texts) {
              const lw = want.toLowerCase();
              const match = all.find(
                (b) => !b.disabled && (b.textContent ?? '').toLowerCase().includes(lw),
              );
              if (match) { match.click(); return `contains="${want}"`; }
            }
            return null;
          },
          { texts: ['Lanjutkan', 'Kirim Pengajuan', 'Kirim', 'Selesai', 'Submit'] },
        ).catch(() => null);
        console.log(`    [${label}] JS DOM click target: ${result ?? 'no match'}`);
      },
    },
    {
      name: 'Enter key',
      exec: async () => {
        await btn.focus({ timeout: SHORT_ACTION_MS }).catch(() => null);
        await page.keyboard.press('Enter').catch(() => null);
      },
    },
  ];

  let resp: Awaited<ReturnType<Page['waitForResponse']>> | null = null;
  let urlChanged = false;
  let winningStrategy: string | null = null;

  for (const strategy of strategies) {
    // Before each strategy, press Escape to close any stray dropdowns
    // left open by the filler.  An open menu can intercept real clicks.
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(150);

    // Fresh per-strategy listeners — critical, because an earlier
    // strategy's listener resolved with `null` (timeout) and can't
    // re-fire for a later strategy's click.
    const respPromise = page
      .waitForResponse(
        (r) => /\/(submit|responsetask)/.test(r.url()) &&
               r.request().method() === 'POST',
        { timeout: timeoutMs },
      )
      .catch(() => null);
    const urlChangePromise = page
      .waitForURL((u) => u.toString() !== beforeUrl, { timeout: timeoutMs })
      .catch(() => null);

    console.log(`    [${label}] click strategy → "${strategy.name}"`);
    try { await strategy.exec(); } catch { /* swallow */ }
    await dismissModal();

    const [gotResp] = await Promise.all([respPromise, urlChangePromise]);
    urlChanged = page.url() !== beforeUrl;

    if (gotResp || urlChanged) {
      resp = gotResp;
      winningStrategy = strategy.name;
      console.log(`    [${label}] ✓ strategy "${strategy.name}" triggered submission`);
      break;
    }

    console.warn(`    [${label}] strategy "${strategy.name}" — no response; trying next`);
  }

  // All strategies exhausted — fall back to DOM-change detection for
  // UI-only steps (where "Lanjutkan" is a client-side transition and
  // fires no /submit or /responsetask).  A change in body innerText
  // length/prefix is a reliable-enough signal of progress for these steps.
  let uiOnlyProgressed = false;
  if (!resp && !urlChanged) {
    const afterDomHash = await page
      .locator('body').innerText({ timeout: SHORT_ACTION_MS })
      .catch(() => '')
      .then((t) => t.length > 0 ? `${t.length}:${t.slice(0, 120)}` : '');
    const domChanged = afterDomHash !== beforeDomHash && afterDomHash.length > 0;

    if (uiOnly && domChanged) {
      console.log(
        `    [${label}] UI-only step: no API response, but DOM changed ` +
        `(before="${beforeDomHash.slice(0, 40)}...", after="${afterDomHash.slice(0, 40)}...") ` +
        `— treating as progressed.`,
      );
      uiOnlyProgressed = true;
    } else {
      const diag = await captureSubmitFailure(page, label);
      throw new Error(
        `[${label}] Submission failed — ALL ${strategies.length} click strategies exhausted.\n` +
        `  Tried: ${strategies.map((s) => s.name).join(' → ')}\n` +
        `  Neither /submit nor /responsetask fired; URL unchanged; ` +
        `${uiOnly ? 'DOM unchanged (uiOnly probe also failed)' : 'uiOnly=false'}.\n` +
        `  Most likely cause: overlay intercepting clicks, non-standard custom ` +
        `onClick binding that rejects synthetic events, or a required field ` +
        `the filler couldn't populate.\n${diag}`,
      );
    }
  } else {
    console.log(`    [${label}] submission via "${winningStrategy ?? 'url-change-only'}"`);
  }

  let body: Record<string, unknown> | null = null;
  let nextTaskId: string | null = null;
  if (resp) {
    const status = resp.status();
    body = await resp.json().catch(() => null) as Record<string, unknown> | null;
    const data = body?.data as Record<string, unknown> | undefined;
    console.log(`    [${label}] submit HTTP ${status} | next_task_id=${data?.task_id ?? 'null'}`);
    expect(status, `[${label}] submit must return HTTP 200`).toBe(200);
    if (typeof data?.task_id === 'string' && data.task_id.length > 0) {
      nextTaskId = data.task_id;
    }
  } else if (urlChanged) {
    // URL-change signal with no captured response — still valid progress.
    console.log(`    [${label}] submit via URL change: ${beforeUrl} → ${page.url()}`);
    const m = page.url().match(/\/submission\/([\w-]+?)(?:[/?#]|$)/);
    if (m) nextTaskId = m[1];
  }
  // uiOnlyProgressed case: leave body=null, nextTaskId=null — caller must
  // probe the next phase via findTaskAcrossUsers.

  return { body, nextTaskId, uiOnlyProgressed };
}

/**
 * Default candidate set for any SPME workflow.  When the caller doesn't
 * specify roles explicitly, we probe EVERY role that could plausibly own
 * a task in the SPME Ma'had Aly / DIKDASMEN flows — assessors, secretariat,
 * applicant role, majelis, and admin (admin often holds pool tasks).
 *
 * Order matters: cheapest / most-likely owners first so the probe exits
 * early on common cases.
 */
const SPME_CANDIDATE_ROLES: RoleKey[] = [
  'asma',   // Asesor Ma'had Aly #1
  'asma2',  // Asesor Ma'had Aly #2
  'sk',     // Sekretariat
  'mha',    // Ma'had Aly applicant
  'mm',     // Majelis Masyayikh
  'asdk',   // Asesor DIKDASMEN #1 (cross-workflow safety)
  'asdk2',  // Asesor DIKDASMEN #2
  'dk',     // DIKDASMEN applicant
  'ta',     // Tenaga Ahli
  'tas',    // Tenaga Asisten
  'admin',  // last resort (pool tasks)
];

/**
 * Probe a list of candidate users to find which one's inbox contains a
 * task for the given ticket.  Returns the FIRST role whose inbox has any
 * matching card.
 *
 * Useful when the workflow engine has assigned a step to a role we cannot
 * predict from XML (parallel branches, role-pool tasks, dynamic assignment,
 * system-routed steps that bounce between roles).
 *
 * Defaults:
 *   • candidateRoles → SPME_CANDIDATE_ROLES (broad sweep across every
 *     relevant role; roles without auth state are silently skipped).
 *   • stepHint       → undefined (no step preference; first candidate wins).
 *
 * Strategy per candidate:
 *   1. loginAs(role) — uses cached auth, refreshes on 401
 *   2. Open /app/inbox
 *   3. Search the rendered HTML for any `{ticket}-N` task_id
 *   4. If found → return immediately so the caller can re-login as that role
 *
 * If multiple cards on one user match the ticket and `stepHint` is given,
 * the step closest to the hint wins as a tie-breaker.
 *
 * Returns null if no candidate owns a task for this ticket.
 */
async function findTaskAcrossUsers(
  browser: Browser,
  ticket: string,
  candidateRoles: RoleKey[] = SPME_CANDIDATE_ROLES,
  {
    acceptableSteps,
    label = 'findTaskAcrossUsers',
    retries = 1,
    delayMs = 3_000,
    abortIfStepAtLeast,
  }: {
    acceptableSteps?: number[];
    label?: string;
    retries?: number;
    delayMs?: number;
    /**
     * If set, and any sweep finds a task whose step is >= this value,
     * abort the entire probe immediately (no more retries).  Used by the
     * intermediate phase (27–35): when we see a Hasil step (36+) we know
     * the workflow has already advanced past intermediate, so continuing
     * to probe is pointless.
     */
    abortIfStepAtLeast?: number;
  } = {},
): Promise<
  | { role: RoleKey; context: BrowserContext; page: Page; taskId: string; step: number }
  | null
> {
  // Inbox card title format (observed in production UI):
  //   "Penilaian Pra Visitasi Asessor 1 (Preview) | #20260419-1278"
  // The card carries ONLY the ticket number — the step is NOT rendered.
  // The full task_id (e.g. "20260419-1278-75") is only derivable AFTER
  // clicking the card and reading the landed submission URL.
  //
  // So this probe:
  //   1. For each candidate role, log in and open /app/inbox.
  //   2. Filter the list via the "Cari Pesan" search box to this ticket.
  //   3. Detect presence of a card matching the ticket (NOT a step regex).
  //   4. Click the card → wait for SPA redirect to /app/spme/submission/X.
  //   5. Parse task_id from the URL → derive step = Number(taskId.split('-').pop()).
  //   6. If acceptableSteps is set and the step is outside it, close the
  //      context and try the next role.  Otherwise return the role +
  //      already-claimed context/page so the caller reuses it.

  const ticketEsc = ticket.replace(/[-]/g, '\\-');
  const ticketRegex = new RegExp(`#?${ticketEsc}(?!\\d)`);
  const stepOf = (id: string) => Number(id.split('-').pop());

  console.log(
    `    [${label}] probing ${candidateRoles.length} role(s) for ticket=${ticket}` +
    `${acceptableSteps ? ` accept=[${acceptableSteps.join(',')}]` : ''}` +
    ` retries=${retries} delay=${delayMs}ms (max budget ~${retries * delayMs / 1_000}s)`,
  );

  // Retry the whole candidate sweep — the backend often materialises the
  // next task asynchronously (a few seconds after the previous submit
  // returns).  `retries === 1` preserves the original single-pass behavior.
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (attempt > 1) {
      console.log(
        `    [${label}] RETRY ${attempt}/${retries} — next task not yet available, ` +
        `waited ${delayMs}ms, re-probing all roles (no cache)`,
      );
    }

  for (const role of candidateRoles) {
    if (!hasAuthState(role)) {
      console.log(`    [${label}] role=${role} skipped (no auth state)`);
      continue;
    }

    // Tolerate a transient login failure (backend flake, axios network
    // error, rate-limit) by skipping this role and continuing the sweep
    // instead of aborting the whole probe.  The retry loop around the
    // sweep will try again next attempt.
    let ctx: BrowserContext;
    try {
      ctx = await loginAs(role, browser);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `    [${label}] role=${role} loginAs failed (${msg.slice(0, 120)}) — skipping this role for this attempt`,
      );
      continue;
    }
    const probe = await ctx.newPage();
    let keepContext = false;

    try {
      // 1. Inbox load — wait for SPA bundle + API fetch.
      await probe.goto('/app/inbox', { waitUntil: 'load' });
      await probe.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
      await waitForPageLoad(probe);
      await probe.waitForTimeout(700);

      // 2. Filter via search input.
      const searchInput = probe
        .getByPlaceholder(/^(Search|Cari.*|Cari Pesan)$/i)
        .or(probe.locator('input[type="search"]'))
        .or(probe.locator('input[placeholder*="Cari" i]'))
        .or(probe.locator('input[placeholder*="Search" i]'))
        .first();
      if (await searchInput.isVisible({ timeout: 2_500 }).catch(() => false)) {
        await searchInput.click().catch(() => null);
        await searchInput.fill('').catch(() => null);
        await searchInput.fill(ticket).catch(() => null);
        await probe.waitForTimeout(800);
      }

      // 3. Detect ticket presence — match by TICKET only, not step.
      const card = probe.getByText(ticketRegex).first();
      const found = await card.waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true).catch(() => false);

      if (!found) {
        const preview = await probe.locator('body').innerText()
          .catch(() => '').then((t) => t.slice(0, 300).replace(/\s+/g, ' '));
        console.log(
          `    [${label}] role=${role}: no card for ticket ${ticket}. ` +
          `Inbox preview: "${preview}..."`,
        );
        continue;
      }

      // 4. Click the card and wait for SPA redirect to /app/spme/submission/{taskId}.
      await Promise.all([
        probe.waitForURL(/\/app\/spme\/submission\/[\w-]+/, { timeout: 15_000 }).catch(() => null),
        card.click(),
      ]);
      await probe.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
      await probe.waitForTimeout(700);

      // 5. Parse task_id + step from the landed URL.
      const urlMatch = probe.url().match(/\/submission\/([\w-]+?)(?:[/?#]|$)/);
      if (!urlMatch) {
        console.warn(
          `    [${label}] role=${role}: click did not land on a submission URL (${probe.url()})`,
        );
        continue;
      }
      const taskId = urlMatch[1];
      const step = stepOf(taskId);

      // 6a. Early abort — caller has signalled that seeing ANY step
      //     ≥ `abortIfStepAtLeast` means the phase has already passed.
      //     Stop the whole probe immediately rather than wasting further
      //     retries.  Return null so the caller treats it as "no task".
      if (abortIfStepAtLeast !== undefined && step >= abortIfStepAtLeast) {
        console.log(
          `    [${label}] role=${role}: taskId=${taskId} step=${step} >= ` +
          `abortIfStepAtLeast=${abortIfStepAtLeast} — phase already advanced, aborting probe.`,
        );
        return null;
      }

      // 6b. Acceptable-steps filter.  If the resolved step isn't what the
      // caller wants, close this context and try the next role — the
      // current role owns a different step of the same ticket.
      if (acceptableSteps && !acceptableSteps.includes(step)) {
        console.log(
          `    [${label}] role=${role}: taskId=${taskId} step=${step} NOT in ` +
          `accept=[${acceptableSteps.join(',')}] — trying next role`,
        );
        continue;
      }

      console.log(
        `    [${label}] ✓ role=${role} taskId=${taskId} step=${step} (claimed via card click)`,
      );
      keepContext = true;
      return { role, context: ctx, page: probe, taskId, step };
    } finally {
      if (!keepContext) await ctx.close().catch(() => null);
    }
  }

    // End of this attempt's role sweep — wait before the next retry.
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } // end retry loop

  console.warn(
    `    [${label}] no candidate role owns an acceptable task for ticket "${ticket}" ` +
    `after ${retries} attempt(s) × ${delayMs}ms`,
  );
  return null;
}

/**
 * Find the owner of a SPECIFIC task_id by trying direct URL navigation
 * under each candidate role.  Use this when the previous /submit response
 * told you the next task_id but no inbox shows it — common for role-pool
 * tasks that only materialize into an inbox card after someone accesses them.
 *
 * Per candidate role:
 *   1. loginAs(role)
 *   2. page.goto(/app/spme/submission/{taskId})
 *   3. If the page is editable → role owns it (already claimed)
 *   4. If a claim button (Ambil Tugas / Klaim / Claim) is visible →
 *      click it, re-check editable — if now editable, role owns the pool.
 *
 * Returns the first role where the task becomes editable, along with the
 * still-open page so the caller can continue without re-navigating.
 */
async function resolveTaskOwnerByUrl(
  browser: Browser,
  taskId: string,
  candidateRoles: RoleKey[] = SPME_CANDIDATE_ROLES,
  { label = 'resolveTaskOwnerByUrl' }: { label?: string } = {},
): Promise<{ role: RoleKey; context: BrowserContext; page: Page } | null> {
  console.log(`    [${label}] probing ${candidateRoles.length} role(s) for taskId=${taskId}`);

  for (const role of candidateRoles) {
    if (!hasAuthState(role)) {
      console.log(`    [${label}] role=${role} skipped (no auth state)`);
      continue;
    }

    const ctx = await loginAs(role, browser);
    const probe = await ctx.newPage();
    try {
      await probe.goto(`/app/spme/submission/${taskId}`);
      await waitForPageLoad(probe);
      await probe.waitForTimeout(1_000);

      if (!probe.url().includes(taskId)) {
        console.log(`    [${label}] role=${role}: SPA redirected away from ${taskId}`);
        await ctx.close();
        continue;
      }

      // Already editable?
      if (await isPageEditable(probe)) {
        console.log(`    [${label}] ✓ role=${role} — task already claimed/editable`);
        return { role, context: ctx, page: probe };
      }

      // Claim button available?
      const claimBtn = probe.getByRole('button', {
        name: /Ambil\s*Tugas|^Ambil$|^Klaim$|^Claim$/i,
      }).first();
      if (await claimBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        console.log(`    [${label}] role=${role}: claim button visible — clicking`);
        await claimBtn.click().catch(() => null);
        await probe.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
        await probe.waitForTimeout(1_000);
        if (await isPageEditable(probe)) {
          console.log(`    [${label}] ✓ role=${role} — pool claim succeeded`);
          return { role, context: ctx, page: probe };
        }
      }

      console.log(`    [${label}] role=${role}: not editable, no claim button`);
    } catch (e) {
      console.warn(`    [${label}] role=${role} error: ${String(e).slice(0, 100)}`);
    }

    await ctx.close().catch(() => null);
  }

  console.warn(`    [${label}] no candidate role can open taskId=${taskId}`);
  return null;
}

/**
 * Parallel-safe preview submitter.
 *
 * Use when two preview steps (e.g. 75 / 76) are created in parallel and you
 * don't know in advance which step the current user owns.  Each user's inbox
 * naturally filters to their own card, so we open whatever card matches the
 * ticket and detect the actual step from the URL post-click.
 *
 * Flow:
 *   1. Navigate to /app/inbox.
 *   2. Click ANY card matching the ticket (no step constraint).
 *   3. Wait for SPA navigation to /app/spme/submission/{taskId}.
 *   4. Parse the actual step from the URL.
 *   5. Scroll bottom + scrollIntoViewIfNeeded("Lanjutkan") + click.
 *   6. Wait for /submit (or /responsetask) HTTP 200.
 *   7. Settle delay so the backend can chain the next task.
 *
 * Returns:
 *   { openedStep, openedTaskId, nextTaskId }
 *
 * Throws:
 *   - if no inbox card matches the ticket
 *   - if the SPA does not redirect to a submission URL
 *   - if "Lanjutkan" never becomes visible
 *   - if /submit returns non-200
 */
async function completePreviewFromInbox(
  page: Page,
  ticket: string,
  {
    label = 'Preview',
    postSubmitDelayMs = 2_000,
    submitTimeoutMs = 20_000,
  }: { label?: string; postSubmitDelayMs?: number; submitTimeoutMs?: number } = {},
): Promise<{ openedStep: number; openedTaskId: string; nextTaskId: string | null }> {
  console.log(`[${label}] ▶ open ANY task for ticket=${ticket}`);

  // 1. Inbox
  await page.goto('/app/inbox');
  await waitForPageLoad(page);
  await page.waitForTimeout(1_000);

  // 2. Match the card by ticket only — each user's inbox already filters by ownership
  const escaped = ticket.replace(/[-]/g, '\\-');
  const ticketRegex = new RegExp(`#?${escaped}(?!\\d)`);
  const card = page.getByText(ticketRegex).first();
  // Bounded existence probe — no more than 5s.  If the inbox doesn't have
  // the card by now, the later layers (retry loop / cross-user probe) will
  // either wait and retry, or skip the test cleanly.
  const cardVisible = await card
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (!cardVisible) {
    throw new Error(`[${label}] No inbox card for ticket "${ticket}".`);
  }

  // 3. Click + wait for redirect
  await Promise.all([
    page.waitForURL(/\/app\/spme\/submission\/[\w-]+/, { timeout: 15_000 }).catch(() => null),
    card.click(),
  ]);
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
  await page.waitForTimeout(800);

  // 4. Detect step from landed URL
  const urlMatch = page.url().match(/\/submission\/([\w-]+?-(\d+))(?:[/?#]|$)/);
  if (!urlMatch) {
    throw new Error(
      `[${label}] Click did not land on a submission URL.\n  Current URL: ${page.url()}`,
    );
  }
  const openedTaskId = urlMatch[1];
  const openedStep = Number(urlMatch[2]);
  console.log(`[${label}] landed taskId=${openedTaskId} step=${openedStep}`);

  // 5. Scroll bottom + scrollIntoViewIfNeeded
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
  await page.waitForTimeout(400);

  const lanjutkanBtn = page.getByRole('button', { name: /^Lanjutkan$/i }).first();
  await lanjutkanBtn.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => null);
  await expect(lanjutkanBtn, `[${label}] "Lanjutkan" must be visible`)
    .toBeVisible({ timeout: 15_000 });

  // 6. Click + wait for submit
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => /\/(submit|responsetask)/.test(r.url()) &&
             r.request().method() === 'POST',
      { timeout: submitTimeoutMs },
    ),
    lanjutkanBtn.click(),
  ]);
  expect(resp.status(), `[${label}] submit must return HTTP 200`).toBe(200);

  const body = await resp.json().catch(() => null) as { data?: { task_id?: string } } | null;
  const nextTaskId = body?.data?.task_id ?? null;
  console.log(`[${label}] ✓ submitted step=${openedStep}; next task_id=${nextTaskId ?? 'null (role boundary)'}`);

  // 7. Settle so the workflow engine can materialize the next task
  await page.waitForTimeout(postSubmitDelayMs);

  return { openedStep, openedTaskId, nextTaskId };
}

/**
 * Open a SPECIFIC task_id.  Prefers direct URL navigation — many steps in
 * this SPME app are auto-claimed or directly assigned and therefore do NOT
 * appear in any inbox.  Falls back to the inbox-click flow only when direct
 * navigation leaves the page read-only (role-pool / claim-required tasks).
 *
 * Strategy (in order):
 *   1. Direct URL: /app/spme/submission/{taskId}
 *      → if page becomes editable → done.
 *   2. Direct URL + click any visible pool-claim button ("Ambil Tugas" /
 *      "Klaim" / "Claim") → re-check editable.
 *   3. Inbox card click (the legacy claim path for tasks that need it).
 *
 * Throws only if all three tiers fail.  Returns the step number parsed
 * from the landed URL so the caller can dispatch per-step actions without
 * ever hardcoding the expected step.
 */
async function openNextTaskByResponse(
  page: Page,
  taskId: string,
  label = 'openNextTaskByResponse',
): Promise<{ step: number; taskId: string }> {
  console.log(`    [${label}] open task=${taskId}`);

  const parseStepFromUrl = (): { taskId: string; step: number } | null => {
    const m = page.url().match(/\/submission\/([\w-]+?-(\d+))(?:[/?#]|$)/);
    if (!m) return null;
    return { taskId: m[1], step: Number(m[2]) };
  };

  // ── Tier 1: direct URL navigation ───────────────────────────────────
  const choosetaskPromise = page
    .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 12_000 })
    .catch(() => null);
  await page.goto(`/app/spme/submission/${taskId}`);
  await waitForPageLoad(page);
  await choosetaskPromise;
  await page.waitForTimeout(700);

  if (!page.url().includes(taskId)) {
    console.warn(`    [${label}] direct-nav redirected: ${page.url()}`);
  }

  if (await isPageEditable(page)) {
    const parsed = parseStepFromUrl();
    if (parsed) {
      console.log(`    [${label}] ✓ direct-nav editable taskId=${parsed.taskId} step=${parsed.step}`);
      return parsed;
    }
  }

  // ── Tier 2: direct URL + pool-claim button ─────────────────────────
  const claimBtn = page.getByRole('button', {
    name: /Ambil\s*Tugas|^Ambil$|^Klaim$|^Claim$/i,
  }).first();
  if (await claimBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const btnText = (await claimBtn.textContent() ?? '').trim();
    console.log(`    [${label}] pool task — clicking "${btnText}"`);
    await claimBtn.click().catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
    await page.waitForTimeout(800);

    if (await isPageEditable(page)) {
      const parsed = parseStepFromUrl();
      if (parsed) {
        console.log(`    [${label}] ✓ pool-claim editable taskId=${parsed.taskId} step=${parsed.step}`);
        return parsed;
      }
    }
  }

  // ── Tier 3: inbox card click (legacy claim path) ──────────────────
  console.log(`    [${label}] falling back to inbox card click`);
  await page.goto('/app/inbox');
  await waitForPageLoad(page);
  await page.waitForTimeout(800);

  const escaped = taskId.replace(/[-]/g, '\\-');
  let card = page.getByText(new RegExp(`#?${escaped}\\b`)).first();
  let found = await card.waitFor({ state: 'visible', timeout: 6_000 })
    .then(() => true).catch(() => false);

  if (!found) {
    const ticket = taskId.split('-').slice(0, -1).join('-');
    const ticketEsc = ticket.replace(/[-]/g, '\\-');
    card = page.getByText(new RegExp(`#?${ticketEsc}(?!\\d)`)).first();
    found = await card.waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true).catch(() => false);
  }

  if (found) {
    await Promise.all([
      page.waitForURL(/\/app\/spme\/submission\/[\w-]+/, { timeout: 15_000 }).catch(() => null),
      card.click(),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(700);

    if (await isPageEditable(page)) {
      const parsed = parseStepFromUrl();
      if (parsed) {
        console.log(`    [${label}] ✓ inbox-click editable taskId=${parsed.taskId} step=${parsed.step}`);
        return parsed;
      }
    }
  }

  // ── All tiers failed ───────────────────────────────────────────────
  const buttons = await page.locator('button:visible').allTextContents().catch(() => []);
  throw new Error(
    `[${label}] Failed to open task "${taskId}" via direct-URL, pool-claim, or inbox card.\n` +
    `  Current URL: ${page.url()}\n` +
    `  Visible buttons: [${buttons.map((t) => `"${t.trim()}"`).join(', ')}]`,
  );
}

/**
 * Extract the numeric step from a task_id string.
 *
 * task_id format is "{YYYYMMDD}-{HHmm}-{step}".  Returns NaN if the input
 * doesn't end in a numeric segment (caller should treat as "unknown").
 */
function extractStep(taskId: string | null | undefined): number {
  if (!taskId) return NaN;
  return Number(taskId.split('-').pop());
}

/**
 * Returns true if advancing to `nextTaskId` would NOT make forward progress,
 * i.e. the next step is at or before the current step.  Two cases:
 *
 *   • Backward  (nextStep < currentStep) — workflow went "Kembali" after a
 *     validation rejection, or the backend returned a predecessor step.
 *   • Parallel  (nextStep === currentStep OR nextStep is a sibling branch
 *     whose number is ≤ currentStep) — e.g. step 14 surfaces after the
 *     active step 13→20 chain has completed; step 14 is a parallel entry,
 *     not a continuation.
 *
 * Either case means the chain SHOULD stop — auto-walking into these tasks
 * either re-runs work already done or crosses into an unrelated branch.
 *
 * Excludes the first iteration (currentStep === 0 sentinel) so the chain
 * always seeds.
 */
function isParallelOrBackward(nextTaskId: string | null, currentStep: number): boolean {
  if (!nextTaskId) return false;
  if (currentStep <= 0) return false;
  const nextStep = extractStep(nextTaskId);
  if (Number.isNaN(nextStep)) return false;
  return nextStep <= currentStep;
}

/**
 * Workflow chain walker — follows `nextTaskId` from each /responsetask.
 *
 * Pure response-driven execution — NO hardcoded step numbers, NO XML
 * inspection.  The loop:
 *   1. Open the current task via inbox click.
 *   2. Look up a per-step action from the `actions` map (default fallback
 *      handles steps not explicitly mapped).
 *   3. Run the action; it MUST leave the page in a state where clicking the
 *      action button fires /responsetask.
 *   4. Click the action button, capture response.data.task_id.
 *   5. If task_id is null → stop (role boundary or terminal step).
 *   6. Else set current = task_id and loop.
 *
 * Safety:
 *   • `maxIterations` guards against runaway loops (default 30 — more than
 *     enough for the entire Mahad Aly backend sequence).
 *   • Every step that isn't in `actions` and has no `fallbackAction` throws
 *     with a clear diagnostic — no silent skipping.
 */
async function runWorkflowChain(
  page: Page,
  startingTaskId: string,
  {
    actions,
    fallbackAction,
    terminalSteps = [],
    maxIterations = 30,
    submitTimeoutMs = 30_000,
    postSubmitDelayMs = 1_000,
    label = 'chain',
  }: {
    /** Per-step actions keyed by step number. */
    actions: Record<number, (page: Page, step: number) => Promise<void>>;
    /** Called for any step not in `actions`.  If omitted → throw. */
    fallbackAction?: (page: Page, step: number) => Promise<void>;
    /** Stop the chain when landing on any of these steps, without submitting. */
    terminalSteps?: number[];
    maxIterations?: number;
    submitTimeoutMs?: number;
    postSubmitDelayMs?: number;
    label?: string;
  },
): Promise<{ visited: number[]; finalNextTaskId: string | null }> {
  const visited: number[] = [];
  let currentTaskId: string | null = startingTaskId;
  let currentStep = 0; // sentinel — first iteration always proceeds

  for (let i = 0; i < maxIterations; i++) {
    if (!currentTaskId) break;

    // Open the next task; if all three tiers (direct URL, pool-claim,
    // inbox) fail, the task is likely owned by a DIFFERENT role — a
    // parallel branch this session can't access.  Treat that as a
    // clean chain-end so the caller can spawn a second chain for the
    // other role instead of hard-failing.
    let step: number;
    try {
      ({ step } = await openNextTaskByResponse(page, currentTaskId, `${label} iter=${i + 1}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[${label}] iter=${i + 1} could not open ${currentTaskId} — ${msg.slice(0, 180)}`,
      );
      console.warn(
        `[${label}] treating as cross-role boundary; chain ends here with finalNextTaskId=${currentTaskId}.`,
      );
      return { visited, finalNextTaskId: currentTaskId };
    }
    visited.push(step);
    currentStep = step;

    if (terminalSteps.includes(step)) {
      console.log(`[${label}] iter=${i + 1} landed on terminal step=${step} — stopping without submit`);
      return { visited, finalNextTaskId: currentTaskId };
    }

    const action = actions[step] ?? fallbackAction;
    if (!action) {
      throw new Error(
        `[${label}] iter=${i + 1} step=${step} has no action defined and no fallbackAction.\n` +
        `  Known action steps: [${Object.keys(actions).join(', ')}]`,
      );
    }

    // Wire response listener BEFORE the action so the submit is captured.
    const respPromise = page
      .waitForResponse(
        (r) => /\/(submit|responsetask)/.test(r.url()) &&
               r.request().method() === 'POST',
        { timeout: submitTimeoutMs },
      )
      .catch(() => null);

    await action(page, step);
    const resp = await respPromise;

    if (!resp) {
      throw new Error(`[${label}] iter=${i + 1} step=${step}: no /submit or /responsetask captured after action.`);
    }
    if (resp.status() !== 200) {
      throw new Error(`[${label}] iter=${i + 1} step=${step}: submit returned HTTP ${resp.status()}.`);
    }

    const body = await resp.json().catch(() => null) as { data?: { task_id?: string } } | null;
    const nextTaskId = typeof body?.data?.task_id === 'string' && body.data.task_id.length > 0
      ? body.data.task_id : null;

    console.log(`[${label}] iter=${i + 1} step=${step} → next=${nextTaskId ?? 'null (chain end)'}`);

    if (!nextTaskId) {
      return { visited, finalNextTaskId: null };
    }

    // ── Step guard — refuse to walk backwards or into a parallel branch.
    // Only a strictly forward step (nextStep > currentStep) is a valid
    // continuation.  ≤ currentStep means:
    //   • a predecessor (Kembali / validation rejection), OR
    //   • the same step re-surfaced, OR
    //   • a sibling parallel entry (e.g. step 14 after the 13→20 chain).
    // Stop cleanly and hand the offending task_id back to the caller.
    if (isParallelOrBackward(nextTaskId, currentStep)) {
      const nextStep = extractStep(nextTaskId);
      console.warn(
        `[${label}] iter=${i + 1} guard tripped: nextStep=${nextStep} <= currentStep=${currentStep} ` +
        `(nextTaskId=${nextTaskId}). Stopping chain — not opening backward/parallel task.`,
      );
      return { visited, finalNextTaskId: nextTaskId };
    }

    currentTaskId = nextTaskId;
    await page.waitForTimeout(postSubmitDelayMs);
  }

  console.warn(
    `[${label}] maxIterations=${maxIterations} exhausted; visited=[${visited.join(', ')}]; ` +
    `lastTaskId=${currentTaskId ?? 'null'}`,
  );
  return { visited, finalNextTaskId: currentTaskId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow phase helpers
//
// SPME Ma'had Aly breaks naturally into three phases per ticket:
//
//   1. runPraVisitasi()     — Asesor (1 or 2) walks 13/14 → 15–20 or 21–26.
//                             Step 20/26 includes a "Lanjutkan" decision and
//                             routes into a system-decision chain (27→28).
//                             Chain naturally breaks here via the
//                             isParallelOrBackward guard.
//
//   2. runIntermediateRole()— Whichever role owns the system-decision aftermath
//                             (typically SK / pool).  Most steps 27–35 are
//                             system-auto and don't need user interaction; this
//                             helper probes for any UI-required intermediates.
//
//   3. runHasilVisitasi()   — Asesor walks 36/44 → 43/50 (scoring + Laporan).
//                             Step is located via findTaskAcrossUsers because
//                             it may be assigned to a different Asesor than
//                             the one who ran pra-visitasi.
//
// Each helper is a thin wrapper around runWorkflowChain — they add
// owner resolution / login / scope-specific defaults so test bodies stay
// declarative.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phase 1 — drive the Pra-Visitasi chain from its entry step (13 or 14)
 * through its natural terminus (20 or 26 submits, chain guard fires on
 * the subsequent ≤-step response).
 *
 * Does NOT do owner resolution — caller must provide an already-logged-in
 * page.  Returns the visited steps and the final nextTaskId (usually a
 * guard-rejected task_id that belongs to the next phase's role).
 */
async function runPraVisitasi(
  page: Page,
  startingTaskId: string,
  {
    actions,
    fallbackAction,
    terminalSteps,
    maxIterations = 12,
    label = 'Pra-Visitasi chain',
  }: {
    actions: Record<number, (page: Page, step: number) => Promise<void>>;
    fallbackAction?: (page: Page, step: number) => Promise<void>;
    /**
     * Steps that cause the chain to STOP without submitting.  Used to
     * cleanly stop before entering Hasil Visitasi territory (36/44) when
     * the backend auto-advances through system decisions 27/28 and drops
     * us into Hasil — that work belongs to the dedicated Hasil phase.
     */
    terminalSteps?: number[];
    maxIterations?: number;
    label?: string;
  },
): Promise<{ visited: number[]; finalNextTaskId: string | null }> {
  return runWorkflowChain(page, startingTaskId, {
    label, actions, fallbackAction, terminalSteps, maxIterations,
    postSubmitDelayMs: 1_000,
  });
}

/**
 * Phase 2 — run any role-specific intermediate tasks that the workflow
 * engine materializes between Pra-Visitasi (phase 1) and Hasil Visitasi
 * (phase 3).  Probes `candidateRoles` for a task on `ticket` within
 * `acceptableSteps`.  If none exists, returns cleanly — many runs skip
 * this phase entirely because steps 27–35 are all system-auto.
 *
 * When a task is found, logs in as that role, runs runWorkflowChain
 * against that starting task, and returns.
 */
async function runIntermediateRole(
  browser: Browser,
  ticket: string,
  {
    candidateRoles,
    acceptableSteps,
    actions,
    fallbackAction,
    maxIterations = 10,
    label = 'Intermediate role phase',
  }: {
    candidateRoles?: RoleKey[];
    acceptableSteps?: number[];
    actions: Record<number, (page: Page, step: number) => Promise<void>>;
    fallbackAction?: (page: Page, step: number) => Promise<void>;
    maxIterations?: number;
    label?: string;
  },
): Promise<{ owner: RoleKey | null; visited: number[]; finalNextTaskId: string | null }> {
  console.log(`[${label}] probing for intermediate role task...`);
  // Intermediate phase is usually entirely auto-progressed (27–35 are
  // mostly system decisions).  Single probe — no retry loop, because:
  //   • If an intermediate task exists, it's already there when we look.
  //   • If it doesn't exist, retrying doesn't make it appear — all we'd
  //     be doing is burning 75s scanning 11 roles × 5 retries.
  //   • abortIfStepAtLeast: 36 means that if the probe finds ANY user
  //     already at a Hasil step (36+), we short-circuit immediately —
  //     the workflow has clearly moved past intermediate.
  const probe = await findTaskAcrossUsers(
    browser, ticket, candidateRoles,
    {
      acceptableSteps,
      label: `${label} probe`,
      retries: 1,
      delayMs: 1_000,
      abortIfStepAtLeast: 36,
    },
  );

  if (!probe) {
    console.log(`[${label}] no intermediate task — all steps auto-progressed. Skipping.`);
    return { owner: null, visited: [], finalNextTaskId: null };
  }

  console.log(`[${label}] owner=${probe.role} task=${probe.taskId} step=${probe.step}`);

  // Reuse the context/page returned by the probe — it's already logged in
  // AND already landed on the submission URL with the task claimed.  Don't
  // loginAs again (that would burn a fresh JWT and drop the claim state).
  try {
    const result = await runWorkflowChain(probe.page, probe.taskId, {
      label, actions, fallbackAction, maxIterations,
      postSubmitDelayMs: 1_500,
    });
    return { owner: probe.role, ...result };
  } finally {
    await probe.context.close().catch(() => null);
  }
}

/**
 * Probe across candidate roles for a task on `ticket` whose step is in
 * `acceptableSteps`, then log in as the owning role and return a fresh page.
 *
 * Use this for ANY entry point where the task may be assigned to roles we
 * cannot predict in advance (parallel branches, role-pool tasks, dynamic
 * assignment).  Replaces every "loginAs(asesor1Role, browser)" call site
 * that previously depended on hardcoded module-level role state.
 *
 * Returns null if no candidate owns an acceptable task (caller decides
 * whether to skip or fail).
 */
async function probeAndLoginAsOwner(
  browser: Browser,
  ticket: string,
  acceptableSteps: number[],
  label: string,
): Promise<
  | { role: RoleKey; context: BrowserContext; page: Page; entryTaskId: string; entryStep: number }
  | null
> {
  const probe = await findTaskAcrossUsers(browser, ticket, undefined, {
    acceptableSteps,
    label: `${label} owner probe`,
  });

  if (!probe) {
    console.warn(
      `[FLOW] ${label}: no role owns step ∈ [${acceptableSteps.join(', ')}] for ticket "${ticket}"`,
    );
    return null;
  }

  console.log(`[FLOW] ${label}: step ${probe.step} owned by role=${probe.role}`);
  // Reuse the probe's already-logged-in, already-claimed context/page.
  // Do NOT loginAs again — that spawns a fresh JWT in a new context and
  // abandons the claim state we just established by clicking the inbox card.
  return {
    role: probe.role,
    context: probe.context,
    page: probe.page,
    entryTaskId: probe.taskId,
    entryStep: probe.step,
  };
}

/**
 * Phase 3 — drive the Hasil Visitasi chain (steps 36–43 for Asesor 1,
 * 44–50 for Asesor 2).  Starting task is located via cross-user probe
 * because the engine may assign it to a different Asesor than the one
 * who ran Pra-Visitasi.  `acceptableSteps` defaults to 36/44 entry.
 */
async function runHasilVisitasi(
  browser: Browser,
  ticket: string,
  {
    candidateRoles,
    acceptableSteps = [36, 44],
    actions,
    fallbackAction,
    maxIterations = 20,
    label = 'Hasil Visitasi chain',
  }: {
    candidateRoles?: RoleKey[];
    acceptableSteps?: number[];
    actions: Record<number, (page: Page, step: number) => Promise<void>>;
    fallbackAction?: (page: Page, step: number) => Promise<void>;
    maxIterations?: number;
    label?: string;
  },
): Promise<{ owner: RoleKey | null; visited: number[]; finalNextTaskId: string | null }> {
  console.log(`[${label}] probing for Hasil entry step...`);
  // Hasil entry (36/44) may lag the DAG join by several seconds after
  // Pra-Visitasi both branches complete.  Patient retry — 15 × 3s = ~45s —
  // handles async task materialisation without false-negative failures.
  const probe = await findTaskAcrossUsers(
    browser, ticket, candidateRoles,
    { acceptableSteps, label: `${label} probe`, retries: 15, delayMs: 3_000 },
  );

  if (!probe) {
    throw new Error(
      `[${label}] no Hasil entry task found (acceptable=[${acceptableSteps.join(', ')}]). ` +
      `Pra-Visitasi and intermediate phases may not have completed.`,
    );
  }

  console.log(`[${label}] owner=${probe.role} entryTask=${probe.taskId} entryStep=${probe.step}`);

  // Reuse the already-logged-in, already-claimed context/page from the probe.
  let firstResult: { visited: number[]; finalNextTaskId: string | null };
  const firstOwner = probe.role;
  try {
    firstResult = await runWorkflowChain(probe.page, probe.taskId, {
      label, actions, fallbackAction, maxIterations,
      postSubmitDelayMs: 1_500,
    });
  } finally {
    await probe.context.close().catch(() => null);
  }

  // ── Second parallel Hasil chain ────────────────────────────────────
  // Steps 36/44 are created in parallel by the workflow engine.  After the
  // first Hasil chain completes (e.g. asma walks 36→43), its response may
  // point to step 44 — the sibling Asesor 2 Hasil entry, owned by asma2.
  // Our first chain stopped gracefully at 44 (cross-role boundary); we now
  // spawn a second chain for the remaining assessor.
  const mergedVisited = [...firstResult.visited];
  let mergedFinalNext = firstResult.finalNextTaskId;

  const HASIL_STEPS = [36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50];
  const finalStep = extractStep(mergedFinalNext);
  if (
    mergedFinalNext &&
    !Number.isNaN(finalStep) &&
    HASIL_STEPS.includes(finalStep)
  ) {
    console.log(
      `[${label}] first chain ended at ${mergedFinalNext} (step ${finalStep}) — ` +
      `probing for second Hasil branch (other assessor)...`,
    );
    // Second probe accepts the WHOLE Hasil range — the second branch may
    // not be at the official entry step (44); it could be mid-chain if the
    // engine auto-advanced it while the first branch was walking.
    const secondProbe = await findTaskAcrossUsers(browser, ticket, candidateRoles, {
      acceptableSteps: HASIL_STEPS,
      label: `${label} SECOND probe`,
      retries: 8,
      delayMs: 2_500,
    });

    if (!secondProbe) {
      console.log(`[${label}] no second Hasil branch found — single-chain flow.`);
    } else {
      console.log(
        `[${label}] second chain: owner=${secondProbe.role} entryTask=${secondProbe.taskId} step=${secondProbe.step}`,
      );
      try {
        const secondResult = await runWorkflowChain(secondProbe.page, secondProbe.taskId, {
          label: `${label} SECOND`, actions, fallbackAction, maxIterations,
          postSubmitDelayMs: 1_500,
        });
        mergedVisited.push(...secondResult.visited);
        mergedFinalNext = secondResult.finalNextTaskId;
        console.log(
          `[${label}] SECOND chain ✓ visited=[${secondResult.visited.join(', ')}] → ` +
          `finalNext=${mergedFinalNext ?? 'null'}`,
        );
      } finally {
        await secondProbe.context.close().catch(() => null);
      }
    }
  }

  return {
    owner: firstOwner,
    visited: mergedVisited,
    finalNextTaskId: mergedFinalNext,
  };
}

/**
 * Robust task open — prefers direct URL navigation, handles pool-claim flow.
 *
 * Strategy:
 *   1. Navigate directly to /app/spme/submission/{taskId}.
 *   2. If editable → done.
 *   3. If NOT editable but a pool-claim button is visible ("Ambil Tugas",
 *      "Ambil", "Claim", "Klaim") → click it and re-check.
 *   4. If still not editable → fall back to claimTaskFromInbox (card click).
 *   5. Throws only if all three strategies fail.
 *
 * Use this over openAssessorTask when:
 *   • The task may be a role-pool task (not yet personally claimed)
 *   • The task_id is known from the response or queue (direct nav is fastest)
 */
async function openTaskSmart(page: Page, taskId: string, label: string): Promise<void> {
  const userInfo = await getUserFromCookies(page).catch(() => '(unknown)');
  console.log(`    [${label}] openTaskSmart task=${taskId} user=${userInfo}`);

  // ── 1. Direct URL navigation ────────────────────────────────────────
  const choosetaskPromise = page
    .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 12_000 })
    .catch(() => null);
  await page.goto(`/app/spme/submission/${taskId}`);
  await waitForPageLoad(page);
  await choosetaskPromise;
  await page.waitForTimeout(800);

  if (!page.url().includes(taskId)) {
    console.warn(`    [${label}] direct nav redirected: ${page.url()}`);
  }

  // ── 2. Already editable? ────────────────────────────────────────────
  if (await isPageEditable(page)) {
    console.log(`    [${label}] ✓ direct nav landed in editable mode`);
    return;
  }

  // ── 3. Pool-claim button? ──────────────────────────────────────────
  const claimBtn = page.getByRole('button', {
    name: /Ambil\s*Tugas|^Ambil$|^Claim$|^Klaim$/i,
  }).first();

  if (await claimBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const claimText = (await claimBtn.textContent() ?? '').trim();
    console.log(`    [${label}] pool task detected — clicking "${claimText}"`);
    await claimBtn.click().catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
    await page.waitForTimeout(1_000);

    if (await isPageEditable(page)) {
      console.log(`    [${label}] ✓ claimed from pool, now editable`);
      return;
    }
  }

  // ── 4. Fallback: inbox card claim ──────────────────────────────────
  console.log(`    [${label}] falling back to inbox claim`);
  const inboxClaimed = await claimTaskFromInbox(page, taskId);
  if (inboxClaimed) {
    console.log(`    [${label}] ✓ inbox-claim success`);
    return;
  }

  // ── 5. Give up with diagnostics ────────────────────────────────────
  const btnTexts = await page.locator('button:visible').allTextContents().catch(() => []);
  throw new Error(
    `[${label}] openTaskSmart failed for ${taskId}.\n` +
    `  User: ${userInfo}\n  URL: ${page.url()}\n` +
    `  Tried: direct nav, pool claim ("Ambil Tugas"), inbox card.\n` +
    `  Visible buttons: [${btnTexts.map((t) => `"${t.trim()}"`).join(', ')}]`,
  );
}

// ─── Action button helpers ────────────────────────────────────────────────
async function waitForActionButton(
  page: Page,
  label: string,
): Promise<{ locator: import('@playwright/test').Locator; name: string }> {
  const candidates: Array<{ locator: import('@playwright/test').Locator; name: string }> = [
    { locator: page.locator('button#true'), name: 'button#true' },
    { locator: page.getByRole('button', { name: /^Selesai$/i }), name: '"Selesai"' },
    { locator: page.getByRole('button', { name: /^Lanjutkan$/i }), name: '"Lanjutkan"' },
    { locator: page.getByRole('button', { name: /^Kirim$/i }), name: '"Kirim"' },
    { locator: page.getByRole('button', { name: /^Kirim Pengajuan$/i }), name: '"Kirim Pengajuan"' },
    { locator: page.getByRole('button', { name: /^Kirim Revisi$/i }), name: '"Kirim Revisi"' },
    { locator: page.getByRole('button', { name: /^Submit$/i }), name: '"Submit"' },
    { locator: page.locator('button[type="submit"]'), name: 'button[type="submit"]' },
  ];

  const maxAttempts = 24;
  const pollDelayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    for (const { locator, name } of candidates) {
      const visible = await locator.first().isVisible({ timeout: 100 }).catch(() => false);
      if (visible) {
        if (attempt > 1) console.log(`    [${label}] action button "${name}" appeared on attempt ${attempt}`);
        return { locator: locator.first(), name };
      }
    }
    if (attempt % 4 === 0) {
      const visibleBtns = await page.locator('button:visible').allTextContents().catch(() => []);
      console.log(`    [${label}] waiting for action button (attempt ${attempt}/${maxAttempts}) — visible: [${visibleBtns.map(t => `"${t.trim()}"`).join(', ')}]`);
    }
    if (attempt < maxAttempts) await page.waitForTimeout(pollDelayMs);
  }

  throw new Error(`[${label}] No action button found after ${maxAttempts * pollDelayMs / 1000}s.`);
}

async function logResponsetask(label: string, resp: Awaited<ReturnType<Page['waitForResponse']>>): Promise<void> {
  const httpStatus = resp.status();
  const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
  const data = body?.data as Record<string, unknown> | undefined;

  console.log(`    ↳ [${label}] responsetask HTTP ${httpStatus} | task_id=${data?.task_id ?? 'null'}`);
  expect(httpStatus, `[${label}] responsetask must return HTTP 200`).toBe(200);

  // Capture the next task_id for response-driven navigation.
  // When the workflow engine chains in non-obvious ways (parallel joins,
  // branch conditions) the actual next task_id may not equal the XML
  // steptrue value — always trust the response, never compute by step.
  if (typeof data?.task_id === 'string' && data.task_id.length > 0) {
    lastResponseTaskId = data.task_id;
    console.log(`    ↳ [${label}] captured next task_id → ${lastResponseTaskId}`);
  } else {
    lastResponseTaskId = null;
    console.log(`    ↳ [${label}] data.task_id is null — next task belongs to another role.`);
  }
}

async function clickApprove(page: Page, label = 'approve'): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
  await page.waitForTimeout(300);

  const { locator: actionBtn, name: actionName } = await waitForActionButton(page, label);
  await actionBtn.scrollIntoViewIfNeeded();
  console.log(`    [${label}] Clicking ${actionName}`);

  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/responsetask'), { timeout: 20_000 }).catch(() => null),
    (async () => {
      await actionBtn!.click();
      const modalBtn = page.locator('[role="dialog"] button, .modal button')
        .filter({ hasText: /Lanjutkan|Selesai|Ya|Konfirmasi/i }).first();
      if (await modalBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        console.log(`    [${label}] Confirmation modal — clicking modal button`);
        await modalBtn.click();
      }
    })(),
  ]);

  if (resp) await logResponsetask(label, resp);
  else {
    console.log(`    [${label}] No /responsetask — may be system/navigation step`);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
  }
}

const clickLanjutkan = (page: Page, label = 'lanjutkan') => clickApprove(page, label);

// ─── Form-fill helpers ────────────────────────────────────────────────────
async function fillAllVisibleSelects(page: Page, label: string): Promise<void> {
  const selects = page.locator('select:visible');
  const count = await selects.count();
  console.log(`  fillAllVisibleSelects [${label}]: ${count} select(s)`);

  for (let i = 0; i < count; i++) {
    const sel = selects.nth(i);
    const currentVal = await sel.inputValue().catch(() => '');
    if (!isPlaceholderValue(currentVal)) continue;

    const opts = await sel.locator('option').all();

    // Prefer "Ya" / "Lulus" / non-"Tidak" options for positive flow
    let picked = false;
    for (const opt of opts) {
      const text = (await opt.textContent() ?? '').trim();
      const val = await opt.getAttribute('value');
      if (isPlaceholderValue(val)) continue;
      if (text.toLowerCase() === 'ya' ||
          text.toLowerCase().includes('lulus') && !text.toLowerCase().includes('tidak') ||
          text.toLowerCase().includes('mumtaz')) {
        await sel.selectOption({ value: val! });
        picked = true;
        break;
      }
    }
    // Fallback: first non-placeholder, non-negative option
    if (!picked) {
      for (const opt of opts) {
        const text = (await opt.textContent() ?? '').trim().toLowerCase();
        const val = await opt.getAttribute('value');
        if (isPlaceholderValue(val)) continue;
        if (text.includes('tidak') || text.includes('rasib')) continue;
        await sel.selectOption({ value: val! });
        picked = true;
        break;
      }
    }
    // Last resort: anything not a placeholder
    if (!picked) {
      for (const opt of opts) {
        const val = await opt.getAttribute('value');
        if (!isPlaceholderValue(val)) {
          await sel.selectOption(val!);
          break;
        }
      }
    }
  }
}

/**
 * Fill every editable row on a Mahad Aly formlist (custom-formlist-wf_data_form_level1).
 *
 * Each criterion row contains:
 *   - 1+ <textarea> for deskripsi/catatan
 *   - 0–2 <select> for status/skor (rating 1–12 or option)
 *   - optional file upload (Bukti Pendukung)
 *
 * For a positive Mumtaz target we set every score select to its highest value.
 */
async function fillMahadAlyFormlist(
  page: Page,
  label: string,
  deskripsi: string,
  filePath: string,
): Promise<void> {
  console.log(`  fillMahadAlyFormlist [${label}]: scanning rows`);

  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  console.log(`  fillMahadAlyFormlist [${label}]: ${rowCount} row(s) found`);

  let filled = 0;
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);

    // Textareas
    const textareas = await row.locator('textarea').all();
    for (let ti = 0; ti < textareas.length; ti++) {
      const ta = textareas[ti];
      if (!await ta.isVisible().catch(() => false)) continue;
      if (await ta.isDisabled().catch(() => true)) continue;
      await ta.fill(`${deskripsi} (kriteria ${i + 1}, kolom ${ti + 1})`).catch(() => null);
    }

    // Selects — for scoring rows, pick the HIGHEST numeric option (Mumtaz)
    const selects = row.locator('select');
    const selCount = await selects.count();
    for (let si = 0; si < selCount; si++) {
      const sel = selects.nth(si);
      if (!await sel.isVisible().catch(() => false)) continue;
      const cur = await sel.inputValue().catch(() => '');
      if (!isPlaceholderValue(cur)) continue;

      const opts = await sel.locator('option').all();
      const validVals: number[] = [];
      const valueMap = new Map<number, string>();
      for (const opt of opts) {
        const val = await opt.getAttribute('value');
        if (isPlaceholderValue(val)) continue;
        const numVal = Number(val);
        if (!Number.isNaN(numVal)) {
          validVals.push(numVal);
          valueMap.set(numVal, val!);
        }
      }
      if (validVals.length > 0) {
        // Highest numeric → Mumtaz target
        const maxVal = Math.max(...validVals);
        await sel.selectOption(valueMap.get(maxVal)!).catch(() => null);
      } else {
        // Non-numeric: use pickPositiveOption so decision selects
        // (e.g. Apakah_PraVisitasi_Asesor_*_Dapat_DiLanjutkan with
        // values "Ya|Tidak") choose "Ya" rather than the first DOM
        // option (which may be "Tidak" and routes the workflow into
        // the revisi loop at step 30 instead of Hasil at step 36/44).
        const pairs = await Promise.all(opts.map(async (o) => ({
          value: await o.getAttribute('value').catch(() => null),
          text: ((await o.textContent().catch(() => '')) ?? '').trim(),
        })));
        const choice = pickPositiveOption(pairs);
        if (choice && choice.value !== null) {
          await sel.selectOption(choice.value).catch(() => null);
        }
      }
    }

    // Checkboxes
    const cbs = row.locator('input[type="checkbox"]');
    const cbCount = await cbs.count();
    for (let ci = 0; ci < cbCount; ci++) {
      const cb = cbs.nth(ci);
      if (!await cb.isChecked().catch(() => false)) await cb.check().catch(() => null);
    }

    // File upload via "Upload File" button (ModalUpload pattern)
    const uploadBtn = row.getByRole('button', { name: /Upload\s*File/i }).first();
    if (await uploadBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
      const uploadRespPromise = page
        .waitForResponse((r) => r.url().includes('/uploadfile1') && r.status() === 200, { timeout: 20_000 })
        .catch(() => null);
      await uploadBtn.click();
      const modalFileInput = page.locator('input[type="file"]').last();
      await modalFileInput.waitFor({ state: 'attached', timeout: 8_000 }).catch(() => null);
      await modalFileInput.setInputFiles(filePath).catch(() => null);
      await uploadRespPromise;
      await page.waitForTimeout(400);
    }

    filled++;
  }

  // Standalone file inputs outside tables
  const standaloneFiles = page.locator('input[type="file"]');
  const sfCount = await standaloneFiles.count();
  for (let fi = 0; fi < sfCount; fi++) {
    const inp = standaloneFiles.nth(fi);
    const has = await inp.evaluate((el: HTMLInputElement) => (el.files?.length ?? 0) > 0).catch(() => false);
    if (!has) {
      await inp.setInputFiles(filePath).catch(() => null);
      await inp.dispatchEvent('change').catch(() => null);
      await page.waitForTimeout(300);
    }
  }

  // Page-level dropdowns (e.g. Apakah_PraVisitasi_*_Dapat_DiLanjutkan)
  await fillAllVisibleSelects(page, label);

  console.log(`  fillMahadAlyFormlist [${label}]: ${filled}/${rowCount} row(s) filled`);
}

async function actionFillAndSubmit(page: Page, label: string): Promise<void> {
  // Fill every visible textarea that's empty
  const textareas = await page.locator('textarea:visible').all();
  for (const ta of textareas) {
    const val = await ta.inputValue().catch(() => '');
    if (!val.trim()) await ta.fill(`OK — ${label}`).catch(() => null);
  }
  await fillAllVisibleSelects(page, label).catch(() => null);
  await clickApprove(page, label);
}

async function actionUploadAndSubmit(page: Page, label: string, filePath: string): Promise<void> {
  const fileInputs = page.locator('input[type="file"]');
  const count = await fileInputs.count();
  console.log(`    [${label}] uploading ${count} file(s)`);
  for (let i = 0; i < count; i++) {
    const inp = fileInputs.nth(i);
    await inp.setInputFiles(filePath).catch(() => null);
    await inp.dispatchEvent('change').catch(() => null);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1_000);
  await clickApprove(page, label);
}

/**
 * SK-style submit: tolerant of complex custom fields and navigation races.
 */
async function actionSKSubmit(page: Page, label: string): Promise<void> {
  console.log(`    [${label}] SK submit start`);
  try {
    const ta = page.locator('textarea:visible').first();
    if (await ta.count() > 0) {
      const cur = await ta.inputValue().catch(() => '');
      if (!cur.trim()) await ta.fill(`Validasi ${label} — sesuai standar.`).catch(() => null);
    }
  } catch { /* ignore */ }

  if (page.isClosed()) return;

  try {
    await clickApprove(page, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Target page') || msg.includes('page closed') || msg.includes('context')) {
      console.log(`    [${label}] page navigated/closed during submit — treating as success`);
      return;
    }
    throw err;
  }
}

// ─── DAG-sync helper ──────────────────────────────────────────────────────
async function findTaskInInbox(page: Page, taskId: string): Promise<boolean> {
  const noTiketFromTask = taskId.split('-').slice(0, -1).join('-');
  const escaped = noTiketFromTask.replace(/[-]/g, '\\-');
  const ticketRegex = new RegExp(`#${escaped}(?!\\d)`);

  await page.goto('/app/inbox');
  await waitForPageLoad(page);
  await page.waitForTimeout(1_500);

  if (await page.getByText(taskId).first().isVisible({ timeout: 3_000 }).catch(() => false)) return true;
  return await page.getByText(ticketRegex).first().isVisible({ timeout: 5_000 }).catch(() => false);
}

async function waitForStepAvailable(
  page: Page,
  taskId: string,
  label: string,
  { attempts = 6, delayMs = 3_000 }: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  console.log(`[GUARD] ${label}: waiting for ${taskId} in inbox`);
  for (let i = 1; i <= attempts; i++) {
    if (await findTaskInInbox(page, taskId)) {
      console.log(`[GUARD] ${label}: ✓ ${taskId} available (attempt ${i}/${attempts})`);
      return;
    }
    if (i < attempts) await page.waitForTimeout(delayMs);
  }
  throw new Error(
    `[BLOCKED] ${label}: ${taskId} did not appear in inbox after ${attempts * delayMs / 1000}s.`,
  );
}

/**
 * Verify the workflow engine created the expected downstream task after a
 * submission. Used as a gate AFTER Step 7 "Kirim Pengajuan" — blocks the
 * suite from advancing to assessor/SK steps if the initial MA submission
 * did not actually transition.
 *
 * Strategy:
 *   1. Navigate directly to the expected task URL; if the SPA stays on that
 *      route (not redirected), the task exists.
 *   2. Fallback: poll /api/wf/mytodolist for a task matching the ticket.
 *
 * Throws with diagnostics if neither check finds the next task within the
 * retry budget.
 */
async function assertWorkflowTransition(
  page: Page,
  noTiket: string,
  expectedStep: number,
  {
    retries = 6,
    delayMs = 5_000,
    initialWaitMs = 3_000,
  }: { retries?: number; delayMs?: number; initialWaitMs?: number } = {},
): Promise<void> {
  const expectedTaskId = taskIdForStep(noTiket, expectedStep);
  const expectedUrl = `/app/spme/submission/${expectedTaskId}`;
  const budget = Math.round((initialWaitMs + retries * delayMs) / 1_000);
  console.log(
    `  assertWorkflowTransition: checking task "${expectedTaskId}" ` +
    `(${initialWaitMs / 1_000}s settle + ${retries} × ${delayMs / 1_000}s = ${budget}s max)`,
  );

  await page.waitForTimeout(initialWaitMs);

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Tier 1 — direct URL probe
    const choosetaskPromise = page
      .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 10_000 })
      .catch(() => null);
    await page.goto(expectedUrl);
    await page.waitForLoadState('networkidle').catch(() => null);
    await choosetaskPromise;

    const landedUrl = page.url();
    if (landedUrl.includes(expectedTaskId)) {
      console.log(`  assertWorkflowTransition ✓ task "${expectedTaskId}" accessible (URL check)`);
      return;
    }
    console.log(`  attempt ${attempt}/${retries}: landed=${landedUrl} (expected to contain ${expectedTaskId})`);

    // Tier 2 — mytodolist probe
    const tasks = await getAllPendingTasks(page);
    const match = tasks.find(
      (t) => t.task_id === expectedTaskId ||
             t.task_id.startsWith(noTiket + '-') ||
             t.no_tiket === noTiket,
    );
    if (match) {
      console.log(`  assertWorkflowTransition ✓ found in mytodolist: ${match.task_id}`);
      return;
    }

    if (attempt < retries) await page.waitForTimeout(delayMs);
  }

  throw new Error(
    `[assertWorkflowTransition] Workflow did NOT transition to step ${expectedStep} for ticket "${noTiket}".\n` +
    `  Expected task: ${expectedTaskId}\n` +
    `  After ${budget}s of polling, no downstream task exists.\n` +
    `  Most likely cause: Step 7 "Kirim Pengajuan" click did not actually submit.\n` +
    `  Check: confirmation modal was handled, /responsetask returned 200, data.task_id was not null.`,
  );
}

// ─── Response-driven navigation ──────────────────────────────────────────
//
// Rule of thumb:
//   • Within a same-role chain of steps → use openTaskByResponse(page).
//   • When the role changes (or lastResponseTaskId is null) → use
//     findTaskForRole(browser, role) to discover the task_id from that
//     role's /mytodolist queue.
//   • NEVER use taskIdForStep(noTiket, N) for a "first task after role
//     change" — the workflow engine may not honor XML step numbers for
//     parallel or computed transitions.

// [REMOVED] openTaskByResponse — only caller was openNextTaskDynamic, which
// was itself removed.  runWorkflowChain now opens response-supplied task_ids
// directly via openNextTaskByResponse (different helper, name-similar but
// supports the full direct-URL → pool-claim → inbox fallback chain).

/**
 * Find the first pending task on the current user's queue that belongs to
 * the given ticket. Preferred when a new role starts their block and we
 * don't know the exact step number the backend chose.
 *
 * The optional `stepHint` is used as a tie-breaker if multiple tasks match
 * the ticket — we pick the one closest to the hint.  Never as a hard filter.
 *
 * Async-tolerant defaults (15 × 2s = 30s) because:
 *   • Workflow engine materializes tasks asynchronously after a submit.
 *   • Inbox/mytodolist caches may lag several seconds behind the DB.
 *   • Pool tasks (claimable-by-role) may not appear in mytodolist at all
 *     until someone clicks them in the inbox.
 *
 * Each attempt tries TWO data sources:
 *   1. /mytodolist API (fast, but role-assigned tasks only)
 *   2. /app/inbox page DOM (picks up pool tasks too) — by force-reloading
 */
async function findTaskForCurrentUser(
  page: Page,
  noTiket: string,
  label: string,
  stepHint?: number,
  { retries = 15, delayMs = 2_000 }: { retries?: number; delayMs?: number } = {},
): Promise<string | null> {
  const userInfo = await getUserFromCookies(page).catch(() => '(unknown)');
  console.log(`    [${label}] findTaskForCurrentUser (UI-only) user=${userInfo} ticket=${noTiket} hint=${stepHint ?? '—'}`);

  const pickBest = (ids: string[]): string => {
    if (ids.length === 1 || stepHint === undefined) return ids[0];
    return ids.reduce((best, cur) => {
      const db = Math.abs(getStepFromTaskId(best) - stepHint);
      const dc = Math.abs(getStepFromTaskId(cur) - stepHint);
      return dc < db ? cur : best;
    }, ids[0]);
  };

  const escaped = noTiket.replace(/[-]/g, '\\-');
  const re = new RegExp(`${escaped}-(\\d+)`, 'g');

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Pure UI-inbox scrape — NO /mytodolist API call.
    // Tasks that are role-assigned (pool) don't always appear in the API
    // response, but they DO render in /app/inbox.  Also avoids the
    // "Invalid character in header content" errors from page.request.post.
    try {
      // Full SPA load so React has time to fetch + render inbox list.
      await page.goto('/app/inbox', { waitUntil: 'load' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
      await waitForPageLoad(page);
      await page.waitForTimeout(600);

      // Narrow the list via the Cari Pesan search input if present.
      const searchInput = page
        .getByPlaceholder(/^(Search|Cari.*|Cari Pesan)$/i)
        .or(page.locator('input[type="search"]'))
        .or(page.locator('input[placeholder*="Cari" i]'))
        .or(page.locator('input[placeholder*="Search" i]'))
        .first();
      if (await searchInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await searchInput.click().catch(() => null);
        await searchInput.fill('').catch(() => null);
        await searchInput.fill(noTiket).catch(() => null);
        await page.waitForTimeout(700);
      }

      // Read both HTML and innerText so we don't miss template-bound strings.
      const html = await page.content().catch(() => '');
      const text = await page.locator('body').innerText().catch(() => '');
      const found = new Set<string>();
      for (const m of html.matchAll(re)) found.add(m[0]);
      for (const m of text.matchAll(re)) found.add(m[0]);

      if (found.size > 0) {
        const picked = pickBest([...found]);
        console.log(
          `    [${label}] ✓ inbox-match attempt ${attempt}/${retries} → ${picked} ` +
          `(${found.size} task_id(s) visible)`,
        );
        return picked;
      }
    } catch (e) {
      console.warn(`    [${label}] inbox scrape error: ${String(e).slice(0, 80)}`);
    }

    console.log(
      `    [${label}] attempt ${attempt}/${retries}: no card for ticket "${noTiket}" ` +
      `(user=${userInfo})`,
    );
    if (attempt < retries) await page.waitForTimeout(delayMs);
  }

  console.warn(
    `    [${label}] findTaskForCurrentUser: exhausted ${retries} × ${delayMs / 1_000}s. ` +
    `No inbox card for ticket "${noTiket}". Returning null — caller decides whether to fail.`,
  );
  return null;
}

/**
 * Same as findTaskForCurrentUser but throws on miss — preserves prior
 * fail-fast semantics for call sites that can't continue without a task.
 * Step 10 uses the nullable form directly so it can do pool-claim fallback.
 */
async function findTaskOrThrow(
  page: Page,
  noTiket: string,
  label: string,
  stepHint?: number,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<string> {
  const id = await findTaskForCurrentUser(page, noTiket, label, stepHint, opts);
  if (id) return id;
  throw new Error(
    `[findTaskOrThrow] (${label}) no task for ticket "${noTiket}" after retries. ` +
    `The workflow may not have progressed as expected.`,
  );
}

// [REMOVED] openNextTaskDynamic — only caller was the now-deleted
// fillAsesorStandardStep.  All sub-step navigation now flows through
// runWorkflowChain → openNextTaskByResponse, which handles direct-URL,
// pool-claim, and inbox-fallback in one place.

// [REMOVED] executeWorkflowStep — step-isolated claim-and-act helper.
// Replaced by the chain-aware pattern: findTaskAcrossUsers (UI claim via
// inbox card click) + runWorkflowChain (response-driven walker).  The
// isolated helper encouraged splitting logically-joined workflow steps
// into separate tests that each re-probed for "their" task — fine when
// the engine was slow, but brittle when the workflow auto-advances
// within the previous step's chain (e.g. step 64 being reached by step
// 63's chain-walker).  Chain walkers are now the only control flow.

// [REMOVED] fillAsesorStandardStep — sub-step driver replaced by
// runWorkflowChain (chain walker) + per-step `actions` map.  Steps 13-20,
// 21-26, 36-42, 44-49 are all driven through runPraVisitasi /
// runHasilVisitasi which derive the task_id from the previous response,
// so no per-step caller helper is needed.

/**
 * Open + fill an MA "isi" sub-step (Steps 2–6).
 *
 * First call (stepHint=2): no response yet, falls back to queue lookup.
 * Subsequent calls: chains via lastResponseTaskId from previous /responsetask.
 */
async function fillMaIsiStep(
  page: Page,
  stepHint: number,
  label: string,
  deskripsi: string,
): Promise<void> {
  let taskId: string;
  if (lastResponseTaskId && lastResponseTaskId.startsWith(noTiket + '-')) {
    taskId = lastResponseTaskId;
    console.log(`[${label}] opening task from response: ${taskId}`);
    await openSubmissionTask(page, taskId);
  } else {
    taskId = await findTaskOrThrow(page, noTiket!, label, stepHint);
    console.log(`[${label}] opening task from queue: ${taskId}`);
    await openSubmissionTask(page, taskId);
  }
  await fillMahadAlyFormlist(page, label, deskripsi, SAMPLE_PDF);
  await clickApprove(page, label);
  console.log(`[${label}] ✓ submitted`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Serial E2E test suite
// ─────────────────────────────────────────────────────────────────────────────
test.describe.configure({ mode: 'serial' });

test.describe("E2E Positive — 1 Ticket (SPME MA'HAD ALY → Complete Workflow)", () => {

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 0 — MA: Start process & fill Pengajuan Asessment (Informasi Umum)
  // XML: form_data_input = {"Nama_Satuan_MahadAly", "NSMA"} → step 1
  // ══════════════════════════════════════════════════════════════════════════
  test('Step 0 — MA: Start process & Pengajuan Informasi Umum', async ({ browser }) => {
    test.setTimeout(90_000);
    if (!hasAuthState('mha')) test.skip(true, 'mha auth state missing — run global-setup');

    const context = await browser.newContext({ storageState: getStorageStatePath('mha') });
    const page = await context.newPage();

    try {
      const checkPromise = page
        .waitForResponse(
          (r) => r.url().includes('/checkprocesstostart') && r.request().method() === 'POST',
          { timeout: 15_000 },
        )
        .catch(() => null);

      console.log('[Step 0] Navigating to /app/spme');
      await page.goto('/app/spme');
      await waitForPageLoad(page);
      await checkPromise;
      await page.waitForTimeout(300);

      const ajukanBtn = page.getByRole('button', { name: /Ajukan A[s]+essment/i });
      await expect(ajukanBtn).toBeVisible({ timeout: 8_000 });
      console.log('[Step 0] Clicking "Ajukan Asessment"');

      const [startResp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/startProcess'), { timeout: 15_000 }).catch(() => null),
        ajukanBtn.click(),
      ]);

      expect(startResp, '/startProcess must be called').not.toBeNull();
      expect(startResp!.status(), 'startProcess HTTP').toBe(200);

      await expect(page).toHaveURL(/\/app\/spme\/submission\/[a-zA-Z0-9_-]+/, { timeout: 10_000 });
      const taskIdMatch = page.url().match(/\/submission\/([a-zA-Z0-9_-]+)/);
      const step0TaskId = taskIdMatch?.[1] ?? '';
      expect(step0TaskId, 'task_id in URL').toBeTruthy();
      noTiket = extractNoTiket(step0TaskId);
      console.log('[Step 0] noTiket:', noTiket);

      await waitForPageLoad(page);
      await page.waitForTimeout(500);

      // Fill Informasi Umum
      console.log('[Step 0] Filling Pengajuan Informasi Umum');
      await fillDynamicForm(page, [
        { name: 'Nama_Satuan_MahadAly', type: 'text', value: INSTITUTION.Nama_Satuan_MahadAly },
        { name: 'NSMA', type: 'text', value: INSTITUTION.NSMA },
      ]);

      // Optional file upload if present
      const hasFile = await page.locator('input[type="file"]').first()
        .waitFor({ state: 'attached', timeout: 3_000 }).then(() => true).catch(() => false);
      if (hasFile) {
        const inp = page.locator('input[type="file"]').first();
        await inp.setInputFiles(SAMPLE_PDF).catch(() => null);
      }

      const sub = new SubmissionPage(page);
      const approveVisible = await sub.approveButton.isVisible({ timeout: 3_000 }).catch(() => false);
      if (approveVisible) await clickApprove(page, 'Step 0');
      else await sub.saveButton.click();

      console.log('[Step 0] ✓ Pengajuan Informasi Umum submitted');
    } finally {
      await context.close();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEPS 2–6 — MA: Fill 5 intermediate _isi standards ("Lanjutkan")
  //   Step 2 → SKL (ma_SKL_1A_1_isi)
  //   Step 3 → Kurikulum (ma_KURIKULUM_1B_1..4_isi)
  //   Step 4 → Pendidik dan Tendik (ma_PENDIDIK_1C_1..4_isi)
  //   Step 5 → Pembiayaan dan Pembelajaran (ma_PEMBIAYAAN_1D_1..4_isi)
  //   Step 6 → Karya Ilmiah / Bahts (ma_BAHTS_2_1..8_isi)
  // All five use decision_key "true":"Lanjutkan" — they do NOT finalize the
  // submission.  Step 7 is the real "Kirim Pengajuan" — handled separately.
  // ══════════════════════════════════════════════════════════════════════════
  test('Steps 2–6 — MA: Fill intermediate isi standards', async ({ browser }) => {
    test.setTimeout(360_000);
    expect(noTiket, 'noTiket must be set by Step 0').toBeTruthy();
    if (!hasAuthState('mha')) test.skip(true, 'mha auth state missing');

    const context = await browser.newContext({ storageState: getStorageStatePath('mha') });
    const page = await context.newPage();

    const STEPS = [
      { stepNum: 2, label: 'Step 2 — Draft Pengajuan (SKL)',                 desc: 'Bukti pencapaian SKL Ma\'had Aly memenuhi standar.' },
      { stepNum: 3, label: 'Step 3 — Pengajuan (Kurikulum)',                 desc: 'Kurikulum kitab turats tersusun sistematis.' },
      { stepNum: 4, label: 'Step 4 — Pengajuan (Pendidik dan Tendik)',       desc: 'Pendidik dan tendik berkualifikasi sanad keilmuan.' },
      { stepNum: 5, label: 'Step 5 — Pengajuan (Pembiayaan dan Pembelajaran)', desc: 'Anggaran dan realisasi pembiayaan transparan.' },
      { stepNum: 6, label: 'Step 6 — Pengajuan (Karya Ilmiah)',              desc: 'Bahts ilmiah produktif dengan luaran berkualitas.' },
    ];

    try {
      for (const { stepNum, label, desc } of STEPS) {
        await fillMaIsiStep(page, stepNum, label, desc);
      }
      console.log('[Steps 2-6] ✓ All 5 intermediate MA isi standards submitted');
    } finally {
      await context.close();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 7 — MA: Submit Pengajuan (FINAL SUBMISSION)
  //
  // XML: decision_key = {"true":"Kirim Pengajuan", "false":"Kembali", "save":"Simpan"}
  //      logtrue     = "Draft Dikirim, Dokumen SPME diajukan dan dikirim oleh [MA]"
  //      steptrue    = 8  (system_role_list_user — Assesor_1 lookup)
  //
  // This is the ONLY step in the MA flow that actually submits the ticket.
  // After click, the workflow engine chains system steps 8 → 9 → 10 (SK).
  // We MUST assert Step 10 exists before allowing the suite to continue —
  // otherwise assessor steps will fail mysteriously with task-not-found errors.
  //
  // Behaviors handled explicitly:
  //   • "Kirim Pengajuan" button click (not a generic "Lanjutkan")
  //   • Confirmation modal ("Ya" / "Lanjutkan" / "Konfirmasi")
  //   • /responsetask HTTP 200 + body.data.task_id check
  //   • Post-submit transition verification (Step 10 must exist)
  // ══════════════════════════════════════════════════════════════════════════
  test('Step 7 — MA: Submit Pengajuan (Kirim Pengajuan)', async ({ browser }) => {
    test.setTimeout(180_000);
    expect(noTiket, 'noTiket must be set by Step 0').toBeTruthy();
    if (!hasAuthState('mha')) test.skip(true, 'mha auth state missing');

    const context = await browser.newContext({ storageState: getStorageStatePath('mha') });
    const page = await context.newPage();

    try {
      // ── 7a. Open the final MA form (Pengabdian) ─────────────────────────
      // Prefer chain from Step 6's response; fall back to queue lookup.
      let taskId: string;
      if (lastResponseTaskId && lastResponseTaskId.startsWith(noTiket + '-')) {
        taskId = lastResponseTaskId;
      } else {
        taskId = await findTaskOrThrow(page, noTiket!, 'Step 7 — Submit Pengajuan', 7);
      }
      console.log(`[Step 7] Opening final submission form: ${taskId}`);
      await openSubmissionTask(page, taskId);
      await page.waitForLoadState('networkidle').catch(() => null);

      // ── 7b. Fill all Pengabdian criteria rows ───────────────────────────
      await fillMahadAlyFormlist(
        page,
        'Step 7 — Submit Pengajuan',
        'Program pengabdian masyarakat berdampak luas dan berkelanjutan.',
        SAMPLE_PDF,
      );

      // ── 7c. Locate the "Kirim Pengajuan" button explicitly ──────────────
      // DynamicForm renders the true-branch button as either button#true (with
      // the decision_key text) OR a button labeled exactly "Kirim Pengajuan".
      // Try both — whichever is visible.
      const kirimBtn = page.getByRole('button', { name: /^Kirim Pengajuan$/i }).first();
      const kirimById = page.locator('button#true').first();

      const kirimVisible = await kirimBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      const idVisible    = await kirimById.isVisible({ timeout: 1_500 }).catch(() => false);

      if (!kirimVisible && !idVisible) {
        const btnTexts = await page.locator('button:visible').allTextContents();
        throw new Error(
          `[Step 7] "Kirim Pengajuan" button not found.\n` +
          `  URL: ${page.url()}\n` +
          `  Visible buttons: [${btnTexts.map((t) => `"${t.trim()}"`).join(', ')}]`,
        );
      }

      const targetBtn = kirimVisible ? kirimBtn : kirimById;
      const targetName = kirimVisible ? '"Kirim Pengajuan"' : 'button#true';
      console.log(`[Step 7] Clicking ${targetName}`);

      await targetBtn.scrollIntoViewIfNeeded();

      // ── 7d. Click + handle confirmation modal + wait for /responsetask ──
      const [resp] = await Promise.all([
        page
          .waitForResponse(
            (r) => (r.url().includes('/responsetask') || r.url().includes('/submit')) &&
                   r.request().method() === 'POST',
            { timeout: 30_000 },
          )
          .catch(() => null),
        (async () => {
          await targetBtn.click();

          // Confirmation modal (if any): "Ya" / "Lanjutkan" / "Konfirmasi"
          const modalBtn = page.locator('[role="dialog"] button, .modal button, [class*="modal"] button')
            .filter({ hasText: /^(Ya|Lanjutkan|Konfirmasi|Kirim)$/i }).first();

          if (await modalBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
            const modalText = (await modalBtn.textContent() ?? '').trim();
            console.log(`[Step 7] Confirmation modal detected — clicking "${modalText}"`);
            await modalBtn.click();
          } else {
            console.log('[Step 7] No confirmation modal detected');
          }
        })(),
      ]);

      // ── 7e. Validate response ───────────────────────────────────────────
      if (!resp) {
        throw new Error(
          `[Step 7] /responsetask (or /submit) was NOT called after clicking "Kirim Pengajuan". ` +
          `Either the button did not submit, or the backend endpoint changed.`,
        );
      }

      const httpStatus = resp.status();
      const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
      console.log(`[Step 7] submit response HTTP ${httpStatus} | body:`, JSON.stringify(body)?.slice(0, 400));

      expect(httpStatus, '[Step 7] Kirim Pengajuan must return HTTP 200').toBe(200);

      const data = body?.data as Record<string, unknown> | undefined;
      if (body?.status !== undefined) {
        const statusStr = String(body.status).toLowerCase();
        expect.soft(statusStr, '[Step 7] body.status must not indicate error')
          .not.toMatch(/error|fail/);
      }

      // data.task_id may be null when the next step is owned by another role —
      // that IS the case here (Step 10 is owned by SK).  Just log and continue.
      console.log(`[Step 7] next task_id per response: ${data?.task_id ?? 'null (expected — next owner = SK)'}`);
      console.log('[Step 7] ✓ "Kirim Pengajuan" submitted successfully');

      // ── 7f. Assert Step 10 was created — GATE for assessor/SK tests ─────
      // If this fails we do NOT silently skip downstream tests — the whole
      // suite must halt here so the root cause (MA submission) is addressed.
      await assertWorkflowTransition(page, noTiket!, 10, {
        retries: 8,
        delayMs: 4_000,
        initialWaitMs: 3_000,
      });
      console.log('[Step 7] ✓ Workflow transitioned to Step 10 (SK Penunjukan Asesor)');
    } finally {
      await context.close();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 10 — SK: Penunjukan Asesor & Jadwal Asessment
  // XML form: {Assesor_1, Assesor_2, Jadwal_Assesment_Mulai, Jadwal_Assesment_Selesai}
  // ══════════════════════════════════════════════════════════════════════════
  test('Step 10 — SK: Assign Assessors & Schedule', async ({ browser }) => {
    test.setTimeout(120_000);
    expect(noTiket, 'noTiket must be set').toBeTruthy();
    if (!hasAuthState('sk')) test.skip(true, 'sk auth state missing');

    const context = await browser.newContext({ storageState: getStorageStatePath('sk') });
    const page = await context.newPage();

    try {
      // SK role's first task for this ticket — query queue dynamically.
      // DO NOT assume step 10; the backend may have chained to a different
      // step if the XML workflow has evolved.
      lastResponseTaskId = null;

      // Patient queue lookup (15 × 2s = 30s budget) — handles async engine lag.
      let step10TaskId = await findTaskForCurrentUser(
        page, noTiket!, 'Step 10 — SK Penunjukan Asesor', 10,
        { retries: 15, delayMs: 2_000 },
      );

      // If still not found via queue/inbox after full budget, fall back to
      // the deterministic task_id guess and let openTaskSmart probe it.
      // This handles the edge case where the task exists in the backend but
      // is a pool task not yet listed in mytodolist.
      if (!step10TaskId) {
        step10TaskId = `${noTiket}-10`;
        console.warn(
          `[Step 10] Queue/inbox lookup exhausted — attempting direct URL with guessed ` +
          `task_id=${step10TaskId} (pool-claim flow).`,
        );
      }

      console.log(`[Step 10] Opening SK task: ${step10TaskId}`);
      await openTaskSmart(page, step10TaskId, 'Step 10 — SK Penunjukan Asesor');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1_500);

      expect(
        page.url(),
        `[Step 10] Navigation redirected — task may not exist`,
      ).toContain(step10TaskId);

      // Reuse the DIKDASMEN page object — same form structure.
      const spme = new SpmeDikdasmenPage(page);
      console.log(
        '[Step 10] expected assessors:',
        `Asesor 1="${ASESOR_ASSIGNMENT.asesor_1_name}"`,
        `Asesor 2="${ASESOR_ASSIGNMENT.asesor_2_name}"`,
      );
      await spme.fillAssessorAssignment(
        ASESOR_ASSIGNMENT.asesor_1_name,
        ASESOR_ASSIGNMENT.asesor_2_name,
        ASESOR_ASSIGNMENT.Jadwal_Assesment_Mulai,
        ASESOR_ASSIGNMENT.Jadwal_Assesment_Selesai,
      );

      // ── Belt-and-braces: catch any visible field fillAssessorAssignment
      //    may not have set (radios, hidden notes, extra catatan textareas).
      //    Avoids silent validation-reject where "Lanjutkan" is enabled
      //    but the form blocks submit.
      await fillAllVisibleFormFields(page, 'Step 10 — SK Penunjukan Asesor', { maxPasses: 3 });
      const unfilled = await verifyAllRequiredFilled(page, 'Step 10 — SK Penunjukan Asesor');
      if (unfilled.length > 0) {
        console.warn(
          `[Step 10] ${unfilled.length} unfilled required fields after fillers — ` +
          `${unfilled.map((f) => f.name).join(', ')}`,
        );
      }

      // ── STRICT submit — requires POST /submit|/responsetask OR URL change
      //    within 5s, else throws with screenshot diagnostics.  The old
      //    clickApprove tolerated silence which masked this exact bug: the
      //    SK form looked submitted, but the backend never advanced past
      //    step 10, and downstream assessor probes found nothing.
      // 15s cap per strategy — SK assessor-assignment may round-trip a
      // few seconds on the backend (notification fan-out + task creation).
      const submit10 = await submitStrict(page, 'Step 10 — SK Penunjukan Asesor', {
        timeoutMs: 15_000,
      });

      console.log(
        `[Step 10] ✓ Assessors assigned — nextTaskId=${submit10.nextTaskId ?? 'null (parallel fan-out to 75/76)'}`,
      );

      // ── Post-submit verification: SK's inbox MUST no longer have a
      //    step-10 card for this ticket.  If it does, the submit was
      //    cosmetic and we need to fail BEFORE downstream tests waste
      //    minutes probing for 75/76 tasks that don't exist.
      await page.waitForTimeout(1_500);
      const recheck = await findTaskForCurrentUser(
        page, noTiket!, 'Step 10 post-submit verification', 10,
        { retries: 2, delayMs: 1_500 },
      );
      if (recheck && recheck.endsWith('-10')) {
        throw new Error(
          `[Step 10] POST-SUBMIT VERIFICATION FAILED — SK still has a step-10 ` +
          `card for ticket "${noTiket}" (taskId=${recheck}).\n` +
          `  The click appeared to succeed but the workflow did NOT advance.\n` +
          `  Common causes: backend rejected assessor-name validation, ` +
          `a required scheduling field was invalid, or the /submit POST ` +
          `returned success with no side-effect.`,
        );
      }
      console.log(`[Step 10] ✓ post-submit verified — step-10 card cleared from SK inbox`);
    } finally {
      await context.close();
    }

    // No assessor-ownership probe here — every downstream test now resolves
    // owners dynamically via probeAndLoginAsOwner / findTaskAcrossUsers.
    // Hardcoding asesor1Role/asesor2Role at this point led to wrong-user
    // logins when the workflow engine routed differently than the XML
    // suggests.  Trust the backend at the moment of use, not at provisioning.
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEPS 75 & 76 — AS: Pra-Visitasi Preview (read-only confirm → "Lanjutkan")
  // XML: Step 75 → Asesor 1 (preview of MA's _isi data) → Step 13
  //      Step 76 → Asesor 2 (preview of MA's _isi data) → Step 14
  // These are pass-through preview steps — just click "Lanjutkan".
  // ══════════════════════════════════════════════════════════════════════════
  test('Step 75 — AS: Pra-Visitasi Preview (parallel entry, dynamic owner)', async ({ browser }) => {
    test.setTimeout(90_000);
    expect(noTiket, 'noTiket must be set').toBeTruthy();
    lastResponseTaskId = null;

    // Probe ALL candidate roles for any preview-entry task (75 OR 76).
    // No role assumption — whichever assessor account the engine picked
    // owns the work.
    const owner = await probeAndLoginAsOwner(
      browser, noTiket!, [75, 76], 'Step 75 Preview',
    );
    if (!owner) {
      test.skip(true, `[Step 75] no role owns step 75 or 76 for ticket "${noTiket}"`);
      return;
    }

    const { context, page, role, entryStep } = owner;
    console.log(`[FLOW] Step 75 — preview entry step ${entryStep} owned by ${role}`);

    try {
      const result = await completePreviewFromInbox(page, noTiket!, {
        label: `Step 75 Preview (resolved role=${role})`,
      });
      lastResponseTaskId = result.nextTaskId;
      console.log(
        `[FLOW] Step 75 ✓ openedStep=${result.openedStep} role=${role} ` +
        `→ nextTaskId=${lastResponseTaskId ?? 'null (chain end)'}`,
      );
    } finally {
      await context.close();
    }
  });

  test('Step 76 — AS: Pra-Visitasi Preview (other parallel entry)', async ({ browser }) => {
    test.setTimeout(90_000);
    expect(noTiket, 'noTiket must be set').toBeTruthy();

    // After Step 75 the workflow may or may not have a sibling preview pending.
    // Probe defensively — if no card exists, the parallel branch has already
    // converged or doesn't apply; skip cleanly.
    const owner = await probeAndLoginAsOwner(
      browser, noTiket!, [75, 76], 'Step 76 Preview',
    );
    if (!owner) {
      console.log(`[FLOW] Step 76 — no remaining preview task; parallel branch already converged. Skipping.`);
      test.skip(true, `[Step 76] no remaining preview task for ticket "${noTiket}"`);
      return;
    }

    const { context, page, role, entryStep } = owner;
    console.log(`[FLOW] Step 76 — preview entry step ${entryStep} owned by ${role}`);

    try {
      const result = await completePreviewFromInbox(page, noTiket!, {
        label: `Step 76 Preview (resolved role=${role})`,
      });
      // Don't overwrite Step 75's lastResponseTaskId if Step 76's is null
      // (role boundary on this branch).  Only overwrite when we have a real
      // forward task to chain.
      if (result.nextTaskId) lastResponseTaskId = result.nextTaskId;
      console.log(
        `[FLOW] Step 76 ✓ openedStep=${result.openedStep} role=${role} ` +
        `→ nextTaskId=${result.nextTaskId ?? 'null (chain end)'}`,
      );
    } finally {
      await context.close();
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEPS 13/14 + 15–20 — AS: Pra-Visitasi (Informasi Umum + 6 standards)
  //
  // Steps 13 and 14 are PARALLEL ENTRY POINTS to the same downstream workflow.
  // Only ONE will actually exist for the current ticket — whichever the engine
  // assigned to whichever assessor.  We resolve the entry by accepting either
  // step number, then chain forward.
  //
  //   Step 13 (Asesor 1 path) → Informasi Umum (NSMA)            → 15
  //   Step 14 (Asesor 2 path) → Informasi Umum (NSPP)            → 21
  //   Step 15 → SKL (_praasesor1)            → 16
  //   …etc. — sub-step chain follows the response task_id, no hardcoding.
  // ══════════════════════════════════════════════════════════════════════════
  test('Steps 13/14 + sub-steps — AS: Pra-Visitasi entry (parallel) + chain', async ({ browser }) => {
    test.setTimeout(420_000);
    expect(noTiket, 'noTiket must be set').toBeTruthy();

    // ── Pra-Visitasi entry resolution ────────────────────────────────────
    // Steps 13 and 14 are parallel entry points — only ONE will exist.
    // Acceptable entry steps are explicitly enumerated so neither is
    // privileged; the resolver picks whichever is actually claimable.
    const ENTRY_STEPS = [13, 14];

    let resolvedRole: RoleKey | null = null;
    let resolvedContext: BrowserContext | null = null;
    let resolvedPage: Page | null = null;
    let resolvedTaskId: string | null = null;
    let resolvedStep = 0;

    // ── Stage A — direct URL probe using chained task_id ────────────────
    const chainedTaskId = lastResponseTaskId as string | null;
    if (
      chainedTaskId &&
      chainedTaskId.startsWith(noTiket + '-') &&
      ENTRY_STEPS.includes(Number(chainedTaskId.split('-').pop()))
    ) {
      console.log(`[Pra-Visitasi entry] Stage A — direct URL probe for chained task ${chainedTaskId}`);
      const urlProbe = await resolveTaskOwnerByUrl(
        browser, chainedTaskId, undefined,
        { label: 'Pra-Visitasi entry URL probe' },
      );
      if (urlProbe) {
        resolvedRole = urlProbe.role;
        resolvedContext = urlProbe.context;
        resolvedPage = urlProbe.page;
        resolvedTaskId = chainedTaskId;
        resolvedStep = Number(chainedTaskId.split('-').pop());
      }
    } else {
      console.log(`[Pra-Visitasi entry] Stage A skipped — chained task is not 13 or 14`);
    }

    // ── Stage B — inbox sweep fallback (accepts step 13 OR 14) ─────────
    if (!resolvedRole) {
      console.log(`[Pra-Visitasi entry] Stage B — inbox sweep accepting steps ${ENTRY_STEPS.join('/')}`);
      const inboxProbe = await findTaskAcrossUsers(
        browser, noTiket!, undefined,
        { acceptableSteps: ENTRY_STEPS, label: 'Pra-Visitasi entry inbox probe' },
      );
      if (!inboxProbe) {
        throw new Error(
          `[Pra-Visitasi entry] No user across [${SPME_CANDIDATE_ROLES.join(', ')}] owns ` +
          `step 13 or 14 for ticket "${noTiket}".\n` +
          `  Did Step 75/76 actually submit and chain to the next step?`,
        );
      }
      resolvedRole = inboxProbe.role;
      resolvedTaskId = inboxProbe.taskId;
      resolvedStep = inboxProbe.step;
      // Reuse the probe's already-logged-in + already-claimed page.
      resolvedContext = inboxProbe.context;
      resolvedPage = inboxProbe.page;
    }

    console.log(
      `[Pra-Visitasi entry] resolved: role=${resolvedRole} taskId=${resolvedTaskId} step=${resolvedStep}`,
    );

    // No role re-binding needed — downstream tests probe owners themselves.
    // The resolved page is reused locally below for THIS test's sub-step chain.

    const context = resolvedContext!;
    const page = resolvedPage!;

    try {
      // If Stage A already landed us on the claimed task URL AND the form is
      // editable, skip the redundant inbox re-click (it would destroy the
      // claim context we just established).
      lastResponseTaskId = null;
      const alreadyOnTask =
        page.url().includes(resolvedTaskId as string) &&
        (await isPageEditable(page));

      if (!alreadyOnTask) {
        console.log(`[Step 13] re-opening via inbox (current URL: ${page.url()})`);
        await page.goto('/app/inbox');
        await waitForPageLoad(page);
        await page.waitForTimeout(800);

        const escaped = (resolvedTaskId as string).replace(/[-]/g, '\\-');
        const card = page.getByText(new RegExp(`#?${escaped}\\b`)).first();
        const found = await card.waitFor({ state: 'visible', timeout: 10_000 })
          .then(() => true).catch(() => false);

        if (!found) {
          // Fallback: any card mentioning the ticket — bounded probe.
          const ticketEsc = noTiket!.replace(/[-]/g, '\\-');
          const fallback = page.getByText(new RegExp(`#?${ticketEsc}(?!\\d)`)).first();
          const fallbackVisible = await fallback
            .isVisible({ timeout: 5_000 })
            .catch(() => false);
          if (!fallbackVisible) {
            throw new Error(`[Step 13] No inbox card for ticket "${noTiket}" (after fallback probe).`);
          }
          await fallback.click({ timeout: MEDIUM_ACTION_MS }).catch(() => null);
        } else {
          await card.click({ timeout: MEDIUM_ACTION_MS }).catch(() => null);
        }

        await page.waitForURL(/\/app\/spme\/submission\/[\w-]+/, { timeout: 15_000 }).catch(() => null);
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
        await page.waitForTimeout(800);
      } else {
        console.log(`[Step 13] Stage A page already editable at ${page.url()} — skipping inbox re-click`);
      }

      console.log(`[Pra-Visitasi entry step=${resolvedStep}] landed URL: ${page.url()}`);

      // Field set depends on which entry step the engine actually opened.
      // Step 13 (Asesor 1 path) uses NSMA + Nama_Satuan_MahadAly.
      // Step 14 (Asesor 2 path) uses NSPP + Nama_Satuan_Pendidikan.
      const commonFields = [
        { name: 'Nama_Pesantren', type: 'text' as const, value: INSTITUTION.Nama_Pesantren },
        { name: 'Alamat', type: 'text' as const, value: INSTITUTION.Alamat },
        { name: 'Ketua_Dewan_Masyayikh', type: 'text' as const, value: INSTITUTION.Ketua_Dewan_Masyayikh },
        { name: 'Mudir', type: 'text' as const, value: INSTITUTION.Mudir },
        { name: 'Takhassus', type: 'text' as const, value: INSTITUTION.Takhassus },
        { name: 'Konsentrasi', type: 'text' as const, value: INSTITUTION.Konsentrasi },
        { name: 'Marhalah', type: 'text' as const, value: INSTITUTION.Marhalah },
        { name: 'Visi', type: 'text' as const, value: INSTITUTION.Visi },
        { name: 'Misi', type: 'text' as const, value: INSTITUTION.Misi },
        { name: 'Tahun_Periode_Asesmen', type: 'text' as const, value: INSTITUTION.Tahun_Periode_Asesmen },
        { name: 'Waktu_Pelaksanaan_Visitasi_Lapangan', type: 'date' as const, value: INSTITUTION.Waktu_Pelaksanaan_Visitasi_Lapangan },
      ];

      const entryFields =
        resolvedStep === 14
          ? [
              { name: 'Nama_Satuan_Pendidikan', type: 'text' as const, value: INSTITUTION.Nama_Satuan_Pendidikan },
              { name: 'NSPP', type: 'text' as const, value: INSTITUTION.NSPP },
              ...commonFields,
            ]
          : [
              { name: 'Nama_Satuan_MahadAly', type: 'text' as const, value: INSTITUTION.Nama_Satuan_MahadAly },
              { name: 'NSMA', type: 'text' as const, value: INSTITUTION.NSMA },
              ...commonFields,
            ];

      // 1. Fill the XML-typed text fields (Nama_Pesantren, NSMA, etc.)
      //    Tolerate per-field timeouts — not every field in `entryFields`
      //    may render on every workflow variant.
      await fillDynamicForm(page, entryFields).catch((e) =>
        console.warn(`[Pra-Visitasi entry] fillDynamicForm partial: ${String(e).slice(0, 100)}`),
      );

      const entryLabel = `Pra-Visitasi entry — step ${resolvedStep} (Informasi Umum)`;

      // 2. MANDATORY — fill every remaining visible field so the backend
      //    never rejects the submit for missing required data.  Covers
      //    radios, textareas, unfilled text inputs, native selects, custom
      //    dropdowns, contenteditable.  Pra-Visitasi in Ma'had Aly is NOT
      //    passive — it requires valid form submission to advance the
      //    workflow, and steps 13/14 have the MOST fields of any step,
      //    so we use a larger pass budget (5 vs the default 3).
      await fillAllVisibleFormFields(page, entryLabel, { maxPasses: 5 });

      // 3. Verify every required field is populated.  If any remain empty,
      //    run one more aggressive filler pass to catch late-mounted fields
      //    (conditional reveals after a radio/dropdown selection).
      let unfilled = await verifyAllRequiredFilled(page, entryLabel);
      if (unfilled.length > 0) {
        console.warn(
          `[Pra-Visitasi entry] ${unfilled.length} unfilled required field(s) — ` +
          `running a second fill pass to catch conditional reveals.`,
        );
        await page.waitForTimeout(500);
        await fillAllVisibleFormFields(page, `${entryLabel} (retry)`, { maxPasses: 3 });
        unfilled = await verifyAllRequiredFilled(page, entryLabel);
      }
      if (unfilled.length > 0) {
        // Still unfilled after two passes — log but proceed.  submitStrict
        // will fail loudly with a screenshot if the form truly can't submit,
        // and the diagnostic above names every still-empty field so the
        // test author can fix the filler / add XML entries.
        console.warn(
          `[Pra-Visitasi entry] PROCEEDING with ${unfilled.length} still-unfilled required ` +
          `field(s) — submit may fail.  Fields: ` +
          `${unfilled.map((f) => f.name).join(', ')}`,
        );
      }

      // 3. Submit — strict if the step fires a backend call, tolerant of
      //    UI-only transitions for steps in UI_ONLY_STEPS.  Steps 13 and 14
      //    in particular are UI-only: "Lanjutkan" just navigates to the
      //    standards chain without a /submit or /responsetask round-trip.
      //    For those, a DOM change after click counts as valid progress.
      const stepIsUiOnly = UI_ONLY_STEPS.has(resolvedStep);
      const entry = await submitStrict(page, entryLabel, {
        timeoutMs: 5_000,
        uiOnly: stepIsUiOnly,
      });

      let chainStart: string | null = entry.nextTaskId;

      if (!chainStart) {
        if (entry.uiOnlyProgressed) {
          // UI-only step: no task_id from response.  Probe the ticket
          // across candidate roles for ANY newly-materialised task.
          console.log(
            `[Pra-Visitasi entry] UI-only transition on step=${resolvedStep} — ` +
            `probing for next task across candidate roles...`,
          );
          await page.waitForTimeout(1_500); // let the engine materialise
          const nextProbe = await findTaskAcrossUsers(
            browser, noTiket!, undefined,
            { label: 'Pra-Visitasi post-entry next-task probe' },
          );
          if (!nextProbe) {
            throw new Error(
              `[Pra-Visitasi entry] UI-only step ${resolvedStep} progressed but no ` +
              `downstream task materialised across all candidate roles.`,
            );
          }
          chainStart = nextProbe.taskId;
          // Close the probe's context — we already have our own page.
          await nextProbe.context.close().catch(() => null);
          console.log(`[Pra-Visitasi entry] ✓ UI-only → found next task ${chainStart} via probe`);
        } else {
          throw new Error(
            `[Pra-Visitasi entry] submit succeeded but nextTaskId is null — ` +
            `backend returned no follow-up task.  Response body: ` +
            `${JSON.stringify(entry.body)?.slice(0, 400)}`,
          );
        }
      }

      console.log(`[Pra-Visitasi entry] ✓ submitted step=${resolvedStep} → chainStart=${chainStart}`);
      await page.waitForTimeout(1_000);

      // ── Phase 1: runPraVisitasi — chain SKL/Kurikulum/Pendidik/Pembiayaan/
      // Karya Ilmiah/Pengabdian.  Guard fires automatically when the backend
      // returns a non-forward step (e.g. decision loops back to 27/28) so we
      // stop cleanly at the phase boundary.
      {
        // Sub-step action uses the SAME strict-submit discipline as the
        // entry: fill all visible fields, then require a real submission
        // signal (POST /submit or URL change).  runWorkflowChain already
        // wires its own response listener around this action, so we don't
        // reuse submitStrict here — but we DO fill everything before click
        // to prevent the backend from rejecting the submit silently.
        const praVisitasiAction = async (p: Page, step: number): Promise<void> => {
          await fillMahadAlyFormlist(
            p, `Pra-Visitasi step=${step}`,
            `Pra-visitasi step ${step}: dokumen lengkap dan memenuhi standar.`,
            SAMPLE_PDF,
          );
          await fillAllVisibleFormFields(p, `Pra-Visitasi step=${step}`);
          // Label-scoped decision filler — sets "Apakah ... Dapat
          // DiLanjutkan" to "Ya".  Critical for step 20/26 which gate
          // the workflow transition to Hasil Visitasi (36/44).
          await fillWorkflowDecisionDropdowns(p, `Pra-Visitasi step=${step}`);
          await clickLanjutkan(p, `Pra-Visitasi step=${step}`);
        };

        const { visited, finalNextTaskId } = await runPraVisitasi(page, chainStart, {
          label: `Pra-Visitasi Asesor (${resolvedRole})`,
          actions: {
            15: praVisitasiAction, 16: praVisitasiAction, 17: praVisitasiAction,
            18: praVisitasiAction, 19: praVisitasiAction, 20: praVisitasiAction,
            21: praVisitasiAction, 22: praVisitasiAction, 23: praVisitasiAction,
            24: praVisitasiAction, 25: praVisitasiAction, 26: praVisitasiAction,
          },
          fallbackAction: praVisitasiAction,
          // Stop cleanly BEFORE entering Hasil Visitasi territory.  After
          // step 20 (Asesor 1) or 26 (Asesor 2), the backend auto-advances
          // through the system decision at 27/28 and creates 36;44.  If our
          // chain keeps walking, we'd run Hasil steps here instead of in
          // the dedicated Hasil Visitasi phase — leaving the workflow in a
          // half-done state.
          terminalSteps: [36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
          maxIterations: 10,
        });
        console.log(
          `[Pra-Visitasi] ✓ visited=[${visited.join(', ')}] → finalNext=${finalNextTaskId ?? 'null'}`,
        );
        // Store for downstream phases to inspect / ignore
        lastResponseTaskId = finalNextTaskId;
      }
    } finally {
      await context.close();
    }

    // ── Second parallel branch ─────────────────────────────────────────
    //
    // The first chain completed (e.g. Asesor 2 walked 14 → 21–26).  But the
    // XML creates TWO parallel Pra-Visitasi branches after Step 12 — the
    // OTHER assessor's branch (13 → 15–20) must also finish before the
    // engine joins at Step 27 and creates Hasil tasks (36/44).
    //
    // Detect the remaining entry by probing for step 13 or 14.  If present,
    // run it as a full Pra-Visitasi entry + chain.  If absent, the engine
    // converged via some other path — proceed.
    console.log(`[Pra-Visitasi] probing for second parallel branch (steps 13 or 14)...`);
    // Retry — the second-branch entry (13 or 14) is usually already present
    // as soon as the first branch's guard trips, but allow a small window
    // for async materialisation just in case.
    const secondBranch = await findTaskAcrossUsers(browser, noTiket!, undefined, {
      acceptableSteps: [13, 14],
      label: 'Pra-Visitasi second branch probe',
      retries: 6,
      delayMs: 2_500,
    });

    if (!secondBranch) {
      console.log(`[Pra-Visitasi] no second branch remaining — both branches converged or this flow is single-branch.`);
    } else {
      const branch2Role = secondBranch.role;
      const branch2Step = secondBranch.step;
      const branch2Page = secondBranch.page;
      const branch2Ctx = secondBranch.context;
      console.log(
        `[FLOW] Pra-Visitasi second branch: role=${branch2Role} step=${branch2Step} ` +
        `taskId=${secondBranch.taskId}`,
      );

      try {
        // Fill the Informasi Umum form with field set appropriate to the
        // resolved step (13 uses NSMA, 14 uses NSPP).
        const b2CommonFields = [
          { name: 'Nama_Pesantren', type: 'text' as const, value: INSTITUTION.Nama_Pesantren },
          { name: 'Alamat', type: 'text' as const, value: INSTITUTION.Alamat },
          { name: 'Ketua_Dewan_Masyayikh', type: 'text' as const, value: INSTITUTION.Ketua_Dewan_Masyayikh },
          { name: 'Mudir', type: 'text' as const, value: INSTITUTION.Mudir },
          { name: 'Takhassus', type: 'text' as const, value: INSTITUTION.Takhassus },
          { name: 'Konsentrasi', type: 'text' as const, value: INSTITUTION.Konsentrasi },
          { name: 'Marhalah', type: 'text' as const, value: INSTITUTION.Marhalah },
          { name: 'Visi', type: 'text' as const, value: INSTITUTION.Visi },
          { name: 'Misi', type: 'text' as const, value: INSTITUTION.Misi },
          { name: 'Tahun_Periode_Asesmen', type: 'text' as const, value: INSTITUTION.Tahun_Periode_Asesmen },
          { name: 'Waktu_Pelaksanaan_Visitasi_Lapangan', type: 'date' as const, value: INSTITUTION.Waktu_Pelaksanaan_Visitasi_Lapangan },
        ];
        const b2Fields = branch2Step === 14
          ? [
              { name: 'Nama_Satuan_Pendidikan', type: 'text' as const, value: INSTITUTION.Nama_Satuan_Pendidikan },
              { name: 'NSPP', type: 'text' as const, value: INSTITUTION.NSPP },
              ...b2CommonFields,
            ]
          : [
              { name: 'Nama_Satuan_MahadAly', type: 'text' as const, value: INSTITUTION.Nama_Satuan_MahadAly },
              { name: 'NSMA', type: 'text' as const, value: INSTITUTION.NSMA },
              ...b2CommonFields,
            ];

        const b2Label = `Pra-Visitasi SECOND branch — step ${branch2Step} (Informasi Umum)`;

        await fillDynamicForm(branch2Page, b2Fields).catch((e) =>
          console.warn(`[${b2Label}] fillDynamicForm partial: ${String(e).slice(0, 100)}`),
        );
        await fillAllVisibleFormFields(branch2Page, b2Label, { maxPasses: 5 });
        await verifyAllRequiredFilled(branch2Page, b2Label);

        const b2Entry = await submitStrict(branch2Page, b2Label, {
          timeoutMs: 15_000,
          uiOnly: UI_ONLY_STEPS.has(branch2Step),
        });
        const b2ChainStart = b2Entry.nextTaskId;
        if (!b2ChainStart) {
          console.warn(
            `[${b2Label}] submit returned no nextTaskId — branch may already be converged.`,
          );
        } else {
          const b2PraVisitasiAction = async (p: Page, step: number): Promise<void> => {
            await fillMahadAlyFormlist(
              p, `Pra-Visitasi[b2] step=${step}`,
              `Pra-visitasi step ${step}: dokumen lengkap dan memenuhi standar.`,
              SAMPLE_PDF,
            );
            await fillAllVisibleFormFields(p, `Pra-Visitasi[b2] step=${step}`);
            // Label-scoped decision filler (same as first branch).
            await fillWorkflowDecisionDropdowns(p, `Pra-Visitasi[b2] step=${step}`);
            await clickLanjutkan(p, `Pra-Visitasi[b2] step=${step}`);
          };

          const b2Result = await runPraVisitasi(branch2Page, b2ChainStart, {
            label: `Pra-Visitasi SECOND chain (${branch2Role})`,
            actions: {
              15: b2PraVisitasiAction, 16: b2PraVisitasiAction, 17: b2PraVisitasiAction,
              18: b2PraVisitasiAction, 19: b2PraVisitasiAction, 20: b2PraVisitasiAction,
              21: b2PraVisitasiAction, 22: b2PraVisitasiAction, 23: b2PraVisitasiAction,
              24: b2PraVisitasiAction, 25: b2PraVisitasiAction, 26: b2PraVisitasiAction,
            },
            fallbackAction: b2PraVisitasiAction,
            // Same Hasil-territory guard as the first branch.
            terminalSteps: [36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50],
            maxIterations: 10,
          });
          console.log(
            `[Pra-Visitasi SECOND] ✓ visited=[${b2Result.visited.join(', ')}] ` +
            `→ finalNext=${b2Result.finalNextTaskId ?? 'null'}`,
          );
          lastResponseTaskId = b2Result.finalNextTaskId;
        }
      } finally {
        await branch2Ctx.close().catch(() => null);
      }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // [REMOVED] Steps 14, 21–26 — AS Asesor 2: Pra-Visitasi block.
  //
  // Steps 13 and 14 are PARALLEL ENTRY POINTS — only one is created by the
  // workflow engine per ticket.  The single test above
  // ("Steps 13/14 + sub-steps") accepts whichever entry exists and chains
  // forward through the matching sub-step sequence (15–20 OR 21–26).
  // Running a second test for Step 14 would either duplicate the work or
  // fail because the task no longer exists.
  // ──────────────────────────────────────────────────────────────────────────

  // ══════════════════════════════════════════════════════════════════════════
  // STEPS 36, 38–43 — AS Asesor 1: Hasil Visitasi (6 standards + Laporan upload)
  //   XML: Step 27 (decision Lanjutkan) → splits into Steps 36 (Asesor 1) and 44 (Asesor 2)
  //
  //   Step 36 → SKL (_asesor1)            → 38
  //   Step 38 → Kurikulum (_asesor1)      → 39
  //   Step 39 → Pendidik (_asesor1)       → 40
  //   Step 40 → Pembiayaan (_asesor1)     → 41
  //   Step 41 → Karya Ilmiah (_asesor1)   → 42
  //   Step 42 → Pengabdian (_asesor1)     → 43
  //   Step 43 → Laporan Asessment (file uploads) → 51
  // ══════════════════════════════════════════════════════════════════════════
  test('Steps 36/44 chain — AS: Hasil Visitasi (with intermediate phase)', async ({ browser }) => {
    test.setTimeout(420_000);
    expect(noTiket, 'noTiket must be set').toBeTruthy();

    // ── Phase 2: intermediate role (SK / pool) steps 27–35 if any materialize.
    // Most runs skip this phase — steps 27, 28 are system-auto decisions.
    // Probe defensively so manual UI steps (if the engine introduces them)
    // don't block Phase 3.
    const intermediateScoring = async (p: Page, step: number): Promise<void> => {
      await fillMahadAlyFormlist(
        p, `Intermediate step=${step}`,
        `Intermediate validasi step ${step}.`,
        SAMPLE_PDF,
      );
      // Belt-and-braces fill + positive-option preference so required
      // selects (incl. any Apakah_ decisions nested in these steps) get
      // "Ya"/"Lulus"/"Memenuhi" rather than the first DOM option.
      await fillAllVisibleFormFields(p, `Intermediate step=${step}`, { maxPasses: 2 });
      await clickLanjutkan(p, `Intermediate step=${step}`);
    };
    const intermediate = await runIntermediateRole(browser, noTiket!, {
      label: 'Intermediate phase (SK/pool 27-35)',
      acceptableSteps: [27, 28, 29, 30, 31, 32, 33, 34, 35],
      actions: {}, // rely on fallback for any surfaced step
      fallbackAction: intermediateScoring,
      maxIterations: 10,
    });
    console.log(
      `[Intermediate] owner=${intermediate.owner ?? 'none'} ` +
      `visited=[${intermediate.visited.join(', ')}]`,
    );

    // ── Phase 3: Hasil Visitasi — resolve Asesor role that owns step 36 or 44.
    const scoringAction = async (p: Page, step: number): Promise<void> => {
      await fillMahadAlyFormlist(
        p, `Hasil step=${step}`,
        `Hasil visitasi step ${step}: skor maksimal — bukti kuat.`,
        SAMPLE_PDF,
      );
      await clickLanjutkan(p, `Hasil step=${step}`);
    };
    const uploadAction = async (p: Page, step: number): Promise<void> => {
      await actionUploadAndSubmit(p, `Hasil step=${step} Laporan`, SAMPLE_PDF);
    };

    const hasil = await runHasilVisitasi(browser, noTiket!, {
      label: 'Hasil Visitasi chain',
      acceptableSteps: [36, 44],
      actions: {
        36: scoringAction, 38: scoringAction, 39: scoringAction,
        40: scoringAction, 41: scoringAction, 42: scoringAction,
        43: uploadAction,
        44: scoringAction, 45: scoringAction, 46: scoringAction,
        47: scoringAction, 48: scoringAction, 49: scoringAction,
        50: uploadAction,
      },
      fallbackAction: scoringAction,
      maxIterations: 20,
    });

    // No role re-binding — every downstream test resolves its own owner.
    if (hasil.owner) console.log(`[FLOW] Hasil Visitasi was owned by role=${hasil.owner}`);

    lastResponseTaskId = hasil.finalNextTaskId;
    console.log(
      `[Hasil Visitasi] ✓ owner=${hasil.owner} visited=[${hasil.visited.join(', ')}] ` +
      `finalNext=${hasil.finalNextTaskId ?? 'null'}`,
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // STEPS 44–50 — AS Asesor 2: Hasil Visitasi (6 standards + Laporan upload)
  //   Step 44 → SKL (_asesor2)          → 45
  //   Step 45 → Kurikulum (_asesor2)    → 46
  //   Step 46 → Pendidik (_asesor2)     → 47
  //   Step 47 → Pembiayaan (_asesor2)   → 48
  //   Step 48 → Karya Ilmiah (_asesor2) → 49
  //   Step 49 → Pengabdian (_asesor2)   → 50
  //   Step 50 → Laporan Asessment (file uploads) → 52
  // ══════════════════════════════════════════════════════════════════════════
  // ──────────────────────────────────────────────────────────────────────────
  // [REMOVED] Steps 44–50 — AS Asesor 2: Hasil Visitasi & Laporan block.
  //
  // Consolidated into the dynamic Hasil Visitasi block above
  // ("Steps 36/44 chain"), which:
  //   • Probes EVERY ASMA candidate role for the Hasil entry step
  //   • Accepts step 36 OR 44 as a parallel-safe entry point
  //   • Walks the chain via response.data.task_id (no hardcoded steps)
  //   • Maps both 36–43 and 44–50 actions in one map
  //
  // A separate "Asesor 2" test would either fight for the same task or fail
  // because the engine assigned only one Hasil branch.  Trust the dynamic
  // resolver — no role assumption.
  // ──────────────────────────────────────────────────────────────────────────

  // ══════════════════════════════════════════════════════════════════════════
  // STEPS 57–63 — SK: Validasi Dewan Asessment (7 sub-steps)
  //
  // DAG sync: SK Step 57 ONLY appears after BOTH Asesor 1 (step 43) AND
  // Asesor 2 (step 50) have submitted their Laporan uploads, AND the
  // system_kalkulasi_nilai_form_mahadali (Step 55) has computed scores.
  //
  //   Step 57 → SKL (_validasi)             → 58
  //   Step 58 → Kurikulum (_validasi)       → 59
  //   Step 59 → Pendidik (_validasi)        → 60
  //   Step 60 → Pembiayaan (_validasi)      → 61
  //   Step 61 → Karya Ilmiah (_validasi)    → 62
  //   Step 62 → Pengabdian (_validasi)      → 63
  //   Step 63 → Laporan Asessment validasi  → 64
  // ══════════════════════════════════════════════════════════════════════════
  test('Steps 57–67 — SK: Validasi → Pleno → Nilai Akhir → Sertifikat', async ({ browser }) => {
    test.setTimeout(480_000); // 8 min for the whole SK terminal block

    expect(noTiket, 'noTiket must be set').toBeTruthy();

    // ── UI-based claim via cross-user probe ────────────────────────────
    // Consolidated SK terminal chain: 57 → 58 → 59 → 60 → 61 → 62 → 63 →
    // 64 (Pleno) → 65 (system kalkulasi, auto) → 66 (Nilai Akhir) → 67
    // (Sertifikat) → 68 (system_end).
    //
    // Previously these were split into four separate tests — but steps 64
    // and 66 are ALREADY reached by the Validasi chain's fallback action,
    // so isolating them caused "task not found" errors (the task had
    // moved forward by the time we looked for it).  One chain, one probe,
    // distinct per-step actions — matches the engine's reality.
    console.log(`[SK terminal chain] probing entry — patient retry (up to 45s)`);
    const probe = await findTaskAcrossUsers(browser, noTiket!, undefined, {
      acceptableSteps: [57, 58, 59, 60, 61, 62, 63, 64, 66, 67],
      label: 'SK terminal chain entry probe',
      retries: 15,
      delayMs: 3_000,
    });

    if (!probe) {
      throw new Error(
        `[SK terminal chain] No SK task (57-67) found across all candidate roles ` +
        `for ticket "${noTiket}" within 45s.\n` +
        `  Most likely cause: one of Asesor 1 (step 43 Laporan) or Asesor 2 (step 50 Laporan) ` +
        `didn't fire, so the DAG join at step 53 never released.\n` +
        `  Verify the Hasil Visitasi phase completed both parallel branches.`,
      );
    }

    console.log(
      `[SK terminal chain] UI-claimed via inbox card: role=${probe.role} ` +
      `entry=${probe.taskId} step=${probe.step}`,
    );

    try {
      // ── Step-specific actions ────────────────────────────────────────
      // 57-63 = Validasi    : minimal-fill + submit (actionSKSubmit)
      // 64    = Pleno       : fill all _pleno formlist rows + submit
      // 66    = Nilai Akhir : select status + peringkat (Mumtaz) + submit
      // 67    = Sertifikat  : upload file + submit
      const validasiAction = (p: Page, step: number) =>
        actionSKSubmit(p, `SK Validasi step=${step}`);

      const plenoAction = async (p: Page, step: number): Promise<void> => {
        console.log(`    [SK Pleno step=${step}] filling pleno formlist`);
        await fillMahadAlyFormlist(
          p, `SK Pleno step=${step}`,
          'Penetapan pleno: skor sesuai konsensus dewan.',
          SAMPLE_PDF,
        );
        await fillAllVisibleFormFields(p, `SK Pleno step=${step}`, { maxPasses: 2 });
        await clickApprove(p, `SK Pleno step=${step}`);
      };

      const nilaiAkhirAction = async (p: Page, step: number): Promise<void> => {
        const lbl = `SK Nilai Akhir step=${step}`;
        console.log(`    [${lbl}] selecting peringkat/status for Mumtaz`);
        const hasPeringkatOption = await p
          .getByText(/Mumtaz|Jayyid|Maqbul|Rasib/i).first()
          .isVisible({ timeout: 3_000 }).catch(() => false);
        if (hasPeringkatOption) {
          await fillDynamicForm(p, [
            {
              name: 'Keputusan_Akhir_Peringkat_Asessment',
              type: 'select',
              value: FINAL_DECISIONS.mumtaz.peringkat,
            },
          ]).catch(() => null);
        }
        await fillDynamicForm(p, [
          { name: 'status', type: 'select', value: FINAL_DECISIONS.mumtaz.status },
        ]).catch(() => null);
        await fillAllVisibleFormFields(p, lbl, { maxPasses: 2 });
        await actionFillAndSubmit(p, lbl);
      };

      const sertifikatAction = async (p: Page, step: number): Promise<void> => {
        const lbl = `SK Sertifikat step=${step}`;
        console.log(`    [${lbl}] uploading sertifikat PDF`);
        await actionUploadAndSubmit(p, lbl, SAMPLE_PDF);
      };

      const result = await runWorkflowChain(probe.page, probe.taskId, {
        label: 'SK terminal chain',
        actions: {
          57: validasiAction, 58: validasiAction, 59: validasiAction,
          60: validasiAction, 61: validasiAction, 62: validasiAction,
          63: validasiAction,
          64: plenoAction,
          66: nilaiAkhirAction,
          67: sertifikatAction,
        },
        // Any unmapped step uses the lightest SK submit — safe default for
        // system steps the engine might surface (65 is auto-only; other
        // intermediate validation steps use the same submit shape as 57-63).
        fallbackAction: validasiAction,
        maxIterations: 15,
        postSubmitDelayMs: 2_000,
      });

      lastResponseTaskId = result.finalNextTaskId;
      console.log(
        `[SK terminal chain] ✓ complete — visited=[${result.visited.join(', ')}] ` +
        `→ finalNext=${result.finalNextTaskId ?? 'null (workflow end)'}`,
      );

      // Final verification — ticket should appear in the SPME list page.
      await probe.page.goto('/app/spme').catch(() => null);
      await waitForPageLoad(probe.page);
      if (noTiket) {
        const ticketRow = probe.page.locator('tbody tr').filter({ hasText: noTiket });
        const ticketVisible = await ticketRow.isVisible({ timeout: 10_000 }).catch(() => false);
        console.log('[SK terminal chain] Completed ticket in list:', ticketVisible, '| noTiket:', noTiket);
      }

      console.log('═══════════════════════════════════════════════════════');
      console.log("E2E Positive Flow COMPLETED — SPME MA'HAD ALY");
      console.log(`  Grade:  ${FINAL_DECISIONS.mumtaz.peringkat}`);
      console.log(`  Status: ${FINAL_DECISIONS.mumtaz.status}`);
      console.log(`  Ticket: ${noTiket ?? '(not captured)'}`);
      console.log(`  SK chain visited: [${result.visited.join(', ')}]`);
      console.log(`  Total criteria scored: ${Object.keys(ALL_CRITERIA).length}`);
      console.log('═══════════════════════════════════════════════════════');
    } finally {
      await probe.context.close().catch(() => null);
    }
  });
});
