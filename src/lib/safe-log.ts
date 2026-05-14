/**
 * Escape and truncate a user-controlled value for safe inclusion in a
 * log line. JSON.stringify converts CR/LF, quotes, and other control
 * characters into escape sequences so an attacker cannot splice fake
 * log entries into Vercel's log stream by submitting a URL or ID that
 * contains `\r\n`. Length is capped so one bad paste does not consume
 * the log budget.
 */
export function safeLogValue(v: unknown, max = 256): string {
  let s: string;
  try {
    if (v instanceof Error) {
      s = JSON.stringify(v.message);
    } else if (typeof v === "string") {
      s = JSON.stringify(v);
    } else {
      s = JSON.stringify(v) ?? String(v);
    }
  } catch {
    s = JSON.stringify(String(v));
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
