import { mkdir, copyFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
const targetDirectory = resolve(root, 'public/pdfjs');
await mkdir(targetDirectory, { recursive: true });
if ((await stat(source)).size < 100_000) throw new Error('PDF.js worker appears incomplete.');
await copyFile(source, resolve(targetDirectory, 'pdf.worker.min.mjs'));
