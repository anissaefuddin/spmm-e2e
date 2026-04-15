import type { Page, Locator } from '@playwright/test';
import { waitForTableLoad, waitForPageLoad } from '../helpers/wait.helpers';

/**
 * UserManagementPage — /app/user-management
 *
 * Selector sources:
 *   - searchInput:         input[placeholder="Search..."] from UserManagementScreen
 *   - createAccountButton: Button with title="Buat Akun Baru"
 *   - table rows:          tbody > tr (real rows after React Query load)
 *   - action dropdown:     the last <button> in a row opens the dropdown
 *   - action items:        text within the dropdown menu
 */
export class UserManagementPage {
  readonly searchInput: Locator;
  readonly createAccountButton: Locator;

  constructor(readonly page: Page) {
    this.searchInput = page.locator('input[placeholder="Search..."]');
    this.createAccountButton = page.getByRole('button', { name: 'Buat Akun Baru' });
  }

  async goto() {
    await this.page.goto('/app/user-management');
    await waitForPageLoad(this.page);
    await waitForTableLoad(this.page);
  }

  async search(query: string) {
    await this.searchInput.fill(query);
    // Debounce: wait for the filter to propagate (React state update + API call)
    await this.page.waitForTimeout(600);
    await waitForTableLoad(this.page);
  }

  async clearSearch() {
    await this.searchInput.clear();
    await this.page.waitForTimeout(600);
    await waitForTableLoad(this.page);
  }

  /** Get the table row that contains the given text (e.g., user's full name) */
  getRowByText(text: string): Locator {
    return this.page.locator('tbody tr').filter({ hasText: text });
  }

  /** Open the three-dots action dropdown for a given row */
  async openActionMenu(rowLocator: Locator) {
    // The action column renders a dropdown trigger button — it's the last button in the row
    await rowLocator.locator('button').last().click();
    // Wait for the dropdown to appear
    await this.page.waitForSelector('[role="menu"], [class*="Dropdown"]', { timeout: 5_000 });
  }

  /** Click a specific action in the dropdown (e.g., "Ubah Akun", "Non Aktifkan Akun") */
  async clickAction(rowLocator: Locator, actionLabel: string) {
    await this.openActionMenu(rowLocator);
    await this.page.getByText(actionLabel, { exact: true }).click();
  }

  async clickCreateNewAccount() {
    await this.createAccountButton.click();
    await waitForPageLoad(this.page);
  }

  /** Get the status text from a row */
  async getRowStatus(rowLocator: Locator): Promise<string> {
    // Status cell uses TextStatus styled-component; get its text content
    const statusCell = rowLocator.locator('td').nth(3);
    return (await statusCell.textContent()) ?? '';
  }
}
