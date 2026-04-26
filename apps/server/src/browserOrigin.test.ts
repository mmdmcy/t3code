import { describe, expect, it } from "vitest";

import {
  isAllowedBrowserOrigin,
  isAllowedBrowserRequestOrigin,
  parseConfiguredBrowserOrigins,
  resolveAllowedBrowserOrigins,
} from "./browserOrigin.ts";

const baseConfig = {
  devUrl: undefined,
  host: "127.0.0.1",
  port: 3773,
};

describe("browser origin policy", () => {
  it("allows non-browser requests without an Origin header", () => {
    expect(isAllowedBrowserOrigin(undefined, baseConfig, undefined)).toBe(true);
  });

  it("allows loopback app origins by default", () => {
    expect(isAllowedBrowserOrigin("http://127.0.0.1:3773", baseConfig, undefined)).toBe(true);
    expect(isAllowedBrowserOrigin("http://localhost:3773", baseConfig, undefined)).toBe(true);
    expect(isAllowedBrowserOrigin("http://[::1]:3773", baseConfig, undefined)).toBe(true);
  });

  it("allows the configured development server origin", () => {
    const origins = resolveAllowedBrowserOrigins(
      {
        ...baseConfig,
        devUrl: new URL("http://127.0.0.1:5173/some/path"),
      },
      undefined,
    );

    expect(origins).toContain("http://127.0.0.1:5173");
  });

  it("requires explicit opt-in for arbitrary browser origins", () => {
    expect(isAllowedBrowserOrigin("https://client.example.com", baseConfig, undefined)).toBe(false);
    expect(
      isAllowedBrowserOrigin(
        "https://client.example.com/path",
        baseConfig,
        "https://client.example.com",
      ),
    ).toBe(true);
  });

  it("allows browser origins that match the current request host", () => {
    expect(
      isAllowedBrowserRequestOrigin(
        "http://192.168.1.44:3773",
        "192.168.1.44:3773",
        {
          ...baseConfig,
          host: "0.0.0.0",
        },
        undefined,
      ),
    ).toBe(true);
    expect(
      isAllowedBrowserRequestOrigin(
        "https://client.example.com",
        "192.168.1.44:3773",
        baseConfig,
        undefined,
      ),
    ).toBe(false);
  });

  it("ignores invalid configured origins instead of broadening access", () => {
    expect(
      parseConfiguredBrowserOrigins("*, null, file:///tmp/app, https://ok.example.com"),
    ).toEqual(["https://ok.example.com"]);
  });
});
