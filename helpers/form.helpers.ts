import type { Page } from '@playwright/test';

/**
 * Dynamic Form Field definition.
 *
 * Maps to the backend ProcessVariable shape from /api/choosetask response.
 * The DynamicForm component renders fields based on variable_type.
 */
export interface FormFieldDef {
  /** The variable_name from backend — becomes the input name attribute */
  name: string;
  /** Variable type determines rendering strategy */
  type: 'text' | 'number' | 'email' | 'select' | 'date' | 'time' | 'file' | 'table' | 'textarea';
  /** Value to fill/select/upload */
  value: string | string[];
  /** If type='file', this is the file path (use TEST_FILES.pdf etc.) */
  filePath?: string;
  /** If type='select', whether it is a multi-select */
  multiple?: boolean;
  /** Optional: the upload input id attribute (for UploadInput components) */
  uploadId?: string;
}

/**
 * fillDynamicForm() — Reusable dynamic form filling helper.
 *
 * Handles all field types rendered by the DynamicForm component:
 *   - text/number/email: fills input[name="{name}"]
 *   - select: clicks custom Select dropdown, picks option by text
 *   - date: fills the react-datepicker input with typed value
 *   - time: fills time input
 *   - file: sets file on input[type="file"] by id or name
 *   - table: fills the first row of an editable DynamicTable
 *   - textarea: fills textarea[name="{name}"]
 *
 * Usage:
 *   await fillDynamicForm(page, [
 *     { name: 'Nama_Pesantren', type: 'text', value: 'Pesantren Test' },
 *     { name: 'Tanggal', type: 'date', value: '2024-01-15' },
 *     { name: 'Dokumen', type: 'file', value: 'sample.pdf', uploadId: 'upload-dok' },
 *   ]);
 */
export async function fillDynamicForm(page: Page, fields: FormFieldDef[]): Promise<void> {
  for (const field of fields) {
    await fillField(page, field);
    // Brief pause between fields for React state updates to settle
    await page.waitForTimeout(150);
  }
}

