/**
 * Shared workflow test utilities.
 *
 * All workflow modules in SPMM follow the same BPM sequence:
 *   1. POST /api/checkprocesstostart  → verify eligibility
 *   2. POST /api/startProcess         → create process instance
 *   3. POST /api/choosetask           → get dynamic form schema
 *   4. POST /api/responsetask         → submit completed form
 *   5. GET  /api/mytodolist           → verify next task
 *   6. GET  /api/logtask              → verify task history
 *
 * These helpers abstract the repetitive workflow step navigation
 * so individual workflow specs focus on business-specific assertions.
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { waitForPageLoad, waitForTableLoad, waitForApiResponse, waitForToast } from '../../helpers/wait.helpers';
import { fillDynamicForm, type FormFieldDef } from '../../helpers/form.helpers';
import { SubmissionPage } from '../../pages/SubmissionPage';

export interface WorkflowOptions {
  /** Route to the workflow list page (e.g., '/app/recommendation') */
  listRoute: string;
  /** Text of the "start new" button on the list page */
  createButtonText: string;
  /** Route for adding a new submission (e.g., '/app/recommendation/add-recommendation') */
  addRoute?: string;
  /** Fields to fill on the initial submission form */
  initialFields?: FormFieldDef[];
  /** Button text for submitting the initial form */
  submitButtonText?: string;
  /** URL pattern for the submission/:task_id route */
  submissionRoutePattern?: RegExp;
}

export interface WorkflowTask {
  taskId: string;
  taskTitle: string;
  decisionKeys: Record<string, string>;
  formSchema: Record<string, unknown>;
}

/**
 * Navigate to a workflow list and verify it loads without errors.
 */
export async function verifyWorkflowListLoads(page: Page, route: string): Promise<void> {
  await page.goto(route);
  await waitForPageLoad(page);
  await waitForTableLoad(page).catch(() => null); // Table may be empty
  await expect(page).not.toHaveURL(/.*login.*/);
}

/**
 * Start a new workflow process and navigate to the submission form.
 * Returns the task_id if navigation to the submission page succeeds.
 */
export async function startWorkflowProcess(
  page: Page,
  opts: WorkflowOptions,
): Promise<string | null> {
  // Navigate to the list page
  await page.goto(opts.listRoute);
  await waitForPageLoad(page);

  // Click the create/start button
  const createBtn = page.getByRole('button', { name: opts.createButtonText });
  await createBtn.waitFor({ state: 'visible', timeout: 10_000 });

  // Intercept checkprocesstostart to know if we can proceed
  const [checkResponse] = await Promise.all([
    page
      .waitForResponse(
        (r) => r.url().includes('/checkprocesstostart') && r.request().method() === 'POST',
        { timeout: 10_000 },
      )
      .catch(() => null),
    createBtn.click(),
  ]);

  if (checkResponse) {
    const body = await checkResponse.json().catch(() => null);
    if (body?.status !== 200 && body?.status !== 'OK') {
      console.warn('checkprocesstostart returned non-200:', body);
    }
  }

  await waitForPageLoad(page);

  // If navigated to add page, fill and submit
  const onAddPage = opts.addRoute
    ? page.url().includes(opts.addRoute.replace('/app', ''))
    : page.url().includes('/add');

  if (onAddPage && opts.initialFields && opts.initialFields.length > 0) {
    await fillDynamicForm(page, opts.initialFields);

    const submitBtn = opts.submitButtonText
      ? page.getByRole('button', { name: opts.submitButtonText })
      : page.getByRole('button', { name: /Kirim|Submit|Lanjutkan/ }).first();

    const [startResponse] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.url().includes('/startProcess') && r.request().method() === 'POST',
          { timeout: 20_000 },
        )
        .catch(() => null),
      submitBtn.click(),
    ]);

    if (startResponse) {
      const body = await startResponse.json().catch(() => null);
      console.log('startProcess response:', body?.status, body?.message);
    }
  }

  // Extract task_id from URL if we navigated to a submission page
  const urlMatch = page.url().match(/\/submission[-/][\w-]+\/([a-zA-Z0-9-]+)/);
  return urlMatch?.[1] ?? null;
}

/**
 * Open a task from the todo list and fill the dynamic form.
 */
export async function openAndFillTask(
  page: Page,
  taskId: string,
  submissionRoute: string,
  fields: FormFieldDef[],
  decision: 'approve' | 'reject' | 'save' = 'save',
): Promise<void> {
  await page.goto(`${submissionRoute}/${taskId}`);
  await waitForPageLoad(page);

  const submission = new SubmissionPage(page);

  // Wait for the form to be ready (dynamic form loads after choosetask API)
  await page.waitForResponse(
    (r) => r.url().includes('/choosetask'),
    { timeout: 15_000 },
  ).catch(() => null);

  await page.waitForTimeout(1_000); // Allow React to render

  if (fields.length > 0) {
    await fillDynamicForm(page, fields);
  }

  switch (decision) {
    case 'approve':
      await submission.approve();
      break;
    case 'reject':
      await submission.reject();
      break;
    case 'save':
    default:
      await submission.save().catch(() => submission.submit());
  }
}

/**
 * Verify a task appears in the todo list.
 */
export async function verifyTaskInTodoList(page: Page, taskId: string): Promise<void> {
  // Call mytodolist API to check
  const response = await page.evaluate(async (id) => {
    const r = await fetch('/api/mytodolist', { method: 'GET', credentials: 'include' });
    const data = await r.json();
    return data?.data?.some((t: { task_id?: string; id?: string }) => t.task_id === id || t.id === id);
  }, taskId);

  expect(response).toBe(true);
}
