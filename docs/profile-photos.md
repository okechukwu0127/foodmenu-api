# Profile photo upload

The authenticated mobile app can upload an image to `POST /api/v1/auth/me/photo`. The gateway accepts multipart data; identity validates and processes the image, writes it to local storage, and saves its reference on the customer profile. `GET /api/v1/auth/me` and subsequent login responses return its URL in `photoUrl`.

## Upload

```bash
curl -i -X POST 'http://localhost:4000/api/v1/auth/me/photo' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -F 'photo=@/absolute/path/to/avatar.jpg'
```

Use an activated user's existing bearer session. Send exactly one file in the `photo` field. Do not manually set `Content-Type` when using curl or mobile FormData; the HTTP client sets the multipart boundary. Customer/account IDs and other form fields are rejected. The authenticated session selects the customer.

Supported inputs: JPEG (`image/jpeg`), PNG (`image/png`), or WebP (`image/webp`), maximum **5 MiB / 5,242,880 bytes**. Both the declared type and actual file signature are checked, then the file must decode successfully. Animated images, SVG, GIF, HEIC and unsupported formats are rejected; convert device photos to JPEG/PNG/WebP before sending. Decoded images are limited to 16 million pixels and 8192 pixels per side.

Identity applies image orientation, crops/resizes to at most 512×512, and re-encodes as WebP. Original metadata, including EXIF location data, is not retained. This follows Sharp's [input limits](https://sharp.pixelplumbing.com/api-constructor/) and [default metadata removal](https://sharp.pixelplumbing.com/api-output/).

HTTP `200` uses the existing envelope; `data` is the updated user:

```json
{
  "success": true,
  "data": {
    "id": "customer-uuid",
    "email": "john@example.com",
    "name": "John Doe",
    "phone": "+447700900123",
    "photoUrl": "http://localhost:4000/uploads/profile-photos/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp",
    "isActive": true,
    "emailVerified": true,
    "providers": ["password"]
  }
}
```

The full response also includes standard status/message/path/timestamp metadata. Missing/invalid/expired tokens return `401`; inactive accounts return `403`. Missing files, unsupported or invalid images and unexpected fields return `400`; files larger than 5 MiB return `413`.

## Read the profile and display the image

```bash
curl 'http://localhost:4000/api/v1/auth/me' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN'
```

Use `data.photoUrl` directly as the image source. The image URL is a public static asset: a person with that URL can fetch it without a bearer token. Only uploads and profile modifications require authentication. Filenames are random UUIDs rather than user IDs or original filenames.

Each replacement creates a new URL to avoid stale image caches. The previous managed photo is removed only after the new file is written and the profile update commits. Invalid uploads or storage failures leave the existing profile photo intact. Concurrent profile operations are serialized through a PostgreSQL customer-row lock. If a database connection fails during commit, the implementation retains a possibly committed file rather than deleting an image that might be referenced; this rare case can leave an unreferenced file for later maintenance.

## Photo precedence and profile editing

An uploaded photo takes precedence over Google's photo. Later Google signin or account linking preserves it, including when a Google refresh races with an upload. Google-sourced photos continue refreshing for customers who have not selected a custom photo.

`PATCH /api/v1/auth/me` remains available for name and phone. Its existing HTTPS `photoUrl` update is retained for compatibility and is treated as a custom image, also preserved across Google signin. Replacing an uploaded image with such a URL removes the old managed file after commit. Sending the unchanged managed URL does not delete that image. For local development, upload URLs may use HTTP; omit `photoUrl` from name/phone patches because the legacy URL field accepts HTTPS only.

The mobile app must use multipart upload for device images rather than putting a local `file://` URI or base64 image into the JSON profile endpoint. The response and profile query supply the server URL to display.

## Storage and deployment

Optional settings:

```dotenv
PROFILE_PHOTO_STORAGE_DIR=uploads/profile-photos
PUBLIC_ASSET_BASE_URL=http://localhost:4000
```

Paths are relative to the process working directory unless absolute. Identity writes the files; the gateway serves them at `/uploads/profile-photos`. Both processes must point to the **same storage directory**. Set `PUBLIC_ASSET_BASE_URL` to the externally reachable API/assets origin for physical mobile devices and deployments, such as `https://api.your-domain.com`; a phone cannot reach your computer through its own localhost.

Customer profile metadata stores the uploaded key/source and URL. Profile reads derive managed URLs from the current asset base. No database migration is required. Uploaded files are excluded from Git and Docker build contexts.

Docker Compose mounts the `foodmenu_profile_photos` named volume read/write in identity and read-only in the gateway, so files survive container recreation. Do not remove that volume unless you intend to remove its images. For services on separate hosts, use shared persistent storage or add object storage before deploying replicas; independent container filesystems cannot share these local files. Keep storage backed up alongside profile data.

Install the new image-processing/upload dependencies and restart the applications:

```bash
npm install
npm run start:dev
```

Swagger at `/api/docs` includes the binary multipart field, bearer authentication and error statuses under **Profile photos**.

## Tests

```bash
npm test -- --runInBand --watchman=false
npm run test:e2e -- --runInBand --watchman=false
npm run test:profile-photos
ESLINT_USE_FLAT_CONFIG=false npm run lint
npm run build
```

The photo integration suite uses a disposable PostgreSQL schema, temporary filesystem directory, real Sharp image processing, HTTP gateway and TCP identity service. Google verification is mocked. It covers authenticated upload, account isolation, static image retrieval, large multipart files, replacement/cleanup, invalid files, storage failure, concurrent uploads, Google precedence and profile edits. Unit tests additionally check decoding limits, metadata removal and path-safe cleanup.
