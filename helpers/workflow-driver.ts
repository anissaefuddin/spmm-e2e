/**
 * workflow-driver.ts
 *
 * Reusable primitives for driving serial E2E tests over dynamic workflows
 * (SPME DIKDASMEN, SPME MA'HAD ALY, and any future XML-driven process).
 *
 * Four exports:
 *   1. createSessionManager(browser)       — per-role context cache + 401 auto-refresh
 *   2. safeRequest(page, role, mgr, fn)    — transparent 401 → relogin → retry once
 *   3. runWorkflowStep(opts)               — action + response capture + next-task discovery
 *   4. openTaskSmart(page, taskId, label)  — direct-URL / pool-claim / inbox fallback
 *
 * Design rules:
 *   • NEVER set cookie / Authorization headers manually — always use the
 *     BrowserContext, which Playwright populates from storageState.
 *   • NEVER hardcode step numbers for navigation; trust response.data.task_id.
 *   • Any 401 bubbles up to the session manager, which discards the cached
 *     storageState and performs a fresh API login before retrying once.
 *   • All retries expose retries/delayMs knobs so the caller can tune.
 */

import type {
  APIResponse,
  Browser,
  BrowserContext,
  Page,
} from '@playwright/test';
import fs from 'fs';
import { loginAs, getStorageStatePath } from './login.helpers';
import { waitForPageLoad } from './wait.helpers';
import type { RoleKey } from '../test-data/users';

// ─────────────────────────────────────────────────────────────────────────────
// Shared API origin
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = process.env.API_BASE_URL || 'http://localhost:1235/api';
export const apiUrl = (path: string): string =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Session Manager
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionManager {
  /** Get (or create) a persistent page for the role.  Safe to call repeatedly. */
  getPage(role: RoleKey): Promise<Page>;
  /** Force a fresh login (clears cached storageState).  Returns a new page. */
  refresh(role: RoleKey): Promise<Page>;
  /** Close every managed context. Call in afterAll. */
  closeAll(): Promise<void>;
  /** Inspect currently-cached roles. */
  roles(): RoleKey[];
}

/**
 * Create a session manager bound to a Playwright Browser.
 *
 * Internally caches one BrowserContext + one Page per role.  On 401 (or
 * manual refresh()), the cached storageState JSON is removed and a fresh
 * loginAs() is invoked — so subsequent calls get a brand new JWT.
 */
