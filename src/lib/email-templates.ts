import "server-only";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function verificationEmail(url: string): {
  subject: string;
  html: string;
  text: string;
} {
  const safeUrl = escapeHtml(url);
  const subject = "Verify your FlavorPress email";
  const text = `Confirm this email address by visiting:

${url}

This link expires in 24 hours.`;
  const html = `<!doctype html>
<html><body style="font-family: ui-serif, Georgia, serif; max-width: 480px; margin: 24px auto; color: #1a1a1a;">
<h1 style="font-size: 20px; font-weight: 500;">Confirm your FlavorPress email</h1>
<p>Click below to verify this email address.</p>
<p><a href="${safeUrl}" style="color: #1a1a1a;">${safeUrl}</a></p>
<p style="color: #666; font-size: 13px;">This link expires in 24 hours.</p>
</body></html>`;
  return { subject, html, text };
}

export function passwordResetEmail(url: string): {
  subject: string;
  html: string;
  text: string;
} {
  const safeUrl = escapeHtml(url);
  const subject = "Reset your FlavorPress password";
  const text = `Reset your password by visiting:

${url}

If you did not ask for this, you can ignore this email; your password stays unchanged. This link expires in 1 hour.`;
  const html = `<!doctype html>
<html><body style="font-family: ui-serif, Georgia, serif; max-width: 480px; margin: 24px auto; color: #1a1a1a;">
<h1 style="font-size: 20px; font-weight: 500;">Reset your FlavorPress password</h1>
<p>Click below to choose a new password.</p>
<p><a href="${safeUrl}" style="color: #1a1a1a;">${safeUrl}</a></p>
<p style="color: #666; font-size: 13px;">If you did not ask for this, ignore this email; your password stays unchanged. This link expires in 1 hour.</p>
</body></html>`;
  return { subject, html, text };
}
