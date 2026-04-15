import type { Page, Locator } from '@playwright/test';
import { waitForTableLoad, waitForPageLoad } from '../helpers/wait.helpers';

/**
 * RecommendationPage — /app/recommendation
 *
 * The recommendation module is the primary workflow entry point for the DM role.
 * Selector sources:
 *   - searchInput:       input[placeholder="Search..."]
 *   - createButton:      Button title="Buat Pengajuan Baru" (visible for DM role)
 */
export class RecommendationPage {
  readonly searchInput: Locator;
  readonly createButton: Locator;

  constructor(readonly page: Page) {
    this.searchInput = page.locator('input[placeholder="Search..."]');
    this.createButton = page.getByRole('button', { name: 'Buat Pengajuan Baru' });
  }

  async goto() {
    await this.page.goto('/app/recommendation');
    await waitForPageLoad(this.page);
    await waitForTableLoad(this.page);
  }

  async clickCreateNew() {
    await this.createButton.click();
    await waitForPageLoad(this.page);
  }

  /** Get all task rows in the table */
  getRows(): Locator {
    return this.page.locator('tbody tr');
  }

  /** Find a row by ticket number or process title */
  getRowByText(text: string): Locator {
    return this.page.locator('tbody tr').filter({ hasText: text });
  }

  /** Click the action/detail button for a specific row */
  async openTask(rowLocator: Locator) {
    // Recommendation table typically has a clickable row or "Lihat" button
    await rowLocator.locator('button').first().click();
    await waitForPageLoad(this.page);
  }
}
