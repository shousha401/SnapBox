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
  tableCount: config.tableCount,
  shiftStarts: config.shiftStarts,
});

const server = app.listen(config.port, () => {
  const tables = Array.from({ length: config.tableCount }, (_, i) => i + 1).join('..');
  console.log(`SnapBox listening on http://0.0.0.0:${config.port}`);
  console.log(`  hub    -> /hub`);
  console.log(`  tables -> /table/${tables}`);
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
