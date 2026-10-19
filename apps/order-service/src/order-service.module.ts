import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { envValidationSchema } from "@app/config";
import { DatabaseModule } from "@app/database";
import { StuartFulfilmentService } from "./fulfilment/stuart-fulfilment.service";
import { OrdersController } from "./orders/orders.controller";
import { OrdersService } from "./orders/orders.service";
import { GoogleRoutesService } from "./tracking/google-routes.service";

@Module({
  controllers: [OrdersController],
  imports: [
    ConfigModule.forRoot({
      envFilePath: ".env",
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    DatabaseModule,
  ],
  providers: [GoogleRoutesService, OrdersService, StuartFulfilmentService],
})
export class OrderServiceModule {}
