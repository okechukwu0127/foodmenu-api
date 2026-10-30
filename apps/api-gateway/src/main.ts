import "reflect-metadata";
import * as express from "express";
import { join } from "path";
import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import {
  createValidationPipe,
  HttpExceptionFilter,
  createRequestLoggingMiddleware,
} from "@app/common";
import { mountProfilePhotoAssets } from "./auth/profile-photo-assets";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);
  const port = configService.get<number>("API_GATEWAY_PORT", 4000);
  const allowedOrigin = configService.get<string>("FOODMENU_APP_URL", "*");

  app.use(
    createRequestLoggingMiddleware({
      headers: configService.get<boolean>("HTTP_LOG_HEADERS", false),
      body: configService.get<boolean>("HTTP_LOG_BODY", false),
    }),
  );
  app.use("/api/v1/webhooks/stripe", express.raw({ type: "application/json" }));
  app.use(
    "/assets",
    express.static(join(process.cwd(), "public/assets"), {
      immutable: true,
      maxAge: "7d",
    }),
  );
  mountProfilePhotoAssets(app, configService);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(helmet());
  app.enableCors({
    exposedHeaders: ["ETag", "X-Request-Id", "X-Vercel-AI-UI-Message-Stream"],
    origin: allowedOrigin === "*" ? true : allowedOrigin,
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle("foodMenu API")
    .setDescription("API Gateway for the foodMenu mobile application.")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document, {
    jsonDocumentUrl: "api/docs-json",
  });

  await app.listen(port);
}

bootstrap();
