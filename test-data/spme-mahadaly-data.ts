/**
 * SPME Ma'had Aly — Complete Test Data
 *
 * Production-ready realistic test data for the full SPME Ma'had Aly E2E workflow.
 * All data uses real Indonesian Islamic boarding school context.
 *
 * Scoring system (from KalkulasiNilaiAkhirFormMahadaly.java):
 *   totalnilai < 104   → Rasib   (Tidak Lulus Asesmen)
 *   totalnilai < 208   → Maqbul  (C/ Baik)       [Lulus Asesmen]
 *   totalnilai < 312   → Jayyid  (B/ Baik Sekali) [Lulus Asesmen]
 *   totalnilai >= 312  → Mumtaz  (A/ Unggul)      [Lulus Asesmen]
 *
 * Score calculation (updatenilaimahadaly):
 *   skor_tertimbang = (skor_mentah_asesor_1 + skor_mentah_asesor_2) / 2.0
 *
 * Custom-formlist structure (wf_data_form_level1 + wf_data_form_level2):
 *   The DynamicTable renders as <table>. Each row = one criterion.
 *   Assessors fill the score column — stored in wf_data_form_level2.skor_mentah_asesor_N.
 *   Scores 1-12 per criterion; 29 criteria total; target sum >= 312 for Mumtaz.
 *   With avg score 11/criterion: 11 × 29 = 319 → Mumtaz.
 */

import path from 'path';

// ── Fixtures path ──────────────────────────────────────────────────────────
export const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/spme');

export const TEST_FILES = {
  /** Asesor 1 report files (steps 43) */
  laporanKeuanganAsesor1:   path.join(FIXTURES_DIR, 'laporan_keuangan_mahad.pdf'),
  laporanAsesmenAsesor1:    path.join(FIXTURES_DIR, 'laporan_asesmen_mahad.pdf'),
  beritaAcaraAsesor1:       path.join(FIXTURES_DIR, 'berita_acara_visitasi.pdf'),
  /** Asesor 2 report files (step 50) */
  laporanKeuanganAsesor2:   path.join(FIXTURES_DIR, 'laporan_keuangan_mahad_as2.pdf'),
  laporanAsesmenAsesor2:    path.join(FIXTURES_DIR, 'laporan_asesmen_mahad_as2.pdf'),
  beritaAcaraAsesor2:       path.join(FIXTURES_DIR, 'berita_acara_visitasi_as2.pdf'),
  /** SK final certificate (step 67) */
  sertifikatSpme:           path.join(FIXTURES_DIR, 'sertifikat_spme_mahad_aly.pdf'),
} as const;

// ── Institution data (Step 0 + Step 13/14) ────────────────────────────────
export const INSTITUTION = {
  Nama_Satuan_MahadAly:     "Ma'had Aly Salafiyah Syafi'iyah Situbondo",
  NSMA:                     '107235040001',
  Nama_Pesantren:           'Pondok Pesantren Salafiyah Syafi\'iyah',
  Alamat:                   'Jl. Kyai Syarifuddin No. 1, Sukorejo, Situbondo, Jawa Timur 68302',
  Ketua_Dewan_Masyayikh:    'K.H. Afifuddin Muhajir, Lc., M.Ag.',
  Mudir:                    'Ustadz Ahmad Azaim Ibrahimy, M.Pd.I.',
  Takhassus:                'Fiqh dan Ushul Fiqh',
  Konsentrasi:              'Fiqh Muamalah Kontemporer',
  Marhalah:                 'Ula – Wustha – Ulya',
  Visi:                     'Menjadi pusat kajian kitab turats yang unggul, berintegritas, dan berkontribusi bagi peradaban Islam Indonesia',
  Misi:                     '1. Menyelenggarakan pendidikan berbasis sanad keilmuan yang sahih\n2. Mengembangkan bahts ilmiah berbasis kitab turats\n3. Membina SDM yang berakhlak mulia dan berkompetensi tinggi\n4. Mendorong pengabdian masyarakat berbasis nilai pesantren',
  Tahun_Periode_Asesmen:    '2026',
  Waktu_Pelaksanaan_Visitasi_Lapangan: '2026-04-22',
  /** Step 14 (Asesor 2) uses NSPP field instead of NSMA */
  NSPP:                     '510035040001',
  /** Step 14 (Asesor 2) uses Nama_Satuan_Pendidikan not Nama_Satuan_MahadAly */
  Nama_Satuan_Pendidikan:   "Ma'had Aly Salafiyah Syafi'iyah Situbondo",
} as const;

