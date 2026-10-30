import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConversationCommerceService } from "./commerce.service";
import { writeStructuredLog } from "@app/common";
@Injectable()
export class CommerceEventsWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly commerce: ConversationCommerceService) {}
  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 5000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.commerce.pollEvents();
    } catch {
      writeStructuredLog("error", "AiConcierge", {
        event: "commerce_event_sync_failed",
      });
    } finally {
      this.busy = false;
    }
  }
}
