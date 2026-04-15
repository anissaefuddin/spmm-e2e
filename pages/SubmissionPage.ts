import type { Page, Locator } from '@playwright/test';
import {
  waitForPageLoad,
  waitForApiResponse,
  waitForButtonNotLoading,
  waitForToast,
} from '../helpers/wait.helpers';

/**
 * SubmissionPage — shared POM for:
 *   /app/recommendation/submission/:task_id
 *   /app/esign/submission/:task_id
 *   /app/spme/submission/:task_id
 *   and other workflow submission routes
 *
 * The DynamicForm component renders form fields based on backend variable definitions.
 * Button IDs (save, true, false) are set explicitly in DynamicForm:
 *   id='save'  → Draft/Save button
 *   id='true'  → Approve/Accept button
 *   id='false' → Reject button
 *
 * File upload IDs come from the UploadInput id prop in AddRecommendationScreen:
 *   #upload-permohonan, #upload-rip, #E-sign (for BSrE)
 */
export class SubmissionPage {
  readonly saveButton: Locator;
  readonly approveButton: Locator;
  readonly rejectButton: Locator;
  readonly backButton: Locator;
  /** "Kirim Pengajuan" — the final submission button in AddRecommendationScreen */
  readonly submitButton: Locator;
  /** "Simpan" — draft save in AddRecommendationScreen */
  readonly draftButton: Locator;

  constructor(readonly page: Page) {
    // DynamicForm decision buttons (explicit IDs set in the component)
    this.saveButton = page.locator('button#save');
    this.approveButton = page.locator('button#true');
    this.rejectButton = page.locator('button#false');

    // AddRecommendationScreen specific buttons (by title)
    this.submitButton = page.getByRole('button', { name: 'Kirim Pengajuan' });
    this.draftButton = page.getByRole('button', { name: 'Simpan' });
    this.backButton = page.getByRole('button', { name: 'Kembali' }).first();
  }

  async waitForLoad() {
    await waitForPageLoad(this.page);
  }

  /**
   * Fill a DynamicForm text field.
   * DynamicForm sets name={key} where key is the variable_name from the backend.
   */
  async fillTextField(fieldName: string, value: string) {
    const input = this.page.locator(`input[name="${fieldName}"]`);
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill(value);
  }

  /**
   * Upload a file to an UploadInput field.
   * The UploadInput renders <input type="file" id={id}>.
   * Playwright can set files on hidden file inputs directly.
   */
  async uploadFile(uploadId: string, filePath: string) {
    const fileInput = this.page.locator(`#${uploadId}`);
    await fileInput.waitFor({ state: 'attached', timeout: 10_000 });
    await fileInput.setInputFiles(filePath);
    // Wait for the file name to appear in the display label
    await this.page.waitForFunction(
      (id) => {
        const input = document.getElementById(id) as HTMLInputElement;
        return input?.files && input.files.length > 0;
      },
      uploadId,
      { timeout: 5_000 },
    );
  }

  /**
   * Upload a file and wait for the upload API response.
   * The frontend calls POST /api/uploadfile1 after file selection.
   */
  async uploadFileAndWaitForApi(uploadId: string, filePath: string) {
    const [apiResponse] = await Promise.all([
      waitForApiResponse(this.page, '/uploadfile1'),
      this.uploadFile(uploadId, filePath),
    ]);
    return apiResponse;
  }

  /** Click the Save/Draft button and wait for the mutation to complete */
  async save() {
    await this.saveButton.click();
    await waitForButtonNotLoading(this.saveButton);
  }

  /** Click Approve and wait for the API response */
  async approve() {
    const [apiResponse] = await Promise.all([
      waitForApiResponse(this.page, '/responsetask'),
      this.approveButton.click(),
    ]);
    return apiResponse;
  }

  /** Click Reject and wait for the API response */
  async reject() {
    const [apiResponse] = await Promise.all([
      waitForApiResponse(this.page, '/responsetask'),
      this.rejectButton.click(),
    ]);
    return apiResponse;
  }

  /** Submit the recommendation form ("Kirim Pengajuan") */
  async submit() {
    const [toast] = await Promise.all([
      waitForToast(this.page, 'success').catch(() => null),
      this.submitButton.click(),
    ]);
    await waitForButtonNotLoading(this.submitButton).catch(() => null);
    return toast;
  }

  /** Get the page task title (the judul_task from choosetask response) */
  async getTaskTitle(): Promise<string> {
    const heading = this.page.locator('h1, h2, h3').first();
    return (await heading.textContent()) ?? '';
  }
}
