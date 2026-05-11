import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { randomBytes } from "node:crypto";

const PARAMS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

const MIN_LENGTH = 12;
const MAX_LENGTH = 256;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, PARAMS);
}

export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  try {
    return await verify(encoded, plain, PARAMS);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(plain: unknown): string | null {
  if (typeof plain !== "string") return "Password is required.";
  if (plain.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters.`;
  if (plain.length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters.`;
  return null;
}

let cachedPlaceholder: Promise<string> | null = null;

export function placeholderHash(): Promise<string> {
  if (!cachedPlaceholder) {
    cachedPlaceholder = hash(randomBytes(32).toString("hex"), PARAMS);
  }
  return cachedPlaceholder;
}
