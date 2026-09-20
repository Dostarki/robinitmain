// Run legacy queue tests against throwaway storage, never the application data directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = ['queue-system.test.js', 'provider-mock.test.js'];
let failed = false;
for (const file of files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'robinity-queue-suite-'));
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      env: { ...process.env, QUEUE_DATA_DIR: directory }, stdio: 'inherit', timeout: 30000,
    });
    if (result.status !== 0) failed = true;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
process.exitCode = failed ? 1 : 0;
