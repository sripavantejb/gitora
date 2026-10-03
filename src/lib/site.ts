const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(
  /\/+$/,
  "",
);
const vercelProductionHost =
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL?.trim();

export const SITE_URL =
  configuredSiteUrl ||
  (vercelProductionHost
    ? `https://${vercelProductionHost}`
    : "http://localhost:3000");
export const GITHUB_REPO_URL = "https://github.com/sripavantejb/gitora";
