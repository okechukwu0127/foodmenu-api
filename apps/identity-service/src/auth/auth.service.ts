import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@app/database";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "crypto";
import { promisify } from "util";
import { OAuth2Client } from "google-auth-library";
import { Prisma } from "@prisma/client";
import { AppError } from "@app/errors";
import { ProfilePhotoStorageService } from "../photos/profile-photo-storage.service";
import { EmailVerificationService } from "../email/email-verification.service";
import {
  SignupDto,
  SigninDto,
  UpdateProfileDto,
  IdentityUser,
  ChangePasswordDto,
} from "@app/dto";

const scrypt = promisify(scryptCallback);
const accountInclude = { customer: true } as const;
type Account = Prisma.AuthAccountGetPayload<{ include: typeof accountInclude }>;

const profileFromMetadata = (
  metadata: Prisma.JsonValue | null | undefined,
): Prisma.JsonObject => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return {};
  const profile = metadata.profile;
  return profile && typeof profile === "object" && !Array.isArray(profile)
    ? profile
    : {};
};

const withProfile = (
  metadata: Prisma.JsonValue | null | undefined,
  profile: Prisma.JsonObject,
): Prisma.InputJsonObject => ({
  ...(metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata
    : {}),
  profile: { ...profileFromMetadata(metadata), ...profile },
});

