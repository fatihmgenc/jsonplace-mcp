export function getSiteUrl() {
  const configured = String(process.env.JSONPLACE_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV !== "production") {
    const port = Number.parseInt(process.env.PORT || "3000", 10);
    const resolvedPort = Number.isFinite(port) ? port : 3000;
    return `http://localhost:${resolvedPort}`;
  }

  return "https://jsonplace.com";
}
