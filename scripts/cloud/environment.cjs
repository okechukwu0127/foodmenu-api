const crypto = require('node:crypto');

function cloudEnvironment(source, previous, publicUrl) {
  if (!source.EMAIL_VERIFICATION_SECRET) throw new Error('Set EMAIL_VERIFICATION_SECRET locally before migration; preserve it for existing verification codes.');
  const password = previous?.POSTGRES_PASSWORD || crypto.randomBytes(32).toString('hex');
  return {
    ...source,
    NODE_ENV: 'production',
    POSTGRES_USER: 'foodmenu',
    POSTGRES_DB: 'foodmenu_api',
    POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgresql://foodmenu:${encodeURIComponent(password)}@postgres:5432/foodmenu_api?schema=public`,
    PUBLIC_ASSET_BASE_URL: publicUrl,
    PROFILE_PHOTO_STORAGE_DIR: '/app/uploads/profile-photos',
    API_GATEWAY_PORT: '4000', TRUST_PROXY_HOPS: '2',
    PAYMENT_SERVICE_PORT: '4010',
    MENU_SERVICE_PORT: '4020',
    ORDER_SERVICE_PORT: '4030',
    IDENTITY_SERVICE_PORT: '4050',
    PAYMENT_SERVICE_HOST: 'payment-service',
    MENU_SERVICE_HOST: 'menu-service',
    ORDER_SERVICE_HOST: 'order-service',
    IDENTITY_SERVICE_HOST: 'identity-service',
    HTTP_LOG_HEADERS: 'false', HTTP_LOG_BODY: 'false', LOG_PRETTY: 'false', LOG_COLOR: 'never',
  };
}
// Compose dotenv syntax: escape dollars before quoting to prevent interpolation.
function serialize(env) {
  return Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error('Invalid environment key');
    return `${key}=${JSON.stringify(String(value).replace(/\$/g, () => "$$"))}`;
  }).join('\n') + '\n';
}
function pgConnection(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected PostgreSQL DATABASE_URL');
  url.searchParams.delete('schema'); // Prisma-only option; libpq rejects it.
  return { PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), ...(url.searchParams.has('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}) };
}
module.exports = { cloudEnvironment, serialize, pgConnection };
