import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = createDb(config.dbPath);
const app = createApp({
  db,
  uploadsDir: config.uploadsDir,
  publicDir: config.publicDir,
  pin: config.pin,
  areas: config.areas,
  shiftStarts: config.shiftStarts,
});

const server = app.listen(config.port, () => {
  console.log(`SnapBox listening on http://0.0.0.0:${config.port}`);
  console.log(`  start  -> /`);
  console.log(`  hub    -> /hub`);
  for (const a of config.areas) {
    console.log(`  ${a.label.padEnd(6)} -> /line/${a.key}/1 .. /line/${a.key}/${a.lines}`);
  }
  if (!config.pin) {
    console.log('  WARNING: SNAPBOX_PIN is not set — approve/delete/feedback are OPEN to the network.');
  }
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
