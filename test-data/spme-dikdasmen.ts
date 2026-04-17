/**
 * SPME DIKDASMEN — Test Data Constants
 *
 * Covers all form variables in the workflow:
 *   Step 0    : Draft Pengajuan (DK role fills institution profile + documents)
 *   Steps 2-6 : Self-assessment for 4 standards (DK role)
 *   Step 9    : Assessor assignment (SK role)
 *   Steps 12/13, 14/15 : Pravisitasi review (ASDK assessors)
 *   Steps 20-27 : Visitasi scoring per indicator (ASDK assessors)
 *   Steps 35-39 : SK Validasi
 *   Step 40/42  : Pleno
 *
 * Variable names are sourced from:
 *   - spme-dikdasmen.xml  (form_data_input keys)
 *   - SpmeExportService.java (column references Sheet 2+)
 *   - KalkulasiNilaiFormDikdasment.java (score/grade computation)
 *
 * Score scale: 0–100 (NOT raw point totals)
 * Grade thresholds (from KalkulasiNilaiFormDikdasment.java):
 *   < 60 → "Rasib (Tidak Lulus Asesmen)" / "TIDAK MEMENUHI STANDAR MUTU."
 *   60–79 → "Maqbul (Baik)/C" / "MEMENUHI STANDAR MUTU."
 *   80–89 → "Jayyid (Baik Sekali)/B" / "MEMENUHI STANDAR MUTU."
 *   ≥ 90  → "Mumtaz (Unggul)/A" / "MEMENUHI STANDAR MUTU."
 *
 * Note: status values include a trailing period — assert exactly as written.
 */

import path from 'path';

// ---------------------------------------------------------------------------
// Process key & routes
// ---------------------------------------------------------------------------
export const SPME_DIKDASMEN = {
  processKey: 'spme-dikdasmen',
  listRoute: '/app/spme/dikdasmen',
  submissionRouteBase: '/app/spme/submission',
  assessorRouteBase: '/app/assessment-submission/submission-spme',
} as const;

// ---------------------------------------------------------------------------
// File fixtures — keep ALL fixtures under 500 KB (no frontend size validation)
// ---------------------------------------------------------------------------
const FILES_DIR = path.resolve(__dirname, 'files');

export const TEST_FILES_DK = {
  /** Generic small PDF used for most document uploads */
  pdf: path.join(FILES_DIR, 'sample.pdf'),
  /** Generic small image (used for photo uploads if needed) */
  jpg: path.join(FILES_DIR, 'sample.jpg'),
  /**
   * Intentionally misnamed .txt file masquerading as PDF.
   * Used in TC-DK-031 (wrong file type test).
   * Create this file: echo "not a pdf" > e2e/test-data/files/fake.txt
   */
  fakeTxt: path.join(FILES_DIR, 'fake.txt'),
} as const;

// ---------------------------------------------------------------------------
// Institution profile (Step 0 — DK role fills on first submission)
// Variable names match form_data_input keys in spme-dikdasmen.xml Step 0
// ---------------------------------------------------------------------------
export const INSTITUTION = {
  /** Shown on Sertifikat and export Sheet 1 */
  nama_lembaga: 'Pondok Pesantren Al-Hikmah Jombang',
  /** Full address for export */
  alamat: 'Jl. KH. Hasyim Asy\'ari No. 12, Jombang, Jawa Timur',
  provinsi: 'Jawa Timur',
  kabupaten: 'Kabupaten Jombang',
  kode_pos: '61411',
  telepon: '0321-861234',
  email: 'admin@alhikmah-jombang.sch.id',
  tahun_berdiri: '1995',
  /** Jenjang: SD/MI, SMP/MTs, SMA/MA, SMK/MAK ula/wustho/ulya*/
  jenjang: 'ula',
  /** Nomor Statistik Lembaga */
  nomor_statistik: '131235170001',
  /** NSS / NPSN */
  NPSN: '20581234',
} as const;

