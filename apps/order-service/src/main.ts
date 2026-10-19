import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { OrderServiceModule } from "./order-service.module";

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(
    OrderServiceModule,
  );
  const configService = appContext.get(ConfigService);
  const host = configService.get<string>("ORDER_SERVICE_HOST", "127.0.0.1");
  const port = configService.get<number>("ORDER_SERVICE_PORT", 4030);
  await appContext.close();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    OrderServiceModule,
    {
      options: { host, port },
      transport: Transport.TCP,
    },
  );

  app.enableShutdownHooks();
  await app.listen();
}

bootstrap();
