# Email verification and activation

Form signup now creates an inactive account and emails an **6-digit code**. It does not issue a login token. The app must show a verification screen, submit the code, and then sign in with the user's password. Google signup/signin continues to use Google's verified identity and does not require a separate emailed code.

All examples use the existing `/api/v1` prefix and the application's standard success/data envelope. Signup, verification and resend are public, rate-limited authentication routes; they do not require a bearer token.

## Configure delivery

The identity service uses configurable SMTP. Add your provider's settings to `.env`:

```dotenv
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=accounts@your-verified-domain.example
EMAIL_VERIFICATION_TTL_SECONDS=14400
EMAIL_VERIFICATION_SECRET=your-private-random-secret-at-least-32-characters
```

Use `14400` for four hours (default), or `7200` for two hours. Other durations are rejected by configuration validation. The expiry starts when SMTP accepts the outgoing message; an SMTP acceptance does not guarantee inbox arrival time.

Use your provider's verified sender/domain for `SMTP_FROM` (a plain email address). For port 587 use `SMTP_SECURE=false` with STARTTLS; for port 465 use `SMTP_SECURE=true` for immediate TLS. Production requires TLS, and certificate verification is retained. See the [official Nodemailer SMTP configuration guide](https://nodemailer.com/smtp).

A private verification secret has been generated in this workspace's local `.env`; its value is not printed in logs. Keep it stable and use the same value on every identity-service instance. For other deployments, generate a fresh secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Store that value securely. Changing it invalidates outstanding codes. SMTP passwords, recipients, verification codes and raw SMTP errors are not logged by the mail service. Codes are never returned by the API.

If SMTP host/from or the verification secret are missing, form signup returns `503 EMAIL_DELIVERY_NOT_CONFIGURED` before creating the account. Google authentication remains available. If SMTP fails after account creation, the account stays inactive and signup returns `503 VERIFICATION_EMAIL_SEND_FAILED`; recover using resend instead of creating another account. Wait for the resend cooldown first. Unknown and already-active emails receive a generic resend response without sending mail.

## Mailtrap Email Sandbox setup

For testing signup emails inside Mailtrap, this workspace's `.env` is prepared with:

```dotenv
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_FROM=no-reply@example.com
SMTP_USER=
SMTP_PASSWORD=
```

