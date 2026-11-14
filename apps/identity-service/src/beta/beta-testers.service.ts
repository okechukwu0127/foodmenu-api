import { Injectable, Logger } from "@nestjs/common";
import { BetaPlatform, BetaTesterStatus } from "@prisma/client";
import { PrismaService } from "@app/database";
import { BetaSignupDto, BetaSignupResponseDto } from "@app/dto";
import { LeadNotificationService } from "../email/lead-notification.service";

const PLATFORM: Record<BetaSignupDto["platform"], BetaPlatform> = {
  ios: BetaPlatform.IOS,
  android: BetaPlatform.ANDROID,
};

const PLATFORM_LABEL: Record<BetaSignupDto["platform"], string> = {
  ios: "iPhone (TestFlight)",
  android: "Android (Google Play testing)",
};

const MESSAGE: Record<BetaSignupDto["platform"], string> = {
  ios: "You're on the list. We'll email your TestFlight invite soon.",
  android:
    "You're on the list. We'll email your Google Play testing invite soon.",
};

@Injectable()
export class BetaTestersService {
  private readonly logger = new Logger(BetaTestersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: LeadNotificationService,
  ) {}

  /**
   * Records a beta-testing request. Idempotent per (email, platform): repeating it
   * refreshes consent and counts the request instead of creating duplicates, and the
   * response is identical either way so the endpoint never reveals who signed up.
   */
  async signup(dto: BetaSignupDto): Promise<BetaSignupResponseDto> {
    const response: BetaSignupResponseDto = {
      registered: true,
      platform: dto.platform,
      message: MESSAGE[dto.platform],
    };

    // Honeypot filled in: almost certainly a bot. Pretend success, store nothing.
    if (dto.company && dto.company.trim().length > 0) {
      this.logger.warn("Discarded beta sign-up with honeypot field filled");
      return response;
    }

    const now = new Date();
    const platform = PLATFORM[dto.platform];
    const source = dto.source ?? "website";
    const existing = await this.prisma.betaTester.findUnique({
      where: { email_platform: { email: dto.email, platform } },
      select: { status: true },
    });

    const saved = await this.prisma.betaTester.upsert({
      where: { email_platform: { email: dto.email, platform } },
      create: { email: dto.email, platform, source, consentAt: now },
      update: {
        consentAt: now,
        requestCount: { increment: 1 },
        // Signing up again after unsubscribing is a fresh opt-in; invited testers stay invited.
        ...(existing?.status === BetaTesterStatus.UNSUBSCRIBED
          ? { status: BetaTesterStatus.REQUESTED }
          : {}),
      },
      select: { status: true, requestCount: true, source: true },
    });

    // Email the team in the background; the saved row is the record either way.
    void this.notifySignup(dto, saved, now).catch(() => undefined);
    return response;
  }

  /** Exposed for tests; resolves once the email attempt is done. */
  notifySignup(
    dto: BetaSignupDto,
    saved: { status: BetaTesterStatus; requestCount: number; source: string },
    at: Date,
  ) {
    const repeat = saved.requestCount > 1;
    return this.notifier.send({
      subject: `${repeat ? "Repeat beta request" : "New beta tester"} — ${PLATFORM_LABEL[dto.platform]}`,
      heading: repeat ? "Beta tester asked again" : "New beta tester sign-up",
      replyTo: dto.email,
      fields: [
        ["Email", dto.email],
        ["Platform", PLATFORM_LABEL[dto.platform]],
        ["Status", saved.status],
        ["Requests so far", String(saved.requestCount)],
        ["Received", at.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })],
        ["Source", saved.source],
      ],
    });
  }
}
