/**
 * Workflow test data.
 *
 * Process keys and task identifiers used in recommendation/SPME workflows.
 * These values come from the BPM engine configuration in the backend.
 *
 * Update these if the backend workflow definitions change.
 */
export const WORKFLOW = {
  /** Process key for the Ma'had Aly recommendation workflow */
  recommendationProcessKey: 'rekomendasi-mahadaly',
  /** Process key for SPME DIKDASMEN workflow */
  spmeDikdasmenProcessKey: 'spme-dikdasmen',
} as const;
