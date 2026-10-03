/**
 * "Where to go after login": only paths on this same site ("/home", "/sso/start?module=..."), never another
 * website ("//evil.com", "https://...", "/\evil.com", "javascript:..."). Returns null if not safe.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || value.length > 500) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\s]/.test(value)) return null; // browsers treat "\" like "/"; no whitespace/newlines
  return value;
}
