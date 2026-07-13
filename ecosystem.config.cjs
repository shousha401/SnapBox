// PM2 config. Named .cjs because package.json is an ES module ("type":"module").
// Start with:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'SnapBox',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        PORT: 4200,
        // Set a real PIN before going live — this gates approve/delete/feedback.
        SNAPBOX_PIN: 'change-me',
        SNAPBOX_TABLES: 4,
        // Optional multi-shift boundaries, e.g. '06:00,18:00'. Empty = one daily shift.
        SNAPBOX_SHIFTS: '',
      },
    },
  ],
};
