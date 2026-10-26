export * from "./auth.dto";

export type IdentityUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  providers: string[];
  isActive: boolean;
  emailVerified: boolean;
};

export type IdentityLogin = {
  sessionId: string;
  accountId: string;
  customerId: string;
  user: IdentityUser;
};

export type IdentitySession = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  expiresAt: string;
  user: IdentityUser;
};

export * from "./address.dto";

export type EmailVerificationRequired = {
  requiresEmailVerification: true;
  isActive: false;
  email: string;
  expiresIn: number;
  resendAfterSeconds: number;
  message: string;
};
export type VerificationResendResponse = {
  message: string;
  expiresIn: number;
  resendAfterSeconds: number;
};
export type EmailActivationResponse = {
  activated: boolean;
  isActive: boolean;
  emailVerified: boolean;
  message: string;
};

export * from "./profile-photo.dto";
