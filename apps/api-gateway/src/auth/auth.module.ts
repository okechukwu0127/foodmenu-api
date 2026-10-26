import { Module } from "@nestjs/common";
import { DatabaseModule } from "@app/database";
import { AuthController } from "./auth.controller";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { IdentityClientService } from "./identity-client.service";
import { AuthGuard } from "./auth.guard";
import { CustomerAccessService } from "./customer-access.service";

import { AddressesController } from "./addresses.controller";

import { ProfilePhotoController } from "./profile-photo.controller";

@Module({
  imports: [
    DatabaseModule,
    ClientsModule.registerAsync([
      {
        name: "IDENTITY_SERVICE",
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: config.get<string>("IDENTITY_SERVICE_HOST", "127.0.0.1"),
            port: config.get<number>("IDENTITY_SERVICE_PORT", 4050),
          },
        }),
      },
    ]),
  ],
  controllers: [AuthController, AddressesController, ProfilePhotoController],
  providers: [IdentityClientService, AuthGuard, CustomerAccessService],
  exports: [IdentityClientService, AuthGuard, CustomerAccessService],
})
export class AuthModule {}
