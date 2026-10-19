const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, "");

const assetBaseUrl = trimTrailingSlash(
  process.env.PUBLIC_ASSET_BASE_URL ?? "http://localhost:4000",
);

export const assetUrl = (path: string) =>
  `${assetBaseUrl}/${trimLeadingSlash(path)}`;
