import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  SetMetadata,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Request, Response } from "express";
import { z } from "zod";
import { writeStructuredLog } from "@app/common";
import { pipeUIMessageStreamToResponse } from "ai";
import {
  profileBody,
  accountBody,
  importBody,
  createConversationBody,
  switchContextBody,
  chatBody,
  pageQuery,
} from "./dto/concierge.dto";
import { ConciergePrivacyInterceptor } from "./persistence/privacy.interceptor";
import { ConciergeAccessService } from "./conversations/access.service";
import { ConciergeConfigService } from "./config/config.service";
import { ConciergePreferencesService } from "./preferences/preferences.service";
import { ConversationsService } from "./conversations/conversations.service";
import { ConciergeChatService } from "./conversations/chat.service";
import { ConciergeRateLimitService } from "./persistence/rate-limit.service";
import { etag, fail, parse, uuid } from "./persistence/contracts";

const bodySchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
  }) as SchemaObject;

@ApiTags("AI Food Concierge")
@UseInterceptors(ConciergePrivacyInterceptor)
@UseGuards(ThrottlerGuard)
@Controller("ai")
export class AiConciergeController {
  constructor(
    private readonly access: ConciergeAccessService,
    private readonly configs: ConciergeConfigService,
    private readonly preferences: ConciergePreferencesService,
    private readonly conversations: ConversationsService,
    private readonly chat: ConciergeChatService,
    private readonly rates: ConciergeRateLimitService,
  ) {}
  private async owner(req: Request) {
    return (await this.access.actor(req, true)).customerId!;
  }
  private async pagination(query: unknown) {
    const config = await this.configs.current();
    const page = parse(pageQuery, query);
    const limit = page.limit ?? config.chatLimits.pageSize;
    if (limit > config.chatLimits.pageSize)
      fail("AI_INVALID_INPUT", "Page limit exceeds configuration");
    return { ...page, limit };
  }
  @ApiQuery({
    name: "locale",
    required: false,
    description: "Configured supported locale",
  })
  @Get("config")
  @SetMetadata("rawResponse", true)
  @ApiOperation({
    summary: "Get client-safe, localized concierge configuration",
  })
  async configuration(@Query() query: unknown, @Res() response: Response) {
    const q = parse(
      z.object({ locale: z.string().max(20).optional() }).strict(),
      query,
    );
    const config = await this.configs.current();
    const locale = q.locale ?? config.defaultLocale;
    const data = this.configs.public(config, locale);
    response.set({
      "Cache-Control": "no-store",
      ETag: this.configs.etag(config, locale),
    });
    // End directly: Express.json() can turn this full-refresh response into 304
    // for older clients still sending If-None-Match, despite Cache-Control.
    response
      .status(200)
      .type("application/json")
      .end(JSON.stringify({ success: true, data }));
  }
  @ApiBearerAuth()
  @Get("preference-profiles")
  async list(@Req() req: Request) {
    return this.preferences.list(await this.owner(req));
  }
  @ApiBody({ schema: bodySchema(importBody) })
  @ApiBearerAuth()
  @Post("preference-profiles/import")
  @HttpCode(200)
  async import(@Req() req: Request, @Body() body: unknown) {
    return this.preferences.import(
      await this.owner(req),
      parse(importBody, body),
    );
  }
  // Static default route must precede the UUID parameter route.
  @ApiBody({
    schema: bodySchema(z.object({ profileId: uuid.nullable() }).strict()),
  })
  @ApiBearerAuth()
  @ApiHeader({
    name: "If-Match",
    required: false,
    description:
      "Quoted numeric resource revision; required for update/delete/default/account/context writes",
  })
  @Put("preference-profiles/default")
  async default(
    @Req() req: Request,
    @Body() body: unknown,
    @Headers("if-match") condition: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const id = await this.owner(req);
    const dto = parse(z.object({ profileId: uuid.nullable() }).strict(), body);
    const result = await this.preferences.setDefault(
      id,
      dto.profileId,
      condition,
    );
    response.setHeader("ETag", etag(result.defaultRevision));
    return result;
  }
  @ApiBearerAuth()
  @Get("preference-profiles/:id")
  async get(
    @Req() req: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.preferences.get(
      await this.owner(req),
      parse(uuid, id),
    );
    response.setHeader("ETag", etag(result.revision));
    return result;
  }
  @ApiBody({ schema: bodySchema(profileBody) })
  @ApiBearerAuth()
  @ApiHeader({
    name: "If-Match",
    required: false,
    description:
      "Quoted numeric resource revision; required for update/delete/default/account/context writes",
  })
  @ApiHeader({
    name: "If-None-Match",
    required: false,
    description: "Use * when creating a new UUID profile",
  })
  @Put("preference-profiles/:id")
  async put(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("if-match") match: string | undefined,
    @Headers("if-none-match") none: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.preferences.put(
      await this.owner(req),
      parse(uuid, id),
      parse(profileBody, body),
      { match, none },
    );
    response.setHeader("ETag", etag(result.revision));
    return result;
  }
  @ApiBearerAuth()
  @ApiHeader({
    name: "If-Match",
    required: false,
    description:
      "Quoted numeric resource revision; required for update/delete/default/account/context writes",
  })
  @Delete("preference-profiles/:id")
  @HttpCode(204)
  @SetMetadata("rawResponse", true)
  async remove(
    @Req() req: Request,
    @Param("id") id: string,
    @Headers("if-match") condition: string | undefined,
    @Res() response: Response,
  ) {
    await this.preferences.remove(
      await this.owner(req),
      parse(uuid, id),
      condition,
    );
    response.status(204).end();
  }
  @ApiBearerAuth()
  @Get("account-preferences")
  async account(
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.preferences.account(await this.owner(req));
    response.setHeader("ETag", etag(result.revision));
    return result;
  }
  @ApiBody({ schema: bodySchema(accountBody) })
  @ApiBearerAuth()
  @ApiHeader({
    name: "If-Match",
    required: false,
    description:
      "Quoted numeric resource revision; required for update/delete/default/account/context writes",
  })
  @Put("account-preferences")
  async putAccount(
    @Req() req: Request,
    @Body() body: unknown,
    @Headers("if-match") condition: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.preferences.putAccount(
      await this.owner(req),
      parse(accountBody, body),
      condition,
    );
    response.setHeader("ETag", etag(result.revision));
    return result;
  }
  @ApiBody({ schema: bodySchema(createConversationBody) })
  @Post("conversations")
  async create(
    @Req() req: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const actor = await this.access.actor(req);
    const dto = parse(createConversationBody, body);
    // IP-based creation limits prevent bypass by repeatedly requesting new guest tokens.
    await this.conversations.db.$transaction((tx) =>
      this.rates.consume(
        tx,
        actor.customerId ?? req.ip ?? "unknown",
        actor.customerId ? "account" : "create",
      ),
    );
    const result = await this.conversations.create(actor, dto);
    response.setHeader("ETag", etag(result.contextRevision));
    return result;
  }
  @ApiBearerAuth()
  @Get("conversations")
  async listConversations(@Req() req: Request, @Query() query: unknown) {
    const customer = await this.owner(req);
    const page = await this.pagination(query);
    return this.conversations.list(customer, page.limit, page.cursor);
  }
  @Get("conversations/:id")
  async conversation(
    @Req() req: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.conversations.get(
      parse(uuid, id),
      await this.access.actor(req),
    );
    response.setHeader("ETag", etag(result.contextRevision));
    return result;
  }
  @Get("conversations/:id/messages")
  async messages(
    @Req() req: Request,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    const actor = await this.access.actor(req);
    const page = await this.pagination(query);
    return this.conversations.history(
      parse(uuid, id),
      actor,
      page.limit,
      page.cursor,
    );
  }
  @Delete("conversations/:id")
  @HttpCode(204)
  @SetMetadata("rawResponse", true)
  async deleteConversation(
    @Req() req: Request,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    await this.conversations.remove(
      parse(uuid, id),
      await this.access.actor(req),
    );
    response.status(204).end();
  }
  @ApiBody({ schema: bodySchema(switchContextBody) })
  @ApiHeader({
    name: "If-Match",
    required: false,
    description:
      "Quoted numeric resource revision; required for update/delete/default/account/context writes",
  })
  @Put("conversations/:id/context")
  async context(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("if-match") condition: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.conversations.switch(
      parse(uuid, id),
      await this.access.actor(req),
      parse(switchContextBody, body),
      condition,
    );
    response.setHeader("ETag", etag(result.contextRevision));
    return result;
  }
  @ApiBody({ schema: bodySchema(chatBody) })
  @ApiResponse({
    status: 200,
    description: "UIMessage SSE stream, not a JSON envelope",
    content: { "text/event-stream": { schema: { type: "string" } } },
  })
  @ApiHeader({
    name: "X-AI-Guest-Token",
    required: false,
    description:
      "Guest conversation token; use existing Bearer authentication for accounts",
  })
  @Post("chat")
  @HttpCode(200)
  @SetMetadata("rawResponse", true)
  @ApiOperation({
    summary:
      "Stream a new user text turn using AI SDK UIMessage SSE, without a JSON envelope",
  })
  async stream(
    @Req() req: Request,
    @Body() body: unknown,
    @Res() response: Response,
  ) {
    const actor = await this.access.actor(req);
    const dto = parse(chatBody, body);
    const abort = new AbortController();
    const close = () => {
      if (!response.writableFinished) abort.abort();
    };
    response.once("close", close);
    try {
      const stream = await this.chat.start(
        actor,
        dto,
        abort.signal,
        response.getHeader("X-Request-Id")?.toString(),
      );
      response.setHeader("X-Accel-Buffering", "no");
      await pipeUIMessageStreamToResponse({
        response,
        stream,
        headers: { "Cache-Control": "no-cache, no-transform" },
      });
    } catch (error) {
      abort.abort();
      if (!response.headersSent) throw error;
      writeStructuredLog("error", "AiConcierge", {
        event: "ai_transport_failed",
        requestId: response.getHeader("X-Request-Id"),
      });
      if (!response.destroyed && !response.writableEnded) response.end();
    } finally {
      response.removeListener("close", close);
    }
  }
}
