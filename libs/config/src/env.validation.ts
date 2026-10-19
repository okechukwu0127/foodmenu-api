import * as Joi from "joi";

export const envValidationSchema = Joi.object({
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
