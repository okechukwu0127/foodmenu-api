# Mobile signup, sign-in and protected checkout

Authentication and profiles run in the dedicated identity microservice, while the gateway preserves the HTTP endpoints. See the [identity service architecture and startup guide](identity-service.md). `npm run start:dev` starts it automatically on private TCP port 4050.

The API now supports email/password registration and login, plus Google registration/login. Both methods return the same FoodMenu bearer token. Menu routes remain public. All `/orders/**` and `/payments/stripe/**` routes require this token, including checkout, saved cards, confirmation, refunds and tracking. These routes also check resource ownership. Stripe and Stuart webhooks require configured provider secrets and valid signatures/secrets, because providers do not have a user's login token.

This repository contains the backend. Connect the mobile screens to the endpoints below; Apple and Facebook buttons and the Forgot Password button do not have implementations in this change. Google accounts do not provide a phone number through this flow; collect a delivery contact number/address in checkout when needed and send the number as `customer.phone`. Form signup requires a phone number in international format.

## 1. Apply the backend change

From the repository root:

```bash
npm install
npm run prisma:generate
npm run prisma:deploy
```

The migration creates separate authentication accounts and login sessions, linked to existing `Customer` records. Existing demo/guest customers are not automatically granted accounts or matched by email. New registrations get their own customer ID and order history. Existing customers' orders require an explicit, verified migration if they should be transferred.

Add these settings to your local `.env` (see `.env.example`):

```dotenv
GOOGLE_CLIENT_IDS=YOUR_WEB_CLIENT_ID.apps.googleusercontent.com
AUTH_SESSION_TTL_SECONDS=604800
```

`GOOGLE_CLIENT_IDS` is a comma-separated allowlist of expected token audiences. Usually both mobile platforms request tokens for the same Web/server client ID, so use that one ID. Do not put a Google client secret in the mobile app; this ID-token verification flow does not need one. If this setting is empty, form authentication works and Google login returns `503` until configured.

Then run:

```bash
npm run start:dev
```

Swagger is available at `http://localhost:4000/api/docs`. Use its **Authorize** button with the FoodMenu access token. Requests below use `http://localhost:4000/api/v1`; use your computer's LAN address for a physical device and your deployed HTTPS URL for production.

## 2. Create the Google Cloud project and consent configuration

1. Open [Google Cloud Console](https://console.cloud.google.com/), then create or select your app's project.
2. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen** if the older navigation is shown).
3. Set your app name, support email and developer contact information in **Branding**. Add the production homepage/privacy policy where requested.
4. Select the appropriate **Audience**. A public consumer app generally uses External. Add your development Google accounts as test users while the app is in testing.
5. Use basic identity scopes: `openid`, `email`, `profile`. This login integration does not need Gmail, Drive or other Google data access.

## 3. Create the OAuth clients

In **Google Auth Platform → Clients** (or **APIs & Services → Credentials → Create credentials → OAuth client ID**):

1. Create a **Web application** client named, for example, `FoodMenu Backend`. Copy its client ID into `GOOGLE_CLIENT_IDS`. The native SDK obtains the ID token and sends JSON to our API; this flow does not require a backend OAuth redirect/callback endpoint. Web origins and redirect URIs are relevant only if you later add a browser/redirect flow.
2. For Android, create an **Android** client with your exact application package name and signing certificate SHA-1. Register the signing identities used for debug builds, release builds and Google Play App Signing as applicable.
3. For iOS, create an **iOS** client with the exact bundle ID. Save this client ID for the iOS SDK and configure its reversed client ID URL scheme.

Keep these clients in the same Google Cloud project. Google distinguishes the native application client from the server/Web client used as the ID token audience.

## 4. Configure Google Sign-In in the mobile app

Choose the supported integration for your mobile framework. The exact package configuration depends on whether your app uses Flutter, React Native/Expo, native Android or native iOS; the backend contract stays the same.

