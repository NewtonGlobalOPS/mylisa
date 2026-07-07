import "dotenv/config";

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  JWT_SECRET: process.env.JWT_SECRET ?? "",
  MYLISA_API_KEY: process.env.MYLISA_API_KEY ?? "",
  GOOGLE_OIDC_CLIENT_IDS: process.env.GOOGLE_OIDC_CLIENT_IDS ?? "",
  NEWTONCENTRE_COURSE_DATABASE_URL:
    process.env.NEWTONCENTRE_COURSE_DATABASE_URL ?? "",
};

if (!env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!env.JWT_SECRET) throw new Error("Missing JWT_SECRET");
if (!env.MYLISA_API_KEY) throw new Error("Missing MYLISA_API_KEY");
