import type { Page, Locator } from '@playwright/test';
import { waitForPageLoad } from '../helpers/wait.helpers';

/**
 * ForgotPasswordPage — /app/forget-password and /app/reset-password/:id
 *
 * Forgot password flow:
 *   Step 1: ForgetPasswordScreen — email input → POST /api/forget-password
 *           → Backend sends reset email with link containing reset token
 *   Step 2: ResetPasswordScreen (/app/reset-password/:id)
 *           — new password + confirm → POST /api/reset-password
 *
 * Note: Also handles /app/create-password/:id (same ResetPasswordScreen component)
 * which is used in the register flow.
 *
 * Selector sources:
 *   - emailInput: input[name="email"] in ForgetPasswordScreen
 *   - continueButton: Button with title "Lanjutkan"
 *   - passwordInput/confirmInput: input[name="password"]/[name="confirm_password"]
 *     in ResetPasswordScreen
 */
export class ForgotPasswordPage {
  readonly emailInput: Locator;
  readonly continueButton: Locator;

  // Reset password form (at /app/reset-password/:id)
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly saveButton: Locator;

  constructor(readonly page: Page) {
    this.emailInput = page.locator('input[name="email"]');
    this.continueButton = page.getByRole('button', { name: 'Lanjutkan' });

    this.newPasswordInput = page.locator('input[name="password"]');
    this.confirmPasswordInput = page.locator('input[name="confirm_password"]');
    this.saveButton = page.getByRole('button', { name: 'Lanjutkan' });
  }

  async goto() {
    await this.page.goto('/app/forget-password');
    await waitForPageLoad(this.page);
    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Submit email to trigger password reset email */
  async submitEmail(email: string) {
    await this.emailInput.fill(email);
    await this.continueButton.click();
  }

  /**
   * Navigate to the reset password page with a given token.
   * In tests, obtain this token from the backend/email interceptor.
   */
  async gotoResetPassword(token: string) {
    await this.page.goto(`/app/reset-password/${token}`);
    await waitForPageLoad(this.page);
    await this.newPasswordInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Fill in new password and confirm, then submit */
  async setNewPassword(password: string, confirmPassword?: string) {
    await this.newPasswordInput.fill(password);
    await this.confirmPasswordInput.fill(confirmPassword ?? password);
    await this.saveButton.click();
  }
}
