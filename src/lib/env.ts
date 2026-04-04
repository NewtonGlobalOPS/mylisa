import "dotenv/config";

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  JWT_SECRET: process.env.JWT_SECRET ?? "",
};

if (!env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!env.JWT_SECRET) throw new Error("Missing JWT_SECRET");
