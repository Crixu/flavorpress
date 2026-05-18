type EnvLike = Record<string, string | undefined>;

export const LOCAL_AUTH_PRODUCTION_ERROR = "FLAVORPRESS_AUTH=local refused in Vercel production.";

export function assertLocalAuthNotVercelProduction(env: EnvLike = process.env): void {
  if (env.VERCEL_ENV === "production" && env.FLAVORPRESS_AUTH === "local") {
    throw new Error(LOCAL_AUTH_PRODUCTION_ERROR);
  }
}

assertLocalAuthNotVercelProduction();
