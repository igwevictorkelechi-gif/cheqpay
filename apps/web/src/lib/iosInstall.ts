/**
 * Which "Add to Home Screen" guide an iPhone or iPad visitor needs.
 *
 * iOS has no install prompt a web page can trigger (Android's
 * `beforeinstallprompt` does not exist there), so the only route is the
 * browser's Share menu — and where that menu lives depends on the device, the
 * browser and, since Safari 26, the Safari version. This works that out from
 * the user agent so the guide can point at the right spot.
 */

export type IosBrowser = "safari" | "chrome" | "firefox" | "edge" | "inapp";

/** Where on screen the first thing to tap sits. */
export type ArrowSpot = "bottom-center" | "bottom-right" | "top-right";

export interface IosInstallInfo {
  device: "iphone" | "ipad";
  browser: IosBrowser;
  /** Safari's major version (from `Version/NN`), when the browser is Safari. */
  safariVersion: number | null;
  arrow: ArrowSpot;
  /** The guide's steps, first to last. Icons are drawn by the component. */
  steps: { icon: "share" | "more" | "add" | "check" | "safari"; text: string; bold: string }[];
}

export interface DetectInput {
  userAgent: string;
  /** navigator.maxTouchPoints: tells iPadOS (which reports as a Mac) from a Mac. */
  maxTouchPoints?: number;
}

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Twitter|TikTok|musical_ly|Snapchat|LinkedInApp|GSA\//i;

/**
 * The guide for this visitor, or null when they aren't on an iPhone/iPad.
 * (Whether the app is already installed is checked separately, at runtime.)
 */
export function detectIosInstall({ userAgent: ua, maxTouchPoints = 0 }: DetectInput): IosInstallInfo | null {
  const iphone = /iPhone|iPod/.test(ua);
  // iPadOS 13+ asks for desktop sites by default and reports itself as a Mac;
  // the touch screen gives it away.
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (!iphone && !ipad) return null;
  const device = ipad ? "ipad" : "iphone";

  let browser: IosBrowser = "safari";
  if (IN_APP.test(ua)) browser = "inapp";
  else if (/CriOS/.test(ua)) browser = "chrome";
  else if (/FxiOS/.test(ua)) browser = "firefox";
  else if (/EdgiOS/.test(ua)) browser = "edge";
  // A WebView with no "Safari/" token is some other app's browser.
  else if (!/Safari\//.test(ua)) browser = "inapp";

  const v = /Version\/(\d+)/.exec(ua);
  const safariVersion = browser === "safari" && v ? Number(v[1]) : null;

  const add = { icon: "add" as const, text: "Scroll down and tap", bold: "Add to Home Screen" };
  const confirm = { icon: "check" as const, text: "Then tap", bold: "Add" };

  if (browser === "inapp") {
    return {
      device,
      browser,
      safariVersion,
      arrow: "top-right",
      steps: [
        { icon: "more", text: "Tap the menu", bold: "•••" },
        { icon: "safari", text: "Choose", bold: "Open in Safari" },
        { icon: "share", text: "In Safari, tap Share, then", bold: "Add to Home Screen" },
      ],
    };
  }

  if (browser !== "safari") {
    // Chrome, Edge and Firefox on iOS keep Share in the address bar.
    return { device, browser, safariVersion, arrow: "top-right", steps: [{ icon: "share", text: "Tap", bold: "Share" }, add, confirm] };
  }

  if (device === "ipad") {
    return { device, browser, safariVersion, arrow: "top-right", steps: [{ icon: "share", text: "Tap", bold: "Share" }, add, confirm] };
  }

  // Safari 26 on iPhone folded Share into the "•••" button at the bottom right.
  if (safariVersion !== null && safariVersion >= 26) {
    return {
      device,
      browser,
      safariVersion,
      arrow: "bottom-right",
      steps: [{ icon: "more", text: "Tap", bold: "•••" }, { icon: "share", text: "Tap", bold: "Share" }, add, confirm],
    };
  }

  return { device, browser, safariVersion, arrow: "bottom-center", steps: [{ icon: "share", text: "Tap", bold: "Share" }, add, confirm] };
}

/** Already running from the home screen: nothing to install. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

/** Where the "seen it" answer is kept: "done", or "later:<ms>" to ask again later. */
export const GUIDE_KEY = "cheqpay-ios-guide";
export const LATER_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether to open the guide on its own, from the stored answer. */
export function guideDue(stored: string | null, now = Date.now()): boolean {
  if (!stored) return true;
  if (stored === "done") return false;
  const m = /^later:(\d+)$/.exec(stored);
  return m ? now - Number(m[1]) >= LATER_MS : true;
}

/** Pages where an overlay would get in the way of signing in. */
export function quietPath(pathname: string): boolean {
  return /^\/(login|signup|verify-otp|connect|screen)(\/|$)/.test(pathname);
}
