#!/usr/bin/env node
// Explicit operator commands; this script never applies Terraform.
const fs = require('node:fs');
const path = require('node:path');
const { createRunner } = require('./command.cjs');
const { waitForSsm } = require('./readiness.cjs');
const dotenv = require('dotenv');
const { cloudEnvironment, serialize, pgConnection } = require('./environment.cjs');
const root = path.resolve(__dirname, '../..');
const work = path.join(root, '.cloud');
const tf = path.join(root, 'infra/terraform/staging');
const profile = process.env.AWS_PROFILE || 'foodmenu-deploy-PowerUserAccess-844706634415';
const command = process.argv[2];
if (!['prepare', 'migrate', 'deploy', 'backup', 'seed'].includes(command)) {
  console.error('Usage: node scripts/cloud/manage.cjs prepare|migrate|deploy|backup|seed'); process.exit(1);
}
fs.mkdirSync(work, { recursive: true, mode: 0o700 });
process.chdir(root);
const run = createRunner(work);
function write(file, content) { fs.writeFileSync(file, content, { mode: 0o600 }); fs.chmodSync(file, 0o600); }
function quote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
const outputs = JSON.parse(run('terraform', [`-chdir=${tf}`, 'output', '-json']));
function output(key) { if (!outputs[key]?.value) throw new Error(`Missing Terraform output: ${key}. Apply the reviewed plan first.`); return outputs[key].value; }
const region = output('region');
function aws(args) {
  return run('aws', [...args, '--profile', profile, '--region', region], { stage: `AWS ${args[0]} ${args[1]}` });
}
function ensureSsmOnline() {
  waitForSsm({
    instanceId: output('instance_id'), region,
    read: () => JSON.parse(aws(['ssm', 'describe-instance-information', '--filters', `Key=InstanceIds,Values=${output('instance_id')}`, '--output', 'json'])).InstanceInformationList,
    sleep: () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000),
    report: message => console.log(message),
  });
}
function ssm(shellCommand) {
  const file = path.join(work, 'ssm-parameters.json');
  write(file, JSON.stringify({ commands: [shellCommand], executionTimeout: ['1200'] }));
  const id = aws(['ssm', 'send-command', '--instance-ids', output('instance_id'), '--document-name', 'AWS-RunShellScript', '--parameters', `file://${file}`, '--query', 'Command.CommandId', '--output', 'text']);
  console.log(`SSM command ${id} submitted; waiting for completion.`);
  for (let i = 0; i < 150; i++) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
    const invocations = JSON.parse(aws(['ssm', 'list-command-invocations', '--command-id', id, '--output', 'json'])).CommandInvocations;
    const status = invocations[0]?.Status;
    if (status === 'Success') { console.log('Remote command completed.'); return; }
    if (['Failed', 'Cancelled', 'TimedOut', 'Cancelling'].includes(status)) throw new Error(`Remote command ${status}; inspect SSM Run Command privately (ID ${id}).`);
  }
  throw new Error(`SSM command still pending: ${id}. Check its status before retrying.`);
}
const bucket = output('artifacts_bucket');
function upload(file, key) { aws(['s3', 'cp', file, `s3://${bucket}/${key}`, '--only-show-errors']); }
function remote(mode, release) {
  const key = `deploy/${release}/remote.sh`;
  const cmd = `for i in $(seq 1 60); do test -e /var/lib/foodmenu/bootstrap-complete && break; sleep 5; done; test -e /var/lib/foodmenu/bootstrap-complete && aws s3 cp ${quote(`s3://${bucket}/${key}`)} /tmp/foodmenu-remote.sh --region ${quote(region)} --only-show-errors && bash /tmp/foodmenu-remote.sh ${[mode, region, bucket, output('runtime_parameter'), release].map(quote).join(' ')}`;
  ssm(cmd);
}
const metadataFile = path.join(work, 'deployment.json');
try {
  // Require remote state for deployment; preview plans can use local state.
  const backend = JSON.parse(fs.readFileSync(path.join(tf, '.terraform/terraform.tfstate'), 'utf8'));
  if (backend.backend?.type !== 's3') throw new Error('Configure the S3 Terraform backend before deployment (see AWS deployment guide).');
  if (command === 'migrate' && !fs.existsSync(metadataFile)) throw new Error('Preparation has not completed: run `node scripts/cloud/manage.cjs prepare` successfully before `migrate`.');
  console.log(`Checking SSM readiness in ${region}...`);
  ensureSsmOnline();
  if (command === 'backup') { ssm(`bash /srv/foodmenu/backup.sh ${[bucket, region].map(quote).join(' ')}`); }
  else if (command === 'seed') {
    // Additive, idempotent catalogue seed (prisma/seed.ts) using the tools image of
    // the current release, then publish prisma/ai-concierge-config.json as the active AI
    // configuration (versioned by content hash; older versions are kept, a re-run is a
    // no-op). Run `deploy` first so the image contains the latest seed files.
    if (!fs.existsSync(metadataFile)) throw new Error('No deployment recorded; run `deploy` before `seed`.');
    ssm(`bash /srv/foodmenu/backup.sh ${[bucket, region].map(quote).join(' ')}`);
    ssm('cd /srv/foodmenu && docker compose --env-file .env --env-file .release.env -f compose.yml --profile tools run --rm tools sh -c "npm run prisma:seed && npm run ai:seed"');
    console.log(`Catalogue seeded and AI configuration published. Verify ${output('api_url')}/api/v1/menu/bootstrap and /api/v1/ai/config?locale=en.`);
  }
  else if (command === 'migrate') {
    if (!fs.existsSync(metadataFile)) throw new Error('Preparation has not completed: run `node scripts/cloud/manage.cjs prepare` successfully before `migrate`. The deployment metadata is created automatically; do not create it manually.');
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    if (metadata.instance !== output('instance_id') || metadata.bucket !== bucket) throw new Error('Prepared deployment belongs to a different target.');
    const local = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
    const dump = path.join(work, 'database.dump');
    const connection = pgConnection(local.DATABASE_URL);
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(connection.PGHOST)) connection.PGHOST = 'host.docker.internal';
    const fd = fs.openSync(dump, 'w', 0o600);
    try { run('docker', ['run', '--rm', '--add-host=host.docker.internal:host-gateway', ...Object.keys(connection).flatMap(key => ['--env', key]), 'postgres:16-alpine', 'pg_dump', '--format=custom', '--no-owner', '--no-acl'], { env: { ...process.env, ...connection }, stdio: ['ignore', fd, 'pipe'] }); } finally { fs.closeSync(fd); }
    const mediaRoot = path.join(work, 'media');
    fs.rmSync(mediaRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(mediaRoot, 'uploads/profile-photos'), { recursive: true, mode: 0o700 });
    const photoDir = path.resolve(root, local.PROFILE_PHOTO_STORAGE_DIR || 'uploads/profile-photos');
    if (fs.existsSync(photoDir)) fs.cpSync(photoDir, path.join(mediaRoot, 'uploads/profile-photos'), { recursive: true });
    fs.cpSync(path.join(root, 'public/assets'), path.join(mediaRoot, 'assets'), { recursive: true });
    const media = path.join(work, 'media.tar.gz');
    run('tar', ['-czf', media, '-C', mediaRoot, 'uploads', 'assets']); fs.chmodSync(media, 0o600);
    upload(dump, `deploy/${metadata.release}/database.dump`);
    upload(media, `deploy/${metadata.release}/media.tar.gz`);
    remote('restore', metadata.release);
    console.log(`Data restored and services started. Verify ${output('api_url')}/api/v1/health and account/order data before switching the mobile app.`);
  } else {
    console.log('Checking local Docker...');
    run('docker', ['info'], { stage: 'Local Docker readiness check' });
    run('docker', ['buildx', 'version'], { stage: 'Docker ARM64 builder check' });
    if (command === 'deploy') ssm(`bash /srv/foodmenu/backup.sh ${[bucket, region].map(quote).join(' ')}`);
    const release = new Date().toISOString().replace(/[-:.]/g, '');
    const directory = path.join(work, release); fs.mkdirSync(directory, { mode: 0o700 });
    const repository = output('repository_url');
    const registry = repository.split('/')[0];
    const password = aws(['ecr', 'get-login-password']);
    console.log(`Signing Docker in to ECR (${region})...`);
    run('docker', ['login', '--username', 'AWS', '--password-stdin', registry], { input: password, stage: 'Docker ECR login' });
    for (const target of ['runner', 'tools']) {
      const tag = `${repository}:${target === 'runner' ? 'runtime' : 'tools'}-${release}`;
      console.log(`Building and publishing ARM64 ${target} image...`);
      run('docker', ['buildx', 'build', '--platform', 'linux/arm64', '--target', target, '--tag', tag, '--push', '.'], { stdio: 'inherit', stage: `Build and publish ${target} image` });
    }
    const cloudFile = path.join(work, 'staging.env');
    const source = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
    // Generated DB passwords are hex, preserved across deployments.
    const previous = fs.existsSync(cloudFile) ? dotenv.parse(fs.readFileSync(cloudFile)) : undefined;
    if (command === 'deploy' && !previous) throw new Error('Missing saved cloud environment; recover it from SSM before deploying to preserve the DB password.');
    const envText = serialize(cloudEnvironment(source, previous, output('api_url')));
    if (Buffer.byteLength(envText) > 8192) throw new Error('Cloud environment exceeds SSM Advanced 8 KiB; split it before deployment.');
    write(cloudFile, envText);
    aws(['ssm', 'put-parameter', '--name', output('runtime_parameter'), '--type', 'SecureString', '--tier', 'Advanced', '--value', `file://${cloudFile}`, '--overwrite']);
    for (const name of ['compose.yml', 'remote.sh', 'backup.sh']) fs.copyFileSync(path.join(root, 'infra/deploy', name), path.join(directory, name));
    // Static assets (category icons etc.) ride along in the release archive, which the
    // server unpacks into /srv/foodmenu: new and changed files land in ./assets
    // (mounted into the gateway); nothing there is deleted.
    fs.cpSync(path.join(root, 'public/assets'), path.join(directory, 'assets'), { recursive: true, filter: source => path.basename(source) !== '.DS_Store' });
    write(path.join(directory, '.release.env'), `RUNTIME_IMAGE=${repository}:runtime-${release}\nTOOLS_IMAGE=${repository}:tools-${release}\n`);
    write(path.join(directory, 'nginx.conf'), fs.readFileSync(path.join(root, 'infra/deploy/nginx.conf.template'), 'utf8').replace('__ORIGIN_TOKEN__', output('origin_token')));
    const archive = path.join(work, 'release.tar.gz');
    run('tar', ['-czf', archive, '-C', directory, '.']); fs.chmodSync(archive, 0o600);
    upload(archive, `deploy/${release}/release.tar.gz`);
    upload(path.join(directory, 'remote.sh'), `deploy/${release}/remote.sh`);
    remote(command, release);
    write(metadataFile, JSON.stringify({ release, instance: output('instance_id'), bucket }));
    console.log(command === 'prepare' ? 'Prepared. Stop local writes, then run the migrate command.' : `Deployed: ${output('api_url')}`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
