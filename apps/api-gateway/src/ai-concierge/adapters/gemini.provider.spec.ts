import { ConfigService } from "@nestjs/config";
import { GeminiConciergeProvider } from "./gemini.provider";
import { MenuToolsService } from "../tools/menu-tools.service";
describe("Gemini direct-provider adapter", () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(["gemini-3.8-flash", undefined, "custom-configured-model"])(
    "uses the configured/default model %s with a mocked Gemini stream",
    async (configuredModel) => {
      const event = {
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Hello from the menu concierge" }],
            },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 6,
          totalTokenCount: 16,
        },
      };
      const fetch = jest.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(`data: ${JSON.stringify(event)}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
      const provider = new GeminiConciergeProvider(
        new ConfigService({
          GOOGLE_GENERATIVE_AI_API_KEY: "test-only-key",
          ...(configuredModel ? { AI_CONCIERGE_MODEL: configuredModel } : {}),
        }),
      );
      const result = provider.stream({
        system: "Private restaurant instructions",
        messages: [{ role: "user", content: "Hello" }],
        tools: {} as ReturnType<MenuToolsService["create"]>,
        signal: new AbortController().signal,
        maxTokens: 100,
        steps: 1,
      });
      const events = [];
      for await (const event of result.events) events.push(event);
      expect(events.filter((e) => e.type === "text-delta")).toEqual([
        expect.objectContaining({ delta: "Hello from the menu concierge" }),
      ]);
      expect(await result.usage).toMatchObject({
        inputTokens: 10,
        outputTokens: 6,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(String(fetch.mock.calls[0][0])).toContain(
        `models/${configuredModel ?? "gemini-3.8-flash"}:streamGenerateContent`,
      );
      expect(String(fetch.mock.calls[0][0])).toContain(
        "generativelanguage.googleapis.com",
      );
    },
  );
  it("fails closed before generation without a configured API key", () => {
    expect(() =>
      new GeminiConciergeProvider(new ConfigService()).assertConfigured(),
    ).toThrow("not configured");
  });
  it("logs provider failures safely instead of dumping the SDK request/error object", async () => {
    jest.replaceProperty(process, "env", {
      ...process.env,
      LOG_COLOR: "never",
    });
    const output = jest
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const rawError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: "private provider request detail",
            status: "PERMISSION_DENIED",
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new GeminiConciergeProvider(
      new ConfigService({ GOOGLE_GENERATIVE_AI_API_KEY: "test-only-key" }),
    );
    const result = provider.stream({
      system: "Private restaurant instructions",
      messages: [{ role: "user", content: "Private customer text" }],
      tools: {} as ReturnType<MenuToolsService["create"]>,
      signal: new AbortController().signal,
      maxTokens: 100,
      steps: 1,
    });
    await expect(
      (async () => {
        for await (const event of result.events) void event;
      })(),
    ).rejects.toThrow("AI_PROVIDER_UNAVAILABLE");
    expect(rawError).not.toHaveBeenCalled();
    const log = output.mock.calls.map((c) => String(c[0])).join("");
    expect(log).toContain('"ai_provider_error"');
    expect(log).toContain('"statusCode": 403');
    expect(log).not.toContain("test-only-key");
    expect(log).not.toContain("private provider request detail");
    expect(log).not.toContain("Private customer text");
  });
});