1. Sign in to [Mailtrap Sandboxes](https://mailtrap.io/sandboxes).
2. Select your sandbox (for example, **My Sandbox**), or create one.
3. Open its **Integration** tab and select SMTP / Nodemailer if a sample selector is shown.
4. Copy the sandbox **Username** into `SMTP_USER` and **Password** into `SMTP_PASSWORD` in your local `.env`. Keep those credentials private; they do not need to be pasted into chat.
5. Restart `npm run start:dev`, then submit a new form signup through `POST /api/v1/auth/signup`.
6. Open that Mailtrap sandbox's inbox. The **Verify your FoodMenu email address** message contains the six-digit activation code.
7. Submit the code and signup email to `POST /api/v1/auth/verify-email`, then sign in normally.

The signup handler already sends the verification email; no extra send-email endpoint or provider SDK is needed. If the account was already created during an earlier failed send, use `POST /api/v1/auth/resend-verification` instead, waiting for its 60-second cooldown if necessary.

Email Sandbox captures emails inside Mailtrap; it does not deliver them to the signup email's real inbox. No sender-domain verification is required for Sandbox. See [Mailtrap's Sandbox setup](https://docs.mailtrap.io/getting-started/email-sandbox) and [SMTP settings](https://docs.mailtrap.io/email-sandbox/setup).

To deliver to real users later, configure Mailtrap's **Email API/SMTP → Sending Domains**, verify your sending domain, and copy that domain's Integration → SMTP credentials. Live SMTP uses `live.smtp.mailtrap.io`, port `587`, and the sender must belong to your verified domain. Replace all Sandbox credentials with the live credentials shown by Mailtrap; see [Mailtrap's live SMTP setup](https://docs.mailtrap.io/email-api-smtp/setup/smtp-integration).

## 1. Signup → verification screen

```http
POST /api/v1/auth/signup
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "+447700900123",
  "password": "a-strong-password"
}
```

HTTP `201`, with `data`:

```json
{
  "requiresEmailVerification": true,
  "isActive": false,
  "email": "john@example.com",
  "expiresIn": 14400,
  "resendAfterSeconds": 60,
  "message": "Account created. Check your email for the verification code to activate your account."
}
```

Display a six-digit code input and a Resend Code option. Preserve the email, cart and pending checkout. Do not navigate into an authenticated checkout or expect `accessToken` in this response.

## 2. Verify the code

```http
POST /api/v1/auth/verify-email
Content-Type: application/json

{"email":"john@example.com","code":"123456"}
```

Treat `code` as a string so leading zeros are retained. Emails are trimmed/lowercased. HTTP `200`, with `data`:

```json
{
  "activated": true,
  "isActive": true,
  "emailVerified": true,
  "message": "Your email has been verified. You can now sign in."
}
```

Verification does not issue a session. Call `/auth/signin` next using the user's credentials. Codes are single-use; a replay returns the invalid-code response. If a verification response was lost, attempt signin; it succeeds if activation already committed.

Incorrect, expired, unsent, replaced or consumed codes return `400 INVALID_OR_EXPIRED_VERIFICATION_CODE`. Five incorrect guesses lock that code and return `429 VERIFICATION_ATTEMPTS_EXCEEDED`; request a fresh code to recover. Attempts are persisted and serialized in PostgreSQL so concurrent requests and multiple service instances share the limit.

## 3. Sign in after activation

The signin request body remains unchanged. Successful signin returns the usual FoodMenu bearer token and user, now including `isActive: true` and `emailVerified: true`.

For correct credentials on an inactive account, HTTP `403` uses the standard error envelope:

```json
{
  "success": false,
  "status": "error",
  "statusCode": 403,
  "message": "Your account is not activated yet. Verify your email before signing in.",
  "error": {
    "code": "ACCOUNT_NOT_ACTIVATED",
    "details": {"requiresEmailVerification":true}
  }
}
```

The normal response also includes path/timestamp metadata. The app should inspect `error.code`, show the verification screen and allow resend. Incorrect credentials remain `401` and do not disclose activation state. An old bearer token associated with an inactive account also returns `403 ACCOUNT_NOT_ACTIVATED` on protected routes. Activation revokes those old sessions; obtain a new token through signin.

## 4. Resend

```http
POST /api/v1/auth/resend-verification
Content-Type: application/json

{"email":"john@example.com"}
```

HTTP `200`, with `data`:

```json
{
  "message": "If this email belongs to an inactive account, a verification code has been sent.",
  "expiresIn": 14400,
  "resendAfterSeconds": 60
}
```

A resend replaces the previous code, resets its guess counter and starts a fresh expiry after SMTP acceptance. The previous code stops working immediately when a new send is reserved, including if that send fails; request another after the cooldown to recover.

A 60-second per-account cooldown applies across all identity instances, in addition to the existing per-IP auth-route limit. Requesting too soon returns `429 VERIFICATION_RESEND_TOO_SOON` with `error.details.retryAfterSeconds`. Use that value to update the app's resend countdown. No activation-link endpoint is added; the supported flow is entering the emailed code in the app.

## Database and rollout

Migration `20261024180000_add_email_verification` adds:

- Nullable `AuthAccount.emailVerifiedAt`, which is the source of activation state.
- One current `EmailVerification` challenge per account, holding its HMAC hash, request ID, requested/sent/expiry timestamps and guess counter.

Existing Google-linked accounts are marked verified because they were created/linked with verified Google identities. Existing password-only accounts are not grandfathered as email-verified; they must request a code and activate. Existing sessions on these inactive accounts are blocked. Activation atomically marks the account verified, consumes the challenge and revokes old sessions.

Configure SMTP before rolling this out to users. Then deploy the migration and restart services:

```bash
npm install
npm run prisma:generate
npm run prisma:deploy
npm run start:dev
```

Swagger at `/api/docs` includes the new verification/resend endpoints and the inactive-account signin response.

The mobile app requires an update: signup no longer returns a token, verification is a new step, and signin must handle `ACCOUNT_NOT_ACTIVATED`. Retain the offline address queue and cart while users activate their account.

## Verification

```bash
npm test -- --runInBand --watchman=false
npm run test:e2e -- --runInBand --watchman=false
npm run test:email-verification
npm run test:addresses
ESLINT_USE_FLAT_CONFIG=false npm run lint
npm run build
```

The PostgreSQL suites run real migrations in disposable schemas and use real HTTP/TCP services. SMTP delivery is mocked so no real emails are sent during tests. The email suite covers inactive signup/signin, legacy sessions, one-time activation, two/four-hour expiry, failed guesses, resend cooldown/invalidation, missing mail configuration, delivery failure/recovery, pending delivery, and concurrent verifies/resends. The SMTP unit tests verify transport configuration and sanitized failures; a real provider delivery test still requires your SMTP settings.
