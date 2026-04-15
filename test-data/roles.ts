import type { RoleKey } from './users';

/**
 * Role → Workflow access mapping.
 * Based on the business rules defined in the system specification.
 *
 * Used by role-access tests to verify:
 *   1. Allowed routes are accessible (no redirect to /login or /404)
 *   2. Forbidden routes redirect or show access denied
 *   3. Sidebar items match the expected set per role
 */

export type WorkflowKey =
  | 'recommendation'
  | 'assessment-report'   // SPMI
  | 'assessment-submission' // SPME
  | 'spme-mahadaly'
  | 'spme-dikdasmen'
  | 'esign'
  | 'support'
  | 'user-management'
  | 'lembaga'
  | 'lembaga-dm';

export interface RoleAccess {
  /** Display name for test reporting */
  label: string;
  /** Routes this role is allowed to visit */
  allowedRoutes: string[];
  /** Routes that must NOT appear / must redirect away */
  forbiddenRoutes: string[];
  /** Sidebar menu items that MUST be visible */
  sidebarItems: string[];
  /** Sidebar menu items that must NOT be visible */
  hiddenSidebarItems: string[];
}

export const ROLE_ACCESS: Record<RoleKey, RoleAccess> = {
  admin: {
    label: 'Admin',
    allowedRoutes: ['/app/', '/app/user-management', '/app/inbox'],
    forbiddenRoutes: ['/app/recommendation', '/app/esign', '/app/spme'],
    sidebarItems: ['Beranda', 'Akun Manajemen'],
    hiddenSidebarItems: ['Pengajuan Rekomendasi', 'Tanda Tangan Elektronik'],
  },

  dm: {
    label: "Dewan Masyayikh",
    allowedRoutes: ['/app/', '/app/recommendation', '/app/inbox'],
    forbiddenRoutes: ['/app/user-management', '/app/esign'],
    sidebarItems: ['Beranda', 'Pengajuan Rekomendasi', 'Bantuan & Dukungan'],
    hiddenSidebarItems: ['Akun Manajemen'],
  },

  sk: {
    label: 'Sekretariat',
    allowedRoutes: [
      '/app/',
      '/app/recommendation',
      '/app/assessment-report',
      '/app/assessment-submission',
      '/app/spme',
      '/app/esign',
      '/app/support',
    ],
    forbiddenRoutes: ['/app/user-management'],
    sidebarItems: [
      'Beranda',
      'Kotak Masuk',
      'Laporan SPM Internal',
      'Laporan SPM Eksternal',
      'Tanda Tangan Elektronik',
      'Bantuan & Dukungan',
    ],
    hiddenSidebarItems: ['Akun Manajemen'],
  },

  ta: {
    label: 'Tenaga Ahli',
    allowedRoutes: ['/app/', '/app/spme', '/app/assessment-submission'],
    forbiddenRoutes: ['/app/user-management', '/app/recommendation'],
    sidebarItems: ['Beranda', 'Laporan SPM Eksternal'],
    hiddenSidebarItems: ['Akun Manajemen', 'Pengajuan Rekomendasi'],
  },

  mm: {
    label: 'Majelis Masyayikh',
    allowedRoutes: ['/app/', '/app/esign', '/app/spme'],
    forbiddenRoutes: ['/app/user-management', '/app/recommendation'],
    sidebarItems: ['Beranda', 'Tanda Tangan Elektronik', 'Laporan SPM Eksternal'],
    hiddenSidebarItems: ['Akun Manajemen'],
  },

  asdk: {
    label: 'Asessor Dikdasmen',
    allowedRoutes: ['/app/', '/app/assessment-submission'],
    forbiddenRoutes: ['/app/user-management', '/app/esign'],
    sidebarItems: ['Beranda', 'Laporan SPM Eksternal'],
    hiddenSidebarItems: ['Akun Manajemen', 'Tanda Tangan Elektronik'],
  },

  mha: {
    label: "Ma'had Aly",
    allowedRoutes: ['/app/', '/app/assessment-submission'],
    forbiddenRoutes: ['/app/user-management', '/app/esign'],
    sidebarItems: ['Beranda', 'Laporan SPM Eksternal'],
    hiddenSidebarItems: ['Akun Manajemen'],
  },

  dk: {
    label: 'DIKDASMEN',
    allowedRoutes: ['/app/', '/app/assessment-submission'],
    forbiddenRoutes: ['/app/user-management', '/app/esign'],
    sidebarItems: ['Beranda', 'Laporan SPM Eksternal'],
    hiddenSidebarItems: ['Akun Manajemen', 'Tanda Tangan Elektronik'],
  },

  tas: {
    label: 'Tenaga Asisten',
    allowedRoutes: ['/app/', '/app/spme/mahadaly', '/app/assessment-submission'],
    forbiddenRoutes: ['/app/user-management', '/app/esign'],
    sidebarItems: ['Beranda', 'Laporan SPM Eksternal'],
    hiddenSidebarItems: ['Akun Manajemen', 'Tanda Tangan Elektronik'],
  },

  asma: {
    label: "Assessor Ma'had Aly",
    allowedRoutes: ['/app/', '/app/spme/mahadaly', '/app/assessment-submission'],
    forbiddenRoutes: ['/app/user-management', '/app/esign'],
    sidebarItems: ['Beranda', 'Laporan SPM Eksternal'],
    hiddenSidebarItems: ['Akun Manajemen', 'Tanda Tangan Elektronik'],
  },
};

/**
 * Workflow process key → starting role mapping.
 * Identifies which role should initiate each workflow.
 */
export const WORKFLOW_INITIATOR: Record<string, RoleKey> = {
  'Permohonan Rekomendasi': 'dm',
  'Help Desk': 'dm',
  SPMI: 'sk',
  'SPME Mahad Aly': 'sk',
  'SPME DIKDASMEN': 'sk',
  'Tanda Tangan Elektronik Bulk': 'mm',
};

/**
 * Sidebar route mapping for access assertions.
 * Key: sidebar display text, Value: route path
 */
export const SIDEBAR_ROUTES: Record<string, string> = {
  Beranda: '/app/',
  'Kotak Masuk': '/app/inbox',
  'Pengajuan Rekomendasi': '/app/recommendation',
  'Laporan SPM Internal': '/app/assessment-report',
  'Laporan SPM Eksternal': '/app/spme',
  Lembaga: '/app/lembaga',
  'Daftar Dewan Masyayikh': '/app/lembaga-dm',
  'Tanda Tangan Elektronik': '/app/esign',
  'Bantuan & Dukungan': '/app/support',
  'Akun Manajemen': '/app/user-management',
};
