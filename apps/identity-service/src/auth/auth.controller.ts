import { Controller } from "@nestjs/common";
import { MessagePattern, Payload } from "@nestjs/microservices";
import { IDENTITY_PATTERNS } from "@app/common";
import {
  UploadProfilePhotoPayload,
  ChangePasswordPayload,
  AuthenticateDto,
  VerifyEmailDto,
  EmailVerificationRequestDto,
  GoogleAuthDto,
  LinkGoogleDto,
  LogoutDto,
  ProfileUpdatePayload,
  SigninDto,
  SignupDto,
} from "@app/dto";
import { EmailVerificationService } from "../email/email-verification.service";
import { AuthService } from "./auth.service";

@Controller()
export class IdentityController {
  constructor(
    private readonly auth: AuthService,
    private readonly verification: EmailVerificationService,
  ) {}

  @MessagePattern(IDENTITY_PATTERNS.SIGNUP)
  signup(@Payload() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @MessagePattern(IDENTITY_PATTERNS.VERIFY_EMAIL)
  verifyEmail(@Payload() dto: VerifyEmailDto) {
    return this.verification.verify(dto.email, dto.code);
  }

  @MessagePattern(IDENTITY_PATTERNS.RESEND_VERIFICATION)
  resendVerification(@Payload() dto: EmailVerificationRequestDto) {
    return this.verification.send(dto.email);
  }

  @MessagePattern(IDENTITY_PATTERNS.SIGNIN)
  signin(@Payload() dto: SigninDto) {
    return this.auth.signin(dto);
  }

  @MessagePattern(IDENTITY_PATTERNS.GOOGLE_SIGNIN)
  google(@Payload() dto: GoogleAuthDto) {
    return this.auth.googleSignin(dto.idToken);
  }

  @MessagePattern(IDENTITY_PATTERNS.LINK_GOOGLE)
  linkGoogle(@Payload() dto: LinkGoogleDto) {
    return this.auth.linkGoogle(dto.accountId, dto.idToken);
  }

  @MessagePattern(IDENTITY_PATTERNS.AUTHENTICATE)
  authenticate(@Payload() dto: AuthenticateDto) {
    return this.auth.authenticate(dto.token);
  }

  @MessagePattern(IDENTITY_PATTERNS.LOGOUT)
  logout(@Payload() dto: LogoutDto) {
    return this.auth.logout(dto.sessionId);
  }

  @MessagePattern(IDENTITY_PATTERNS.CHANGE_PASSWORD)
  changePassword(@Payload() dto: ChangePasswordPayload) {
    return this.auth.changePassword(dto.accountId, dto.sessionId, dto);
  }

  @MessagePattern(IDENTITY_PATTERNS.UPLOAD_PROFILE_PHOTO)
  uploadPhoto(@Payload() dto: UploadProfilePhotoPayload) {
    return this.auth.uploadProfilePhoto(
      dto.accountId,
      dto.imageBase64,
      dto.contentType,
    );
  }

  @MessagePattern(IDENTITY_PATTERNS.UPDATE_PROFILE)
  updateProfile(@Payload() dto: ProfileUpdatePayload) {
    const { accountId, ...profile } = dto;
    return this.auth.updateProfile(accountId, profile);
  }
}
