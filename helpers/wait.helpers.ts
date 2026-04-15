import type { Page, Locator } from '@playwright/test';

/**
 * Wait for React Query table loading skeletons to disappear.
 *
 * The Table component renders SkeletonPlaceholder elements inside tbody cells
 * while `isLoading=true`. Once data arrives, real rows (or EmptyState) render.
 *
 * Strategy: poll DOM until no skeleton divs remain, then confirm at least one
 * real <tr> is present.
 */
export async function waitForTableLoad(page: Page): Promise<void> {
  // Skeleton rows have styled-components class containing "Skeleton"
  await page.waitForFunction(
    () => document.querySelectorAll('tbody td div[class*="Skeleton"]').length === 0,
    { timeout: 15_000 },
  );
  // Confirm real rows (data or empty-state row) are in the DOM
  await page.waitForSelector('tbody tr', { timeout: 10_000 });
}

/**
 * Wait for React 18 Suspense/lazy chunk loading to finish.
 *
 * BaseRouter wraps all routes in <Suspense fallback={<LoadingSpinner />}>.
 * On first navigation to a route, a code-split chunk loads, briefly showing
 * the spinner before the page renders.
 *
 * Strategy: networkidle covers the chunk fetch; then confirm no spinner remains.
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 });

  // Dismiss any visible loading spinner (styled-components class)
  const spinner = page.locator('[class*="Spinner"], [class*="Loading"]').first();
  const spinnerVisible = await spinner.isVisible({ timeout: 500 }).catch(() => false);
  if (spinnerVisible) {
    await spinner.waitFor({ state: 'hidden', timeout: 15_000 });
  }
}

/**
 * Wait for a React Query mutation button to finish its loading state.
 *
 * The Button component renders "Loading..." text while `isLoading=true`.
 * This prevents premature assertions after clicking submit.
 */
export async function waitForButtonNotLoading(button: Locator): Promise<void> {
  await button.waitFor({ state: 'visible' });
  const handle = await button.elementHandle();
  if (!handle) return;
  await button.page().waitForFunction(
    (el: Element) => !el.textContent?.includes('Loading...'),
    handle,
    { timeout: 15_000 },
  );
}

/**
 * Wait for a react-toastify toast notification to appear.
 *
 * react-toastify adds `.Toastify__toast--success` / `.Toastify__toast--error`
 * classes to the container div.
 */
export async function waitForToast(
  page: Page,
  type: 'success' | 'error' = 'success',
): Promise<Locator> {
  const selector = `.Toastify__toast--${type}`;
  await page.waitForSelector(selector, { timeout: 10_000 });
  return page.locator(selector).first();
}

/**
 * Wait for a specific API response to complete.
 *
 * Useful when the UI navigation depends on an API response (e.g., after
 * startProcess the app navigates to the new task).
 */
export async function waitForApiResponse(
  page: Page,
  urlPattern: string | RegExp,
  expectedStatus = 200,
): Promise<ReturnType<Page['waitForResponse']>> {
  return page.waitForResponse(
    (response) => {
      const urlMatch =
        typeof urlPattern === 'string'
          ? response.url().includes(urlPattern)
          : urlPattern.test(response.url());
      return urlMatch && response.status() === expectedStatus;
    },
    { timeout: 20_000 },
  );
}

/**
 * Wait for modal dialog to be visible by its heading text.
 */
export async function waitForModal(page: Page, headingText: string): Promise<Locator> {
  const modal = page.locator('[role="dialog"]').filter({ hasText: headingText });
  await modal.waitFor({ state: 'visible', timeout: 10_000 });
  return modal;
}
