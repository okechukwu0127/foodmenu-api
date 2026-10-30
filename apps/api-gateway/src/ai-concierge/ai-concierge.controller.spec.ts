import type { Response } from "express";
import { AiConciergeController } from "./ai-concierge.controller";
import type { ConciergeAccessService } from "./conversations/access.service";
import type { ConciergeConfigService } from "./config/config.service";
import type { ConciergePreferencesService } from "./preferences/preferences.service";
import type { ConversationsService } from "./conversations/conversations.service";
import type { ConciergeChatService } from "./conversations/chat.service";
import type { ConciergeRateLimitService } from "./persistence/rate-limit.service";

describe("AiConciergeController configuration", () => {
  const config = { version: "v1", defaultLocale: "en" };
  const configs = {
    current: jest.fn().mockResolvedValue(config),
    public: jest.fn().mockReturnValue({ version: "v1" }),
    etag: jest.fn().mockReturnValue('"v1-en"'),
  };
  const controller = new AiConciergeController(
    {} as ConciergeAccessService,
    configs as unknown as ConciergeConfigService,
    {} as ConciergePreferencesService,
    {} as ConversationsService,
    {} as ConciergeChatService,
    {} as ConciergeRateLimitService,
  );
  const response = () => ({
    set: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    end: jest.fn(),
    json: jest.fn(),
  });

  beforeEach(() => jest.clearAllMocks());

  it("returns a complete, non-cacheable config response", async () => {
    const res = response();

    await controller.configuration(
      { locale: "en" },
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { version: "v1" },
    });
    expect(res.end).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith({ "Cache-Control": "no-store" });
  });

  it("returns a full config for a matching conditional request", async () => {
    const res = response();

    await controller.configuration(
      { locale: "en" },
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { version: "v1" },
    });
    expect(res.end).not.toHaveBeenCalled();
  });
});
