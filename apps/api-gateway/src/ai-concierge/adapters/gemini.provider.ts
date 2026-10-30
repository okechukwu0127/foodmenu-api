import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ModelMessage, stepCountIs, streamText } from "ai";
import { fail } from "../persistence/contracts";
import { MenuToolsService } from "../tools/menu-tools.service";
import { serverErrorDetails, writeStructuredLog } from "@app/common";

export type TextEvent =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string };
@Injectable()
export class GeminiConciergeProvider {
  constructor(private readonly config: ConfigService) {}
  assertConfigured() {
    if (!this.config.get<string>("GOOGLE_GENERATIVE_AI_API_KEY"))
      fail(
        "AI_PROVIDER_UNAVAILABLE",
        "The concierge provider is not configured",
        503,
      );
  }
  stream(options: {
    system: string;
    messages: ModelMessage[];
    tools: ReturnType<MenuToolsService["create"]>;
    signal: AbortSignal;
    maxTokens: number;
    steps: number;
  }) {
    this.assertConfigured();
    const google = createGoogleGenerativeAI({
      apiKey: this.config.get<string>("GOOGLE_GENERATIVE_AI_API_KEY"),
    });
    const model = this.config.get<string>(
      "AI_CONCIERGE_MODEL",
      "gemini-3.8-flash",
    );
    const result = streamText({
      model: google(model),
      onError: ({ error }) => {
        const status =
          error && typeof error === "object" && "statusCode" in error
            ? error.statusCode
            : undefined;
        writeStructuredLog("error", "GeminiConciergeProvider", {
          event: "ai_provider_error",
          model,
          statusCode: typeof status === "number" ? status : undefined,
          error: serverErrorDetails(error),
        });
      },
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      abortSignal: options.signal,
      maxOutputTokens: options.maxTokens,
      stopWhen: [
        stepCountIs(options.steps),
        ({ steps }) =>
          steps.reduce(
            (sum, step) => sum + (step.usage.outputTokens ?? 0),
            0,
          ) >= options.maxTokens,
      ],
      prepareStep: ({ stepNumber, steps }) => ({
        maxOutputTokens: Math.max(
          1,
          options.maxTokens -
            steps.reduce(
              (sum, step) => sum + (step.usage.outputTokens ?? 0),
              0,
            ),
        ),
        toolChoice:
          options.steps > 1 && stepNumber === options.steps - 1
            ? "none"
            : stepNumber === 0 && Object.keys(options.tools).length
              ? "required"
              : "auto",
      }),
      maxRetries: 0,
    });
    async function* events(): AsyncGenerator<TextEvent> {
      for await (const part of result.fullStream) {
        if (part.type === "error") throw new Error("AI_PROVIDER_UNAVAILABLE");
        if (part.type === "abort") throw new Error("AI_CANCELLED");
        if (part.type === "text-start" || part.type === "text-end")
          yield { type: part.type, id: part.id };
        if (part.type === "text-delta")
          yield { type: part.type, id: part.id, delta: part.text };
      }
    }
    const usage = Promise.resolve(result.totalUsage)
      .then((u) => ({
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
      }))
      .catch(() => ({}));
    return { events: events(), usage };
  }
}
