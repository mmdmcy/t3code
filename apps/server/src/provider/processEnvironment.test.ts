import { describe, expect, it } from "vitest";

import { providerProcessEnv } from "./processEnvironment.ts";

describe("providerProcessEnv", () => {
  it("disables common telemetry channels for provider child processes", () => {
    expect(providerProcessEnv({}, { PATH: "/bin" })).toMatchObject({
      PATH: "/bin",
      DISABLE_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      OTEL_SDK_DISABLED: "true",
      T3CODE_TELEMETRY_ENABLED: "0",
    });
  });

  it("allows explicit opt-in for provider telemetry", () => {
    expect(
      providerProcessEnv(
        { OTEL_SDK_DISABLED: "false" },
        { T3CODE_ALLOW_PROVIDER_TELEMETRY: "1", PATH: "/bin" },
      ),
    ).toEqual({
      T3CODE_ALLOW_PROVIDER_TELEMETRY: "1",
      PATH: "/bin",
      OTEL_SDK_DISABLED: "false",
    });
  });
});