export function createSessionManager(browser: Browser): SessionManager {
  const contexts = new Map<RoleKey, BrowserContext>();
  const pages = new Map<RoleKey, Page>();

  async function ensureContext(role: RoleKey): Promise<BrowserContext> {
    const existing = contexts.get(role);
    if (existing) return existing;
    // loginAs already probes /user/detail-me and re-authenticates on 401 —
    // we never touch cookie headers manually.
    const ctx = await loginAs(role, browser);
    contexts.set(role, ctx);
    return ctx;
  }

  async function getPage(role: RoleKey): Promise<Page> {
    const cached = pages.get(role);
    if (cached && !cached.isClosed()) return cached;

    const ctx = await ensureContext(role);
    const page = await ctx.newPage();
    pages.set(role, page);
    console.log(`[SESSION] login user=${role}`);
    return page;
  }

  async function refresh(role: RoleKey): Promise<Page> {
    console.warn(`[SESSION] refresh user=${role} — discarding cached auth`);

    // Discard cached storageState file so loginAs() re-authenticates via API.
    const stateFile = getStorageStatePath(role);
    try { fs.unlinkSync(stateFile); } catch { /* may not exist */ }

    // Close the old page/context so nothing lingers.
    const oldPage = pages.get(role);
    if (oldPage && !oldPage.isClosed()) await oldPage.close().catch(() => null);
    pages.delete(role);

    const oldCtx = contexts.get(role);
    if (oldCtx) await oldCtx.close().catch(() => null);
    contexts.delete(role);

    return getPage(role);
  }

  async function closeAll(): Promise<void> {
    for (const [, ctx] of contexts) {
      await ctx.close().catch(() => null);
    }
    contexts.clear();
    pages.clear();
  }

  return {
    getPage,
    refresh,
    closeAll,
    roles: () => [...contexts.keys()],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Safe API Request Wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Playwright APIRequest; if the response is 401, refresh the
 * session for `role` and retry ONCE with the fresh page.
 *
 * Usage:
 *   const resp = await safeRequest(page, 'sk', mgr, (p) =>
 *     p.request.post(apiUrl('/mytodolist'), { data: {...} })
 *   );
 *
 * Notes:
 *   • NEVER passes raw cookies / Authorization headers — the page's context
 *     already carries auth cookies.
 *   • Caller MUST use the returned page-bound response; if a retry happened,
 *     the request ran on a fresh page (cookies auto-set by storageState).
 */
export async function safeRequest(
  page: Page,
  role: RoleKey,
  mgr: SessionManager,
  fn: (p: Page) => Promise<APIResponse>,
  { retries = 1 }: { retries?: number } = {},
): Promise<APIResponse> {
  let resp = await fn(page);

  for (let i = 0; i < retries; i++) {
    if (resp.status() !== 401) return resp;
    console.warn(`[safeRequest] 401 for role=${role} — refreshing session & retrying (${i + 1}/${retries})`);
    const fresh = await mgr.refresh(role);
    resp = await fn(fresh);
  }
  return resp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Todo-list fetch (single place that reads identity from cookies)
// ─────────────────────────────────────────────────────────────────────────────

interface RawTask {
  task_id?: string;
  id?: string;
  task_name?: string;
  name?: string;
  no_tiket?: string;
  ticket_no?: string;
  process_instance_id?: string;
  role_code?: string;
  role?: string;
}

export interface TaskInfo {
  task_id: string;
  task_name: string;
  no_tiket: string;
  process_instance_id: string;
  role_code: string;
}

function normalizeTask(t: RawTask): TaskInfo {
  return {
    task_id: String(t.task_id ?? t.id ?? ''),
    task_name: String(t.task_name ?? t.name ?? ''),
    no_tiket: String(t.no_tiket ?? t.ticket_no ?? ''),
    process_instance_id: String(t.process_instance_id ?? ''),
    role_code: String(t.role_code ?? t.role ?? ''),
  };
}

/**
 * Read the user's identity from the `detailUser` cookie.
 *
 * We DO NOT construct a manual Authorization header — the page's BrowserContext
 * carries the `token` cookie and the SPA / tests both let axios / the request
 * API pull it automatically.  This function only extracts the `username`,
 * `role`, `lembaga` that the /mytodolist endpoint expects in the JSON body.
 */
async function readIdentityFromCookies(page: Page): Promise<{
  username: string;
  role: string;
  lembaga: string | null;
}> {
  const cookies = await page.context().cookies();
  const detail = cookies.find((c) => c.name === 'detailUser');
  if (!detail?.value) return { username: '', role: '', lembaga: null };

  const raw = detail.value;
  const parsed: {
    fullname?: string;
    lembaga?: string | null;
    roles?: { role_code?: string }[];
  } = (() => {
    try { return JSON.parse(decodeURIComponent(raw)); }
    catch { try { return JSON.parse(raw); } catch { return {}; } }
  })();

  return {
    username: parsed.fullname ?? '',
    role: parsed.roles?.[0]?.role_code ?? '',
    lembaga: parsed.lembaga ?? null,
  };
}

/**
 * Fetch the current user's pending tasks via /mytodolist — uses the
 * BrowserContext for auth (never a manual header).  401-safe via safeRequest.
 */
export async function getPendingTasks(
  page: Page,
  role: RoleKey,
  mgr: SessionManager,
  workflow: string,
): Promise<TaskInfo[]> {
  const identity = await readIdentityFromCookies(page);

  const resp = await safeRequest(page, role, mgr, (p) =>
    p.request.post(apiUrl('/mytodolist'), {
      data: {
        role: identity.role,
        username: identity.username,
        lembaga: identity.lembaga,
        workflow,
        status: ['Selesai', 'Sedang Diproses'],
      },
    }),
  );

  if (!resp.ok()) return [];
  const body = await resp.json().catch(() => ({ data: [] })) as { data?: unknown[] };
  const list = Array.isArray(body?.data) ? body.data as RawTask[] : [];
  return list.map(normalizeTask);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Smart Task Opening
// ─────────────────────────────────────────────────────────────────────────────

async function isPageEditable(page: Page): Promise<boolean> {
  if (page.isClosed()) return false;
  const btn = page.getByRole('button', {
    name: /Simpan|Selesai|Lanjutkan|Kirim/i,
  }).first();
  return btn.isVisible({ timeout: 2_000 }).catch(() => false);
}

/**
 * Open a task with a four-tier strategy:
 *   1. Direct URL navigation  (fastest; works if user already owns the task)
 *   2. Pool-claim button      ("Ambil Tugas" / "Ambil" / "Claim" / "Klaim")
 *   3. Inbox card click       (fallback for cards without direct URL parity)
 *   4. Hard error             (with diagnostic dump — last resort)
 *
 * Post-condition: page is editable (at least one Simpan/Lanjutkan/Kirim
 * button visible).  Throws otherwise.
 */
export async function openTaskSmart(
  page: Page,
  taskId: string,
  label: string,
): Promise<void> {
  console.log(`[FLOW] openTaskSmart task=${taskId} (${label})`);

  // ── 1. Direct URL ────────────────────────────────────────────────────
  const choosetaskPromise = page
    .waitForResponse((r) => r.url().includes('/choosetask'), { timeout: 12_000 })
    .catch(() => null);
  await page.goto(`/app/spme/submission/${taskId}`);
  await waitForPageLoad(page);
  await choosetaskPromise;
  await page.waitForTimeout(600);

  if (!page.url().includes(taskId)) {
    console.warn(`    [openTaskSmart] direct-nav redirect: ${page.url()}`);
  }
  if (await isPageEditable(page)) {
    console.log(`    [openTaskSmart] ✓ direct-nav → editable`);
    return;
  }

  // ── 2. Pool-claim button ────────────────────────────────────────────
  const claimBtn = page.getByRole('button', {
    name: /Ambil\s*Tugas|^Ambil$|^Claim$|^Klaim$/i,
  }).first();

  if (await claimBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const text = (await claimBtn.textContent() ?? '').trim();
    console.log(`    [openTaskSmart] pool task — clicking "${text}"`);
    await claimBtn.click().catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
    await page.waitForTimeout(1_000);

    if (await isPageEditable(page)) {
      console.log(`    [openTaskSmart] ✓ pool-claim → editable`);
      return;
    }
  }

  // ── 3. Inbox card ───────────────────────────────────────────────────
  console.log(`    [openTaskSmart] falling back to inbox card`);
  await page.goto('/app/inbox');
  await waitForPageLoad(page);
  await page.waitForTimeout(1_000);

  let card = page.getByText(taskId).first();
  if (!await card.isVisible({ timeout: 3_000 }).catch(() => false)) {
    const ticket = taskId.split('-').slice(0, -1).join('-');
    const escaped = ticket.replace(/[-]/g, '\\-');
    card = page.getByText(new RegExp(`${escaped}(?!\\d)`)).first();
  }

  if (await card.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await card.click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(1_000);
    if (page.url().includes(taskId) && await isPageEditable(page)) {
      console.log(`    [openTaskSmart] ✓ inbox-card → editable`);
      return;
    }
  }

  // ── 4. Hard error ──────────────────────────────────────────────────
  const buttons = await page.locator('button:visible').allTextContents().catch(() => []);
  throw new Error(
    `[openTaskSmart] Failed to open task ${taskId} (${label}).\n` +
    `  URL: ${page.url()}\n` +
    `  Tried: direct URL, pool claim, inbox card.\n` +
    `  Visible buttons: [${buttons.map((t) => `"${t.trim()}"`).join(', ')}]`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task discovery (API + inbox DOM scrape)
// ─────────────────────────────────────────────────────────────────────────────

function getStepNumberFromTaskId(taskId: string): number {
  return Number(taskId.split('-').pop());
}

/**
 * Poll BOTH /mytodolist and the /app/inbox DOM until a task belonging to
 * `ticket` is visible to the current user.  Returns null (not throws) on
 * exhaustion so the caller can decide.
 *
 * stepHint is a soft tie-breaker when multiple tasks match; never a filter.
 */
export async function findTaskForRole(
  page: Page,
  role: RoleKey,
  mgr: SessionManager,
  ticket: string,
  {
    workflow,
    stepHint,
    retries = 15,
    delayMs = 2_000,
  }: {
    workflow: string;
    stepHint?: number;
    retries?: number;
    delayMs?: number;
  },
): Promise<string | null> {
  const pickBest = (ids: string[]): string => {
    if (ids.length === 1 || stepHint === undefined) return ids[0];
    return ids.reduce((best, cur) => {
      const db = Math.abs(getStepNumberFromTaskId(best) - stepHint);
      const dc = Math.abs(getStepNumberFromTaskId(cur) - stepHint);
      return dc < db ? cur : best;
    }, ids[0]);
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    // Source A — API
    const tasks = await getPendingTasks(page, role, mgr, workflow);
    const apiHits = tasks
      .filter((t) => t.task_id.startsWith(ticket + '-') || t.no_tiket === ticket)
      .map((t) => t.task_id);

    if (apiHits.length > 0) {
      const picked = pickBest(apiHits);
      console.log(`[RETRY] api-hit attempt=${attempt}/${retries} role=${role} → ${picked}`);
      return picked;
    }

    // Source B — inbox DOM scrape (force reload)
    try {
      await page.goto('/app/inbox', { waitUntil: 'domcontentloaded' });
      await waitForPageLoad(page);
      await page.waitForTimeout(500);
      const html = await page.content().catch(() => '');
      const re = new RegExp(`${ticket.replace(/[-]/g, '\\-')}-(\\d+)`, 'g');
      const ids = new Set<string>();
      for (const m of html.matchAll(re)) ids.add(m[0]);
      if (ids.size > 0) {
        const picked = pickBest([...ids]);
        console.log(`[RETRY] inbox-hit attempt=${attempt}/${retries} role=${role} → ${picked}`);
        return picked;
      }
    } catch (e) {
      console.warn(`[RETRY] inbox scrape error: ${String(e).slice(0, 80)}`);
    }

    console.log(`[RETRY] waiting task... attempt=${attempt}/${retries} role=${role} ticket=${ticket}`);
    if (attempt < retries) await page.waitForTimeout(delayMs);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Workflow Step Driver
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowStepOptions {
  sessionMgr: SessionManager;
  /** Role that owns this step */
  role: RoleKey;
  ticket: string;
  workflow: string;
  label: string;
  /** XML step number — soft hint, never a hard filter. */
  stepHint?: number;
  /**
   * Optional explicit task_id.  Prefer passing the task_id captured from
   * the PREVIOUS step's /responsetask response instead of computing one.
   */
  taskId?: string;
  /**
   * Perform the step's business action on the editable page.  Must leave
   * the page in a state where submit will fire /responsetask.  This driver
   * handles waitForResponse + capture; the action just needs to click the
   * correct button.
   */
  action: (page: Page) => Promise<void>;
  /** Retry budget when looking up the task.  Defaults: 15 × 2s = 30s. */
  retries?: number;
  delayMs?: number;
}

export interface WorkflowStepResult {
  /** The task_id we opened and acted on. */
  completedTaskId: string;
  /**
   * Backend's response.data.task_id.  Non-null when the next step belongs
   * to the SAME user; null when the next step is a different role.
   */
  nextTaskId: string | null;
  /** Full /responsetask body for further inspection if needed. */
  responseBody: Record<string, unknown> | null;
}

/**
 * Execute a single workflow step end-to-end.
 *
 *   1. Resolve task_id — caller-supplied OR queue lookup (15 × 2s default).
 *   2. Open via openTaskSmart (direct URL → pool claim → inbox).
 *   3. Wire a /responsetask listener and invoke the caller's action.
 *   4. Log + return the next task_id so the caller can chain without
 *      hardcoding any step number.
 *
 * The caller decides whether to reuse `nextTaskId` (same role) or perform
 * a role switch via sessionMgr.getPage(nextRole).
 */
export async function runWorkflowStep(opts: WorkflowStepOptions): Promise<WorkflowStepResult> {
  const {
    sessionMgr, role, ticket, workflow, label,
    stepHint, action,
    retries = 15, delayMs = 2_000,
  } = opts;

  const page = await sessionMgr.getPage(role);
  console.log(`[FLOW] ▶ ${label} | user=${role} ticket=${ticket} hint=${stepHint ?? '—'}`);

  // ── 1. Resolve task_id ──────────────────────────────────────────────
  let taskId = opts.taskId ?? null;
  if (!taskId) {
    taskId = await findTaskForRole(page, role, sessionMgr, ticket, {
      workflow, stepHint, retries, delayMs,
    });
  }
  if (!taskId) {
    throw new Error(
      `[FLOW] ${label}: no task for role=${role} on ticket "${ticket}" ` +
      `after ${retries}×${delayMs / 1_000}s. Is the previous step complete?`,
    );
  }
  console.log(`[FLOW] resolved task_id=${taskId}`);

  // ── 2. Open task ────────────────────────────────────────────────────
  await openTaskSmart(page, taskId, label);

  // ── 3. Action + response capture ────────────────────────────────────
  const respPromise = page
    .waitForResponse(
      (r) => r.url().includes('/responsetask') &&
             r.request().method() === 'POST',
      { timeout: 30_000 },
    )
    .catch(() => null);

  await action(page);
  const resp = await respPromise;

  let nextTaskId: string | null = null;
  let body: Record<string, unknown> | null = null;

  if (resp) {
    body = await resp.json().catch(() => null) as Record<string, unknown> | null;
    const status = resp.status();
    const data = body?.data as Record<string, unknown> | undefined;
    console.log(`[FLOW] responsetask HTTP ${status} | next_task_id=${data?.task_id ?? 'null'}`);

    if (status !== 200) {
      throw new Error(`[FLOW] ${label} responsetask returned ${status}: ${JSON.stringify(body)?.slice(0, 200)}`);
    }
    if (typeof data?.task_id === 'string' && data.task_id.length > 0) {
      nextTaskId = data.task_id;
    }
  } else {
    console.warn(`[FLOW] ${label}: no /responsetask captured — may be a system step`);
  }

  console.log(`[FLOW] ✓ ${label} | next=${nextTaskId ?? '(role boundary — use findTaskForRole next)'}`);
  return { completedTaskId: taskId, nextTaskId, responseBody: body };
}
