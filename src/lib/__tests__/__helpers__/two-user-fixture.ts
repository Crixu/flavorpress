import { db, ensureSchema } from "@/lib/db";
import { createUser } from "@/lib/users";
import { hashPassword } from "@/lib/password";

export interface TwoUserFixture {
  userA: { id: string; email: string };
  userB: { id: string; email: string };
}

export async function createTwoUserFixture(): Promise<TwoUserFixture> {
  await ensureSchema();
  await db.execute("DELETE FROM users");
  const hash = await hashPassword("correct horse battery staple");
  const verifiedAt = Date.now();
  const a = await createUser({
    email: "a@example.com",
    passwordHash: hash,
    emailVerifiedAt: verifiedAt,
  });
  const b = await createUser({
    email: "b@example.com",
    passwordHash: hash,
    emailVerifiedAt: verifiedAt,
  });
  return {
    userA: { id: a.id, email: a.email },
    userB: { id: b.id, email: b.email },
  };
}

export async function seedOutletForUser(
  userId: string,
  opts?: { id?: string; baseUrl?: string; displayName?: string },
): Promise<string> {
  const id = opts?.id ?? `o_${userId.slice(0, 4)}_${Math.random().toString(36).slice(2, 8)}`;
  const baseUrl = opts?.baseUrl ?? `https://${id}.example.com`;
  await db.execute({
    sql: `INSERT INTO outlets (id, user_id, base_url, display_name, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, userId, baseUrl, opts?.displayName ?? id, Date.now()],
  });
  return id;
}

export async function seedSourceForUser(
  userId: string,
  opts?: { id?: string; url?: string; kind?: string },
): Promise<string> {
  const id = opts?.id ?? `s_${userId.slice(0, 4)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.execute({
    sql: `INSERT INTO sources (id, user_id, kind, url, created_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [
      id,
      userId,
      opts?.kind ?? "rss",
      opts?.url ?? `https://${id}.example.com/feed`,
      Date.now(),
    ],
  });
  return id;
}

export async function seedClusterForUser(
  userId: string,
  opts?: { id?: string; state?: string },
): Promise<string> {
  const id = opts?.id ?? `c_${userId.slice(0, 4)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.execute({
    sql: `INSERT INTO clusters (id, user_id, formed_at, source_count, state)
          VALUES (?, ?, ?, 1, ?)`,
    args: [id, userId, Date.now(), opts?.state ?? "forming"],
  });
  return id;
}

export async function seedDraftForUser(
  userId: string,
  opts: { clusterId: string; outletId: string; id?: string },
): Promise<string> {
  const id = opts.id ?? `d_${userId.slice(0, 4)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.execute({
    sql: `INSERT INTO drafts (
            id, cluster_id, user_id, outlet_id, capability_version_pin, mode,
            headline, body, voice_match_score, trace_id, created_at, state
          ) VALUES (?, ?, ?, ?, ?, 'drafter', ?, ?, 0.8, ?, ?, 'pre-rendered')`,
    args: [
      id,
      opts.clusterId,
      userId,
      opts.outletId,
      "v1",
      "Test headline",
      "Test body",
      `trace-${id}`,
      Date.now(),
    ],
  });
  return id;
}

export async function seedFolderForUser(
  userId: string,
  opts?: { id?: string; name?: string },
): Promise<string> {
  const id = opts?.id ?? `f_${userId.slice(0, 4)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.execute({
    sql: `INSERT INTO source_folders (id, user_id, name, sort_order, created_at)
          VALUES (?, ?, ?, 0, ?)`,
    args: [id, userId, opts?.name ?? id, Date.now()],
  });
  return id;
}
