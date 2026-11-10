const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunner } = require('./command.cjs');

test('command failures identify the step without printing subprocess secrets', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foodmenu-command-test-'));
  try {
    const run = createRunner(directory, () => ({ status: 1, stderr: 'credential helper error secret-token', stdout: '' }));
    assert.throws(() => run('docker', ['login'], { stage: 'Docker ECR login', input: 'stdin-token' }), error => {
      assert.match(error.message, /Docker ECR login failed/);
      assert.match(error.message, /credential-store/);
      assert.doesNotMatch(error.message, /secret-token|stdin-token/);
      return true;
    });
    const file = path.join(directory, 'errors', fs.readdirSync(path.join(directory, 'errors'))[0]);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(file, 'utf8'), /secret-token/);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /stdin-token/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('Docker daemon failure has an actionable hint', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'foodmenu-command-test-'));
  try {
    const run = createRunner(directory, () => ({ status: 1, stderr: 'connection refused' }));
    assert.throws(() => run('docker', ['info']), /Start Docker Desktop/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('successful commands preserve output and consume stage outside spawn options', () => {
  const run = createRunner('/unused', (bin, args, options) => {
    assert.equal(options.stage, undefined);
    return { status: 0, stdout: ' success\n' };
  });
  assert.equal(run('docker', ['version'], { stage: 'Docker version' }), 'success');
});

test('stdin input reaches commands using password-stdin', () => {
  const run = createRunner('/unused');
  assert.equal(run(process.execPath, ['-e', 'process.stdout.write(require("node:fs").readFileSync(0,"utf8"))'], {
    stage: 'Stdin transport check', input: 'fixture-input',
  }), 'fixture-input');
});
