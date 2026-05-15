#!/usr/bin/env -S npx tsx --conditions=react-server
/**
 * Re-encrypt local dev secrets that were written with cwd-derived legacy keys.
 *
 * Usage:
 *   npm run migrate-legacy-secret-keys -- --from-cwd /old/flavorpress/path
 *   npm run migrate-legacy-secret-keys -- --from-homedir
 */

import { createDecipheriv, createHash } from "node:crypto";
import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client, type InValue } from "@libsql/client";
import {
  decryptSecret,
  encryptSecret,
  hasEncryptionKeyConfigured,
  isEncryptedSecret,
} from "../src/lib/secret-crypto";

const SECRET_PREFIX = "fpsec:v1:";

interface SecretEnvelope {
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ct: string;
}

interface CliArgs {
  dbPath?: string;
  fromCwds: string[];
  fromHomedir: boolean;
}

export interface MigrationOptions {
  dbPath?: string;
  fromCwds?: string[];
  fromHomedir?: boolean;
}

export interface MigrationResult {
  scanned: number;
  migrated: number;
  skipped: number;
}

interface SecretCell {
  table: "outlets" | "app_settings";
  idValue: InValue;
  column: "app_password_encrypted" | "wpcom_refresh_token_encrypted" | "value";
  value: unknown;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { fromCwds: [], fromHomedir: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from-cwd") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing path after --from-cwd.");
      args.fromCwds.push(path.resolve(value));
      i += 1;
      continue;
    }
    if (arg === "--from-homedir") {
      args.fromHomedir = true;
      continue;
    }
    if (arg === "--db") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing path after --db.");
      args.dbPath = path.resolve(value);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export async function migrateLegacySecretKeys(options: MigrationOptions): Promise<MigrationResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run legacy secret migration in production.");
  }
  if (!hasEncryptionKeyConfigured()) {
    throw new Error("Set FLAVORPRESS_ENCRYPTION_KEY before running the migration.");
  }

  const legacyKeys = buildLegacyKeys(options);
  if (legacyKeys.length === 0) {
    throw new Error("Pass at least one legacy source: --from-cwd <path> or --from-homedir.");
  }

  const dbUrl = resolveDatabaseUrl(options.dbPath);
  const client = createClient({ url: dbUrl });

  try {
    const cells = await listSecretCells(client);
    const result: MigrationResult = { scanned: 0, migrated: 0, skipped: 0 };

    for (const cell of cells) {
      result.scanned += 1;
      const secret = secretValueToString(cell.value);
      if (!secret || !isEncryptedSecret(secret)) {
        result.skipped += 1;
        continue;
      }
      if (decryptsWithCurrentKey(secret)) {
        result.skipped += 1;
        continue;
      }

      const plaintext = decryptWithLegacyKeys(secret, legacyKeys);
      if (!plaintext) {
        result.skipped += 1;
        continue;
      }

      const encrypted = encryptSecret(plaintext);
      await updateSecretCell(client, cell, encrypted);
      result.migrated += 1;
    }

    return result;
  } finally {
    client.close();
  }
}

function buildLegacyKeys(options: MigrationOptions): Buffer[] {
  const paths = [...(options.fromCwds ?? [])];
  if (options.fromHomedir) {
    paths.push(path.join(homedir(), "Studio", "FlavorPress-app"));
  }
  return dedupeKeys(paths.map((legacyPath) => legacyLocalDevelopmentKey(path.resolve(legacyPath))));
}

function resolveDatabaseUrl(dbPath?: string): string {
  if (dbPath) {
    if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
    return `file:${dbPath}`;
  }

  const configured = process.env.LIBSQL_URL?.trim();
  if (!configured) {
    return `file:${path.join(process.cwd(), ".data", "flavorpress.db")}`;
  }
  if (configured.startsWith("file:")) return configured;
  if (!configured.includes("://")) return configured;

  throw new Error(
    "Refusing to run against a remote LIBSQL_URL. Pass --db for a local sqlite file.",
  );
}