// ---------------------------------------------------------------------------
// Assessor assignment (Step 9 — SK fills)
// These must be real user names or IDs in the test database.
// ---------------------------------------------------------------------------
export const ASSESSOR_ASSIGNMENT = {
  /** Display name of the first ASDK user in the test DB (account: asesorddm1@yopmail.com) */
  asesor_1_name: 'DS Asesor DDM #1',
  /** Display name of the second ASDK user in the test DB (account: asesorddm2@yopmail.com) */
  asesor_2_name: 'DS Asesor DDM #2',
  /** ISO date for pravisitasi — 7 days from a fixed reference date */
  tanggal_pravisitasi: '2025-05-01',
  /** ISO date for visitasi — 14 days from pravisitasi */
  tanggal_visitasi: '2025-05-15',
  /** Catatan penunjukan SK */
  catatan_penunjukan: 'Penunjukan asesor SPME DIKDASMEN batch April 2025.',
} as const;

// ---------------------------------------------------------------------------
// Standard 1 — Kelembagaan (Institutional standing / legal status)
// Steps 2/2 in spme-dikdasmen.xml; DK fills self-assessment
// ---------------------------------------------------------------------------
export const STANDARD_1_KELEMBAGAAN = {
  // Sub-indicators filled by institution (DK) during self-assessment
  sk_pendirian_nomor: 'SK/2021/PP-AH/001',
  sk_pendirian_tanggal: '2021-03-15',
  sk_izin_operasional_nomor: 'SK-DIKNAS/2022/789',
  sk_izin_operasional_tanggal: '2022-01-10',
  sk_izin_operasional_berlaku: '2027-01-10',
  akta_notaris_nomor: 'Akta No. 12 / 2019',
  akta_notaris_tanggal: '2019-06-20',
  /** Total siswa aktif */
  jumlah_siswa: '245',
  jumlah_rombel: '9',
  /** Visi misi kelembagaan */
  visi_misi: 'Menjadi lembaga pendidikan Islam terpadu yang berakhlakul karimah, berprestasi, dan mandiri.',
} as const;

// ---------------------------------------------------------------------------
// Standard 2 — Kurikulum (Curriculum documents)
// Steps 3/3 in spme-dikdasmen.xml
// ---------------------------------------------------------------------------
export const STANDARD_2_KURIKULUM = {
  dokumen_kurikulum_tahun: '2024',
  nama_kurikulum: 'Kurikulum Merdeka Berbasis Pesantren 2024',
  tanggal_pengesahan: '2024-07-15',
  pengesah: 'Kepala Kantor Kemenag Kabupaten Jombang',
  /** Jumlah mata pelajaran intrakurikuler */
  jumlah_mapel_intra: '14',
  /** Jumlah kegiatan ekstrakurikuler */
  jumlah_ekskul: '8',
  catatan_kurikulum: 'Kurikulum terintegrasi antara pendidikan umum dan pendidikan agama Islam.',
} as const;

// ---------------------------------------------------------------------------
// Standard 3 — Pendidik dan Tenaga Kependidikan
// Steps 4/4 in spme-dikdasmen.xml
// ---------------------------------------------------------------------------
export const STANDARD_3_PENDIDIK = {
  /** Kepala sekolah / mudir */
  nama_kepala: 'KH. Ahmad Fauzi Rosyid, M.Pd.',
  kualifikasi_kepala: 'S2 Pendidikan Islam',
  sertifikat_kepala: 'Sertifikat Kepala Sekolah 2023',
  /** Total pendidik */
  jumlah_pendidik: '18',
  /** Pendidik berkualifikasi S1 ke atas */
  pendidik_s1_keatas: '16',
  /** Pendidik bersertifikat pendidik */
  pendidik_bersertifikat: '12',
  /** Tenaga kependidikan (TU, pustakawan, laboran, dll) */
  jumlah_tendik: '7',
  tendik_berkualifikasi: '5',
} as const;

