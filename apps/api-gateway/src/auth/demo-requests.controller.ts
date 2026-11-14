import { Body, Controller, Header, HttpCode, Post, UseGuards } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { WebsiteLeadDto, WebsiteLeadResponseDto } from "@app/dto";
import { IdentityClientService } from "./identity-client.service";

// Public endpoint for the Liberq website's "Book a free demo" / "Become a partner" form.
@ApiTags("Website leads")
@UseGuards(ThrottlerGuard)
@Controller("demo-requests")
export class DemoRequestsController {
  constructor(private readonly identity: IdentityClientService) {}

  @Post()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  // Stricter than the global limit: 5 requests per minute per IP.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: "Book a free demo (restaurants) or apply to become a partner (marketers)",
    description:
      "Saves the request and emails the team inbox set in LEADS_NOTIFY_EMAIL. kind defaults to demo.",
  })
  @ApiOkResponse({ type: WebsiteLeadResponseDto })
  @ApiBadRequestResponse({ description: "Missing or invalid name, business, email, UK phone or consent" })
  @ApiTooManyRequestsResponse({ description: "Too many requests from this IP" })
  create(@Body() dto: WebsiteLeadDto) {
    return this.identity.demoRequest(dto);
  }
}
