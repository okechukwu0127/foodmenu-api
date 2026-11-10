const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

function createRunner(directory, spawn = cp.spawnSync) {
  return function run(bin, args, options = {}) {
    const { stage = `${bin} command`, ...spawnOptions } = options;
    const result = spawn(bin, args, {
      encoding: 'utf8', stdio: [spawnOptions.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024, ...spawnOptions,
    });
    if (result.error || result.status !== 0) {
      const errors = path.join(directory, 'errors');
      fs.mkdirSync(errors, { recursive: true, mode: 0o700 });
      const file = path.join(errors, `${Date.now()}-${crypto.randomUUID()}.log`);
      // Only local private files receive subprocess output. Never log stdin,
      // argv, or the subprocess environment: they may contain credentials.
      const details = `${stage}\nExit: ${result.status ?? result.error?.code}\n${result.error?.message || ''}\n${result.stdout || ''}\n${result.stderr || ''}`;
      fs.writeFileSync(file, details, { mode: 0o600, flag: 'wx' });
      const stderr = String(result.stderr || '');
      let hint = '';
      if (bin === 'docker' && args[0] === 'info')
        hint = ' Start Docker Desktop and confirm `docker info` succeeds in this terminal.';
      else if (bin === 'docker' && args[0] === 'login')
        hint = /credential|keychain/i.test(stderr)
          ? ' Docker reported a credential-store problem. Check Docker Desktop and its macOS Keychain access.'
          : ' Docker could not sign in to ECR. Check the private log for authentication or network details.';
      throw new Error(`${stage} failed (${result.status ?? result.error?.code}).${hint}\nPrivate diagnostic log: ${file}\nThe log may contain secrets; inspect it locally and do not share it unredacted.`);
    }
    return result.stdout?.trim();
  };
}
module.exports = { createRunner };
