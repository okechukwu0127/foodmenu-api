import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  API_GATEWAY_PORT: Joi.number().default(4000),
  DATABASE_URL: Joi.string().required(),
  FOODMENU_APP_URL: Joi.string().default("*"),
  NODE_ENV: Joi.string()
    .valid("development", "test", "production")
    .default("development"),
  MENU_SERVICE_HOST: Joi.string().default("127.0.0.1"),
  MENU_SERVICE_PORT: Joi.number().default(4020),
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
});
