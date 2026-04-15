import type { Page, Locator } from '@playwright/test';
import { waitForPageLoad, waitForButtonNotLoading, waitForToast } from '../helpers/wait.helpers';

/**
 * AddUserPage — /app/user-management/add
 * Also used for EditUserPage — /app/user-management/edit
 *
 * Selector sources:
 *   All fields use react-hook-form Controller → name attribute on <input>
 *   Buttons use the Button component title prop as accessible name
 */
export class AddUserPage {
  readonly fullnameInput: Locator;
  readonly firstNameInput: Locator;
  readonly lastNameInput: Locator;
  readonly emailInput: Locator;
  readonly phoneInput: Locator;
  readonly submitButton: Locator;
  readonly backButton: Locator;

  constructor(readonly page: Page) {
    this.fullnameInput = page.locator('input[name="fullname"]');
    this.firstNameInput = page.locator('input[name="first_name"]');
    this.lastNameInput = page.locator('input[name="last_name"]');
    this.emailInput = page.locator('input[name="email"]');
    this.phoneInput = page.locator('input[name="phone_number"]');

    // AddUser: "Buat Akun" | EditUser: "Ubah Akun"
    this.submitButton = page
      .getByRole('button', { name: /Buat Akun|Ubah Akun/ })
      .and(page.locator('[type="submit"]'));

    this.backButton = page.getByRole('button', { name: 'Kembali' });
  }

  async goto() {
    await this.page.goto('/app/user-management/add');
    await waitForPageLoad(this.page);
    await this.fullnameInput.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /**
   * Select a role from the role_ids Select component.
   * The Select component renders a custom dropdown (not a native <select>).
   * Click the visible container to open it, then click the option by text.
   */
  async selectRole(roleName: string) {
    // The Select with name="role_ids" wraps a hidden input; the visible trigger
    // is the SelectContainer div. Click it to open the dropdown.
    const roleSelectTrigger = this.page
      .locator('label')
      .filter({ hasText: 'Role' })
      .locator('~ *')
      .first();
    await roleSelectTrigger.click();
    await this.page.getByText(roleName, { exact: true }).click();
  }

  async fillForm(data: {
    fullname: string;
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    role?: string;
  }) {
    await this.fullnameInput.fill(data.fullname);
    await this.firstNameInput.fill(data.first_name);
    await this.lastNameInput.fill(data.last_name);
    await this.emailInput.fill(data.email);
    await this.phoneInput.fill(data.phone_number);
    if (data.role) {
      await this.selectRole(data.role);
    }
  }

  async submit() {
    await this.submitButton.click();
    await waitForButtonNotLoading(this.submitButton);
  }

  async submitAndExpectSuccess(): Promise<void> {
    const [toast] = await Promise.all([
      waitForToast(this.page, 'success'),
      this.submit(),
    ]);
    await toast.waitFor({ state: 'visible' });
  }
}
