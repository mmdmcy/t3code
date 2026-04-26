const PROVIDER_PRIVACY_ENV = {
  DISABLE_TELEMETRY: "1",
  DO_NOT_TRACK: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  OTEL_SDK_DISABLED: "true",
  T3CODE_TELEMETRY_ENABLED: "0",
} as const;

function definedEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export function providerProcessEnv(
  overrides: Readonly<Record<string, string | undefined>> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (baseEnv.T3CODE_ALLOW_PROVIDER_TELEMETRY === "1") {
    return definedEnv({
      ...baseEnv,
      ...overrides,
    });
  }

  return definedEnv({
    ...baseEnv,
    ...PROVIDER_PRIVACY_ENV,
    ...overrides,
  });
}
