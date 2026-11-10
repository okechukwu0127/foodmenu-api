// Disposable local stack. Uses generated fixtures, never reads the project's .env.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { cloudEnvironment, serialize } = require('./environment.cjs');
const root = path.resolve(__dirname, '../..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'foodmenu-cloud-smoke-'));
const project = `foodmenu-cloud-smoke-${Date.now()}`;
fs.copyFileSync(path.join(root, 'infra/deploy/compose.yml'), path.join(work, 'compose.yml'));
fs.mkdirSync(path.join(work, 'uploads/profile-photos'), { recursive: true });
fs.mkdirSync(path.join(work, 'assets'));
fs.writeFileSync(path.join(work, 'assets/review.txt'), 'asset smoke check');
const env = cloudEnvironment({ EMAIL_VERIFICATION_SECRET: 'test-secret-'.repeat(4), STRIPE_SECRET_KEY: 'sk_test_fixture', SMTP_PASSWORD: "$value'word", FOODMENU_APP_URL: '*' }, undefined, 'https://example.test');
fs.writeFileSync(path.join(work, '.env'), serialize(env), { mode: 0o600 });
fs.writeFileSync(path.join(work, '.release.env'), 'RUNTIME_IMAGE=foodmenu:terraform-review\nTOOLS_IMAGE=foodmenu:terraform-tools-review\n');
function compose(args, optional = false) {
  const result = cp.spawnSync('docker', ['compose', '-p', project, '--project-directory', work, '--env-file', path.join(work, '.env'), '--env-file', path.join(work, '.release.env'), '-f', path.join(work, 'compose.yml'), ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (!optional && result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result;
}
// Suppress host port publication; checks run from inside the gateway container.
const composeText = fs.readFileSync(path.join(work, 'compose.yml'), 'utf8').replace('ports: ["127.0.0.1:4000:4000"]', 'ports: []');
fs.writeFileSync(path.join(work, 'compose.yml'), composeText);
try {
  const config = JSON.parse(compose(['--profile', 'tools', 'config', '--format', 'json']).stdout);
  assert.equal(Object.keys(config.services).length, 7);
  for (const service of Object.values(config.services)) assert.ok(!service.ports?.length);
  compose(['up', '-d', '--wait', 'postgres']);
  compose(['run', '--rm', 'tools', 'npx', 'prisma', 'migrate', 'deploy']);
  compose(['up', '-d']);
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    const result = compose(['exec', '-T', 'api-gateway', 'node', '-e', 'fetch("http://127.0.0.1:4000/api/v1/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'], true);
    if (result.status === 0) { healthy = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  if (!healthy) throw new Error('Gateway did not become healthy.');
  const secret = compose(['exec', '-T', 'api-gateway', 'node', '-e', 'console.log(JSON.stringify(process.env.SMTP_PASSWORD))']);
  assert.equal(JSON.parse(secret.stdout), "$value'word");
  compose(['exec', '-T', 'api-gateway', 'node', '-e', 'Promise.all([fetch("http://127.0.0.1:4000/assets/review.txt").then(async r=>{if(await r.text()!=="asset smoke check")throw Error("asset")}),fetch("http://127.0.0.1:4000/api/v1/menu/foods").then(r=>{if(r.status!==200)throw Error("menu RPC")}),fetch("http://127.0.0.1:4000/api/v1/auth/me").then(r=>{if(r.status!==401)throw Error("auth")})]).catch(e=>{console.error(e);process.exit(1)})']);
  const running = compose(['ps', '--status', 'running', '--services']).stdout.trim().split('\n');
  assert.equal(running.length, 6);
  const schema = compose(['exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \'SELECT count(*) FROM "PaymentCommerceEvent"\'']);
  assert.equal(schema.stdout.trim(), '0');
  console.log('Cloud stack smoke passed: migrations, six running containers, health, protected auth, assets, literal SMTP password, commerce event table.');
} finally {
  compose(['down', '--volumes', '--remove-orphans'], true);
  fs.rmSync(work, { recursive: true, force: true });
}
