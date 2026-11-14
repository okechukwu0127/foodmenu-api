import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { IDENTITY_PATTERNS } from "@app/common";
import { WebsiteLeadDto } from "@app/dto";
import { WebsiteLeadsService } from "./website-leads.service";

@Controller()
export class IdentityWebsiteLeadsController {
  constructor(private readonly leads: WebsiteLeadsService) {}

  @MessagePattern(IDENTITY_PATTERNS.DEMO_REQUEST)
  create(@Payload() dto: WebsiteLeadDto) {
    return this.leads.create(dto);
  }
}
