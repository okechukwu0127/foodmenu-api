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

## Red request and response errors

HTTP 4xx/5xx completions and aborted connections are error-level `http_request_failed` events on stderr. The exception filter also logs `http_response_error` for client errors and `server_error` for server failures, with the same request ID and a safe response summary (success/status/error code). Raw response messages/details are deliberately excluded; they can echo submitted credentials, addresses or private notes. Server failures retain safe exception type/code/stack frames. Successful completions remain info-level stdout logs. A handled failure normally produces a response-error entry and a completion entry, correlated by requestId.

`LOG_COLOR=auto` colors error entries red when stderr is an interactive terminal. `LOG_COLOR=always` forces red through process-manager pipes such as concurrently; this is enabled in the local .env. `LOG_COLOR=never` emits plain JSON for files/log collectors. `NO_COLOR` disables coloring even when always is selected. ANSI colors decorate terminal output only; API JSON/SSE responses are unchanged. In production, use never (or auto with non-interactive stderr) to keep machine-readable JSON lines.
