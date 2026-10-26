import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom, timeout } from "rxjs";
import { AppError } from "@app/errors";
import { IDENTITY_PATTERNS } from "@app/common";
import {
  EmailVerificationRequired,
  ChangePasswordDto,
  EmailActivationResponse,
  VerificationResendResponse,
  VerifyEmailDto,
  CustomerAddressResponseDto,
  CustomerAddressesResponseDto,
  DefaultAddressResponseDto,
  PutCustomerAddressDto,
  IdentityLogin,
  IdentitySession,
  IdentityUser,
  SigninDto,
  SignupDto,
  UpdateProfileDto,
} from "@app/dto";

@Injectable()
export class IdentityClientService {
  constructor(
    @Inject("IDENTITY_SERVICE") private readonly client: ClientProxy,
    private readonly config: ConfigService,
  ) {}

  signup(dto: SignupDto) {
    return this.send<EmailVerificationRequired>(IDENTITY_PATTERNS.SIGNUP, dto);
  }
  verifyEmail(dto: VerifyEmailDto) {
    return this.send<EmailActivationResponse>(
      IDENTITY_PATTERNS.VERIFY_EMAIL,
      dto,
    );
  }
  resendVerification(email: string) {
    return this.send<VerificationResendResponse>(
      IDENTITY_PATTERNS.RESEND_VERIFICATION,
      { email },
    );
  }
  signin(dto: SigninDto) {
    return this.send<IdentitySession>(IDENTITY_PATTERNS.SIGNIN, dto);
  }
  googleSignin(idToken: string) {
    return this.send<IdentitySession>(IDENTITY_PATTERNS.GOOGLE_SIGNIN, {
      idToken,
    });
  }
  linkGoogle(accountId: string, idToken: string) {
    return this.send<{ linked: boolean }>(IDENTITY_PATTERNS.LINK_GOOGLE, {
      accountId,
      idToken,
    });
  }
  authenticate(token: string) {
    return this.send<IdentityLogin>(IDENTITY_PATTERNS.AUTHENTICATE, { token });
  }
  logout(sessionId: string) {
    return this.send<{ loggedOut: boolean }>(IDENTITY_PATTERNS.LOGOUT, {
      sessionId,
    });
  }
  changePassword(accountId: string, sessionId: string, dto: ChangePasswordDto) {
    return this.send<{ passwordChanged: true; requiresLogin: true }>(
      IDENTITY_PATTERNS.CHANGE_PASSWORD,
      { ...dto, accountId, sessionId },
    );
  }
  updateProfile(accountId: string, dto: UpdateProfileDto) {
    return this.send<IdentityUser>(IDENTITY_PATTERNS.UPDATE_PROFILE, {
      ...dto,
      accountId,
    });
  }

  uploadProfilePhoto(
    accountId: string,
    imageBase64: string,
    contentType: string,
  ) {
    return this.send<IdentityUser>(IDENTITY_PATTERNS.UPLOAD_PROFILE_PHOTO, {
      accountId,
      imageBase64,
      contentType,
    });
  }

  listAddresses(customerId: string) {
    return this.send<CustomerAddressesResponseDto>(
      IDENTITY_PATTERNS.LIST_ADDRESSES,
      { customerId },
    );
  }
  putAddress(
    customerId: string,
    addressId: string,
    dto: PutCustomerAddressDto,
  ) {
    return this.send<CustomerAddressResponseDto>(
      IDENTITY_PATTERNS.PUT_ADDRESS,
      { ...dto, customerId, addressId },
    );
  }
  setDefaultAddress(customerId: string, addressId: string | null) {
    return this.send<DefaultAddressResponseDto>(
      IDENTITY_PATTERNS.SET_DEFAULT_ADDRESS,
      { customerId, addressId },
    );
  }
  deleteAddress(customerId: string, addressId: string) {
    return this.send<{ deleted: boolean }>(IDENTITY_PATTERNS.DELETE_ADDRESS, {
      customerId,
      addressId,
    });
  }

  private async send<T>(pattern: string, payload: unknown): Promise<T> {
    try {
      return await firstValueFrom(
        this.client
          .send<T>(pattern, payload)
          .pipe(
            timeout(
              Number(
                this.config.get<number>("IDENTITY_SERVICE_TIMEOUT_MS", 10000),
              ),
            ),
          ),
      );
    } catch (error) {
      const response = error as {
        statusCode?: number;
        code?: string;
        details?: unknown;
        message?: string | string[];
      } | null;
      const status = response?.statusCode;
      if (
        status &&
        [400, 401, 403, 404, 409, 413, 429, 500, 503].includes(status)
      ) {
        if (response?.code && typeof response.message === "string") {
          throw new AppError(
            response.code,
            response.message,
            status,
            response.details,
          );
        }
        throw new HttpException(
          {
            statusCode: status,
            message: response?.message ?? "Identity service request failed",
          },
          status,
        );
      }
      throw new ServiceUnavailableException(
        "Identity service is unavailable. Please try again.",
      );
    }
  }
}
