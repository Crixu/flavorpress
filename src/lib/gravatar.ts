import { createHash } from "node:crypto";

export function gravatarUrl(email: string, size = 80, defaultImage = "mp"): string {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const params = new URLSearchParams({
    s: String(size),
    d: defaultImage,
    r: "g",
  });
  return `https://www.gravatar.com/avatar/${hash}?${params.toString()}`;
}
