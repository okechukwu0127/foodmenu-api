import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Patch,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { ThrottlerGuard } from "@nestjs/throttler";
import { IdentityClientService } from "./identity-client.service";
import {
  GoogleAuthDto,
  ChangePasswordDto,
  VerifyEmailDto,
  EmailVerificationRequestDto,
  SigninDto,
  SignupDto,
  UpdateProfileDto,
} from "@app/dto";
import { AuthGuard, CurrentLogin, Login } from "./auth.guard";

@ApiTags("Authentication")
@UseGuards(ThrottlerGuard)
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: IdentityClientService) {}

  @Post("signup")
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Create an inactive account and email its activation code; no login token is issued",
  })
  @ApiCreatedResponse({
    description:
      "data includes requiresEmailVerification: true, isActive: false, email, expiresIn and resendAfterSeconds; no accessToken",
  })
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Post("verify-email")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Activate an account using its emailed 6-digit code",
  })
  @ApiOkResponse({
    description: "Account activated; sign in separately to obtain a session",
  })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto);
  }

  @Post("resend-verification")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary:
      "Resend an activation code; replaces older codes with a fresh expiry",
  })
  resendVerification(@Body() dto: EmailVerificationRequestDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Post("signin")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Sign in using email and password after activation",
  })
  @ApiForbiddenResponse({
    description:
      "ACCOUNT_NOT_ACTIVATED: verify the account email before signing in",
  })
  signin(@Body() dto: SigninDto) {
    return this.auth.signin(dto);
  }

  @Post("google")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @ApiOperation({
    summary: "Sign up or sign in using a verified Google ID token",
  })
  google(@Body() dto: GoogleAuthDto) {
    return this.auth.googleSignin(dto.idToken);
  }

  @Post("google/link")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  linkGoogle(@CurrentLogin() login: Login, @Body() dto: GoogleAuthDto) {
    return this.auth.linkGoogle(login.accountId, dto.idToken);
  }

  @Get("me")
  @Header("Cache-Control", "no-store")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  me(@CurrentLogin() login: Login) {
    return login.user;
  }

  @Patch("me")
  @Header("Cache-Control", "no-store")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Update the signed-in customer's name, phone or profile photo",
  })
  updateProfile(@CurrentLogin() login: Login, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(login.accountId, dto);
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  logout(@CurrentLogin() login: Login) {
    return this.auth.logout(login.sessionId);
  }

  @Post("change-password")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Change the current password and revoke all login sessions",
  })
  @ApiBadRequestResponse({
    description:
      "Invalid input, CURRENT_PASSWORD_INCORRECT, PASSWORD_CONFIRMATION_MISMATCH, PASSWORD_UNCHANGED or PASSWORD_NOT_SET",
  })
  @ApiUnauthorizedResponse({
    description: "Missing, expired or revoked login session",
  })
  @ApiOkResponse({
    description:
      "data: { passwordChanged: true, requiresLogin: true }. Sign in again with the new password.",
  })
  changePassword(@CurrentLogin() login: Login, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(login.accountId, login.sessionId, dto);
  }
}
