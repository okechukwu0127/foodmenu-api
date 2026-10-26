# Password Manager screen

## Change an existing password

`POST /api/v1/auth/change-password` requires an active Bearer session. The gateway derives account/session IDs from the token; request-supplied IDs and other unknown fields are rejected.

```bash
curl -X POST 'http://localhost:4000/api/v1/auth/change-password' \
  -H 'Authorization: Bearer YOUR_LOGIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "currentPassword": "your-current-password",
    "newPassword": "your-new-password",
    "confirmNewPassword": "your-new-password"
  }'
```

All three fields are required strings of 8–128 characters, following the existing signup policy. Passwords are not trimmed. Confirmation must match exactly and the new password must differ from the current one. Google-only accounts cannot use this endpoint to create their first password; they continue to sign in with Google.

Successful response: HTTP 200, `Cache-Control: no-store`, using the standard response envelope. Its relevant fields are:

```json
{
  "success": true,
  "data": {
    "passwordChanged": true,
    "requiresLogin": true
  }
}
```

After success, delete the local session token and navigate to sign-in. All existing sessions, including the current device, are revoked. No new token is returned. Google linking and profile data are preserved. If a response is lost after the change committed, the old token will return 401; sign in with the new password to recover.

Errors use the existing error envelope (`error.code`, `message`, etc.):

| HTTP | Code/condition | Frontend behavior |
| --- | --- | --- |
| 400 | CURRENT_PASSWORD_INCORRECT | Show an error under Current Password |
| 400 | PASSWORD_CONFIRMATION_MISMATCH | Show an error under Confirm New Password |
| 400 | PASSWORD_UNCHANGED | Ask for a different new password |
| 400 | PASSWORD_NOT_SET | Explain that this account uses Google sign-in |
| 400 | Standard DTO validation error | Show the returned validation message |
| 401 | Missing, expired, or revoked session | Navigate to sign-in |
| 403 | ACCOUNT_NOT_ACTIVATED | Complete email activation |
| 429 | Existing gateway rate limit | Ask the user to wait before retrying |

The identity service uses salted scrypt hashes, account row locks and a transaction for hash replacement plus session revocation. Password sign-in uses the same lock, so racing old-password sign-ins cannot leave a valid session after the change commits. The session is checked again inside the lock. Request logs redact all three password fields.

No database migration or new environment variable is needed. Swagger documents the route under Authentication at `/api/docs`.

## Forgot Password link

This is a separate email-based recovery flow. There is currently no forgot-password/reset-by-code endpoint. The email activation endpoints verify signup ownership and must not be used to reset passwords. Wire the Password Manager submit button to the change-password endpoint above; the Forgot Password link needs separate backend recovery APIs before it can be used.

Database integration coverage lives in `test/email-verification.e2e-spec.ts` and runs with `npm run test:email-verification` in an isolated, disposable schema. It covers authentication, account isolation, validation, incorrect passwords, Google-only accounts, hash replacement, all-session revocation and concurrent changes/sign-ins.
