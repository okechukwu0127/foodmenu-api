import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { z } from "zod";
import { ConversationCommerceService } from "./commerce.service";
import { ConciergeAccessService } from "../conversations/access.service";
import { etag, fail, parse, uuid } from "../persistence/contracts";
import { commerceActionSchema, paymentActionSchema } from "./commerce.dto";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
const schema = (s: z.ZodType) =>
  z.toJSONSchema(s, { target: "openapi-3.0", io: "input" }) as SchemaObject;
@ApiTags("AI conversation commerce")
@Controller("ai/conversations/:id")
export class ConversationCommerceController {
  constructor(
    private readonly commerce: ConversationCommerceService,
    private readonly access: ConciergeAccessService,
  ) {}
  @Get("commerce")
  async get(
    @Req() req: Request,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.commerce.get(
      parse(uuid, id),
      await this.access.actor(req),
    );
    response.set({ ETag: etag(result.revision), "Cache-Control": "no-store" });
    return result;
  }
  @Post("actions")
  @HttpCode(200)
  @ApiBody({ schema: schema(commerceActionSchema) })
  @ApiOperation({
    summary:
      "Apply an explicit validated commerce action, append its history card and protect retries",
  })
  async action(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.commerce.action(
      parse(uuid, id),
      await this.access.actor(req),
      parse(commerceActionSchema, body),
      match,
    );
    response.setHeader("Cache-Control", "no-store");
    const revision = (result as any).state?.revision;
    if (revision) response.setHeader("ETag", etag(revision));
    return result;
  }
  @Post("payment")
  @HttpCode(200)
  @ApiBody({ schema: schema(paymentActionSchema) })
  async begin(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Headers("if-match") match: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    return this.commerce.begin(
      parse(uuid, id),
      await this.access.actor(req, true),
      parse(paymentActionSchema, body),
      match,
    );
  }
  @Post("payment/cancel")
  @HttpCode(200)
  async cancel(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "no-store");
    const dto = parse(z.object({ quoteId: uuid }).strict(), body);
    return this.commerce.cancel(
      parse(uuid, id),
      await this.access.actor(req, true),
      dto.quoteId,
    );
  }
  @Post("claim")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Claim the same guest conversation using both a valid Bearer session and its guest token",
  })
  async claim(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    parse(z.object({}).strict(), body ?? {});
    const actor = await this.access.actor(req, true);
    const proof = req.get("X-AI-Guest-Token");
    if (!proof || !/^[a-f0-9]{64}$/.test(proof))
      fail(
        "AI_GUEST_PROOF_REQUIRED",
        "Supply the guest conversation token and your Bearer session",
        401,
      );
    const result = await this.commerce.claim(
      parse(uuid, id),
      actor.customerId!,
      proof,
    );
    response.set({
      "Cache-Control": "no-store",
      ETag: etag(result.contextRevision),
    });
    return result;
  }
}
