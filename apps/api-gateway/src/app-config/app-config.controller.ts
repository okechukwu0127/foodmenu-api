import { Controller, Get, Headers, Res, SetMetadata } from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { AppConfigService } from "./app-config.service";
import { AppConfigResponseDto } from "./dto/app-config-response.dto";

@ApiTags("Application configuration")
@Controller("app/config")
export class AppConfigController {
  constructor(private readonly configs: AppConfigService) {}

  @Get()
  @SetMetadata("rawResponse", true)
  @ApiOperation({
    summary:
      "Get public branding and the active default restaurant; no login required",
  })
  @ApiHeader({
    name: "If-None-Match",
    required: false,
    description: "ETag from a previously cached configuration",
  })
  @ApiOkResponse({ type: AppConfigResponseDto })
  @ApiResponse({
    status: 304,
    description: "Unchanged configuration; reuse cached JSON, no response body",
  })
  @ApiResponse({
    status: 503,
    description: "Application settings missing or default restaurant inactive",
  })
  async getConfig(
    @Headers("if-none-match") condition: string | undefined,
    @Res() response: Response,
  ) {
    const { data, etag } = await this.configs.getPublicConfig();
    response.set({
      ETag: etag,
      "Cache-Control": "public, max-age=60, must-revalidate",
    });
    if (
      condition
        ?.split(",")
        .some(
          (tag) =>
            tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag,
        )
    ) {
      response.status(304).end();
      return;
    }
    response.status(200).json({ success: true, data });
  }
}
