import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "Check API Gateway health" })
  @ApiResponse({
    status: 200,
    schema: {
      example: { service: "api-gateway", status: "ok" },
    },
  })
  getHealth() {
    return {
      service: "api-gateway",
      status: "ok",
    };
  }
}
