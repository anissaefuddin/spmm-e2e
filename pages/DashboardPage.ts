import type { Page, Locator } from '@playwright/test';
import { waitForPageLoad } from '../helpers/wait.helpers';

/**
 * DashboardPage — /app/
 *
 * Dashboard.tsx renders role-specific widgets:
 *   - TicketWidget       → all roles
 *   - ChartWidget        → non-DM roles
 *   - StatistikWidget    → non-DM roles
 *   - AnnouncementBanner → admin/non-DM roles
 *   - Profile + Banner   → DM role only
 */
export class DashboardPage {
  /** TicketWidget is rendered for all roles — reliable anchor element */
  readonly ticketWidget: Locator;
  readonly announcementSection: Locator;

  constructor(readonly page: Page) {
    // TicketWidget always renders; identify by heading text inside the widget
    this.ticketWidget = page.getByText(/Tiket|Ticket/i).first();
    // AnnouncementBanner for admin, Announcement for others — both contain "Pengumuman"
    this.announcementSection = page.getByText(/Pengumuman/i).first();
  }

  async goto() {
    await this.page.goto('/app/');
    await waitForPageLoad(this.page);
  }

  async isOnDashboard(): Promise<boolean> {
    return this.page.url().match(/\/app\/?$/) !== null;
  }
}
