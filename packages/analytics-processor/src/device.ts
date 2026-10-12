export type DeviceBucket = "mobile" | "desktop" | "bot" | "other";

const botPattern =
  /bot|crawler|spider|crawl|slurp|mediapartners|facebookexternalhit|bingpreview|duckduckbot|baiduspider|yandex|semrush|ahrefs|headlesschrome|python-requests|curl|wget|monitor|pingdom|uptime/i;

const mobilePattern =
  /mobi|android|iphone|ipad|ipod|iemobile|blackberry|opera mini|windows phone|webos/i;

const desktopPattern = /windows nt|macintosh|mac os x|x11|cros|linux/i;

export function classifyDevice(userAgent: string): DeviceBucket {
  if (userAgent === "") return "other";
  if (botPattern.test(userAgent)) return "bot";
  if (mobilePattern.test(userAgent)) return "mobile";
  if (desktopPattern.test(userAgent)) return "desktop";
  return "other";
}