const httpsPhoto = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
};

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();
  constructor(private readonly config: ConfigService) {}

  async verify(idToken: string) {
    const audience = this.config
      .get<string>("GOOGLE_CLIENT_IDS", "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (!audience.length)
      throw new ServiceUnavailableException("Google sign-in is not configured");
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || !payload.email_verified)
        throw new Error("Unverified Google identity");
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        name: payload.name ?? "",
        givenName: payload.given_name,
        familyName: payload.family_name,
        photoUrl: httpsPhoto(payload.picture),
      };
    } catch {
      throw new UnauthorizedException("Invalid or expired Google ID token");
    }
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly google: GoogleTokenVerifier,
    private readonly verification: EmailVerificationService,
    private readonly photos: ProfilePhotoStorageService,
  ) {}

  async signup(dto: SignupDto) {
    this.verification.assertConfigured();
    const salt = randomBytes(16).toString("hex");
    const hash = (await scrypt(dto.password, salt, 64)) as Buffer;
    const [firstName, ...lastName] = dto.name.split(/\s+/);
    try {
      const account = await this.prisma.authAccount.create({
        data: {
          email: dto.email,
          passwordHash: `${salt}:${hash.toString("hex")}`,
          customer: {
            create: {
              id: randomUUID(),
              email: dto.email,
              firstName,
              lastName: lastName.join(" "),
              phone: dto.phone,
            },
          },
        },
        include: accountInclude,
      });
      const sent = await this.verification.send(account.email);
      return {
        ...sent,
        requiresEmailVerification: true as const,
        isActive: false as const,
        email: account.email,
        message:
          "Account created. Check your email for the verification code to activate your account.",
      };
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async signin(dto: SigninDto) {
    return this.prisma.$transaction(
      async (tx) => {
        // Serialize password sign-in with changes so an old password cannot issue
        // a session after the password-change transaction has revoked sessions.
        await tx.$queryRaw`SELECT "id" FROM "AuthAccount" WHERE "email" = ${dto.email} FOR UPDATE`;
        const account = await tx.authAccount.findUnique({
          where: { email: dto.email },
          include: accountInclude,
        });
        if (
          !(await this.passwordMatches(dto.password, account?.passwordHash)) ||
          !account
        ) {
          throw new UnauthorizedException("Invalid email or password");
        }
        return this.createSession(account, tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async changePassword(
    accountId: string,
    sessionId: string,
    dto: ChangePasswordDto,
  ) {
    if (dto.newPassword !== dto.confirmNewPassword)
      throw new AppError(
        "PASSWORD_CONFIRMATION_MISMATCH",
        "New password and confirmation must match",
        400,
      );
    if (dto.newPassword === dto.currentPassword)
      throw new AppError(
        "PASSWORD_UNCHANGED",
        "New password must differ from your current password",
        400,
      );
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AuthAccount" WHERE "id" = ${accountId} FOR UPDATE`;
        // Recheck inside the lock: the gateway guard may have run before another
        // password change invalidated this session.
        const session = await tx.authSession.findUnique({
          where: { id: sessionId },
        });
        if (
          !session ||
          session.accountId !== accountId ||
          session.expiresAt <= new Date()
        )
          throw new UnauthorizedException("Invalid or expired login token");
        const account = await tx.authAccount.findUniqueOrThrow({
          where: { id: accountId },
          include: accountInclude,
        });
        this.assertActive(account);
        if (!account.passwordHash)
          throw new AppError(
            "PASSWORD_NOT_SET",
            "This account uses Google sign-in and does not have a password to change",
            400,
          );
        if (
          !(await this.passwordMatches(
            dto.currentPassword,
            account.passwordHash,
          ))
        )
          throw new AppError(
            "CURRENT_PASSWORD_INCORRECT",
            "Current password is incorrect",
            400,
          );
        const salt = randomBytes(16).toString("hex");
        const hash = (await scrypt(dto.newPassword, salt, 64)) as Buffer;
        await tx.authAccount.update({
          where: { id: accountId },
          data: { passwordHash: `${salt}:${hash.toString("hex")}` },
        });
        await tx.authSession.deleteMany({ where: { accountId } });
        return { passwordChanged: true as const, requiresLogin: true as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async passwordMatches(password: string, stored?: string | null) {
    const [salt, expected] = stored?.split(":") ?? [
      "0".repeat(32),
      "0".repeat(128),
    ];
    const hash = (await scrypt(password, salt, 64)) as Buffer;
    const expectedBuffer = Buffer.from(expected ?? "", "hex");
    return (
      Boolean(stored) &&
      expectedBuffer.length === hash.length &&
      timingSafeEqual(hash, expectedBuffer)
    );
  }

  async googleSignin(idToken: string) {
    const identity = await this.google.verify(idToken);
    let account = await this.prisma.authAccount.findUnique({
      where: { googleSub: identity.sub },
      include: accountInclude,
    });
    if (!account) {
      if (
        await this.prisma.authAccount.findUnique({
          where: { email: identity.email },
        })
      ) {
        throw new ConflictException(
          "Sign in with your password first, then link Google using /auth/google/link",
        );
      }
      try {
        account = await this.prisma.authAccount.create({
          data: {
            email: identity.email,
            googleSub: identity.sub,
            emailVerifiedAt: new Date(),
            customer: {
              create: {
                id: randomUUID(),
                email: identity.email,
                firstName: identity.givenName ?? identity.name,
                lastName: identity.familyName,
                ...(identity.photoUrl
                  ? {
                      metadata: withProfile(null, {
                        photoUrl: identity.photoUrl,
                      }),
                    }
                  : {}),
              },
            },
          },
          include: accountInclude,
        });
      } catch (error) {
        this.rethrowConflict(error);
      }
    }
    if (identity.photoUrl && account) {
      account.customer = await this.updateGooglePhoto(
        account.customerId,
        identity.photoUrl,
      );
    }
    return this.createSession(account!);
  }

  async linkGoogle(accountId: string, idToken: string) {
    const identity = await this.google.verify(idToken);
    const account = await this.prisma.authAccount.findUniqueOrThrow({
      where: { id: accountId },
      include: accountInclude,
    });
    if (
      account.email !== identity.email ||
      (account.googleSub && account.googleSub !== identity.sub)
    ) {
      throw new ConflictException(
        "Google account must match your account email and existing Google identity",
      );
    }
    try {
      await this.prisma.authAccount.update({
        where: { id: accountId },
        data: { googleSub: identity.sub },
      });
      if (identity.photoUrl) {
        await this.updateGooglePhoto(account.customerId, identity.photoUrl);
      }
      return { linked: true };
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async authenticate(token: string) {
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new UnauthorizedException("Invalid login token");
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.tokenHash(token) },
      include: { account: { include: accountInclude } },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException("Invalid or expired login token");
    this.assertActive(session.account);
    return {
      sessionId: session.id,
      accountId: session.accountId,
      customerId: session.account.customerId,
      user: this.user(session.account),
    };
  }

  async logout(sessionId: string) {
    await this.prisma.authSession.deleteMany({ where: { id: sessionId } });
    return { loggedOut: true };
  }

  private async createSession(
    account: Account,
    db: Pick<Prisma.TransactionClient, "authSession"> = this.prisma,
  ) {
    this.assertActive(account);
    const accessToken = randomBytes(32).toString("hex");
    const expiresIn = Number(
      this.config.get<number>("AUTH_SESSION_TTL_SECONDS", 604800),
    );
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await db.authSession.create({
      data: {
        accountId: account.id,
        tokenHash: this.tokenHash(accessToken),
        expiresAt,
      },
    });
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn,
      expiresAt: expiresAt.toISOString(),
      user: this.user(account),
    };
  }

  async updateProfile(accountId: string, dto: UpdateProfileDto) {
    const account = await this.prisma.authAccount.findUniqueOrThrow({
      where: { id: accountId },
      include: accountInclude,
    });
    const names = dto.name?.split(/\s+/);
    account.customer = await this.mutateProfile(
      account.customerId,
      (metadata) => {
        const profile = profileFromMetadata(metadata);
        const currentUrl = this.photos.isManagedKey(profile.uploadedPhotoKey)
          ? this.photos.publicUrl(profile.uploadedPhotoKey)
          : profile.photoUrl;
        return {
          ...(names
            ? { firstName: names[0], lastName: names.slice(1).join(" ") }
            : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.photoUrl !== undefined && dto.photoUrl !== currentUrl
            ? {
                metadata: withProfile(metadata, {
                  photoUrl: dto.photoUrl,
                  photoSource: "custom",
                  uploadedPhotoKey: null,
                }),
              }
            : {}),
        };
      },
    );
    return this.user(account);
  }

  async uploadProfilePhoto(
    accountId: string,
    imageBase64: string,
    contentType: string,
  ) {
    const account = await this.prisma.authAccount.findUniqueOrThrow({
      where: { id: accountId },
      include: accountInclude,
    });
    this.assertActive(account);
    const photo = await this.photos.store(imageBase64, contentType);
    try {
      account.customer = await this.mutateProfile(
        account.customerId,
        (metadata) => ({
          metadata: withProfile(metadata, {
            photoUrl: photo.url,
            uploadedPhotoKey: photo.key,
            photoSource: "upload",
          }),
        }),
      );
      return this.user(account);
    } catch (error) {
      // A lost DB commit acknowledgement is ambiguous. Remove the new file only
      // after a successful read proves it is not the current profile image.
      try {
        const current = await this.prisma.customer.findUnique({
          where: { id: account.customerId },
          select: { metadata: true },
        });
        if (
          !current ||
          profileFromMetadata(current.metadata).uploadedPhotoKey !== photo.key
        )
          await this.photos.remove(photo.key);
      } catch {
        /* Keep the file if the database cannot confirm whether it committed. */
      }
      throw error;
    }
  }

  private updateGooglePhoto(customerId: string, photoUrl: string) {
    return this.mutateProfile(customerId, (metadata) => {
      const profile = profileFromMetadata(metadata);
      if (
        this.photos.isManagedKey(profile.uploadedPhotoKey) ||
        profile.photoSource === "upload" ||
        profile.photoSource === "custom"
      )
        return {};
      return {
        metadata: withProfile(metadata, { photoUrl, photoSource: "google" }),
      };
    });
  }

  private async mutateProfile(
    customerId: string,
    data: (metadata: Prisma.JsonValue | null) => Prisma.CustomerUpdateInput,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const [current] = await tx.$queryRaw<
        { metadata: Prisma.JsonValue | null }[]
      >`
        SELECT "metadata" FROM "Customer" WHERE "id" = ${customerId} FOR UPDATE
      `;
      if (!current) throw new NotFoundException("Customer profile not found");
      const previousPhotoKey = profileFromMetadata(
        current.metadata,
      ).uploadedPhotoKey;
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: data(current.metadata),
      });
      return { customer, previousPhotoKey };
    });
    if (
      result.previousPhotoKey !==
      profileFromMetadata(result.customer.metadata).uploadedPhotoKey
    )
      await this.photos.remove(result.previousPhotoKey);
    return result.customer;
  }

  private user(account: Account): IdentityUser {
    const profile = profileFromMetadata(account.customer.metadata);
    return {
      id: account.customerId,
      email: account.email,
      name: [account.customer.firstName, account.customer.lastName]
        .filter(Boolean)
        .join(" "),
      phone: account.customer.phone,
      photoUrl: this.photos.isManagedKey(profile.uploadedPhotoKey)
        ? this.photos.publicUrl(profile.uploadedPhotoKey)
        : typeof profile.photoUrl === "string"
          ? profile.photoUrl
          : null,
      isActive: Boolean(account.emailVerifiedAt),
      emailVerified: Boolean(account.emailVerifiedAt),
      providers: [
        ...(account.passwordHash ? ["password"] : []),
        ...(account.googleSub ? ["google"] : []),
      ],
    };
  }

  private assertActive(account: Account) {
    if (!account.emailVerifiedAt)
      throw new AppError(
        "ACCOUNT_NOT_ACTIVATED",
        "Your account is not activated yet. Verify your email before signing in.",
        403,
        { requiresEmailVerification: true },
      );
  }

  private tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  private rethrowConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      throw new ConflictException(
        "An account with these credentials already exists",
      );
    throw error;
  }
}
