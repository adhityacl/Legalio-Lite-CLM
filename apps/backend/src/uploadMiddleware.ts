import multer from 'multer';
/** Multipart parser shared by the AI document-parse endpoints (memory storage, 30 MB). */

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});