async function fillField(page: Page, field: FormFieldDef): Promise<void> {
  const value = Array.isArray(field.value) ? field.value : [field.value];

  switch (field.type) {
    case 'text':
    case 'number':
    case 'email': {
      const input = page.locator(`input[name="${field.name}"]`).first();
      await input.waitFor({ state: 'visible', timeout: 8_000 });
      await input.clear();
      await input.fill(value[0]);
      break;
    }

    case 'textarea': {
      console.log(`    fillField [textarea] "${field.name}"`);

      // Detection runs three strategies in order; the first one that resolves to
      // a visible, enabled element wins.  This avoids hard-coding attribute names
      // that the rendered component may omit.
      //
      // Strategy 1 — name attribute (fastest; works when DynamicForm passes name)
      // Strategy 2 — label-based container lookup (works when name is absent)
      // Strategy 3 — last visible textarea on the page (positional fallback)

      let textarea = page.locator(`textarea[name="${field.name}"]`).first();
      const nameMatch = await textarea.isVisible({ timeout: 2_000 }).catch(() => false);
      console.log(`      strategy 1 (name="${field.name}"): ${nameMatch ? '✓' : '✗'}`);

      if (!nameMatch) {
        // Strategy 2: find a parent div whose label text contains the field name,
        // then pick the first editable element inside it.
        // Using a RegExp so partial / case-insensitive matches work for label text
        // that may include asterisks, colons, or localised translations.
        const labelPattern = new RegExp(field.name.replace(/_/g, '[_ ]'), 'i');
        const group = page.locator('div').filter({
          has: page.locator('label').filter({ hasText: labelPattern }),
        }).last();

        const groupVisible = await group.isVisible({ timeout: 2_000 }).catch(() => false);
        console.log(`      strategy 2 (label~/${labelPattern.source}/i): ${groupVisible ? '✓' : '✗'}`);

        if (groupVisible) {
          textarea = group
            .locator('textarea, [contenteditable="true"]')
            .first();
        }
      }

      // Strategy 3: fall back to the last visible textarea on the page.
      // "last" is preferred over "first" because the active / focused field in a
      // multi-section form is usually appended later in the DOM.
      const resolvedVisible = await textarea.isVisible({ timeout: 1_000 }).catch(() => false);
      if (!resolvedVisible) {
        console.log(`      strategy 3 (last visible textarea): attempting`);
        textarea = page.locator('textarea:visible').last();
      }

      const finalVisible = await textarea.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!finalVisible) {
        // Snapshot what IS on the page so the test report tells us what to target
        const allTextareas = await page.locator('textarea').all();
        const textareaInfo = await Promise.all(allTextareas.map(async (ta) => {
          const name = await ta.getAttribute('name') ?? '';
          const id   = await ta.getAttribute('id') ?? '';
          const plc  = await ta.getAttribute('placeholder') ?? '';
          const visible = await ta.isVisible().catch(() => false);
          return `name="${name}" id="${id}" placeholder="${plc}" visible=${visible}`;
        }));

        const allInputs = await page.locator('input[type="text"], input:not([type])').all();
        const inputInfo = await Promise.all(allInputs.slice(0, 30).map(async (i) => {
          const name = await i.getAttribute('name') ?? '';
          const id   = await i.getAttribute('id') ?? '';
          const visible = await i.isVisible().catch(() => false);
          return `name="${name}" id="${id}" visible=${visible}`;
        }));

        const allLabels = (await page.locator('label').allTextContents())
          .map((s) => s.trim()).filter(Boolean).slice(0, 40);

        const ceCount = await page.locator('[contenteditable="true"]').count();

        throw new Error(
          `fillField [textarea] "${field.name}": element not found after three strategies.\n\n` +
          `── DOM SNAPSHOT ────────────────────────────────────────────────\n` +
          `Page URL: ${page.url()}\n` +
          `<textarea> elements (${allTextareas.length}):\n` +
          (textareaInfo.length ? textareaInfo.map((s) => `  • ${s}`).join('\n') : '  (none)') + `\n` +
          `<input type="text"> elements (showing first 30 of ${allInputs.length}):\n` +
          (inputInfo.length ? inputInfo.map((s) => `  • ${s}`).join('\n') : '  (none)') + `\n` +
          `[contenteditable="true"] elements: ${ceCount}\n` +
          `<label> texts (first 40): ${allLabels.map((l) => `"${l}"`).join(', ')}\n` +
          `────────────────────────────────────────────────────────────────\n\n` +
          `Likely causes:\n` +
          `  • Field "${field.name}" is named differently in the rendered form\n` +
          `    (compare the names listed above and update the test constant).\n` +
          `  • The page has not finished loading the form schema — add a wait\n` +
          `    on the choosetask response or a known field's label before fillDynamicForm.\n` +
          `  • The form uses a rich-text editor instead of <textarea> (count of\n` +
          `    contenteditable nodes shown above).`,
        );
      }

      await textarea.waitFor({ state: 'visible', timeout: 10_000 });
      await textarea.scrollIntoViewIfNeeded();
      await textarea.click();
      await textarea.fill(value[0]);
      console.log(`      ✓ filled with "${value[0].slice(0, 40)}${value[0].length > 40 ? '…' : ''}"`);
      break;
    }

    case 'date': {
      // react-datepicker renders an input with the field name
      // It accepts typed dates in dd/MM/yyyy or MM/dd/yyyy depending on locale
      const dateInput = page
        .locator(`input[name="${field.name}"], input[placeholder*="tanggal"], input[placeholder*="date"]`)
        .first();
      await dateInput.waitFor({ state: 'visible', timeout: 8_000 });
      await dateInput.click();
      await dateInput.fill(value[0]);
      // Close the datepicker calendar by pressing Tab
      await page.keyboard.press('Tab');
      break;
    }

    case 'time': {
      const timeInput = page.locator(`input[name="${field.name}"]`).first();
      await timeInput.waitFor({ state: 'visible', timeout: 8_000 });
      await timeInput.fill(value[0]);
      break;
    }

    case 'select': {
      // The custom Select component wraps a hidden <input name="{name}">
      // The visible trigger is a styled container next to the label
      // Strategy: find the label, then find its sibling/container, then click
      const label = page.locator(`label`).filter({ hasText: field.name }).first();
      const labelExists = await label.isVisible({ timeout: 3_000 }).catch(() => false);

      if (labelExists) {
        // Click the select container adjacent to the label
        // SelectContainer is the next sibling of the LabelWrapper
        const selectContainer = page
          .locator(`label:has-text("${field.name}") ~ *, label:has-text("${field.name}") + *`)
          .first();
        await selectContainer.click();
      } else {
        // Fallback: click the hidden input's wrapper by name association
        const hiddenInput = page.locator(`input[name="${field.name}"]`).first();
        const wrapper = page.locator(`[class*="Select"][class*="Container"]`).filter({
          has: hiddenInput,
        });
        if (await wrapper.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await wrapper.click();
        }
      }

      // Wait for dropdown to open
      await page.waitForTimeout(300);

      // For multi-select, click each option; for single select, click just the first
      const optionValues = field.multiple ? value : [value[0]];
      for (const optVal of optionValues) {
        const option = page.getByText(optVal, { exact: true }).first();
        await option.waitFor({ state: 'visible', timeout: 5_000 });
        await option.click();
        await page.waitForTimeout(200);
      }

      // Close dropdown by pressing Escape or clicking outside
      await page.keyboard.press('Escape');
      break;
    }

    case 'file': {
      // UploadInput renders <input type="file" id="{uploadId or name}">
      // Playwright can set files on hidden inputs directly
      const selector = field.uploadId
        ? `#${field.uploadId}`
        : `input[type="file"][name="${field.name}"], input[type="file"]`;

      const fileInput = page.locator(selector).first();
      await fileInput.waitFor({ state: 'attached', timeout: 8_000 });

      const filePath = field.filePath ?? value[0];
      await fileInput.setInputFiles(filePath);

      // Wait for React state update after file selection
      await page.waitForFunction(
        (sel) => {
          const el = document.querySelector(sel) as HTMLInputElement;
          return el?.files && el.files.length > 0;
        },
        selector,
        { timeout: 5_000 },
      ).catch(() => null); // Ignore timeout — some inputs don't expose files
      break;
    }

    case 'table': {
      // DynamicTable component renders an editable table
      // Fill the first row's inputs using column index
      // The table cells contain inputs for editing
      const tableInputs = page
        .locator('table tbody tr:first-child input, table tbody tr:first-child textarea')
        .all();

      const inputs = await tableInputs;
      const vals = Array.isArray(field.value) ? field.value : [field.value];

      for (let i = 0; i < Math.min(inputs.length, vals.length); i++) {
        await inputs[i].clear();
        await inputs[i].fill(vals[i]);
        await page.waitForTimeout(100);
      }
      break;
    }

    default: {
      console.warn(`fillDynamicForm: unknown field type "${(field as FormFieldDef).type}" for field "${field.name}"`);
    }
  }
}

