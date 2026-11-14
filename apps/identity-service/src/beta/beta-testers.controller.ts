import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { IDENTITY_PATTERNS } from "@app/common";
import { BetaSignupDto } from "@app/dto";
import { BetaTestersService } from "./beta-testers.service";

@Controller()
export class IdentityBetaTestersController {
  constructor(private readonly betaTesters: BetaTestersService) {}

  @MessagePattern(IDENTITY_PATTERNS.BETA_SIGNUP)
  signup(@Payload() dto: BetaSignupDto) {
    return this.betaTesters.signup(dto);
  }
}