// ---------------------------------------------------------------------------
// Standard 4 — Sarana Prasarana (Infrastructure)
// Steps 5/5 in spme-dikdasmen.xml; 12 sarpras items from export service
// ---------------------------------------------------------------------------
export const STANDARD_4_SARPRAS = {
  /** Luas tanah (m²) */
  luas_tanah: '3500',
  /** Status kepemilikan: Milik Sendiri / Sewa / Wakaf */
  status_tanah: 'Wakaf',
  luas_bangunan: '2200',
  /** 12 sarpras items — ketersediaan Y/N + kondisi */
  ruang_kelas_tersedia: 'Ya',
  ruang_kelas_kondisi: 'Baik',
  perpustakaan_tersedia: 'Ya',
  perpustakaan_kondisi: 'Baik',
  laboratorium_ipa_tersedia: 'Ya',
  laboratorium_ipa_kondisi: 'Cukup',
  laboratorium_komputer_tersedia: 'Ya',
  laboratorium_komputer_kondisi: 'Baik',
  ruang_guru_tersedia: 'Ya',
  ruang_guru_kondisi: 'Baik',
  ruang_kepala_tersedia: 'Ya',
  ruang_kepala_kondisi: 'Baik',
  ruang_tata_usaha_tersedia: 'Ya',
  ruang_tata_usaha_kondisi: 'Cukup',
  musholla_tersedia: 'Ya',
  musholla_kondisi: 'Baik',
  toilet_siswa_tersedia: 'Ya',
  toilet_siswa_kondisi: 'Baik',
  toilet_guru_tersedia: 'Ya',
  toilet_guru_kondisi: 'Baik',
  kantin_tersedia: 'Ya',
  kantin_kondisi: 'Cukup',
  tempat_parkir_tersedia: 'Ya',
  tempat_parkir_kondisi: 'Cukup',
} as const;

// ---------------------------------------------------------------------------
// Pravisitasi review data (Steps 12/13, 14/15 — ASDK per assessor)
// Variable names sourced from SpmeExportService.java Sheet 2
// ---------------------------------------------------------------------------
export const PRAVISITASI_ASESOR_1 = {
  /** Catatan untuk daftar siswa */
  // pravisit_daftarSiswa_catatan: 'Daftar siswa lengkap, terverifikasi dari DAPODIK.',
  /** Penilaian kualifikasi kepala: Memenuhi / Tidak Memenuhi */
  pravisit_kualifikasiKepala_memenuhi: 'Memenuhi',
  pravisit_kualifikasiPendidik_memenuhi: 'Memenuhi',
  pravisit_kualifikasiAdministrasi_memenuhi: 'Memenuhi',
  pravisit_kualifikasiPustakawan_memenuhi: 'Tidak Memenuhi',
  /** Catatan umum pravisitasi asesor 1 */
  catatan_pravisitasi: 'Dokumen administratif lengkap. Kualifikasi pustakawan perlu ditingkatkan.',
  pravisit_daftarLulusan_asesor1: 'Daftar lulusan 3 tahun terakhir tersedia dan valid.',
  pravisit_kurikulum_asesor1: 'Kurikulum Merdeka Berbasis Pesantren telah disahkan.',
  pravisit_strukturDewan_asesor1: 'Struktur dewan tersedia sesuai SK pendirian.',
} as const;

export const PRAVISITASI_ASESOR_2 = {
  pravisit_daftarSiswa_catatan: 'Daftar siswa terverifikasi, sesuai dengan data fisik.',
  pravisit_kualifikasiKepala_memenuhi: 'Memenuhi',
  pravisit_kualifikasiPendidik_memenuhi: 'Memenuhi',
  pravisit_kualifikasiAdministrasi_memenuhi: 'Memenuhi',
  pravisit_kualifikasiPustakawan_memenuhi: 'Tidak Memenuhi',
  catatan_pravisitasi: 'Dokumen lengkap. Catatan: perlu pengembangan kualifikasi pustakawan.',
  pravisit_daftarLulusan_asesor2: 'Lulusan 3 tahun terakhir terdokumentasi dengan baik.',
  pravisit_kurikulum_asesor2: 'Kurikulum sudah diimplementasikan dengan baik.',
  pravisit_strukturDewan_asesor2: 'Struktur dewan lengkap dan aktif.',
} as const;

