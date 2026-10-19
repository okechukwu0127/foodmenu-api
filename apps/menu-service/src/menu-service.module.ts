import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { envValidationSchema } from "@app/config";
import { DatabaseModule } from "@app/database";
import { MenuCatalogController } from "./menu/menu-catalog.controller";
import { MenuCatalogService } from "./menu/menu-catalog.service";

@Module({
  controllers: [MenuCatalogController],
  imports: [
    ConfigModule.forRoot({
      envFilePath: ".env",
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    DatabaseModule,
  ],
  providers: [MenuCatalogService],
})
export class MenuServiceModule {}
