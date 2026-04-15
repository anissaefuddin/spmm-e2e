import type { Page, Locator } from '@playwright/test';

/**
 * LoginPage — /app/login
 *
 * Selector sources (no data-testid):
 *   - emailInput:    react-hook-form Controller with name='email' spreads {...field}
 *                    onto the TextInput, which is a forwardRef to <input name="email">
 *   - passwordInput: same pattern, name='password'
 *   - submitButton:  Button component with title='Masuk' renders that text in StyledSpan
 */
export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly forgotPasswordLink: Locator;
  readonly registerButton: Locator;

  constructor(readonly page: Page) {
    this.emailInput = page.locator('input[name="email"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.submitButton = page.getByRole('button', { name: 'Masuk' });
    this.forgotPasswordLink = page.getByText('Lupa Password?');
    this.registerButton = page.getByRole('button', { name: /Daftar/ });
  }

  async goto() {
    await this.page.goto('/app/login');
    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async fillEmail(email: string) {
    await this.emailInput.fill(email);
  }

  async fillPassword(password: string) {
    await this.passwordInput.fill(password);
  }

  async submit() {
    await this.submitButton.click();
  }

  async login(email: string, password: string) {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.submit();
  }
}
