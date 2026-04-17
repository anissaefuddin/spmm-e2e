/**
 * Test account definitions — all 10 system roles.
 *
 * Each account MUST exist in the test database before running E2E tests.
 * Use dedicated test accounts — NEVER production credentials.
 *
 * Credentials are read from .env.test; these strings are fallback defaults
 * for local development only.
 */

export type RoleKey =
  | 'admin'
  | 'dm'
  | 'sk'
  | 'ta'
  | 'mm'
  | 'asdk'
  | 'asdk2'
  | 'mha'
  | 'dk'
  | 'tas'
  | 'asma';

export interface TestUser {
  email: string;
  password: string;
  role_code: string;
  role_name: string;
  authStateFile: string;
  envEmailKey: string;
  envPasswordKey: string;
  lembaga?: string;
  institution_id?: string;
}

export const TEST_USERS: Record<RoleKey, TestUser> = {
  /** Admin — user management, no workflow access */
  admin: {
    email: process.env.TEST_ADMIN_EMAIL || 'adminspmm@yopmail.com',
    password: process.env.TEST_ADMIN_PASSWORD || 'P@ssword123!',
    role_code: 'AD',
    role_name: 'Admin',
    authStateFile: 'admin-auth.json',
    envEmailKey: 'TEST_ADMIN_EMAIL',
    envPasswordKey: 'TEST_ADMIN_PASSWORD',
  },

  /** Dewan Masyayikh — recommendation workflow, data input */
  dm: {
    email: process.env.TEST_DM_EMAIL || 'penguruspondokputra@gmail.com',
    password: process.env.TEST_DM_PASSWORD || 'Password123!',
    role_code: 'DM',
    role_name: 'Dewan Masyayikh',
    authStateFile: 'dm-auth.json',
    envEmailKey: 'TEST_DM_EMAIL',
    envPasswordKey: 'TEST_DM_PASSWORD',
    lembaga: 'Pesantren E2E Test',
    institution_id: 'test-institution-e2e',
  },

  /** Sekretariat — all workflows, full access */
  sk: {
    email: process.env.TEST_SK_EMAIL || 'sekretariat@yopmail.com',
    password: process.env.TEST_SK_PASSWORD || 'Password123!',
    role_code: 'SK',
    role_name: 'Sekretariat',
    authStateFile: 'sk-auth.json',
    envEmailKey: 'TEST_SK_EMAIL',
    envPasswordKey: 'TEST_SK_PASSWORD',
  },

  /** Tenaga Ahli — SPME Mahad Aly + SPME DIKDASMEN */
  ta: {
    email: process.env.TEST_TA_EMAIL || 'ta1@yopmail.com',
    password: process.env.TEST_TA_PASSWORD || 'Password123!',
    role_code: 'TA',
    role_name: "Tenaga Ahli",
    authStateFile: 'ta-auth.json',
    envEmailKey: 'TEST_TA_EMAIL',
    envPasswordKey: 'TEST_TA_PASSWORD',
  },

  /** Majelis Masyayikh — E-sign bulk + SPME */
  mm: {
    email: process.env.TEST_MM_EMAIL || 'abdghaffarrozin@majelismasyayikh.id',
    password: process.env.TEST_MM_PASSWORD || 'Password123!',
    role_code: 'MM',
    role_name: 'Majelis Masyayikh',
    authStateFile: 'mm-auth.json',
    envEmailKey: 'TEST_MM_EMAIL',
    envPasswordKey: 'TEST_MM_PASSWORD',
  },

  /** Asessor Dikdasmen — SPME DIKDASMEN only (first assessor / Asesor 1) */
  asdk: {
    email: process.env.TEST_ASDK_EMAIL || 'asesorddm1@yopmail.com',
    password: process.env.TEST_ASDK_PASSWORD || 'Password123!',
    role_code: 'ASDK',
    role_name: 'Asessor Dikdasmen',
    authStateFile: 'asdk-auth.json',
    envEmailKey: 'TEST_ASDK_EMAIL',
    envPasswordKey: 'TEST_ASDK_PASSWORD',
  },

  /** Asessor Dikdasmen #2 — second assessor (Asesor 2) for paired review workflows */
  asdk2: {
    email: process.env.TEST_ASDK2_EMAIL || 'asesorddm2@yopmail.com',
    password: process.env.TEST_ASDK2_PASSWORD || 'Password123!',
    role_code: 'ASDK',
    role_name: 'Asessor Dikdasmen',
    authStateFile: 'asdk2-auth.json',
    envEmailKey: 'TEST_ASDK2_EMAIL',
    envPasswordKey: 'TEST_ASDK2_PASSWORD',
  },

  /** Ma'had Aly — SPME Mahad Aly only */
  mha: {
    email: process.env.TEST_MHA_EMAIL || 'penguruspondokputra@gmail.com',
    password: process.env.TEST_MHA_PASSWORD || 'Password123!',
    role_code: 'MHA',
    role_name: "Ma'had Aly",
    authStateFile: 'mha-auth.json',
    envEmailKey: 'TEST_MHA_EMAIL',
    envPasswordKey: 'TEST_MHA_PASSWORD',
  },

  /** DIKDASMEN — SPME DIKDASMEN only */
  dk: {
    email: process.env.TEST_DK_EMAIL || 'wusthaspmbabululumabuluengie@gmail.com',
    password: process.env.TEST_DK_PASSWORD || 'Password123!',
    role_code: 'DK',
    role_name: 'DIKDASMEN',
    authStateFile: 'dk-auth.json',
    envEmailKey: 'TEST_DK_EMAIL',
    envPasswordKey: 'TEST_DK_PASSWORD',
  },

  /** Tenaga Asisten — SPME Mahad Aly only */
  tas: {
    email: process.env.TEST_TAS_EMAIL || 'userta@yopmail.com',
    password: process.env.TEST_TAS_PASSWORD || 'Password123!',
    role_code: 'TAS',
    role_name: 'Tenaga Asisten',
    authStateFile: 'tas-auth.json',
    envEmailKey: 'TEST_TAS_EMAIL',
    envPasswordKey: 'TEST_TAS_PASSWORD',
  },

  /** Assessor Ma'had Aly — SPME Mahad Aly only */
  asma: {
    email: process.env.TEST_ASMA_EMAIL || 'useras@yopmail.com',
    password: process.env.TEST_ASMA_PASSWORD || 'Password123!',
    role_code: 'ASMA',
    role_name: "Assessor Ma'had Aly",
    authStateFile: 'asma-auth.json',
    envEmailKey: 'TEST_ASMA_EMAIL',
    envPasswordKey: 'TEST_ASMA_PASSWORD',
  },
} as const;

export const ALL_ROLE_KEYS = Object.keys(TEST_USERS) as RoleKey[];

/**
 * Payload for creating a new user during CRUD tests.
 * Uses Date.now() for email uniqueness.
 */
export function createNewUserPayload() {
  const ts = Date.now();
  return {
    fullname: `E2E Test User ${ts}`,
    first_name: 'E2E',
    last_name: `Test${ts}`,
    email: `e2e.new.${ts}@spmm.test`,
    phone_number: '081234567890',
    role: 'Admin',
  };
}
