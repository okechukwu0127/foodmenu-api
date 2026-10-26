import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { IdentityServiceModule } from "./identity-service.module";

async function bootstrap() {
  const context = await NestFactory.createApplicationContext(
    IdentityServiceModule,
  );
  const config = context.get(ConfigService);
  const host = config.get<string>("IDENTITY_SERVICE_HOST", "127.0.0.1");
  const port = config.get<number>("IDENTITY_SERVICE_PORT", 4050);
  await context.close();
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    IdentityServiceModule,
    {
      transport: Transport.TCP,
      options: { host, port },
    },
  );
  app.enableShutdownHooks();
  await app.listen();
}
bootstrap();
