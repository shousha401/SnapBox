import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Compress an uploaded image into a full-size JPEG + a small thumbnail.
 * Returns web paths (served under /uploads) to store in the DB.
 */
export async function savePhoto(buffer, uploadsDir) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const base = `${Date.now()}-${randomUUID()}`;
  const fullName = `${base}.jpg`;
  const thumbName = `${base}.thumb.jpg`;

  await sharp(buffer)
    .rotate() // honour EXIF orientation from tablet cameras
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(path.join(uploadsDir, fullName));

  await sharp(buffer)
    .rotate()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toFile(path.join(uploadsDir, thumbName));

  return { photo_path: `/uploads/${fullName}`, thumb_path: `/uploads/${thumbName}` };
}