// ---------------------------------------------------------------------------
// Visitasi assessment scores (Steps 20-27 — ASDK per assessor per standard)
//
// skor_tertimbang = ((skor_asesor_1 + skor_asesor_2) / 2) × bobot
// totalnilai = sum of all skor_tertimbang values
//
// For Mumtaz (≥ 90): use high scores (91–100)
// For Jayyid (80–89): use mid-high scores (80–88)
// For Maqbul (60–79): use mid scores (60–75)
// For Rasib (< 60): use low scores (45–58)
// ---------------------------------------------------------------------------

/** Score set that yields totalnilai ≥ 90 → Mumtaz */
export const VISITASI_SCORES_MUMTAZ = {
  // Standard 1 — Kelembagaan (bobot ~25%)
  std1_indicator_1: { skor: '95', bobot: '10' },
  std1_indicator_2: { skor: '92', bobot: '8' },
  std1_indicator_3: { skor: '90', bobot: '7' },
  // Standard 2 — Kurikulum (bobot ~25%)
  std2_indicator_1: { skor: '94', bobot: '9' },
  std2_indicator_2: { skor: '91', bobot: '8' },
  std2_indicator_3: { skor: '93', bobot: '8' },
  // Standard 3 — Pendidik (bobot ~25%)
  std3_indicator_1: { skor: '90', bobot: '9' },
  std3_indicator_2: { skor: '92', bobot: '8' },
  std3_indicator_3: { skor: '88', bobot: '8' },
  // Standard 4 — Sarpras (bobot ~25%)
  std4_indicator_1: { skor: '91', bobot: '9' },
  std4_indicator_2: { skor: '89', bobot: '8' },
  std4_indicator_3: { skor: '90', bobot: '8' },
} as const;

/**
 * Visitasi row-level field values (Steps 20–27 custom-formlist rows).
 *
 * Each row in the visitasi custom-formlist has this set of fields that the
 * assessor must fill.  Values are deliberately chosen to pass validation:
 *   • STATUS  → "Memenuhi" (first real business value, never "-")
 *   • SKOR    → "4" (highest available rating)
 *   • textareas → descriptive Mumtaz-level content
 */
export const VISITASI_ROW_DATA = {
  telaah_dokumen:              'Dokumen lengkap dan sesuai',
  wawancara:                   'Hasil wawancara sesuai standar',
  observasi:                   'Observasi menunjukkan implementasi baik',
  status:                      'Memenuhi',
  alasan:                      'Semua indikator terpenuhi',
  skor:                        '4',
  komponen_terpenuhi:          'Semua komponen terpenuhi',
  komponen_tidak_terpenuhi:    '-',
  saran:                       'Pertahankan kualitas',
} as const;

/** Score set that yields totalnilai in [80, 89] → Jayyid */
export const VISITASI_SCORES_JAYYID = {
  std1_indicator_1: { skor: '85', bobot: '10' },
  std1_indicator_2: { skor: '82', bobot: '8' },
  std1_indicator_3: { skor: '80', bobot: '7' },
  std2_indicator_1: { skor: '84', bobot: '9' },
  std2_indicator_2: { skor: '81', bobot: '8' },
  std2_indicator_3: { skor: '83', bobot: '8' },
  std3_indicator_1: { skor: '80', bobot: '9' },
  std3_indicator_2: { skor: '82', bobot: '8' },
  std3_indicator_3: { skor: '79', bobot: '8' },
  std4_indicator_1: { skor: '82', bobot: '9' },
  std4_indicator_2: { skor: '80', bobot: '8' },
  std4_indicator_3: { skor: '81', bobot: '8' },
} as const;

