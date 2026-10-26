import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@app/database";
import { AuthService, GoogleTokenVerifier } from "./auth.service";
import { ProfilePhotoStorageService } from "../photos/profile-photo-storage.service";
import { EmailVerificationService } from "../email/email-verification.service";
import { OAuth2Client } from "google-auth-library";

const account = {
  id: "account-1",
  email: "john@example.com",
  customerId: "customer-1",
  passwordHash: null as string | null,
  googleSub: null,
  emailVerifiedAt: new Date(),
  customer: { firstName: "John", lastName: "Doe", phone: "+447700900123" },
};

describe("Authentication", () => {
  const prisma: any = {
    $transaction: async (action: (tx: any) => Promise<unknown>) =>
      action(prisma),
    $queryRaw: jest.fn(),
    authAccount: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    authSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    customer: { update: jest.fn(), findUnique: jest.fn() },
  };
  const google = { verify: jest.fn() };
  const verification = { assertConfigured: jest.fn(), send: jest.fn() };
  const photos = {
    isManagedKey: jest.fn().mockReturnValue(false),
    publicUrl: jest.fn(),
    remove: jest.fn(),
    store: jest.fn(),
  };
  let service: AuthService;
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ metadata: { other: "keep" } }]);
    service = new AuthService(
      prisma as unknown as PrismaService,
      new ConfigService({ AUTH_SESSION_TTL_SECONDS: 3600 }),
      google as unknown as GoogleTokenVerifier,
      verification as unknown as EmailVerificationService,
      photos as unknown as ProfilePhotoStorageService,
    );
  });

  it("hashes passwords and stores only a hash of each bearer token", async () => {
    prisma.authAccount.create.mockImplementation(async ({ data }: any) => ({
      ...account,
      passwordHash: data.passwordHash,
    }));
    verification.send.mockResolvedValue({
      expiresIn: 14400,
      resendAfterSeconds: 60,
    });
    const result = await service.signup({
      name: "John Doe",
      email: account.email,
      phone: account.customer.phone,
      password: "a-strong-password",
    });
    expect(
      prisma.authAccount.create.mock.calls[0][0].data.passwordHash,
    ).not.toContain("a-strong-password");
    expect(prisma.authSession.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requiresEmailVerification: true,
      isActive: false,
    });
    expect(result).not.toHaveProperty("accessToken");

    const stored = await prisma.authAccount.create.mock.results[0].value;
    prisma.authAccount.findUnique.mockResolvedValue(stored);
    const session = await service.signin({
      email: account.email,
      password: "a-strong-password",
    });
    expect(session.accessToken).toMatch(/^[a-f0-9]{64}$/);
    expect(prisma.authSession.create.mock.calls[0][0].data.tokenHash).not.toBe(
      session.accessToken,
    );
    expect(session.user).not.toHaveProperty("passwordHash");
    prisma.authAccount.findUnique.mockResolvedValue({
      ...stored,
      emailVerifiedAt: null,
    });
    await expect(
      service.signin({ email: account.email, password: "a-strong-password" }),
    ).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_NOT_ACTIVATED" });
    await expect(
      service.signin({ email: account.email, password: "wrong-password" }),
    ).rejects.toThrow("Invalid email or password");
  });

  it("rejects unknown accounts and Google-only accounts for password login", async () => {
    prisma.authAccount.findUnique.mockResolvedValue(null);
    await expect(
      service.signin({ email: account.email, password: "wrong-password" }),
    ).rejects.toThrow("Invalid email or password");
    prisma.authAccount.findUnique.mockResolvedValue(account);
    await expect(
      service.signin({ email: account.email, password: "wrong-password" }),
    ).rejects.toThrow("Invalid email or password");
  });

  it("rejects absent, expired, malformed and revoked sessions", async () => {
    await expect(service.authenticate("invalid")).rejects.toThrow(
      "Invalid login token",
    );
    prisma.authSession.findUnique.mockResolvedValue(null);
    await expect(service.authenticate("a".repeat(64))).rejects.toThrow(
      "Invalid or expired",
    );
    prisma.authSession.findUnique.mockResolvedValue({ expiresAt: new Date(0) });
    await expect(service.authenticate("a".repeat(64))).rejects.toThrow(
      "Invalid or expired",
    );
    prisma.authSession.findUnique.mockResolvedValue({
      id: "session-1",
      accountId: account.id,
      expiresAt: new Date(Date.now() + 10000),
      account,
    });
    await expect(service.authenticate("a".repeat(64))).resolves.toMatchObject({
      customerId: "customer-1",
    });
    await service.logout("session-1");
    expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({
      where: { id: "session-1" },
    });
  });

  it("creates a Google account or signs in using its stable Google subject", async () => {
    google.verify.mockResolvedValue({
      sub: "google-1",
      email: account.email,
      name: "John Doe",
    });
    prisma.authAccount.findUnique.mockResolvedValue(null);
    prisma.authAccount.create.mockResolvedValue({
      ...account,
      googleSub: "google-1",
    });
    await expect(service.googleSignin("id-token")).resolves.toHaveProperty(
      "accessToken",
    );
    expect(prisma.authAccount.create.mock.calls[0][0].data.googleSub).toBe(
      "google-1",
    );
    prisma.authAccount.create.mockClear();
    prisma.authAccount.findUnique.mockResolvedValue({
      ...account,
      googleSub: "google-1",
    });
    await service.googleSignin("id-token");
    expect(prisma.authAccount.create).not.toHaveBeenCalled();
  });

  it("requires password login before linking a matching email", async () => {
    google.verify.mockResolvedValue({ sub: "google-1", email: account.email });
    prisma.authAccount.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(account);
    await expect(service.googleSignin("id-token")).rejects.toThrow(
      "Sign in with your password first",
    );
    prisma.authAccount.findUniqueOrThrow.mockResolvedValue(account);
    await expect(service.linkGoogle(account.id, "id-token")).resolves.toEqual({
      linked: true,
    });
    google.verify.mockResolvedValue({
      sub: "google-2",
      email: "other@example.com",
    });
    await expect(service.linkGoogle(account.id, "id-token")).rejects.toThrow(
      "must match",
    );
  });

  it("persists the photo from a verified Google identity and returns it in the session", async () => {
    const linked = {
      ...account,
      googleSub: "google-1",
      customer: { ...account.customer, metadata: { other: "keep" } },
    };
    prisma.authAccount.findUnique.mockResolvedValue(linked);
    google.verify.mockResolvedValue({
      sub: "google-1",
      photoUrl: "https://example.com/photo.jpg",
    });
    prisma.customer.update.mockImplementation(async ({ data }: any) => ({
      ...linked.customer,
      ...data,
    }));
    const result = await service.googleSignin("signed-id-token");
    expect(result.user.photoUrl).toBe("https://example.com/photo.jpg");
    expect(prisma.customer.update.mock.calls[0][0].data.metadata.other).toBe(
      "keep",
    );
  });
});

