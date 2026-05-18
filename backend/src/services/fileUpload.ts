import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function makeStorage(subdir: string) {
  const dir = path.resolve(env.UPLOAD_DIR, subdir);
  ensureDir(dir);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dir),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  });
}

const imageFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = /jpeg|jpg|png|gif|webp|svg/i;
  if (allowed.test(path.extname(file.originalname))) cb(null, true);
  else cb(new Error('Only image files are allowed (jpg, png, gif, webp, svg)'));
};

const importFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = /xlsx|xls|csv|json/i;
  if (allowed.test(path.extname(file.originalname))) cb(null, true);
  else cb(new Error('Only xlsx, csv, or json files are allowed'));
};

// ── Configured uploaders ──────────────────────────────────────

/** Logo upload: /uploads/logos/ — max 5MB, images only */
export const uploadLogo = multer({
  storage: makeStorage('logos'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
}).single('logo');

/** Signature upload: /uploads/signatures/ — max 2MB, images only */
export const uploadSignature = multer({
  storage: makeStorage('signatures'),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: imageFilter,
}).single('signature');

/** Item image upload: /uploads/items/ — max 5MB */
export const uploadItemImage = multer({
  storage: makeStorage('items'),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFilter,
}).single('image');

/** Import file upload: /uploads/imports/ — max 10MB, xlsx/csv/json */
export const uploadImportFile = multer({
  storage: makeStorage('imports'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: importFilter,
}).single('file');

/** Bill attachment upload: /uploads/bills/ — max 10MB */
export const uploadBill = multer({
  storage: makeStorage('bills'),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('bill');

/** Invoice attachment upload: /uploads/invoice-attachments/ — max 10MB */
export const uploadInvoiceAttachment = multer({
  storage: makeStorage('invoice-attachments'),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('file');

/** Employee document upload: /uploads/employees/ — max 10MB */
export const uploadEmployeeDocument = multer({
  storage: makeStorage('employees'),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single('document');

/**
 * Get the public URL path for an uploaded file
 */
export function getUploadUrl(filepath: string): string {
  const uploadDir = path.resolve(env.UPLOAD_DIR);
  const relative = path.relative(uploadDir, filepath);
  return `/uploads/${relative.replace(/\\/g, '/')}`;
}
