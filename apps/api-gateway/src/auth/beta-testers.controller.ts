import {
  Body,
  Controller,
  Header,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { BetaSignupDto, BetaSignupResponseDto } from "@app/dto";
import { IdentityClientService } from "./identity-client.service";

// Public endpoint used by the Liberq marketing website's "Join the beta" form.
@ApiTags("Beta testers")
@UseGuards(ThrottlerGuard)
@Controller("beta-testers")
export class BetaTestersController {
  constructor(private readonly identity: IdentityClientService) {}

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  // Stricter than the global limit: 5 sign-ups per minute per IP.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary:
      "Join the beta: store an Apple ID (TestFlight) or Google account (Play testing) email",
    description:
      "Idempotent per email + platform. The response is the same for new and repeat sign-ups.",
  })
  @ApiOkResponse({ type: BetaSignupResponseDto })
  @ApiBadRequestResponse({
    description: "Invalid email, platform or missing consent",
  })
  @ApiTooManyRequestsResponse({ description: "Too many sign-ups from this IP" })
  signup(@Body() dto: BetaSignupDto) {
    return this.identity.betaSignup(dto);
  }
}
