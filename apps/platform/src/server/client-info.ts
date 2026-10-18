// Rough phone / browser type from the User-Agent header, for the login record (B-03, docs/STABILITY_PLAN.md).
// Only the two short words are stored, never the header itself.

export type Device = "android" | "iphone" | "ipad" | "windows" | "mac" | "linux" | "other";
export type Browser = "chrome" | "samsung" | "safari" | "firefox" | "edge" | "opera" | "webview" | "other";

export function describeClient(userAgent: string | null | undefined): { device: Device; browser: Browser } {
  const ua = userAgent ?? "";
  const device: Device = /iPhone|iPod/.test(ua)
    ? "iphone"
    : /iPad/.test(ua)
      ? "ipad"
      : /Android/.test(ua)
        ? "android"
        : /Windows/.test(ua)
          ? "windows"
          : /Macintosh|Mac OS X/.test(ua)
            ? "mac"
            : /Linux|CrOS/.test(ua)
              ? "linux"
              : "other";
  const apple = device === "iphone" || device === "ipad";
  const browser: Browser = /; wv\)/.test(ua)
    ? "webview" // an Android app showing the page inside itself
    : /SamsungBrowser/.test(ua)
      ? "samsung"
      : /Edg(A|iOS)?\//.test(ua)
        ? "edge"
        : /Firefox\/|FxiOS/.test(ua)
          ? "firefox"
          : /OPR\/|Opera/.test(ua)
            ? "opera"
            : /CriOS|Chrome\//.test(ua)
              ? "chrome"
              : /Version\/.*Safari\//.test(ua)
                ? "safari"
                : apple && /AppleWebKit/.test(ua)
                  ? "webview" // e.g. the iPhone Home Screen app, which keeps its own cookies apart from Safari
                  : "other";
  return { device, browser };
}