/**
 * fillDynamicFormFromSchema() — Fill form using raw backend ProcessVariable schema.
 *
 * Accepts the form_data_input object from /api/choosetask response and fills
 * all non-readonly fields with provided values or sensible defaults.
 *
 * @param page - Playwright page
 * @param schema - The form_data_input from choosetask API response
 * @param overrides - Custom values keyed by variable_name
 * @param filePaths - File paths keyed by variable_name (for file fields)
 */
export async function fillDynamicFormFromSchema(
  page: Page,
  schema: Record<string, { variable_type?: string; read_only?: boolean; required?: string; variable_name?: string }>,
  overrides: Record<string, string> = {},
  filePaths: Record<string, string> = {},
): Promise<void> {
  const fields: FormFieldDef[] = [];

  for (const [key, field] of Object.entries(schema)) {
    if (field.read_only) continue;

    const varType = field.variable_type ?? 'text';
    const overrideValue = overrides[key] ?? overrides[field.variable_name ?? key];

    // Map backend variable_type to our FormFieldDef type
    let fieldType: FormFieldDef['type'] = 'text';
    if (varType === 'option') fieldType = 'select';
    else if (varType === 'date') fieldType = 'date';
    else if (varType === 'time') fieldType = 'time';
    else if (varType === 'file') fieldType = 'file';
    else if (varType === 'table') fieldType = 'table';
    else if (varType === 'textarea') fieldType = 'textarea';

    const defaultValue = fieldType === 'date' ? '2024-01-01' : 'Test Value E2E';

    fields.push({
      name: key,
      type: fieldType,
      value: overrideValue ?? defaultValue,
      filePath: filePaths[key] ?? filePaths[field.variable_name ?? key],
    });
  }

  await fillDynamicForm(page, fields);
}