describe("Google token verification", () => {
  afterEach(() => jest.restoreAllMocks());
  it("passes the audience allowlist to Google's signature/issuer/expiry verifier", async () => {
    const verify = jest
      .spyOn(OAuth2Client.prototype, "verifyIdToken")
      .mockResolvedValue({
        getPayload: () => ({
          sub: "google-1",
          email: "john@example.com",
          email_verified: true,
        }),
      } as never);
    const verifier = new GoogleTokenVerifier(
      new ConfigService({ GOOGLE_CLIENT_IDS: "web-1, web-2" }),
    );
    await expect(verifier.verify("signed-id-token")).resolves.toHaveProperty(
      "sub",
      "google-1",
    );
    expect(verify).toHaveBeenCalledWith({
      idToken: "signed-id-token",
      audience: ["web-1", "web-2"],
    });
    verify.mockImplementation(
      () => Promise.reject(new Error("expired or wrong audience")) as never,
    );
    await expect(verifier.verify("bad-token")).rejects.toThrow(
      "Invalid or expired",
    );
  });
  it("rejects unverified email and unconfigured Google authentication", async () => {
    jest.spyOn(OAuth2Client.prototype, "verifyIdToken").mockResolvedValue({
      getPayload: () => ({
        sub: "google-1",
        email: "john@example.com",
        email_verified: false,
      }),
    } as never);
    await expect(
      new GoogleTokenVerifier(
        new ConfigService({ GOOGLE_CLIENT_IDS: "web-1" }),
      ).verify("token"),
    ).rejects.toThrow("Invalid or expired");
    await expect(
      new GoogleTokenVerifier(
        new ConfigService({ GOOGLE_CLIENT_IDS: "" }),
      ).verify("token"),
    ).rejects.toThrow("not configured");
  });
});
