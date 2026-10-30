import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  LOG_COLOR: Joi.string().valid("auto", "always", "never").default("auto"),
  GOOGLE_GENERATIVE_AI_API_KEY: Joi.string().allow("").optional(),
  AI_CONCIERGE_MODEL: Joi.string().max(100).default("gemini-3.8-flash"),
  AI_PROVIDER_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(120000)
    .default(45000),
  AI_GUEST_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(604800)
    .default(86400),
  AI_RETENTION_DAYS: Joi.number().integer().min(1).max(365).default(30),
  AI_ACCOUNT_RATE_LIMIT: Joi.number().integer().min(1).max(1000).default(20),
  AI_GUEST_RATE_LIMIT: Joi.number().integer().min(1).max(100).default(5),
  AI_GUEST_CREATE_RATE_LIMIT: Joi.number().integer().min(1).max(100).default(3),
  HTTP_LOG_HEADERS: Joi.boolean().default(false),
  HTTP_LOG_BODY: Joi.boolean().default(false),
  EMAIL_VERIFICATION_TTL_SECONDS: Joi.number()
    .valid(7200, 14400)
    .default(14400),
  EMAIL_VERIFICATION_SECRET: Joi.string().min(32).allow("").optional(),
  SMTP_HOST: Joi.string().allow("").optional(),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow("").optional(),
  SMTP_PASSWORD: Joi.string().allow("").optional(),
  SMTP_FROM: Joi.string().email().allow("").optional(),
  PROFILE_PHOTO_STORAGE_DIR: Joi.string()
    .min(1)
    .default("uploads/profile-photos"),
  GOOGLE_CLIENT_IDS: Joi.string().allow("").default(""),
  AUTH_SESSION_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(2592000)
    .default(604800),
  IDENTITY_SERVICE_HOST: Joi.string().default("127.0.0.1"),
  IDENTITY_SERVICE_PORT: Joi.number().port().default(4050),
  IDENTITY_SERVICE_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(120000)
    .default(10000),
  API_GATEWAY_PORT: Joi.number().default(4000),
  DATABASE_URL: Joi.string().required(),
  FOODMENU_APP_URL: Joi.string().default("*"),
  GOOGLE_ROUTES_API_KEY: Joi.string().allow("").optional(),
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  MENU_SERVICE_HOST: Joi.string().default("127.0.0.1"),
  MENU_SERVICE_PORT: Joi.number().default(4020),
  ORDER_SERVICE_HOST: Joi.string().default("127.0.0.1"),
  ORDER_SERVICE_PORT: Joi.number().default(4030),
  PAYMENT_SERVICE_HOST: Joi.string().default("127.0.0.1"),
  PAYMENT_SERVICE_PORT: Joi.number().default(4010),
  PGADMIN_DEFAULT_EMAIL: Joi.string().email().default("admin@foodmenu.local"),
  PGADMIN_DEFAULT_PASSWORD: Joi.string().min(4).default("admin"),
  POSTGRES_DB: Joi.string().default("foodmenu_api"),
  POSTGRES_PASSWORD: Joi.string().default("foodmenu"),
  POSTGRES_USER: Joi.string().default("foodmenu"),
  PUBLIC_ASSET_BASE_URL: Joi.string().uri().default("http://localhost:4000"),
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().allow("").optional(),
  STUART_ACCOUNT_ID: Joi.string().allow("").optional(),
  STUART_API_BASE_URL: Joi.string()
    .uri()
    .default("https://api.sandbox.stuart.com"),
  STUART_CLIENT_ID: Joi.string().allow("").optional(),
  STUART_CLIENT_SECRET: Joi.string().allow("").optional(),
  STUART_FALLBACK_CUSTOMER_PHONE: Joi.string().allow("").optional(),
  STUART_PACKAGE_TYPE: Joi.string().default("medium"),
  STUART_PICKUP_ADDRESS: Joi.string().allow("").optional(),
  STUART_PICKUP_COMMENT: Joi.string().allow("").optional(),
  STUART_PICKUP_COMPANY: Joi.string().default("FoodMenu"),
  STUART_PICKUP_DELAY_MINUTES: Joi.number().default(15),
  STUART_PICKUP_EMAIL: Joi.string().allow("").optional(),
  STUART_PICKUP_FIRST_NAME: Joi.string().default("FoodMenu"),
  STUART_PICKUP_LAST_NAME: Joi.string().default("Kitchen"),
  STUART_PICKUP_LATITUDE: Joi.number().optional(),
  STUART_PICKUP_LONGITUDE: Joi.number().optional(),
  STUART_PICKUP_PHONE: Joi.string().allow("").optional(),
  STUART_WEBHOOK_SECRET: Joi.string().allow("").optional(),
});

// Identity validates only its own settings; it does not need payment/provider secrets.
export const identityEnvValidationSchema = Joi.object(
  Object.fromEntries(
    [
      "EMAIL_VERIFICATION_TTL_SECONDS",
      "EMAIL_VERIFICATION_SECRET",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_SECURE",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "SMTP_FROM",
      "PROFILE_PHOTO_STORAGE_DIR",
      "PUBLIC_ASSET_BASE_URL",
      "DATABASE_URL",
      "NODE_ENV",
      "GOOGLE_CLIENT_IDS",
      "AUTH_SESSION_TTL_SECONDS",
      "IDENTITY_SERVICE_HOST",
      "IDENTITY_SERVICE_PORT",
      "IDENTITY_SERVICE_TIMEOUT_MS",
    ].map((key) => [key, envValidationSchema.extract(key)]),
  ),
);
