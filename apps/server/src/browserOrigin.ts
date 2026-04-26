import type { ServerConfigShape } from "./config.ts";
import { formatHostForUrl, isWildcardHost } from "./startupAccess.ts";

const LOOPBACK_BROWSER_HOSTS = ["127.0.0.1", "localhost", "[::1]"] as const;

type BrowserOriginConfig = Pick<ServerConfigShape, "devUrl" | "host" | "port">;

function normalizeOrigin(rawOrigin: string): string | null {
  const trimmed = rawOrigin.trim();
  if (!trimmed || trimmed === "null") {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function addOrigin(origins: Set<string>, rawOrigin: string): void {
  const normalized = normalizeOrigin(rawOrigin);
  if (normalized) {
    origins.add(normalized);
  }
}

function addHttpOrigin(origins: Set<string>, host: string, port: number): void {
  addOrigin(origins, `http://${host}:${port}`);
}

function normalizeRequestHostOrigin(rawHost: string | undefined): string | null {
  if (!rawHost) {
    return null;
  }
  const trimmed = rawHost.trim();
  if (!trimmed || /[/?#@\\]/.test(trimmed)) {
    return null;
  }
  return normalizeOrigin(`http://${trimmed}`);
}

export function parseConfiguredBrowserOrigins(
  rawOrigins: string | undefined,
): ReadonlyArray<string> {
  if (!rawOrigins) {
    return [];
  }

  const origins = new Set<string>();
  for (const rawOrigin of rawOrigins.split(",")) {
    addOrigin(origins, rawOrigin);
  }
  return [...origins];
}

export function resolveAllowedBrowserOrigins(
  config: BrowserOriginConfig,
  rawConfiguredOrigins = process.env.T3CODE_ALLOWED_BROWSER_ORIGINS,
): ReadonlyArray<string> {
  const origins = new Set<string>();

  for (const host of LOOPBACK_BROWSER_HOSTS) {
    addHttpOrigin(origins, host, config.port);
  }

  if (config.devUrl) {
    addOrigin(origins, config.devUrl.origin);
  }

  if (config.host && !isWildcardHost(config.host)) {
    addHttpOrigin(origins, formatHostForUrl(config.host), config.port);
  }

  for (const origin of parseConfiguredBrowserOrigins(rawConfiguredOrigins)) {
    origins.add(origin);
  }

  return [...origins];
}

export function isAllowedBrowserOrigin(
  origin: string | undefined,
  config: BrowserOriginConfig,
  rawConfiguredOrigins = process.env.T3CODE_ALLOWED_BROWSER_ORIGINS,
): boolean {
  if (origin === undefined) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  return resolveAllowedBrowserOrigins(config, rawConfiguredOrigins).includes(normalized);
}

export function isAllowedBrowserRequestOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  config: BrowserOriginConfig,
  rawConfiguredOrigins = process.env.T3CODE_ALLOWED_BROWSER_ORIGINS,
): boolean {
  if (isAllowedBrowserOrigin(origin, config, rawConfiguredOrigins)) {
    return true;
  }

  const normalizedOrigin = origin === undefined ? null : normalizeOrigin(origin);
  const normalizedRequestHostOrigin = normalizeRequestHostOrigin(requestHost);
  return normalizedOrigin !== null && normalizedOrigin === normalizedRequestHostOrigin;
}