// ── Assessor assignment data (Step 10) ────────────────────────────────────
export const ASESOR_ASSIGNMENT = {
  /** These must match actual AS users in the test DB */
  Assesor_1_Label:          'Dr. Ahmad Fauzi, M.Ag.',
  Assesor_2_Label:          'Ustadz Hasan Basri, M.A.',
  Jadwal_Assesment_Mulai:   '2026-04-20',
  Jadwal_Assesment_Selesai: '2026-04-25',
} as const;

// ── Score per criterion for target Mumtaz (>= 312 total) ─────────────────
// With 29 criteria × avg 11 = 319 (Mumtaz). Assessors give 11 and 11 each.
export const SCORE_MUMTAZ = {
  asesor1: 11,
  asesor2: 11,
} as const;

// Score for target Maqbul (104-207): avg 4/criterion × 29 = 116
export const SCORE_MAQBUL = {
  asesor1: 4,
  asesor2: 4,
} as const;

// Score for boundary Rasib (<104): avg 3/criterion × 29 = 87
export const SCORE_RASIB = {
  asesor1: 3,
  asesor2: 3,
} as const;

// ── Custom-formlist structure (inferred from wf_data_form_level1/level2) ──
//
// Each custom-formlist variable renders as a DynamicTable in the frontend.
// The DynamicTable rows correspond to rows in wf_data_form_level1.
// The score inputs map to wf_data_form_level2.skor_mentah_asesor_N.
//
// DynamicTable cell structure (fillDynamicForm with type='table'):
//   Column 0: no_urut (auto / read-only)
//   Column 1: aspek / indikator (label — read-only in assessor view)
//   Column 2: skor (NUMBER input — filled by assessor)
//   Column 3: catatan (TEXTAREA — optional notes)
//
// For MA submission (_isi), columns may differ:
//   Column 0: no_urut (auto / read-only)
//   Column 1: aspek (label — read-only)
//   Column 2: deskripsi_bukti (TEXTAREA — MA fills evidence description)
//   Column 3: tautan_bukti (TEXT — URL or file reference)
//
// NOTE: Exact column order depends on WfCustomVariabel configuration in DB.
// These are the most likely structures based on Indonesian assessment conventions.

export interface CriterionData {
  /** Human-readable criterion label (for logging/documentation) */
  label: string;
  /** Evidence description filled by MA */
  deskripsi_bukti: string;
  /** Notes filled by assessor */
  catatan_asesor: string;
  /** Score from assessor 1 (for target Mumtaz) */
  skor_asesor1: number;
  /** Score from assessor 2 (for target Mumtaz) */
  skor_asesor2: number;
}

