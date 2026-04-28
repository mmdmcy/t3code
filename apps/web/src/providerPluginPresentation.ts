import type { ServerProviderPlugin } from "@t3tools/contracts";

function titleCaseWords(value: string): string {
  return value
    .split(/[\s:_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatProviderPluginDisplayName(
  plugin: Pick<ServerProviderPlugin, "name" | "interface">,
): string {
  const displayName = plugin.interface?.displayName?.trim();
  if (displayName) {
    return displayName;
  }
  return titleCaseWords(plugin.name);
}

export function formatProviderPluginDescription(
  plugin: Pick<ServerProviderPlugin, "interface">,
): string {
  return (
    plugin.interface?.shortDescription?.trim() ||
    plugin.interface?.longDescription?.trim() ||
    "Provider plugin"
  );
}

export function formatProviderPluginSource(plugin: Pick<ServerProviderPlugin, "source">): string {
  if (plugin.source.type === "local") return "Local";
  if (plugin.source.type === "git") return "Git";
  return "Remote";
}

export type ProviderPluginLifecycle =
  | "available"
  | "installed"
  | "installed-by-default"
  | "unavailable";

export function getProviderPluginLifecycle(plugin: ServerProviderPlugin): ProviderPluginLifecycle {
  if (plugin.installed && plugin.installPolicy === "INSTALLED_BY_DEFAULT") {
    return "installed-by-default";
  }
  if (plugin.installed) {
    return "installed";
  }
  if (plugin.installPolicy === "AVAILABLE") {
    return "available";
  }
  return "unavailable";
}

export function formatProviderPluginStatusLabel(plugin: ServerProviderPlugin): string {
  const lifecycle = getProviderPluginLifecycle(plugin);
  if (lifecycle === "installed-by-default") return "Built in";
  if (lifecycle === "installed") return "Installed";
  if (lifecycle === "available") return "Available";
  return "Unavailable";
}

export function formatProviderPluginActionHint(plugin: ServerProviderPlugin): string {
  const lifecycle = getProviderPluginLifecycle(plugin);
  if (lifecycle === "installed-by-default") {
    return "Installed by the provider and cannot be removed.";
  }
  if (lifecycle === "installed") {
    return providerPluginCanUninstall(plugin)
      ? "Installed. You can uninstall it from this device."
      : "Installed, but this provider does not allow removal.";
  }
  if (lifecycle === "available") {
    return "Available to install from the marketplace.";
  }
  return "This plugin is not installable from here.";
}

export function providerPluginCanInstall(plugin: ServerProviderPlugin): boolean {
  return !plugin.installed && plugin.installPolicy === "AVAILABLE";
}

export function providerPluginCanUninstall(plugin: ServerProviderPlugin): boolean {
  return plugin.installed && plugin.installPolicy !== "INSTALLED_BY_DEFAULT";
}
