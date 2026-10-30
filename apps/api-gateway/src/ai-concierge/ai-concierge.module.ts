import { ConversationCommerceService } from "./commerce/commerce.service";
import { ConversationCommerceController } from "./commerce/commerce.controller";
import { CommerceEventsWorker } from "./commerce/commerce-events.worker";
import { ConciergeCategoryOptionsService } from "./config/category-options.service";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { DatabaseModule } from "@app/database";
import { AuthModule } from "../auth/auth.module";
import { AiConciergeController } from "./ai-concierge.controller";
import { ConciergeConfigService } from "./config/config.service";
import { ConciergePreferencesService } from "./preferences/preferences.service";
import { EffectivePreferencesService } from "./preferences/effective-preferences.service";
import { ConversationsService } from "./conversations/conversations.service";
import { ConciergeChatService } from "./conversations/chat.service";
import { ConciergeAccessService } from "./conversations/access.service";
import { ConciergeMenuAdapter } from "./adapters/menu.adapter";
import { GeminiConciergeProvider } from "./adapters/gemini.provider";
import { MenuToolsService } from "./tools/menu-tools.service";
import { ConciergeRateLimitService } from "./persistence/rate-limit.service";
import { ConciergeRetentionService } from "./persistence/retention.service";
@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ClientsModule.registerAsync([
      {
        name: "AI_PAYMENT_SERVICE",
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (c: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: c.get("PAYMENT_SERVICE_HOST", "127.0.0.1"),
            port: c.get("PAYMENT_SERVICE_PORT", 4010),
          },
        }),
      },
      {
        name: "AI_MENU_SERVICE",
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get("MENU_SERVICE_HOST", "127.0.0.1"),
            port: config.get("MENU_SERVICE_PORT", 4020),
          },
        }),
      },
    ]),
  ],
  controllers: [AiConciergeController, ConversationCommerceController],
  providers: [
    ConversationCommerceService,
    CommerceEventsWorker,
    ConciergeConfigService,
    ConciergeCategoryOptionsService,
    ConciergePreferencesService,
    EffectivePreferencesService,
    ConversationsService,
    ConciergeChatService,
    ConciergeAccessService,
    ConciergeMenuAdapter,
    GeminiConciergeProvider,
    MenuToolsService,
    ConciergeRateLimitService,
    ConciergeRetentionService,
  ],
})
export class AiConciergeModule {}