// ── 1A: SKL (Standar Kelulusan / Learning Outcomes) — 1 criterion ─────────
export const CRITERIA_SKL: Record<string, CriterionData> = {
  ma_SKL_1A_1: {
    label:         '1A.1 Profil Lulusan dan Capaian Pembelajaran',
    deskripsi_bukti: 'Dokumen profil lulusan Ma\'had Aly yang menjabarkan kemampuan membaca, memahami, dan mensyarah kitab turats (Fathul Mu\'in, Ihya\' Ulum al-Din, Alfiyah Ibn Malik). Capaian pembelajaran ditetapkan dalam SK Mudir No. 001/SK/MA-SSS/2025.',
    catatan_asesor:  'Profil lulusan telah mencakup 4 domain kompetensi: kognitif, afektif, psikomotorik, dan spiritual. Capaian pembelajaran sesuai standar SNPT Ma\'had Aly.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
};

// ── 1B: KURIKULUM — 4 criteria ────────────────────────────────────────────
export const CRITERIA_KURIKULUM: Record<string, CriterionData> = {
  ma_KURIKULUM_1B_1: {
    label:         '1B.1 Struktur dan Muatan Kurikulum',
    deskripsi_bukti: 'Kurikulum Ma\'had Aly memuat 144 SKS untuk jenjang Marhalah Wustha, mencakup kajian: Tafsir Jalalain, Shahih Bukhari, Alfiyah Ibn Malik, Fathul Mu\'in, Bidayatul Mujtahid, dan Maqashid al-Syariah. Ditetapkan dalam Rapat Pleno Dewan Masyayikh 2025.',
    catatan_asesor:  'Struktur kurikulum memenuhi SNP Ma\'had Aly. Muatan kitab turats tersusun secara sistematis dari tingkat dasar hingga lanjut.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_KURIKULUM_1B_2: {
    label:         '1B.2 Perencanaan Pembelajaran Berbasis Kitab Turats',
    deskripsi_bukti: 'RPP berbasis kitab turats telah disusun oleh seluruh ustadz dengan mengacu pada sanad keilmuan masing-masing. Metode bandongan, sorogan, dan halaqah diterapkan secara konsisten. Terdapat 120 RPP yang telah divalidasi Mudir.',
    catatan_asesor:  'Perencanaan pembelajaran telah mengintegrasikan metode pesantren klasik dengan pendekatan modern. Sanad keilmuan terdokumentasi dengan baik.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_KURIKULUM_1B_3: {
    label:         '1B.3 Pelaksanaan Pembelajaran (Sanad Keilmuan)',
    deskripsi_bukti: 'Proses pembelajaran melibatkan 18 ustadz dengan sanad keilmuan yang terverifikasi langsung ke ulama Haramain. 3 ustadz memiliki ijazah langsung dari Syaikh Ali Jum\'ah (Al-Azhar), 4 dari Syaikh Thoha Jabir al-Ulwani. Dokumentasi ijazah tersimpan di perpustakaan pesantren.',
    catatan_asesor:  'Sanad keilmuan para pendidik sangat kuat dan terverifikasi. Proses pembelajaran kitab turats dilaksanakan dengan metode yang tepat dan konsisten.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_KURIKULUM_1B_4: {
    label:         '1B.4 Penilaian Hasil Pembelajaran',
    deskripsi_bukti: 'Sistem penilaian mencakup ujian lisan (imtihan syafahi) membaca dan mensyarah kitab, ujian tertulis, dan penilaian portofolio bahts ilmiah. Nilai kelulusan minimal 75 untuk setiap mata kajian. 94% santri lulus pada tahun akademik 2024/2025.',
    catatan_asesor:  'Sistem penilaian komprehensif dan sesuai standar Ma\'had Aly. Tingkat kelulusan tinggi menunjukkan efektivitas pembelajaran.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
};

// ── 1C: PENDIDIK DAN TENAGA KEPENDIDIKAN — 4 criteria ────────────────────
export const CRITERIA_PENDIDIK: Record<string, CriterionData> = {
  ma_PENDIDIK_1C_1: {
    label:         '1C.1 Kualifikasi dan Kompetensi Pendidik',
    deskripsi_bukti: 'Dari 18 pendidik: 6 bergelar S3 (Doktor), 10 bergelar S2 (Magister), 2 bergelar S1. Seluruhnya memiliki ijazah pesantren dan sanad keilmuan kitab turats. 12 ustadz pernah menimba ilmu di Timur Tengah (Al-Azhar, Madinah, Yaman). Data terlampir dalam SK Mudir tentang Pendidik.',
    catatan_asesor:  'Kualifikasi pendidik sangat memadai, melampaui standar minimal. Kombinasi kualifikasi akademik formal dan keilmuan pesantren sangat ideal.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENDIDIK_1C_2: {
    label:         '1C.2 Kualifikasi dan Kompetensi Tenaga Kependidikan',
    deskripsi_bukti: 'Tenaga kependidikan berjumlah 24 orang, terdiri dari: Kepala Tata Usaha (S2), 3 staf administrasi (S1), 2 pustakawan (D3 Perpustakaan), 1 teknisi laboratorium (S1 IT), dan tenaga pendukung lainnya. Semua telah mengikuti pelatihan manajemen pendidikan.',
    catatan_asesor:  'Kualifikasi tendik mencukupi untuk mendukung operasional Ma\'had Aly. Perlu peningkatan jumlah tenaga IT.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENDIDIK_1C_3: {
    label:         '1C.3 Pengembangan Pendidik (Kajian Keilmuan)',
    deskripsi_bukti: 'Program pengembangan: (1) Rihlah ilmiyah tahunan ke Timur Tengah untuk 3 ustadz terpilih; (2) Halaqah pengembangan keilmuan setiap bulan; (3) Penugasan penulisan artikel jurnal minimal 1 artikel/ustadz/tahun; (4) Subsidi studi lanjut S3 untuk 2 ustadz per tahun. Anggaran Rp 450 juta/tahun.',
    catatan_asesor:  'Program pengembangan pendidik sangat terstruktur dan berdampak. Dukungan kelembagaan terhadap peningkatan kapasitas pendidik sangat kuat.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENDIDIK_1C_4: {
    label:         '1C.4 Pengelolaan Pendidik dan Tenaga Kependidikan',
    deskripsi_bukti: 'Sistem pengelolaan SDM menggunakan SIMPEG berbasis web. Terdapat SOP rekrutmen, orientasi, evaluasi kinerja tahunan, dan pemberian penghargaan. Evaluasi kinerja dilakukan dua kali setahun oleh Dewan Masyayikh. Seluruh kebijakan SDM tertuang dalam Peraturan Ma\'had Aly No. 002/PMA/2024.',
    catatan_asesor:  'Pengelolaan SDM sangat sistematis dan terstandar. SOP lengkap dan diterapkan secara konsisten.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
};

// ── 1D: PEMBIAYAAN DAN PEMBELAJARAN — 4 criteria ─────────────────────────
export const CRITERIA_PEMBIAYAAN: Record<string, CriterionData> = {
  ma_PEMBIAYAAN_1D_1: {
    label:         '1D.1 Perencanaan Anggaran Pembiayaan',
    deskripsi_bukti: 'RKAT (Rencana Kerja dan Anggaran Tahunan) 2025/2026 telah disusun dengan total anggaran Rp 8,5 miliar, meliputi: operasional pendidikan 45%, SDM 35%, pengembangan 15%, pemeliharaan 5%. Proses penyusunan melibatkan Dewan Masyayikh, Mudir, dan bendahara. Disetujui Ketua Yayasan.',
    catatan_asesor:  'Perencanaan anggaran sangat komprehensif dan transparan. Alokasi pendidikan dan SDM mendominasi, menunjukkan prioritas yang tepat.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PEMBIAYAAN_1D_2: {
    label:         '1D.2 Realisasi Anggaran Pembiayaan',
    deskripsi_bukti: 'Realisasi anggaran 2024/2025: 97,3% dari RKAT terealisasi. Laporan keuangan diaudit oleh KAP independen (Kantor Akuntan Publik Hamid & Rekan). Opini audit: Wajar Tanpa Pengecualian (WTP). Tidak ada temuan material. Laporan tersedia untuk publik di website pesantren.',
    catatan_asesor:  'Realisasi anggaran sangat baik (97,3%). Laporan keuangan diaudit secara profesional dengan hasil WTP. Transparansi keuangan sangat tinggi.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PEMBIAYAAN_1D_3: {
    label:         '1D.3 Sumber dan Mekanisme Pembiayaan',
    deskripsi_bukti: 'Sumber pembiayaan: (1) Syahriah santri 30%; (2) Wakaf produktif (sawah, tambak, koperasi pesantren) 45%; (3) Donasi alumni dan masyarakat 15%; (4) Program pemerintah (BOP, beasiswa PBSB) 10%. Mekanisme pengelolaan menggunakan sistem akuntansi digital terintegrasi.',
    catatan_asesor:  'Diversifikasi sumber pembiayaan sangat baik. Ketergantungan pada syahriah santri rendah, menunjukkan kemandirian finansial yang kuat.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PEMBIAYAAN_1D_4: {
    label:         '1D.4 Transparansi dan Akuntabilitas Pembiayaan',
    deskripsi_bukti: 'Laporan keuangan dipublikasikan setiap semester di website resmi. Terdapat Komite Pengawas Keuangan independen beranggotakan 3 orang (2 akademisi, 1 akuntan publik). Rapat pertanggungjawaban keuangan dilakukan terbuka dihadiri wali santri setiap tahun. ISO 9001:2015 untuk manajemen keuangan.',
    catatan_asesor:  'Akuntabilitas keuangan sangat tinggi dan transparan. Sistem pengawasan berlapis (internal + eksternal + publik) sangat layak dijadikan contoh.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
};

// ── 2: BAHTS / KARYA ILMIAH — 8 criteria ──────────────────────────────────
export const CRITERIA_BAHTS: Record<string, CriterionData> = {
  ma_BAHTS_2_1: {
    label:         '2.1 Kebijakan Penelitian dan Bahts',
    deskripsi_bukti: 'Peraturan Ma\'had Aly No. 003/PMA/2024 tentang Penelitian dan Bahts Ilmiah. Roadmap penelitian 2024-2029 telah ditetapkan dengan 5 tema utama: fiqh kontemporer, ushul fiqh, tafsir tematik, hadis terapan, dan tasawuf modern. Anggaran penelitian Rp 800 juta/tahun.',
    catatan_asesor:  'Kebijakan penelitian sangat komprehensif dan sejalan dengan kekhasan Ma\'had Aly. Roadmap penelitian menunjukkan visi jangka panjang yang jelas.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_BAHTS_2_2: {
    label:         '2.2 Pelaksanaan Penelitian / Bahts Ilmiah',
    deskripsi_bukti: 'Produksi bahts 2024/2025: 34 bahts ilmiah (24 pendidik + 10 santri unggulan), 8 di antaranya dipresentasikan di forum nasional. Topik unggulan: "Hukum Transaksi Digital dalam Perspektif Fiqh Muamalah" (Ustadz Ahmad Muzakki, M.A.), "Rekonstruksi Maqashid al-Syariah untuk Keuangan Syariah" (Dr. Hamid Fahmi, Lc., Ph.D.).',
    catatan_asesor:  'Produktivitas bahts sangat tinggi. Topik penelitian relevan dengan isu kontemporer dan berbasis kitab turats yang kuat.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_BAHTS_2_3: {
    label:         '2.3 Pengelolaan dan Fasilitasi Bahts',
    deskripsi_bukti: 'Pusat Studi dan Bahts Ilmiah (PSBI) Ma\'had Aly dilengkapi: perpustakaan digital 12.000 judul, akses jurnal Scopus dan JSTOR, laboratorium manuskrip, dan ruang diskusi halaqah. Terdapat 2 peneliti senior full-time dan dana riset hibah internal untuk santri. PSBI terakreditasi Kemendikbudristek.',
    catatan_asesor:  'Fasilitas bahts sangat memadai dan terus dikembangkan. Dukungan teknologi informasi untuk penelitian sangat baik.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_BAHTS_2_4: {
    label:         '2.4 Hasil dan Luaran Bahts Ilmiah',
    deskripsi_bukti: 'Luaran 2024/2025: 3 buku teks (diterbitkan Pustaka Ilmu Surabaya), 12 artikel jurnal terakreditasi SINTA 2-3, 4 manuskrip kitab yang ditahqiq dan diterbitkan. Paten: 1 pendaftaran HKI untuk metode pembelajaran kitab digital. Indeks SINTA Ma\'had Aly: 156 poin.',
    catatan_asesor:  'Luaran bahts sangat produktif dan berkualitas. Penerbitan buku teks dan tahqiq manuskrip merupakan kontribusi signifikan bagi khazanah keilmuan Islam.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_BAHTS_2_5: {
    label:         '2.5 Penyebaran dan Pemanfaatan Hasil Bahts',
    deskripsi_bukti: 'Mekanisme diseminasi: (1) Seminar nasional tahunan "Bahtsul Masail Kontemporer" (200+ peserta); (2) Majalah ilmiah "Buhuts al-Islamiyah" terbit 2x/tahun (ISSN 2809-3751); (3) Repository online di repository.mahad-situbondo.ac.id; (4) Kerjasama dengan 15 pesantren mitra untuk transfer ilmu.',
    catatan_asesor:  'Diseminasi hasil bahts sangat efektif dan berdampak luas. Seminar nasional dan majalah ilmiah menjadi media penyebaran yang baik.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_BAHTS_2_6: {
    label:         '2.6 Kerjasama dalam Bahts Ilmiah',
    deskripsi_bukti: 'MoU aktif dengan 8 lembaga: UIN Sunan Ampel Surabaya (kajian manuskrip Nusantara), IAIN Jember (fiqh lokal), Universitas Islam Madinah (pertukaran peneliti), Ma\'had Aly Al-Anwar Sarang (riset bersama), Lajnah Pentashihan Mushaf Al-Qur\'an Kemenag (tahqiq). Dana bersama Rp 200 juta.',
    catatan_asesor:  'Jaringan kerjasama penelitian sangat luas, mencakup lembaga nasional dan internasional. Kerjasama dengan Universitas Islam Madinah menjadi nilai tambah yang signifikan.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_BAHTS_2_7: {
    label:         '2.7 Rekognisi Hasil Bahts (Nasional/Internasional)',
    deskripsi_bukti: 'Penghargaan yang diterima: (1) Juara 1 Kompetisi Bahtsul Masail Nasional 2024 (PBNU); (2) Best Paper Award International Conference on Islamic Studies 2024 (Maroko); (3) Apresiasi Karya Ilmiah Terbaik Kemenag 2025 untuk buku "Fiqh Digital Nusantara". 2 santri meraih beasiswa riset ke Turki.',
    catatan_asesor:  'Rekognisi nasional dan internasional sangat membanggakan. Pencapaian ini membuktikan kualitas bahts ilmiah Ma\'had Aly di kancah global.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_BAHTS_2_8: {
    label:         '2.8 Pengembangan SDM untuk Bahts',
    deskripsi_bukti: 'Program khusus: (1) Training metodologi penelitian kualitatif dan kuantitatif (2x/tahun, 40 peserta); (2) Workshop penulisan artikel jurnal internasional (4x/tahun); (3) Pendampingan intensif santri berbakat dalam bahts (10 santri/tahun, setiap meraih gelar Hafidz dan Faqih); (4) Biaya studi lanjut peneliti senior.',
    catatan_asesor:  'Program pengembangan SDM penelitian sangat terprogram dan berkesinambungan. Perhatian khusus pada santri berbakat sangat positif.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
};

// ── 3: PENGABDIAN KEPADA MASYARAKAT — 8 criteria ─────────────────────────
export const CRITERIA_PENGABDIAN: Record<string, CriterionData> = {
  ma_PENGABDIAN_3_1: {
    label:         '3.1 Kebijakan Pengabdian kepada Masyarakat',
    deskripsi_bukti: 'Renstra Pengabdian Masyarakat Ma\'had Aly 2024-2029, ditetapkan dengan SK Mudir No. 004/SK/MA-SSS/2024. Program unggulan: dakwah masyarakat terpencil, pemberdayaan ekonomi syariah, dan pendidikan non-formal berbasis pesantren. Anggaran Rp 300 juta/tahun.',
    catatan_asesor:  'Kebijakan pengabdian sangat terstruktur dan berbasis kebutuhan masyarakat. Renstra menunjukkan komitmen jangka panjang terhadap pemberdayaan masyarakat.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENGABDIAN_3_2: {
    label:         '3.2 Pelaksanaan Program Pengabdian',
    deskripsi_bukti: 'Program berjalan 2024/2025: (1) Dakwah ke 45 desa di Situbondo-Bondowoso (santri + ustadz, 3x/bulan); (2) Majelis ta\'lim rutin di 12 masjid sekitar pesantren; (3) Pelatihan pertanian halal untuk 200 petani; (4) Klinik hukum Islam gratis (200+ konsultasi); (5) Pengajian Kitab Kuning terbuka untuk umum.',
    catatan_asesor:  'Program pengabdian sangat beragam dan aktif. Jangkauan ke 45 desa menunjukkan dampak yang sangat luas di masyarakat.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENGABDIAN_3_3: {
    label:         '3.3 Pengelolaan dan Pembiayaan Pengabdian',
    deskripsi_bukti: 'LP2M (Lembaga Penelitian dan Pengabdian kepada Masyarakat) Ma\'had Aly mengelola program dengan sistem perencanaan tahunan, monitoring triwulan, dan evaluasi akhir tahun. Sumber dana: BOPMA 40%, infak wakif 35%, hibah CSR BSI 25%. Laporan pengabdian dipublikasikan di website.',
    catatan_asesor:  'Pengelolaan LP2M sangat profesional. Diversifikasi sumber dana pengabdian menunjukkan kemampuan networking yang baik.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENGABDIAN_3_4: {
    label:         '3.4 Hasil dan Dampak Pengabdian',
    deskripsi_bukti: 'Dampak terukur 2024/2025: (1) 1.200 warga desa mengikuti program dakwah rutin; (2) 85 UMKM binaan berhasil mendapat sertifikasi halal; (3) 3 desa mendapat status "Desa Religius" dari pemda; (4) Indeks literasi keuangan syariah masyarakat naik 23% (survei BPS Situbondo); (5) Penghargaan Pesantren Peduli Masyarakat dari Gubernur Jatim.',
    catatan_asesor:  'Dampak pengabdian sangat signifikan dan terukur. Pencapaian konkret seperti sertifikasi halal UMKM dan penghargaan gubernur menunjukkan kualitas tinggi.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENGABDIAN_3_5: {
    label:         '3.5 Kerjasama Pengabdian dengan Masyarakat',
    deskripsi_bukti: 'Mitra aktif: (1) Pemkab Situbondo (program desa binaan); (2) Bank Syariah Indonesia (literasi keuangan syariah); (3) BPJS Ketenagakerjaan (sosialisasi jaminan sosial); (4) Kemenag Situbondo (penyuluhan agama); (5) 25 ormas Islam lokal (koordinasi dakwah). Total nilai kerjasama Rp 1,2 miliar.',
    catatan_asesor:  'Jaringan mitra pengabdian sangat luas, mencakup pemerintah, BUMN, dan organisasi masyarakat. Nilai kerjasama yang besar menunjukkan kepercayaan pemangku kepentingan.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENGABDIAN_3_6: {
    label:         '3.6 Keberlanjutan Program Pengabdian',
    deskripsi_bukti: 'Indikator keberlanjutan: (1) 90% program tahun lalu dilanjutkan/diperluas tahun ini; (2) Pembentukan 8 kelompok alumni di desa-desa binaan sebagai kader pengabdian mandiri; (3) Dokumentasi best practice yang menjadi modul pelatihan; (4) Dana abadi pengabdian (wakaf produktif) Rp 1,5 miliar.',
    catatan_asesor:  'Keberlanjutan program sangat terjamin melalui kader alumni dan dana abadi. Model ini menjadi contoh baik bagi Ma\'had Aly lainnya.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENGABDIAN_3_7: {
    label:         '3.7 Integrasi Pengabdian dengan Pembelajaran',
    deskripsi_bukti: 'KKN (Kuliah Kerja Nyata) Ma\'had Aly wajib selama 40 hari, terintegrasi dalam kurikulum sebagai 4 SKS. Materi pengabdian dimasukkan dalam kurikulum: fiqh zakat kontemporer, ekonomi Islam terapan, dan dakwah bil hikmah. 100% santri tahun akhir mengikuti KKN berbasis pengabdian.',
    catatan_asesor:  'Integrasi pengabdian dan pembelajaran sangat baik melalui KKN wajib. Bobot 4 SKS menunjukkan komitmen kurikuler yang serius terhadap pengabdian masyarakat.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
  ma_PENGABDIAN_3_8: {
    label:         '3.8 Rekognisi Pengabdian',
    deskripsi_bukti: 'Penghargaan pengabdian: (1) Pesantren Pengabdian Terbaik se-Jawa Timur 2024 (PWNU Jatim); (2) Award for Community Engagement ASEAN Islamic Universities Network 2024; (3) Liputan media nasional (Kompas, Republika) tentang program dakwah terpencil; (4) Studi tiru dari 23 Ma\'had Aly dan pesantren lain.',
    catatan_asesor:  'Rekognisi pengabdian sangat membanggakan di tingkat regional dan ASEAN. Menjadi referensi bagi lembaga lain membuktikan kualitas dan dampak program.',
    skor_asesor1:  11,
    skor_asesor2:  11,
  },
};

// ── Decision variables ─────────────────────────────────────────────────────
export const PRAVISITASI_DECISIONS = {
  lanjutkan: 'Ya',
  tidakLanjutkan: 'Tidak',
} as const;

export const FINAL_DECISIONS = {
  mumtaz: {
    status: 'Lulus Asesmen',
    peringkat: 'Mumtaz (A/ Unggul)',
    minScore: 312,
  },
  jayyid: {
    status: 'Lulus Asesmen',
    peringkat: 'Jayyid (B/ Baik Sekali)',
    minScore: 208,
  },
  maqbul: {
    status: 'Lulus Asesmen',
    peringkat: 'Maqbul (C/ Baik)',
    minScore: 104,
  },
  rasib: {
    status: 'Tidak Lulus Asesmen',
    peringkat: 'Rasib (Tidak Lulus Asesmen)',
    minScore: 0,
  },
} as const;

// ── All criteria in workflow order ─────────────────────────────────────────
export const ALL_CRITERIA = {
  ...CRITERIA_SKL,
  ...CRITERIA_KURIKULUM,
  ...CRITERIA_PENDIDIK,
  ...CRITERIA_PEMBIAYAAN,
  ...CRITERIA_BAHTS,
  ...CRITERIA_PENGABDIAN,
} as const;

export const CRITERIA_KEYS = Object.keys(ALL_CRITERIA) as Array<keyof typeof ALL_CRITERIA>;

// ── Workflow step title patterns (for waitForLocator assertions) ───────────
export const STEP_TITLES = {
  step0:     'Pengajuan Asessment (Informasi Umum)',
  step2:     'Draft Pengajuan Asessment (SKL)',
  step3:     'Pengajuan Asessment (Kurikulum)',
  step4:     'Pengajuan Asessment (Pendidik dan Tendik)',
  step5:     'Pengajuan Asessment(Pembiayaan dan Pembelajaran)',
  step6:     'Pengajuan Asessment(Karya Ilmiah)',
  step7:     'Pengajuan Asessment(Pengabdian)',
  step10:    'Penunjukan Asesor dan Jadwal Asessment',
  step13:    'Penilaian Pra Visitasi Asessor 1 (Informasi Umum)',
  step14:    'Penilaian Pra Visitasi Asessor 2 (Informasi Umum)',
  step15:    'Penilaian Pra Visitasi Asessor 1 (SKL)',
  step20:    'Penilaian Pra Visitasi Asessor 1 (Pengabdian)',
  step21:    'Penilaian Pra Visitasi Asessor 2 (SKL)',
  step26:    'Penilaian Pra Visitasi Asessor 2 (Pengabdian)',
  step30:    'Revisi berkas dokumen(SKL)',
  step36:    'Penilaian Hasil Visitasi Asessor 1(SKL)',
  step43:    'Penilaian Hasil Visitasi Asessor 1(Laporan Asessment)',
  step44:    'Penilaian Hasil Visitasi Asessor 2 (SKL)',
  step50:    'Penilaian Hasil Visitasi Asessor 2(Laporan Asessment)',
  step57:    'Validasi Dewan Asessment(SKL)',
  step63:    'Validasi Dewan Asessment(Laporan Asessment)',
  step64:    'Penetapan Hasil Visitasi',
  step66:    'Penetapan Hasil Visitasi (Nilai Akhir)',
  step67:    'Upload Sertifikat SPME',
  step70:    'Hasil SPME',
} as const;

// ── API payload types (mirrors recommendationService.ts types) ─────────────
export interface ChooseTaskPayload {
  task_id: string;
  lembaga: string;
  role: string;
  username: string;
}

export interface ResponseTaskPayload {
  username: string;
  lembaga: string;
  role: string;
  task_id: string;
  form_data_input: Record<string, unknown>;
  decision_result: 'true' | 'false' | 'save';
}
