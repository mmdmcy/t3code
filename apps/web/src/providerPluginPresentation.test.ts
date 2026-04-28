import type { ServerProviderPlugin } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  formatProviderPluginActionHint,
  formatProviderPluginStatusLabel,
  getProviderPluginLifecycle,
  providerPluginCanInstall,
  providerPluginCanUninstall,
} from "./providerPluginPresentation";

function plugin(overrides: Partial<ServerProviderPlugin>): ServerProviderPlugin {
  return {
    id: "plugin-id",
    name: "example-plugin",
    enabled: true,
    installed: false,
    authPolicy: "ON_USE",
    installPolicy: "AVAILABLE",
    marketplaceName: "openai-curated",
    featured: false,
    source: { type: "remote" },
    ...overrides,
  };
}

describe("providerPluginPresentation", () => {
  it("marks available marketplace plugins as installable", () => {
    const value = plugin({ enabled: false });

    expect(getProviderPluginLifecycle(value)).toBe("available");
    expect(formatProviderPluginStatusLabel(value)).toBe("Available");
    expect(formatProviderPluginActionHint(value)).toBe(
      "Available to install from the marketplace.",
    );
    expect(providerPluginCanInstall(value)).toBe(true);
    expect(providerPluginCanUninstall(value)).toBe(false);
  });

  it("marks installed plugins as removable when policy allows it", () => {
    const value = plugin({ installed: true });

    expect(getProviderPluginLifecycle(value)).toBe("installed");
    expect(formatProviderPluginStatusLabel(value)).toBe("Installed");
    expect(formatProviderPluginActionHint(value)).toBe(
      "Installed. You can uninstall it from this device.",
    );
    expect(providerPluginCanInstall(value)).toBe(false);
    expect(providerPluginCanUninstall(value)).toBe(true);
  });

  it("marks default provider plugins as built in", () => {
    const value = plugin({ installed: true, installPolicy: "INSTALLED_BY_DEFAULT" });

    expect(getProviderPluginLifecycle(value)).toBe("installed-by-default");
    expect(formatProviderPluginStatusLabel(value)).toBe("Built in");
    expect(formatProviderPluginActionHint(value)).toBe(
      "Installed by the provider and cannot be removed.",
    );
    expect(providerPluginCanInstall(value)).toBe(false);
    expect(providerPluginCanUninstall(value)).toBe(false);
  });
});