- **Android:** use [Sign in with Google through Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg). Set the server client ID to the **Web client ID**, obtain the Google ID token, and pass that token to this API.
- **iOS:** follow [Google's iOS setup](https://developers.google.com/identity/sign-in/ios/start-integrating). Configure `GIDClientID` with the iOS client ID, the reversed client ID URL scheme, and `GIDServerClientID` with the Web client ID. Obtain the ID token after sign-in.
- **Flutter / React Native:** configure your chosen Google Sign-In package's platform client IDs and Web/server client ID, and obtain its Google `idToken`. Follow the package's instructions for the installed version.

Use the **Google ID token**, rather than an OAuth access token, a plain Google user ID, or a Firebase ID token. The server uses Google's official library to validate the token and expected audience and uses Google's stable `sub` identifier to identify returning users. See [Google's server verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Both the Google signup and Google signin buttons call:

```http
POST /api/v1/auth/google
Content-Type: application/json

{"idToken":"GOOGLE_ID_TOKEN_FROM_MOBILE_SDK"}
```

A first Google login creates an account; a returning Google login opens a new FoodMenu session. The endpoint returns HTTP `200` in both cases.

If the email already belongs to a password account, this endpoint returns `409`. Sign in with the existing password, then explicitly link the Google account using both proofs:

```http
POST /api/v1/auth/google/link
Authorization: Bearer FOODMENU_ACCESS_TOKEN
Content-Type: application/json

{"idToken":"GOOGLE_ID_TOKEN_FROM_MOBILE_SDK"}
```

The Google email must match the signed-in account email. Future Google logins then use the linked account and the same order history. A linked Google account is identified by `sub` even if its Google email later changes.

## 5. Connect the form screens

Signup (`201 Created`):

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

Signup now returns `requiresEmailVerification: true` and `isActive: false` without an access token. Show a 6-digit email verification screen, call `POST /api/v1/auth/verify-email` with `{ "email": "john@example.com", "code": "123456" }`, then sign in below. Resend through `POST /api/v1/auth/resend-verification` with the email. Codes expire after four hours by default, configurable to two hours. Follow the [email activation and SMTP setup guide](email-verification.md) before testing form signup.

Signin after activation (`200 OK`):

```http
POST /api/v1/auth/signin
Content-Type: application/json

{"email":"john@example.com","password":"a-strong-password"}
```

Emails are trimmed and lowercased. Passwords must be 8–128 characters; they are not trimmed and are stored as salted scrypt hashes. Invalid credentials return `401`, correct credentials on an inactive account return `403 ACCOUNT_NOT_ACTIVATED`, duplicate registration returns `409`, and invalid form fields return `400`. Authentication routes are limited to 20 requests per minute per client IP and return `429` when exceeded.

Signin after activation and Google authentication return the existing API response envelope. Signup returns the verification-required payload described above:

```json
{
  "success": true,
  "status": "success",
  "statusCode": 200,
  "message": "Request successful",
  "data": {
    "accessToken": "64-character-opaque-login-token",
    "tokenType": "Bearer",
    "expiresIn": 604800,
    "expiresAt": "2026-10-29T12:00:00.000Z",
    "user": {
      "id": "customer-uuid",
      "email": "john@example.com",
      "name": "John Doe",
      "phone": "+447700900123",
      "providers": ["password"],
      "isActive": true,
      "emailVerified": true
    }
  },
  "path": "/api/v1/auth/signin",
  "timestamp": "2026-10-22T12:00:00.000Z"
}
```

Read `response.data.accessToken` from this envelope (your HTTP library may wrap the response body in another `data` property). Store it in the device's secure storage/Keychain/Keystore. The token is an opaque bearer credential, not a JWT to decode. The database stores only its SHA-256 hash. Sessions expire after seven days by default; this version requires login again after expiration and does not implement refresh tokens.

Retrieve the current user with `GET /api/v1/auth/me` and the same Authorization header. Update name, phone or HTTPS profile photo with `PATCH /api/v1/auth/me`; see the [profile API example](identity-service.md#http-compatibility).

## 6. Gate checkout in the mobile app

1. Let guests browse the menu and build their cart.
2. When the user taps Checkout, check for a saved FoodMenu login token. If absent, show signup/signin and preserve the cart.
3. After successful authentication, resume checkout with the saved token:

```http
POST /api/v1/payments/stripe/payment-intent
Authorization: Bearer FOODMENU_ACCESS_TOKEN
Content-Type: application/json

{
  "amount": 2500,
  "currency": "gbp",
  "checkoutSessionId": "unique-cart-checkout-attempt",
  "order": {
    "deliveryAddress": {
      "line1": "23 King Street",
      "city": "London",
      "postcode": "SW1A 1AA",
      "country": "GB"
    }
  }
}
```

The server derives customer identity from the session. Do not send a customer ID to choose whose account is charged. Supplied customer IDs/emails/names are overridden with the signed-in identity. The `customerId` returned by Stripe checkout is a **Stripe** ID; `auth`'s `user.id` is the application's customer ID.

Checkout keys are scoped to the signed-in customer; use the same original key when retrying the same attempt. The returned `checkoutSessionId` is the server's scoped key, so do not substitute it for your original retry key. Start a new key for a new checkout. Let the server generate order IDs; passing an existing order ID requires that it already belongs to the signed-in customer.

4. Send the FoodMenu token on every subsequent order/payment request:

```http
GET /api/v1/orders
Authorization: Bearer FOODMENU_ACCESS_TOKEN
```

```http
GET /api/v1/orders/ORDER_ID/tracking
Authorization: Bearer FOODMENU_ACCESS_TOKEN
```

This applies to confirmation/status/refunds and saved-card setup/list/save/update/delete too. `customerId` is optional on saved-card requests and supplied values are ignored. An order/payment/card belonging to someone else returns `404`; missing, invalid, expired or revoked login credentials return `401` before payment/order processing.

5. On `401`, clear the saved token and show login, preserving the cart. Keep the user signed in on other errors.
6. Log out by calling `POST /api/v1/auth/logout` with the bearer header, then clear device storage and the mobile Google SDK session. Logout revokes that FoodMenu session immediately. Other devices' sessions remain active.

## 7. Run and verify

```bash
npm test -- --runInBand --watchman=false
npm run test:e2e -- --runInBand --watchman=false
npm run build
```

Try checkout with no token: expect `401`. Register/login, then retry with `Authorization: Bearer <accessToken>`: expect normal checkout processing. Try reading another customer's order/card/payment: expect `404`. Log out and retry with the old token: expect `401`.

Google verification unit tests mock Google's token verifier; test a real Google account from the configured mobile SDK after creating the OAuth clients. No Cloud credentials or mobile project are supplied by this repository.

Configure `STRIPE_WEBHOOK_SECRET` and `STUART_WEBHOOK_SECRET` before using provider callbacks. Missing webhook secrets now reject callbacks instead of accepting unauthenticated updates.

Production deployment: run the migration before starting the new gateway. Serve HTTP API traffic over HTTPS. Keep identity/payment/order/menu TCP ports on the private service network; these transports trust the gateway. Docker Compose now exposes those service ports only within its network. Expired session rows can be deleted periodically using `expiresAt < now()` without affecting active sessions. Form signup requires email activation; configure SMTP and follow the [verification flow](email-verification.md). Password reset remains a separate follow-up feature. Existing refund and fulfilment mutation routes retain their customer-facing behavior, scoped to owned records; add staff roles/policies separately if only staff should operate those routes.

## Basic Google profile

Google signup/signin uses only the normal basic sign-in permissions. The verified
ID token supplies the name, email and optional `picture` claim. The API saves the
photo in existing customer metadata and returns it as `user.photoUrl` in signup,
signin and `/auth/me` responses. No database migration is needed.

There is no Google People API import endpoint or request for birthday, gender or
Google phone-number permissions. The response excludes demographic fields.
Phone numbers supplied during form signup remain available for food delivery.
A profile photo may be absent; the mobile app displays a generic avatar then.

## Saved customer addresses

Authenticated address storage is available under `/api/v1/me/addresses`; see the [address API and offline integration guide](customer-addresses.md). These endpoints replace the Expo app's older `/addresses/sync` contract and require a separate mobile client update while retaining its offline queue.

## Upload profile photos

Use `POST /api/v1/auth/me/photo` with bearer authentication and a multipart `photo` file. The response and `GET /api/v1/auth/me` include the stored `photoUrl`. See the [upload, mobile integration and storage guide](profile-photos.md).

## Change password

Use authenticated `POST /api/v1/auth/change-password` with `currentPassword`, `newPassword` and `confirmNewPassword`. Success revokes all sessions; navigate to sign-in. See the [Password Manager integration guide](password-management.md). Forgot-password recovery is a separate flow and is not yet available.
