import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseShifts } from './shift.js';
import { parseAreas } from './areas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, '..');

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 4200),
    pin: env.SNAPBOX_PIN || '',
    areas: parseAreas(env),
    shiftStarts: parseShifts(env.SNAPBOX_SHIFTS),
    dbPath: env.SNAPBOX_DB || path.join(root, 'data', 'snapbox.db'),
    uploadsDir: env.SNAPBOX_UPLOADS || path.join(root, 'uploads'),
    publicDir: path.join(root, 'public'),
  };
}
