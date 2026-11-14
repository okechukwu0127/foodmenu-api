import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_PIPE } from "@nestjs/core";
import { identityEnvValidationSchema } from "@app/config";
import { DatabaseModule } from "@app/database";
import { createValidationPipe } from "@app/common";
import { IdentityController } from "./auth/auth.controller";
import { AuthService, GoogleTokenVerifier } from "./auth/auth.service";
import { IdentityExceptionFilter } from "./identity-exception.filter";

import { AddressesService } from "./addresses/addresses.service";
import { IdentityAddressesController } from "./addresses/addresses.controller";
import { FavoritesService } from "./favorites/favorites.service";
import { IdentityFavoritesController } from "./favorites/favorites.controller";
import { BetaTestersService } from "./beta/beta-testers.service";
import { IdentityBetaTestersController } from "./beta/beta-testers.controller";
import { WebsiteLeadsService } from "./leads/website-leads.service";
import { IdentityWebsiteLeadsController } from "./leads/website-leads.controller";
import { LeadNotificationService } from "./email/lead-notification.service";

import { EmailVerificationService } from "./email/email-verification.service";
import { VerificationMailService } from "./email/verification-mail.service";

import { ProfilePhotoStorageService } from "./photos/profile-photo-storage.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: ".env",
      isGlobal: true,
      validationSchema: identityEnvValidationSchema,
    }),
    DatabaseModule,
  ],
  controllers: [
    IdentityController,
    IdentityAddressesController,
    IdentityFavoritesController,
    IdentityBetaTestersController,
    IdentityWebsiteLeadsController,
  ],
  providers: [
    AddressesService,
    FavoritesService,
    BetaTestersService,
    WebsiteLeadsService,
    LeadNotificationService,
    AuthService,
    ProfilePhotoStorageService,
    EmailVerificationService,
    VerificationMailService,
    GoogleTokenVerifier,
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: IdentityExceptionFilter },
  ],
})
export class IdentityServiceModule {}
