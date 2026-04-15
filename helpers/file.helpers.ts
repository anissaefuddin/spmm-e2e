import path from 'path';

const FILES_DIR = path.resolve(__dirname, '../test-data/files');

export const TEST_FILES = {
  pdf: path.join(FILES_DIR, 'sample.pdf'),
  jpg: path.join(FILES_DIR, 'sample.jpg'),
} as const;
