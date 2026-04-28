import type {
  ProviderKind,
  ServerProvider,
  ServerProviderPlugin,
  ServerProviderPluginDetail,
  ServerProviderSkill,
} from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  InfoIcon,
  PackageMinusIcon,
  PackagePlusIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { getPrimaryEnvironmentConnection } from "~/environments/runtime";
import { readLocalApi } from "~/localApi";
import {
  formatProviderPluginActionHint,
  formatProviderPluginDescription,
  formatProviderPluginDisplayName,
  formatProviderPluginSource,
  formatProviderPluginStatusLabel,
  getProviderPluginLifecycle,
  providerPluginCanInstall,
  providerPluginCanUninstall,
} from "~/providerPluginPresentation";
import { searchProviderPlugins } from "~/providerPluginSearch";
import {
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
} from "~/providerSkillPresentation";
import { searchProviderSkills } from "~/providerSkillSearch";
import { useServerProviders } from "~/rpc/serverState";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import { type SidebarCapabilityPanelView, useUiStateStore } from "~/uiStateStore";
import { cn } from "~/lib/utils";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";

type SkillFilter = "enabled" | "all";
type PluginFilter = "installed" | "available" | "featured" | "all";
type PendingPluginAction = {
  readonly id: string;
  readonly action: "install" | "uninstall" | "read";
};

const CAPABILITY_VIEWS = [
  {
    id: "skills",
    label: "/skills",
    icon: WandSparklesIcon,
  },
  {
    id: "plugins",
    label: "/plugins",
    icon: PuzzleIcon,
  },
] as const satisfies ReadonlyArray<{
  readonly id: SidebarCapabilityPanelView;
  readonly label: string;
  readonly icon: typeof WandSparklesIcon;
}>;

function providerLabel(provider: ServerProvider): string {
  return provider.displayName ?? provider.provider;
}

function buildPluginRpcInput(provider: ProviderKind, plugin: ServerProviderPlugin) {
  return {
    provider,
    pluginName: plugin.name,
    ...(plugin.marketplacePath
      ? { marketplacePath: plugin.marketplacePath }
      : { remoteMarketplaceName: plugin.marketplaceName }),
  };
}

function appendTokenToPrompt(prompt: string, token: string): string {
  if (!prompt.trim()) return token;
  return /\s$/.test(prompt) ? `${prompt}${token}` : `${prompt} ${token}`;
}

function showToast(input: {
  type: "success" | "warning" | "error";
  title: string;
  description?: string;
}) {
  toastManager.add(
    stackedThreadToast({
      type: input.type,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
    }),
  );
}

function isPluginVisibleForFilter(plugin: ServerProviderPlugin, filter: PluginFilter): boolean {
  if (filter === "installed") return plugin.installed;
  if (filter === "available") return providerPluginCanInstall(plugin);
  if (filter === "featured") return plugin.featured;
  return true;
}

function pluginStatusClassName(plugin: ServerProviderPlugin): string {
  const lifecycle = getProviderPluginLifecycle(plugin);
  if (lifecycle === "available") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (lifecycle === "installed" || lifecycle === "installed-by-default") {
    return "border-success/20 bg-success/10 text-success";
  }
  return "border-border/60 bg-muted text-muted-foreground";
}

function pluginEmptyMessage(filter: PluginFilter): string {
  if (filter === "installed") return "No installed plugins. Switch to Available to install one.";
  if (filter === "available") return "No installable plugins match this view.";
  if (filter === "featured") return "No featured plugins match this view.";
  return "No plugins match this view.";
}