/** Score set that yields totalnilai in [60, 79] → Maqbul */
export const VISITASI_SCORES_MAQBUL = {
  std1_indicator_1: { skor: '70', bobot: '10' },
  std1_indicator_2: { skor: '65', bobot: '8' },
  std1_indicator_3: { skor: '68', bobot: '7' },
  std2_indicator_1: { skor: '72', bobot: '9' },
  std2_indicator_2: { skor: '60', bobot: '8' },
  std2_indicator_3: { skor: '64', bobot: '8' },
  std3_indicator_1: { skor: '66', bobot: '9' },
  std3_indicator_2: { skor: '70', bobot: '8' },
  std3_indicator_3: { skor: '62', bobot: '8' },
  std4_indicator_1: { skor: '68', bobot: '9' },
  std4_indicator_2: { skor: '63', bobot: '8' },
  std4_indicator_3: { skor: '67', bobot: '8' },
} as const;

/** Score set that yields totalnilai < 60 → Rasib */
export const VISITASI_SCORES_RASIB = {
  std1_indicator_1: { skor: '55', bobot: '10' },
  std1_indicator_2: { skor: '50', bobot: '8' },
  std1_indicator_3: { skor: '48', bobot: '7' },
  std2_indicator_1: { skor: '52', bobot: '9' },
  std2_indicator_2: { skor: '45', bobot: '8' },
  std2_indicator_3: { skor: '58', bobot: '8' },
  std3_indicator_1: { skor: '50', bobot: '9' },
  std3_indicator_2: { skor: '55', bobot: '8' },
  std3_indicator_3: { skor: '48', bobot: '8' },
  std4_indicator_1: { skor: '52', bobot: '9' },
  std4_indicator_2: { skor: '46', bobot: '8' },
  std4_indicator_3: { skor: '53', bobot: '8' },
} as const;

// ---------------------------------------------------------------------------
// Expected grade results (from KalkulasiNilaiFormDikdasment.java)
// NOTE: The trailing period on status is significant — assert exactly.
// ---------------------------------------------------------------------------
export const EXPECTED_GRADES = {
  mumtaz: {
    peringkat: 'Mumtaz (Unggul)/A',
    status: 'MEMENUHI STANDAR MUTU.',
    min_score: 90,
  },
  jayyid: {
    peringkat: 'Jayyid (Baik Sekali)/B',
    status: 'MEMENUHI STANDAR MUTU.',
    min_score: 80,
    max_score: 89,
  },
  maqbul: {
    peringkat: 'Maqbul (Baik)/C',
    status: 'MEMENUHI STANDAR MUTU.',
    min_score: 60,
    max_score: 79,
  },
  rasib: {
    peringkat: 'Rasib (Tidak Lulus Asesmen)',
    status: 'TIDAK MEMENUHI STANDAR MUTU.',
    max_score: 59,
  },
} as const;

// ---------------------------------------------------------------------------
// SK validation data (Steps 35–39)
// ---------------------------------------------------------------------------
export const SK_VALIDASI = {
  catatan_validasi: 'Hasil asesmen telah diverifikasi. Nilai sesuai dengan berkas dan temuan lapangan.',
  tanggal_validasi: '2025-05-25',
  /** Pleno decision: Setuju / Tidak Setuju */
  keputusan_pleno: 'Setuju',
  catatan_pleno: 'Pleno menyetujui hasil asesmen. Tidak ada keberatan dari peserta.',
} as const;

// ---------------------------------------------------------------------------
// Boundary score values for parametrized boundary tests
// ---------------------------------------------------------------------------
export const SCORE_BOUNDARIES = [
  { score: 59,   expectedGrade: EXPECTED_GRADES.rasib,  label: 'below-60-rasib' },
  { score: 60,   expectedGrade: EXPECTED_GRADES.maqbul, label: 'at-60-maqbul-lower' },
  { score: 79,   expectedGrade: EXPECTED_GRADES.maqbul, label: 'at-79-maqbul-upper' },
  { score: 80,   expectedGrade: EXPECTED_GRADES.jayyid, label: 'at-80-jayyid-lower' },
  { score: 89,   expectedGrade: EXPECTED_GRADES.jayyid, label: 'at-89-jayyid-upper' },
  { score: 90,   expectedGrade: EXPECTED_GRADES.mumtaz, label: 'at-90-mumtaz-lower' },
  { score: 100,  expectedGrade: EXPECTED_GRADES.mumtaz, label: 'at-100-mumtaz-max' },
] as const;
