import { Module } from "@nestjs/common";
import { DatabaseModule } from "@app/database";
import { AppConfigController } from "./app-config.controller";
import { AppConfigService } from "./app-config.service";

@Module({
  imports: [DatabaseModule],
  controllers: [AppConfigController],
  providers: [AppConfigService],
})
export class AppConfigModule {}
