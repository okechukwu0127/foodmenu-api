const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cloudEnvironment, serialize, pgConnection } = require('./environment.cjs');

test('cloud config preserves authentication secrets and uses private service discovery', () => {
  const source = { EMAIL_VERIFICATION_SECRET: 'a'.repeat(32), SMTP_PASSWORD: 'smtp-secret', DATABASE_URL: 'postgresql://local:secret@localhost/local' };
  const env = cloudEnvironment(source, undefined, 'https://sample.cloudfront.net');
  assert.equal(env.EMAIL_VERIFICATION_SECRET, source.EMAIL_VERIFICATION_SECRET);
  assert.equal(env.SMTP_PASSWORD, source.SMTP_PASSWORD);
  assert.equal(env.PUBLIC_ASSET_BASE_URL, 'https://sample.cloudfront.net');
  assert.equal(new URL(env.DATABASE_URL).hostname, 'postgres');
  assert.equal(env.MENU_SERVICE_HOST, 'menu-service');
  assert.equal(env.TRUST_PROXY_HOPS, '2');
  assert.equal(env.HTTP_LOG_BODY, 'false');
  assert.equal(env.POSTGRES_PASSWORD.length, 64);
  assert.equal(source.DATABASE_URL, 'postgresql://local:secret@localhost/local');
});
test('subsequent deployments preserve cloud DB credentials', () => {
  const env = cloudEnvironment({ EMAIL_VERIFICATION_SECRET: 'a'.repeat(32) }, { POSTGRES_PASSWORD: 'existing-password' }, 'https://example.com');
  assert.equal(env.POSTGRES_PASSWORD, 'existing-password');
  assert.equal(new URL(env.DATABASE_URL).password, 'existing-password');
});
test('missing verification secret prevents migration of unusable activation codes', () => {
  assert.throws(() => cloudEnvironment({}, undefined, 'https://example.com'), /EMAIL_VERIFICATION_SECRET/);
});
test('dotenv serialization prevents shell/Compose interpolation', () => {
  assert.equal(serialize({ SMTP_PASSWORD: "$value'word" }), `SMTP_PASSWORD="$$value'word"\n`);
  assert.throws(() => serialize({ 'INVALID;COMMAND': 'data' }), /Invalid environment key/);
});
test('libpq credentials remove Prisma schema and remain outside command arguments', () => {
  assert.deepEqual(pgConnection('postgresql://user:p%40ss@localhost:5433/app?schema=public&sslmode=require'), {
    PGHOST: 'localhost', PGPORT: '5433', PGDATABASE: 'app', PGUSER: 'user', PGPASSWORD: 'p@ss', PGSSLMODE: 'require',
  });
  assert.throws(() => pgConnection('https://example.com'), /PostgreSQL/);
});