function ProviderSelect(props: {
  providers: ReadonlyArray<ServerProvider>;
  selectedProvider: ServerProvider | null;
  onProviderChange: (provider: ProviderKind) => void;
}) {
  if (props.providers.length <= 1 || !props.selectedProvider) {
    return null;
  }

  return (
    <Select
      value={props.selectedProvider.provider}
      onValueChange={(value) => {
        if (value) props.onProviderChange(value as ProviderKind);
      }}
    >
      <SelectTrigger
        size="xs"
        className="h-7 min-w-0 flex-1 bg-background/55 text-xs"
        aria-label="Provider"
      >
        <SelectValue>{providerLabel(props.selectedProvider)}</SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false}>
        {props.providers.map((provider) => (
          <SelectItem key={provider.provider} hideIndicator value={provider.provider}>
            {providerLabel(provider)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

function CapabilityToggle(props: {
  view: SidebarCapabilityPanelView;
  label: string;
  active: boolean;
  count: number;
  icon: typeof WandSparklesIcon;
  onSelect: (view: SidebarCapabilityPanelView) => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
        props.active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
      )}
      onClick={() => props.onSelect(props.view)}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{props.label}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground/80">{props.count}</span>
    </button>
  );
}

function FilterButton<T extends string>(props: {
  value: T;
  activeValue: T;
  label: string;
  count?: number;
  onChange: (value: T) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
        props.value === props.activeValue
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
      )}
      aria-pressed={props.value === props.activeValue}
      onClick={() => props.onChange(props.value)}
    >
      <span>{props.label}</span>
      {typeof props.count === "number" ? (
        <span className="text-[10px] text-muted-foreground/75">{props.count}</span>
      ) : null}
    </button>
  );
}

function SkillRow(props: {
  skill: ServerProviderSkill;
  canInsert: boolean;
  onInsert: (skill: ServerProviderSkill) => void;
  onCopy: (skill: ServerProviderSkill) => void;
}) {
  const sourceLabel = formatProviderSkillInstallSource(props.skill);
  const description =
    props.skill.shortDescription ??
    props.skill.description ??
    (props.skill.scope ? `${props.skill.scope} skill` : "Provider skill");

  return (
    <div className="group rounded-lg border border-border/60 bg-background/35 px-2 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <WandSparklesIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">
              {formatProviderSkillDisplayName(props.skill)}
            </span>
            {!props.skill.enabled ? (
              <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                Disabled
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">
            {description}
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground/65">
            <span className="truncate">${props.skill.name}</span>
            {sourceLabel ? <span className="shrink-0">{sourceLabel}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Copy skill token"
                  onClick={() => props.onCopy(props.skill)}
                />
              }
            >
              <CopyIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="right">Copy token</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label="Insert skill"
                  disabled={!props.canInsert || !props.skill.enabled}
                  onClick={() => props.onInsert(props.skill)}
                />
              }
            >
              <CheckIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="right">
              {props.canInsert ? "Insert in composer" : "Open a thread to insert"}
            </TooltipPopup>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}

function PluginRow(props: {
  plugin: ServerProviderPlugin;
  pendingAction: PendingPluginAction | null;
  onRead: (plugin: ServerProviderPlugin) => void;
  onInstall: (plugin: ServerProviderPlugin) => void;
  onUninstall: (plugin: ServerProviderPlugin) => void;
}) {
  const displayName = formatProviderPluginDisplayName(props.plugin);
  const description = formatProviderPluginDescription(props.plugin);
  const canInstall = providerPluginCanInstall(props.plugin);
  const canUninstall = providerPluginCanUninstall(props.plugin);
  const pending = props.pendingAction?.id === props.plugin.id ? props.pendingAction.action : null;
  const statusLabel = formatProviderPluginStatusLabel(props.plugin);
  const actionHint = formatProviderPluginActionHint(props.plugin);
  const lifecycle = getProviderPluginLifecycle(props.plugin);
  const uninstallBlockedLabel = lifecycle === "installed-by-default" ? "Built in" : "Locked";

  return (
    <div className="rounded-lg border border-border/60 bg-background/35 px-2 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <PuzzleIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{displayName}</span>
            <span
              className={cn(
                "shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]",
                pluginStatusClassName(props.plugin),
              )}
            >
              {statusLabel}
            </span>
            {props.plugin.featured ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                <SparklesIcon className="size-3" />
                Featured
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground/80">
            {description}
          </p>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground/65">
            <span className="truncate">{props.plugin.name}</span>
            <span className="shrink-0">{formatProviderPluginSource(props.plugin)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2 grid gap-1.5">
        <p className="text-[10px] leading-4 text-muted-foreground/70">{actionHint}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            aria-label={`View details for ${displayName}`}
            disabled={pending === "read"}
            onClick={() => props.onRead(props.plugin)}
          >
            {pending === "read" ? (
              <RefreshCwIcon className="size-3.5 animate-spin" />
            ) : (
              <InfoIcon className="size-3.5" />
            )}
            Details
          </Button>
          {props.plugin.installed ? (
            <Button
              size="xs"
              variant={canUninstall ? "outline" : "secondary"}
              aria-label={canUninstall ? `Uninstall ${displayName}` : `${displayName} is built in`}
              disabled={!canUninstall || pending === "uninstall"}
              onClick={() => props.onUninstall(props.plugin)}
            >
              {pending === "uninstall" ? (
                <RefreshCwIcon className="size-3.5 animate-spin" />
              ) : canUninstall ? (
                <PackageMinusIcon className="size-3.5" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
              {pending === "uninstall"
                ? "Uninstalling"
                : canUninstall
                  ? "Uninstall"
                  : uninstallBlockedLabel}
            </Button>
          ) : (
            <Button
              size="xs"
              variant={canInstall ? "default" : "secondary"}
              aria-label={
                canInstall ? `Install ${displayName}` : `${displayName} is not installable`
              }
              disabled={!canInstall || pending === "install"}
              onClick={() => props.onInstall(props.plugin)}
            >
              {pending === "install" ? (
                <RefreshCwIcon className="size-3.5 animate-spin" />
              ) : (
                <PackagePlusIcon className="size-3.5" />
              )}
              {pending === "install" ? "Installing" : canInstall ? "Install" : "Unavailable"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PluginDetailDialog(props: {
  detail: ServerProviderPluginDetail | null;
  pendingAction: PendingPluginAction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenExternal: (url: string) => void;
  onInstall: (plugin: ServerProviderPlugin) => void;
  onUninstall: (plugin: ServerProviderPlugin) => void;
}) {
  const detail = props.detail;
  const summary = detail?.summary ?? null;
  const websiteUrl = detail?.summary.interface?.websiteUrl;
  const privacyPolicyUrl = detail?.summary.interface?.privacyPolicyUrl;
  const termsOfServiceUrl = detail?.summary.interface?.termsOfServiceUrl;
  const canInstall = summary ? providerPluginCanInstall(summary) : false;
  const canUninstall = summary ? providerPluginCanUninstall(summary) : false;
  const pending =
    summary && props.pendingAction?.id === summary.id ? props.pendingAction.action : null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {detail ? formatProviderPluginDisplayName(detail.summary) : "Plugin"}
          </DialogTitle>
          <DialogDescription>
            {detail ? formatProviderPluginDescription(detail.summary) : "Plugin details"}
          </DialogDescription>
        </DialogHeader>
        {detail ? (
          <DialogPanel className="grid gap-4">
            {detail.description ? (
              <p className="text-sm leading-6 text-foreground/85">{detail.description}</p>
            ) : null}
            <div className="grid gap-2 text-sm">
              <DetailRow label="Status" value={formatProviderPluginStatusLabel(detail.summary)} />
              <DetailRow label="Marketplace" value={detail.marketplaceName} />
              <DetailRow label="Plugin id" value={detail.summary.id} />
              <DetailRow label="Source" value={formatProviderPluginSource(detail.summary)} />
              <DetailRow
                label="Auth"
                value={detail.summary.authPolicy === "ON_INSTALL" ? "On install" : "On use"}
              />
            </div>
            {detail.apps.length > 0 ? (
              <DetailSection title="Apps">
                {detail.apps.map((app) => (
                  <div key={app.id} className="rounded-lg border border-border/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{app.name}</span>
                      {app.needsAuth ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Needs auth</span>
                      ) : null}
                    </div>
                    {app.description ? (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {app.description}
                      </p>
                    ) : null}
                  </div>
                ))}
              </DetailSection>
            ) : null}
            {detail.skills.length > 0 ? (
              <DetailSection title="Skills">
                <div className="flex flex-wrap gap-1.5">
                  {detail.skills.map((skill) => (
                    <span
                      key={`${skill.path}:${skill.name}`}
                      className="rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground"
                    >
                      ${skill.name}
                    </span>
                  ))}
                </div>
              </DetailSection>
            ) : null}
            {detail.mcpServers.length > 0 ? (
              <DetailSection title="MCP Servers">
                <div className="flex flex-wrap gap-1.5">
                  {detail.mcpServers.map((server) => (
                    <span
                      key={server}
                      className="rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground"
                    >
                      {server}
                    </span>
                  ))}
                </div>
              </DetailSection>
            ) : null}
          </DialogPanel>
        ) : null}
        <DialogFooter>
          {summary?.installed ? (
            <Button
              variant={canUninstall ? "outline" : "secondary"}
              disabled={!canUninstall || pending === "uninstall"}
              onClick={() => props.onUninstall(summary)}
            >
              {pending === "uninstall" ? (
                <RefreshCwIcon className="size-4 animate-spin" />
              ) : canUninstall ? (
                <PackageMinusIcon className="size-4" />
              ) : (
                <CheckIcon className="size-4" />
              )}
              {pending === "uninstall" ? "Uninstalling" : canUninstall ? "Uninstall" : "Built in"}
            </Button>
          ) : summary ? (
            <Button
              disabled={!canInstall || pending === "install"}
              onClick={() => props.onInstall(summary)}
            >
              {pending === "install" ? (
                <RefreshCwIcon className="size-4 animate-spin" />
              ) : (
                <PackagePlusIcon className="size-4" />
              )}
              {pending === "install" ? "Installing" : canInstall ? "Install" : "Unavailable"}
            </Button>
          ) : null}
          {websiteUrl ? (
            <Button variant="outline" onClick={() => props.onOpenExternal(websiteUrl)}>
              <ExternalLinkIcon className="size-4" />
              Website
            </Button>
          ) : null}
          {privacyPolicyUrl ? (
            <Button variant="ghost" onClick={() => props.onOpenExternal(privacyPolicyUrl)}>
              Privacy
            </Button>
          ) : null}
          {termsOfServiceUrl ? (
            <Button variant="ghost" onClick={() => props.onOpenExternal(termsOfServiceUrl)}>
              Terms
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DetailSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {props.title}
      </h3>
      {props.children}
    </section>
  );
}

function DetailRow(props: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="min-w-0 truncate font-mono text-xs">{props.value}</span>
    </div>
  );
}

export function SidebarCapabilitiesPanel() {
  const providers = useServerProviders();
  const panelView = useUiStateStore((store) => store.sidebarCapabilityPanelView);
  const setPanelView = useUiStateStore((store) => store.setSidebarCapabilityPanelView);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const setComposerPrompt = useComposerDraftStore((store) => store.setPrompt);
  const [selectedProviderKind, setSelectedProviderKind] = useState<ProviderKind | null>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const [pluginQuery, setPluginQuery] = useState("");
  const [skillFilter, setSkillFilter] = useState<SkillFilter>("enabled");
  const [pluginFilter, setPluginFilter] = useState<PluginFilter>("all");
  const [pendingPluginAction, setPendingPluginAction] = useState<PendingPluginAction | null>(null);
  const [pluginDetail, setPluginDetail] = useState<ServerProviderPluginDetail | null>(null);
  const [pluginDetailOpen, setPluginDetailOpen] = useState(false);
  const { copyToClipboard } = useCopyToClipboard<ServerProviderSkill>({
    onCopy: (skill) =>
      showToast({ type: "success", title: "Skill token copied", description: `$${skill.name}` }),
    onError: () => showToast({ type: "error", title: "Clipboard unavailable" }),
  });

  const availableProviders = useMemo(
    () =>
      providers.filter(
        (provider) =>
          (provider.skills?.length ?? 0) > 0 ||
          (provider.plugins?.length ?? 0) > 0 ||
          provider.provider === "codex",
      ),
    [providers],
  );
  const selectedProvider = useMemo(() => {
    return (
      availableProviders.find((provider) => provider.provider === selectedProviderKind) ??
      availableProviders[0] ??
      null
    );
  }, [availableProviders, selectedProviderKind]);
  const routeComposerTarget =
    routeTarget?.kind === "server" ? routeTarget.threadRef : (routeTarget?.draftId ?? null);
  const skillCount = selectedProvider?.skills?.filter((skill) => skill.enabled).length ?? 0;
  const pluginCount = selectedProvider?.plugins?.length ?? 0;
  const pluginInstalledCount =
    selectedProvider?.plugins?.filter((plugin) => plugin.installed).length ?? 0;
  const pluginAvailableCount =
    selectedProvider?.plugins?.filter((plugin) => providerPluginCanInstall(plugin)).length ?? 0;
  const pluginFeaturedCount =
    selectedProvider?.plugins?.filter((plugin) => plugin.featured).length ?? 0;

  useEffect(() => {
    if (!selectedProvider && availableProviders[0]) {
      setSelectedProviderKind(availableProviders[0].provider);
      return;
    }
    if (selectedProvider && selectedProvider.provider !== selectedProviderKind) {
      setSelectedProviderKind(selectedProvider.provider);
    }
  }, [availableProviders, selectedProvider, selectedProviderKind]);

  const visibleSkills = useMemo(() => {
    const skills = selectedProvider?.skills ?? [];
    const filtered = skillFilter === "enabled" ? skills.filter((skill) => skill.enabled) : skills;
    return searchProviderSkills(filtered, skillQuery, 24, {
      includeDisabled: skillFilter === "all",
    });
  }, [selectedProvider?.skills, skillFilter, skillQuery]);

  const visiblePlugins = useMemo(() => {
    const plugins = (selectedProvider?.plugins ?? []).filter((plugin) =>
      isPluginVisibleForFilter(plugin, pluginFilter),
    );
    return searchProviderPlugins(plugins, pluginQuery, 24);
  }, [selectedProvider?.plugins, pluginFilter, pluginQuery]);

  const handleInsertSkill = useCallback(
    (skill: ServerProviderSkill) => {
      if (!routeComposerTarget) {
        copyToClipboard(`$${skill.name} `, skill);
        return;
      }
      const currentPrompt = getComposerDraft(routeComposerTarget)?.prompt ?? "";
      setComposerPrompt(routeComposerTarget, appendTokenToPrompt(currentPrompt, `$${skill.name} `));
      showToast({ type: "success", title: "Skill inserted", description: `$${skill.name}` });
    },
    [copyToClipboard, getComposerDraft, routeComposerTarget, setComposerPrompt],
  );

  const handleReadPlugin = useCallback(
    async (plugin: ServerProviderPlugin) => {
      if (!selectedProvider) return;
      setPendingPluginAction({ id: plugin.id, action: "read" });
      try {
        const detail = await getPrimaryEnvironmentConnection().client.server.readProviderPlugin(
          buildPluginRpcInput(selectedProvider.provider, plugin),
        );
        setPluginDetail(detail);
        setPluginDetailOpen(true);
      } catch (error) {
        showToast({
          type: "error",
          title: "Failed to read plugin",
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setPendingPluginAction(null);
      }
    },
    [selectedProvider],
  );

  const handleInstallPlugin = useCallback(
    async (plugin: ServerProviderPlugin) => {
      if (!selectedProvider) return;
      setPendingPluginAction({ id: plugin.id, action: "install" });
      try {
        const result = await getPrimaryEnvironmentConnection().client.server.installProviderPlugin(
          buildPluginRpcInput(selectedProvider.provider, plugin),
        );
        showToast({
          type: "success",
          title: "Plugin installed",
          description:
            result.appsNeedingAuth.length > 0
              ? `${result.appsNeedingAuth.length} app${result.appsNeedingAuth.length === 1 ? "" : "s"} need authorization.`
              : formatProviderPluginDisplayName(plugin),
        });
        setPluginFilter("all");
        setPluginDetailOpen(false);
        setPluginDetail(null);
      } catch (error) {
        showToast({
          type: "error",
          title: "Failed to install plugin",
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setPendingPluginAction(null);
      }
    },
    [selectedProvider],
  );

  const handleUninstallPlugin = useCallback(
    async (plugin: ServerProviderPlugin) => {
      if (!selectedProvider) return;
      setPendingPluginAction({ id: plugin.id, action: "uninstall" });
      try {
        await getPrimaryEnvironmentConnection().client.server.uninstallProviderPlugin({
          provider: selectedProvider.provider,
          pluginId: plugin.id,
        });
        showToast({
          type: "success",
          title: "Plugin uninstalled",
          description: formatProviderPluginDisplayName(plugin),
        });
        setPluginFilter("all");
        setPluginDetailOpen(false);
        setPluginDetail(null);
      } catch (error) {
        showToast({
          type: "error",
          title: "Failed to uninstall plugin",
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setPendingPluginAction(null);
      }
    },
    [selectedProvider],
  );

  const handleRefreshProviders = useCallback(async () => {
    try {
      await getPrimaryEnvironmentConnection().client.server.refreshProviders();
    } catch (error) {
      showToast({
        type: "error",
        title: "Failed to refresh providers",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const handleOpenExternal = useCallback((url: string) => {
    void readLocalApi()?.shell.openExternal(url);
  }, []);

  return (
    <div className="px-3 pt-1 pb-2">
      <div className="mb-2 flex items-center justify-between pl-1.5 pr-0.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Extensions
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Refresh provider capabilities"
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border border-border/70 bg-background/55 text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                onClick={handleRefreshProviders}
              />
            }
          >
            <RefreshCwIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="right">Refresh providers</TooltipPopup>
        </Tooltip>
      </div>
      <div className="rounded-lg border border-border/70 bg-background/45 p-1">
        <div className="grid grid-cols-2 gap-1">
          {CAPABILITY_VIEWS.map((view) => (
            <CapabilityToggle
              key={view.id}
              view={view.id}
              label={view.label}
              icon={view.icon}
              active={panelView === view.id}
              count={view.id === "skills" ? skillCount : pluginCount}
              onSelect={(nextView) => setPanelView(panelView === nextView ? null : nextView)}
            />
          ))}
        </div>
        {panelView ? (
          <div className="mt-2 grid gap-2 border-t border-border/60 pt-2">
            <div className="flex min-w-0 items-center gap-2">
              <ProviderSelect
                providers={availableProviders}
                selectedProvider={selectedProvider}
                onProviderChange={setSelectedProviderKind}
              />
              <button
                type="button"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close extensions panel"
                onClick={() => setPanelView(null)}
              >
                <XIcon className="size-3.5" />
              </button>
            </div>
            {panelView === "skills" ? (
              <div className="grid gap-2">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    value={skillQuery}
                    onChange={(event) => setSkillQuery(event.target.value)}
                    placeholder="Search skills"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <FilterButton
                    value="enabled"
                    activeValue={skillFilter}
                    label="Enabled"
                    onChange={setSkillFilter}
                  />
                  <FilterButton
                    value="all"
                    activeValue={skillFilter}
                    label="All"
                    onChange={setSkillFilter}
                  />
                </div>
                <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-0.5">
                  {visibleSkills.length > 0 ? (
                    visibleSkills.map((skill) => (
                      <SkillRow
                        key={`${skill.path}:${skill.name}`}
                        skill={skill}
                        canInsert={routeComposerTarget !== null}
                        onInsert={handleInsertSkill}
                        onCopy={(nextSkill) => copyToClipboard(`$${nextSkill.name} `, nextSkill)}
                      />
                    ))
                  ) : (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground/70">
                      No skills match this view.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    value={pluginQuery}
                    onChange={(event) => setPluginQuery(event.target.value)}
                    placeholder="Search plugins"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <FilterButton
                    value="installed"
                    activeValue={pluginFilter}
                    label="Installed"
                    count={pluginInstalledCount}
                    onChange={setPluginFilter}
                  />
                  <FilterButton
                    value="available"
                    activeValue={pluginFilter}
                    label="Available"
                    count={pluginAvailableCount}
                    onChange={setPluginFilter}
                  />
                  <FilterButton
                    value="featured"
                    activeValue={pluginFilter}
                    label="Featured"
                    count={pluginFeaturedCount}
                    onChange={setPluginFilter}
                  />
                  <FilterButton
                    value="all"
                    activeValue={pluginFilter}
                    label="All"
                    count={pluginCount}
                    onChange={setPluginFilter}
                  />
                </div>
                <p className="px-1 text-[10px] leading-4 text-muted-foreground/70">
                  {pluginInstalledCount} installed · {pluginAvailableCount} available to install
                </p>
                <div className="grid max-h-72 gap-1.5 overflow-y-auto pr-0.5">
                  {visiblePlugins.length > 0 ? (
                    visiblePlugins.map((plugin) => (
                      <PluginRow
                        key={plugin.id}
                        plugin={plugin}
                        pendingAction={pendingPluginAction}
                        onRead={handleReadPlugin}
                        onInstall={handleInstallPlugin}
                        onUninstall={handleUninstallPlugin}
                      />
                    ))
                  ) : (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground/70">
                      {pluginEmptyMessage(pluginFilter)}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
      <PluginDetailDialog
        detail={pluginDetail}
        pendingAction={pendingPluginAction}
        open={pluginDetailOpen}
        onOpenChange={setPluginDetailOpen}
        onOpenExternal={handleOpenExternal}
        onInstall={handleInstallPlugin}
        onUninstall={handleUninstallPlugin}
      />
    </div>
  );
}
