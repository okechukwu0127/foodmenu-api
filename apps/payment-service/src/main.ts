import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { MicroserviceOptions, Transport } from "@nestjs/microservices";
import { PaymentServiceModule } from "./payment-service.module";

async function bootstrap() {
  const appContext = await NestFactory.createApplicationContext(
    PaymentServiceModule,
  );
  const configService = appContext.get(ConfigService);
  await appContext.close();

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    PaymentServiceModule,
    {
      options: {
        host: configService.get<string>("PAYMENT_SERVICE_HOST", "127.0.0.1"),
        port: configService.get<number>("PAYMENT_SERVICE_PORT", 4010),
      },
      transport: Transport.TCP,
    },
  );

  app.enableShutdownHooks();
  await app.listen();
}

bootstrap();