async function listSecretCells(client: Client): Promise<SecretCell[]> {
  const cells: SecretCell[] = [];

  if (await tableExists(client, "outlets")) {
    const outletColumns = await listColumns(client, "outlets");
    const secretColumns = ["app_password_encrypted", "wpcom_refresh_token_encrypted"].filter(
      (column) => outletColumns.includes(column),
    ) as Array<"app_password_encrypted" | "wpcom_refresh_token_encrypted">;

    if (secretColumns.length > 0) {
      const r = await client.execute({
        sql: `SELECT rowid, ${secretColumns.join(", ")} FROM outlets`,
      });
      for (const row of r.rows) {
        for (const column of secretColumns) {
          cells.push({
            table: "outlets",
            idValue: Number(row.rowid),
            column,
            value: row[column],
          });
        }
      }
    }
  }

  if (await tableExists(client, "app_settings")) {
    const r = await client.execute("SELECT key, value FROM app_settings");
    for (const row of r.rows) {
      cells.push({
        table: "app_settings",
        idValue: String(row.key),
        column: "value",
        value: row.value,
      });
    }
  }

  return cells;
}

async function tableExists(client: Client, table: string): Promise<boolean> {
  const r = await client.execute({
    sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return r.rows.length > 0;
}

async function listColumns(client: Client, table: string): Promise<string[]> {
  const r = await client.execute(`PRAGMA table_info(${table})`);
  return r.rows.map((row) => String(row.name));
}

async function updateSecretCell(
  client: Client,
  cell: SecretCell,
  encrypted: string,
): Promise<void> {
  const value = cell.table === "outlets" ? Buffer.from(encrypted, "utf8") : encrypted;
  if (cell.table === "app_settings") {
    await client.execute({
      sql: `UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?`,
      args: [value, Date.now(), cell.idValue],
    });
    return;
  }

  await client.execute({
    sql: `UPDATE outlets SET ${cell.column} = ? WHERE rowid = ?`,
    args: [value, cell.idValue],
  });
}

function decryptsWithCurrentKey(secret: string): boolean {
  try {
    decryptSecret(secret);
    return true;
  } catch {
    return false;
  }
}

function decryptWithLegacyKeys(secret: string, keys: Buffer[]): string | null {
  const envelope = parseEnvelope(secret);
  if (!envelope || envelope.alg !== "aes-256-gcm") return null;

  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, fromBase64Url(envelope.iv));
      decipher.setAuthTag(fromBase64Url(envelope.tag));
      return Buffer.concat([
        decipher.update(fromBase64Url(envelope.ct)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Try the next explicit legacy key.
    }
  }

  return null;
}

function parseEnvelope(secret: string): SecretEnvelope | null {
  try {
    return JSON.parse(
      Buffer.from(fromBase64Url(secret.slice(SECRET_PREFIX.length))).toString("utf8"),
    ) as SecretEnvelope;
  } catch {
    return null;
  }
}

function secretValueToString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("utf8");
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8");
  }
  if (isArrayBufferLike(value)) return Buffer.from(value).toString("utf8");
  return null;
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { byteLength?: unknown; slice?: unknown };
  return typeof candidate.byteLength === "number" && typeof candidate.slice === "function";
}

function legacyLocalDevelopmentKey(cwd: string): Buffer {
  return createHash("sha256").update(`FlavorPress local development key:${cwd}`).digest();
}

function dedupeKeys(keys: Buffer[]): Buffer[] {
  const seen = new Set<string>();
  return keys.filter((key) => {
    const id = key.toString("hex");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function fromBase64Url(value: string): Buffer {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await migrateLegacySecretKeys(args);
  process.stdout.write(
    `Scanned ${result.scanned} secret cells; migrated ${result.migrated}; skipped ${result.skipped}.\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
