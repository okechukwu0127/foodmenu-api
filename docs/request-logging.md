# HTTP request logging

The API gateway registers `createRequestLoggingMiddleware` before body parsers, authentication, and static handlers. Each completed or aborted HTTP request produces one JSON log entry with a generated requestId, method, route template, statusCode, durationMs and aborted flag. `X-Request-Id` on the response matches the log. Requests without a resolved route (including static files and unmatched paths) use a placeholder to avoid exposing arbitrary URL contents. Aborted requests report the status at disconnection; it may not have reached the client.

Basic logs are always enabled. To include sanitized request details, set these gateway variables and restart it:

```dotenv
HTTP_LOG_HEADERS=true
HTTP_LOG_BODY=true
```

Both default to false. `HTTP_LOG_BODY` includes parsed query parameters, parsed bodies and uploaded file size/type. Responses are not logged. The old HTTP LoggingInterceptor is no longer registered in the gateway, preventing duplicate request logs. Internal TCP calls are outside this logger's scope.

Headers use an allowlist; authorization, cookies, signatures and custom headers are redacted. Body/query fields matching password, token, secret, code, address, email, phone, name, coordinate, card, image and related sensitive names are recursively redacted. Original request data is unchanged. Raw buffers (including Stripe webhook payloads) are omitted. Uploaded file contents and filenames are omitted. Output size, string length, nesting and collection sizes are capped.

Redaction is based on field names and cannot recognize every secret written inside arbitrary free text. Keep detailed logs disabled in production unless needed, and extend the sanitizer when introducing sensitive fields. Existing application error logs are separate from these request logs.

## JSON formatting and server errors

Request logs are standalone JSON objects with `timestamp`, `level` and `context`. Development uses two-space indentation by default. Set `LOG_PRETTY=false` for compact JSON (one object per line). Production always uses compact JSON. A process manager such as concurrently may add its own line prefixes when running `npm run start:dev`; use `npm run start:dev:gateway` directly for output without those prefixes. Nest startup messages remain in Nest's usual format.

Gateway HTTP errors with status 500 or higher are logged to stderr as structured JSON, including method, route, status, application error code, and the same requestId as the request log and response header. Identity's exception filter also logs unexpected errors and explicit server failures at their source. Error type, safe provider/database code and stack frames are retained; raw exception messages and data are excluded because they can contain credentials or customer data. Client-facing error responses remain unchanged. Expected 4xx failures are visible through request completion logs. Internal TCP request IDs are not yet propagated, so identity error entries do not carry the gateway request ID.
