#!/usr/bin/env ts-node
/**
 * SPME Ma'had Aly — PDF Fixture Generator
 *
 * Creates 7 minimal valid PDF files for Playwright upload testing.
 * Uses only Node.js built-ins — no external PDF library required.
 *
 * Run once before the test suite:
 *   npx ts-node e2e/fixtures/spme/generate-pdfs.ts
 *   # or
 *   node -r ts-node/register e2e/fixtures/spme/generate-pdfs.ts
 *
 * Output: e2e/fixtures/spme/*.pdf (7 files, ~500 bytes each)
 *
 * These PDFs are minimal but structurally valid (correct xref, trailer).
 * The backend upload handler (POST /api/uploadfile1) accepts them.
 */

import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve(__dirname);

// ── Minimal PDF builder ────────────────────────────────────────────────────
// Produces a single-page PDF with Helvetica text. Only ASCII content to
// avoid encoding issues in the PDF string literal syntax.

function createMinimalPdf(title: string, subtitle: string): Buffer {
  // Sanitise for use inside PDF literal strings (ISO-8859-1 subset)
  const esc = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .slice(0, 70);   // keep well under line-length limits

  const line1 = esc(title);
  const line2 = esc(subtitle);

  const streamContent = [
    'BT',
    '/F1 14 Tf',
    '72 740 Td',
    `(${line1}) Tj`,
    '0 -20 Td',
    '/F1 11 Tf',
    `(${line2}) Tj`,
    'ET',
  ].join(' ');

  // PDF objects — order matches the xref table (1=Catalog, 2=Pages, 3=Page, 4=Stream, 5=Font)
  const header = '%PDF-1.4\n';
  const obj1   = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  const obj2   = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  const obj3   = [
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]',
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    'endobj',
    '',
  ].join('\n');
  const streamLen = Buffer.byteLength(streamContent, 'ascii');
  const obj4   = `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
  const obj5   = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  // Byte offsets for xref (ASCII-only content: charLength === byteLength)
  const o1 = header.length;
  const o2 = o1 + obj1.length;
  const o3 = o2 + obj2.length;
  const o4 = o3 + obj3.length;
  const o5 = o4 + obj4.length;
  const xrefStart = o5 + obj5.length;

  const pad10 = (n: number) => n.toString().padStart(10, '0');

  // PDF xref entries MUST be exactly 20 bytes each (incl. trailing ' \n')
  const xref = [
    'xref',
    '0 6',
    `0000000000 65535 f `,
    `${pad10(o1)} 00000 n `,
    `${pad10(o2)} 00000 n `,
    `${pad10(o3)} 00000 n `,
    `${pad10(o4)} 00000 n `,
    `${pad10(o5)} 00000 n `,
    '',
  ].join('\n');

  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const pdfContent = header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer;
  return Buffer.from(pdfContent, 'ascii');
}

// ── File definitions ───────────────────────────────────────────────────────

const PDF_FILES: Array<{ filename: string; title: string; subtitle: string }> = [
  {
    filename: 'laporan_keuangan_mahad.pdf',
    title: 'Laporan Keuangan Ma\'had Aly - Asesor 1',
    subtitle: 'Periode 2024/2025 - Audit WTP - Test Fixture',
  },
  {
    filename: 'laporan_asesmen_mahad.pdf',
    title: 'Laporan Asesmen Ma\'had Aly - Asesor 1',
    subtitle: 'Penilaian Hasil Visitasi - Test Fixture',
  },
  {
    filename: 'berita_acara_visitasi.pdf',
    title: 'Berita Acara Visitasi - Asesor 1',
    subtitle: 'Pelaksanaan Visitasi Lapangan - Test Fixture',
  },
  {
    filename: 'laporan_keuangan_mahad_as2.pdf',
    title: 'Laporan Keuangan Ma\'had Aly - Asesor 2',
    subtitle: 'Periode 2024/2025 - Audit WTP - Test Fixture',
  },
  {
    filename: 'laporan_asesmen_mahad_as2.pdf',
    title: 'Laporan Asesmen Ma\'had Aly - Asesor 2',
    subtitle: 'Penilaian Hasil Visitasi - Test Fixture',
  },
  {
    filename: 'berita_acara_visitasi_as2.pdf',
    title: 'Berita Acara Visitasi - Asesor 2',
    subtitle: 'Pelaksanaan Visitasi Lapangan - Test Fixture',
  },
  {
    filename: 'sertifikat_spme_mahad_aly.pdf',
    title: 'Sertifikat SPME Ma\'had Aly',
    subtitle: 'Lulus Asesmen - Mumtaz (A/Unggul) - Test Fixture',
  },
];

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let created = 0;
  let skipped = 0;

  for (const { filename, title, subtitle } of PDF_FILES) {
    const outPath = path.join(OUTPUT_DIR, filename);

    if (fs.existsSync(outPath)) {
      console.log(`  skip  ${filename}  (already exists)`);
      skipped++;
      continue;
    }

    const pdfBuffer = createMinimalPdf(title, subtitle);
    fs.writeFileSync(outPath, pdfBuffer);
    console.log(`  wrote ${filename}  (${pdfBuffer.length} bytes)`);
    created++;
  }

  console.log(`\nDone — ${created} created, ${skipped} skipped.`);
  console.log(`Output directory: ${OUTPUT_DIR}`);
}

main();
