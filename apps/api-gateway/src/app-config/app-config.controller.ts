import {
  Controller,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
  Res,
  SetMetadata,
} from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import {
  AppConfigService,
  LEGAL_DOCUMENT_IDS,
  type LegalDocumentId,
} from "./app-config.service";
import {
  AppConfigResponseDto,
  LegalDocumentResponseDto,
} from "./dto/app-config-response.dto";

const matchesEtag = (condition: string | undefined, etag: string) =>
  condition
    ?.split(",")
    .some(
      (tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === etag,
    ) ?? false;

/** 200 with the body, or 304 with no body when the client already has this version. */
const sendCacheable = (
  response: Response,
  condition: string | undefined,
  { data, etag }: { data: unknown; etag: string },
) => {
  response.set({
    ETag: etag,
    "Cache-Control": "public, max-age=60, must-revalidate",
  });
  if (matchesEtag(condition, etag)) {
    response.status(304).end();
    return;
  }
  response.status(200).json({ success: true, data });
};

@ApiTags("Application configuration")
@Controller()
export class AppConfigController {
  constructor(private readonly configs: AppConfigService) {}

  @Get("app/config")
  @SetMetadata("rawResponse", true)
  @ApiOperation({
    summary:
      "Get public branding, the active default restaurant and legal document versions; no login required",
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
    sendCacheable(response, condition, await this.configs.getPublicConfig());
  }

  @Get("legal/:id")
  @SetMetadata("rawResponse", true)
  @ApiOperation({
    summary:
      "Get a legal document (terms or privacy) as structured blocks; no login required",
  })
  @ApiParam({ name: "id", enum: LEGAL_DOCUMENT_IDS })
  @ApiHeader({
    name: "If-None-Match",
    required: false,
    description: "ETag from a previously cached copy of this document",
  })
  @ApiOkResponse({ type: LegalDocumentResponseDto })
  @ApiResponse({ status: 304, description: "Unchanged; reuse the cached copy" })
  @ApiResponse({ status: 404, description: "Document not published yet" })
  async getLegalDocument(
    @Param("id", new ParseEnumPipe(LEGAL_DOCUMENT_IDS))
    id: LegalDocumentId,
    @Headers("if-none-match") condition: string | undefined,
    @Res() response: Response,
  ) {
    sendCacheable(
      response,
      condition,
      await this.configs.getLegalDocument(id),
    );
  }
}
