import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// The tablet resizes the photo in the browser before upload, so the server just
// stores the received bytes — no native image library (keeps us clear of the
// endpoint security block on libvips/sharp). The single stored file doubles as
// its own thumbnail (the hub scales it with CSS).
export async function savePhoto(buffer, uploadsDir, mimetype = 'image/jpeg') {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const ext = EXT_BY_MIME[String(mimetype).toLowerCase()] || 'jpg';
  const name = `${Date.now()}-${randomUUID()}.${ext}`;
  await fs.promises.writeFile(path.join(uploadsDir, name), buffer);
  const web = `/uploads/${name}`;
  return { photo_path: web, thumb_path: web };
}
