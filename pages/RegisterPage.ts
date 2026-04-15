import type { Page, Locator } from '@playwright/test';
import { waitForPageLoad } from '../helpers/wait.helpers';

/**
 * RegisterPage — /app/register
 *
 * Registration flow has multiple steps (screens):
 *   Step 1: RegisterScreen   — email + password → "Lanjutkan" → POST /api/register
 *   Step 2: OtpRegisterScreen — 6-digit OTP input → POST /api/verify-otp
 *   Step 3: ConfirmationAkunScreen — success/fail state
 *   Step 4: CreatePasswordScreen — full profile + password → POST /api/set-password
 *   Step 5: SuccesRegister — success landing
 *
 * Routes (under basename /app):
 *   /app/register                — Step 1
 *   /app/register/confirmation-akun  — Step 2/3
 *   /app/register/create-password    — Step 4
 *   /app/register/succes-register    — Step 5
 */
export class RegisterPage {
  // Step 1: Initial registration form
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly continueButton: Locator;

  // Step 2: OTP input (6-digit code)
  readonly otpInputs: Locator;
  readonly resendOtpLink: Locator;
  readonly submitOtpButton: Locator;

  // Step 4: Create password / complete profile
  readonly fullnameInput: Locator;
  readonly addressInput: Locator;
  readonly phoneInput: Locator;
  readonly newPasswordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly createPasswordButton: Locator;

  constructor(readonly page: Page) {
    // Step 1 elements
    this.emailInput = page.locator('input[name="email"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.continueButton = page.getByRole('button', { name: 'Lanjutkan' });

    // Step 2 elements — OTP input (react-otp-input renders individual inputs)
    this.otpInputs = page.locator('input[type="text"][maxlength="1"], input[type="number"]');
    this.resendOtpLink = page.getByText('Kirim Ulang OTP');
    this.submitOtpButton = page.getByRole('button', { name: 'Lanjutkan' });

    // Step 4 elements
    this.fullnameInput = page.locator('input[name="fullname"]');
    this.addressInput = page.locator('textarea[name="address"]');
    this.phoneInput = page.locator('input[name="phone_number"]');
    this.newPasswordInput = page.locator('input[name="password"]');
    this.confirmPasswordInput = page.locator('input[name="confirm_password"]');
    this.createPasswordButton = page.getByRole('button', { name: 'Lanjutkan' });
  }

  async goto() {
    await this.page.goto('/app/register');
    await waitForPageLoad(this.page);
    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  /** Step 1: Submit email + password to trigger OTP */
  async submitInitialForm(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.continueButton.click();
  }

  /**
   * Step 2: Enter 6-digit OTP.
   * OtpRegisterScreen uses react-otp-input which renders individual <input> per digit.
   */
  async enterOtp(otpCode: string) {
    const digits = otpCode.split('');
    const inputs = await this.otpInputs.all();

    for (let i = 0; i < Math.min(inputs.length, digits.length); i++) {
      await inputs[i].click();
      await inputs[i].fill(digits[i]);
    }
    await this.submitOtpButton.click();
  }

  /**
   * Step 4: Complete profile and set password.
   * fullname is disabled (pre-filled from EMIS), address and phone are required.
   */
  async completeProfile(data: {
    address?: string;
    phone_number: string;
    password: string;
    confirm_password: string;
  }) {
    if (data.address) {
      await this.addressInput.fill(data.address);
    }
    await this.phoneInput.fill(data.phone_number);
    await this.newPasswordInput.fill(data.password);
    await this.confirmPasswordInput.fill(data.confirm_password);
    await this.createPasswordButton.click();
  }

  /** Navigate to login from the OTP screen */
  async goToLogin() {
    await this.page.getByText('Masuk ke Akun Anda').click();
  }
}
