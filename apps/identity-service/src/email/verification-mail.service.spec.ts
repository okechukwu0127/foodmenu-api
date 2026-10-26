import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import { VerificationMailService } from "./verification-mail.service";

jest.mock("nodemailer", () => ({ createTransport: jest.fn() }));

describe("Verification mail delivery", () => {
  const transport = { sendMail: jest.fn(), close: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(nodemailer.createTransport).mockReturnValue(transport as never);
    transport.sendMail.mockResolvedValue({
      accepted: ["member@example.com"],
      rejected: [],
    });
  });
  const configuration = {
    NODE_ENV: "production",
    SMTP_HOST: "smtp.example.com",
    SMTP_FROM: "signup@example.com",
    SMTP_USER: "sender",
    SMTP_PASSWORD: "smtp-password",
  };

  it("sends the code and four-hour expiry using authenticated TLS SMTP with logging disabled", async () => {
    await new VerificationMailService(
      new ConfigService(configuration),
    ).sendVerification("member@example.com", "012345", 14400);
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        requireTLS: true,
        secure: false,
        logger: false,
        debug: false,
        auth: { user: "sender", pass: "smtp-password" },
      }),
    );
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        text: expect.stringContaining("012345"),
      }),
    );
    expect(transport.sendMail.mock.calls[0][0].text).toContain("4 hours");
    expect(transport.close).toHaveBeenCalled();
  });

  it("reports unavailable configuration without creating a transport", async () => {
    await expect(
      new VerificationMailService(new ConfigService()).sendVerification(
        "member@example.com",
        "012345",
        7200,
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "EMAIL_DELIVERY_NOT_CONFIGURED",
    });
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it("does not expose SMTP errors or credentials", async () => {
    transport.sendMail.mockRejectedValue(
      new Error("Sensitive SMTP transcript and credentials"),
    );
    await expect(
      new VerificationMailService(
        new ConfigService(configuration),
      ).sendVerification("member@example.com", "012345", 7200),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "VERIFICATION_EMAIL_SEND_FAILED",
      message:
        "We could not send your verification email. Please request a new code shortly.",
    });
    expect(transport.close).toHaveBeenCalled();
  });

  it("treats rejected recipients as failed delivery", async () => {
    transport.sendMail.mockResolvedValue({
      accepted: [],
      rejected: ["member@example.com"],
    });
    await expect(
      new VerificationMailService(
        new ConfigService(configuration),
      ).sendVerification("member@example.com", "012345", 7200),
    ).rejects.toMatchObject({ code: "VERIFICATION_EMAIL_SEND_FAILED" });
  });
});
