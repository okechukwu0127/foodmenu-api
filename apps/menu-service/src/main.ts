import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { MenuServiceModule } from "./menu-service.module";

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(
    MenuServiceModule,
  );
  const configService = appContext.get(ConfigService);
  const host = configService.get<string>("MENU_SERVICE_HOST", "127.0.0.1");
  const port = configService.get<number>("MENU_SERVICE_PORT", 4020);
  await appContext.close();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    MenuServiceModule,
    {
      options: { host, port },
      transport: Transport.TCP,
    },
  );

  app.enableShutdownHooks();
  await app.listen();
}

bootstrap();
