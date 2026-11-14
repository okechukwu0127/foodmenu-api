import { Injectable, Logger } from "@nestjs/common";
import { LeadKind } from "@prisma/client";
import { PrismaService } from "@app/database";
import { WebsiteLeadDto, WebsiteLeadResponseDto } from "@app/dto";
import { LeadNotificationService } from "../email/lead-notification.service";

const MESSAGE = {
  demo: "Thank you — we'll be in touch within one working day.",
  partner: "Application received — your partner kit is on its way.",
} as const;

/** +44 7123 456789 style: 0044… and 0… become +44… */
export const normaliseUkPhone = (raw: string) => {
  const digits = raw.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+44")) return digits;
  if (digits.startsWith("0044")) return `+44${digits.slice(4)}`;
  if (digits.startsWith("0")) return `+44${digits.slice(1)}`;
  return digits;
};

const london = (d: Date) =>
  d.toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" });

@Injectable()
export class WebsiteLeadsService {
  private readonly logger = new Logger(WebsiteLeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: LeadNotificationService,
  ) {}

  /** Saves the request, then emails the team in the background (never delays or fails the visitor). */
  async create(dto: WebsiteLeadDto): Promise<WebsiteLeadResponseDto> {
    const kind = dto.kind ?? "demo";
    const response: WebsiteLeadResponseDto = { received: true, kind, message: MESSAGE[kind] };

    // Honeypot filled in: almost certainly a bot. Pretend success, store nothing.
    if (dto.company && dto.company.trim().length > 0) {
      this.logger.warn("Discarded website lead with honeypot field filled");
      return response;
    }

    const now = new Date();
    const lead = await this.prisma.websiteLead.create({
      data: {
        kind: kind === "partner" ? LeadKind.PARTNER : LeadKind.DEMO,
        name: dto.name,
        business: dto.business,
        email: dto.email,
        phone: normaliseUkPhone(dto.phone),
        source: dto.source ?? "website",
        consentAt: now,
      },
      select: { id: true, kind: true, name: true, business: true, email: true, phone: true, source: true, createdAt: true },
    });

    void this.notify(lead).catch(() => undefined);
    return response;
  }

  /** Exposed for tests; resolves once the email attempt (and notifiedAt stamp) is done. */
  async notify(lead: {
    id: string;
    kind: LeadKind;
    name: string;
    business: string;
    email: string;
    phone: string;
    source: string;
    createdAt: Date;
  }) {
    const partner = lead.kind === LeadKind.PARTNER;
    const sent = await this.notifier.send({
      subject: partner
        ? `New partner application — ${lead.name} (${lead.business})`
        : `New demo request — ${lead.business}`,
      heading: partner ? "New partner application" : "New “Book a free demo” request",
      replyTo: lead.email,
      fields: [
        ["Name", lead.name],
        [partner ? "Area they cover" : "Restaurant", lead.business],
        ["Email", lead.email],
        ["Phone", lead.phone],
        ["Received", london(lead.createdAt)],
        ["Source", lead.source],
        ["Reference", lead.id],
      ],
    });
    if (sent) {
      await this.prisma.websiteLead.update({ where: { id: lead.id }, data: { notifiedAt: new Date() } });
    }
    return sent;
  }
}
