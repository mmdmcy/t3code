import {
  DateTime,
  Duration,
  Effect,
  Equal,
  Layer,
  Option,
  Result,
  Schema,
  Stream,
  Types,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as CodexErrors from "effect-codex-app-server/errors";

import type {
  CodexSettings,
  ServerProvider,
  ServerProviderState,
  ModelCapabilities,
  ServerProviderModel,
  ServerProviderPlugin,
  ServerProviderPluginAppSummary,
  ServerProviderPluginDetail,
  ServerProviderPluginInstallInput,
  ServerProviderPluginInstallResult,
  ServerProviderPluginReadInput,
  ServerProviderPluginSkillSummary,
  ServerProviderPluginUninstallInput,
  ServerProviderPluginUninstallResult,
  ServerProviderSkill,
} from "@t3tools/contracts";
import { ServerProviderPluginError, ServerSettingsError } from "@t3tools/contracts";

import { createModelCapabilities } from "@t3tools/shared/model";

import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { buildServerProvider, nonEmptyTrimmed } from "../providerSnapshot.ts";
import { CodexProvider } from "../Services/CodexProvider.ts";
import { providerProcessEnv } from "../processEnvironment.ts";
import { expandHomePath } from "../../pathExpansion.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import packageJson from "../../../package.json" with { type: "json" };

const PROVIDER = "codex" as const;
const PROVIDER_PROBE_TIMEOUT_MS = 8_000;
const CODEX_PRESENTATION = {
  displayName: "Codex",
  showInteractionModeToggle: true,
} as const;

export interface CodexAppServerProviderSnapshot {
  readonly account: CodexSchema.V2GetAccountResponse;
  readonly version: string | undefined;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly plugins: ReadonlyArray<ServerProviderPlugin>;
}

const REASONING_EFFORT_LABELS: Record<CodexSchema.V2ModelListResponse__ReasoningEffort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

function codexAccountAuthLabel(account: CodexSchema.V2GetAccountResponse["account"]) {
  if (!account) return undefined;
  if (account.type === "apiKey") return "OpenAI API Key";

  switch (account.planType) {
    case "free":
      return "ChatGPT Free Subscription";
    case "go":
      return "ChatGPT Go Subscription";
    case "plus":
      return "ChatGPT Plus Subscription";
    case "pro":
      return "ChatGPT Pro 20x Subscription";
    case "prolite":
      return "ChatGPT Pro 5x Subscription";
    case "team":
      return "ChatGPT Team Subscription";
    case "self_serve_business_usage_based":
    case "business":
      return "ChatGPT Business Subscription";
    case "enterprise_cbp_usage_based":
    case "enterprise":
      return "ChatGPT Enterprise Subscription";
    case "edu":
      return "ChatGPT Edu Subscription";
    case "unknown":
      return "ChatGPT Subscription";
    default:
      account.planType satisfies never;
      return undefined;
  }
}

function mapCodexModelCapabilities(
  model: CodexSchema.V2ModelListResponse__Model,
): ModelCapabilities {
  const reasoningOptions = model.supportedReasoningEfforts.map(({ reasoningEffort }) =>
    reasoningEffort === model.defaultReasoningEffort
      ? {
          id: reasoningEffort,
          label: REASONING_EFFORT_LABELS[reasoningEffort],
          isDefault: true,
        }
      : {
          id: reasoningEffort,
          label: REASONING_EFFORT_LABELS[reasoningEffort],
        },
  );
  const defaultReasoning = reasoningOptions.find((option) => option.isDefault)?.id;
  const supportsFastMode = (model.additionalSpeedTiers ?? []).includes("fast");
  return createModelCapabilities({
    optionDescriptors: [
      ...(reasoningOptions.length > 0
        ? [
            {
              id: "reasoningEffort",
              label: "Reasoning",
              type: "select" as const,
              options: reasoningOptions,
              ...(defaultReasoning ? { currentValue: defaultReasoning } : {}),
            },
          ]
        : []),
      ...(supportsFastMode
        ? [
            {
              id: "fastMode",
              label: "Fast Mode",
              type: "boolean" as const,
            },
          ]
        : []),
    ],
  });
}

const toDisplayName = (model: CodexSchema.V2ModelListResponse__Model): string => {
  // Capitalize 'gpt' to 'GPT-' and capitalize any letter following a dash
  return model.displayName
    .replace(/^gpt/i, "GPT") // Handle start with 'gpt' or 'GPT'
    .replace(/-([a-z])/g, (_, c) => "-" + c.toUpperCase());
};

function parseCodexModelListResponse(
  response: CodexSchema.V2ModelListResponse,
): ReadonlyArray<ServerProviderModel> {
  return response.data.map((model) => ({
    slug: model.model,
    name: toDisplayName(model),
    isCustom: false,
    capabilities: mapCodexModelCapabilities(model),
  }));
}

function appendCustomCodexModels(
  models: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
): ReadonlyArray<ServerProviderModel> {
  if (customModels.length === 0) {
    return models;
  }

  const seen = new Set(models.map((model) => model.slug));
  const fallbackCapabilities = models.find((model) => model.capabilities)?.capabilities ?? null;
  const customEntries: ServerProviderModel[] = [];
  for (const rawModel of customModels) {
    const slug = rawModel.trim();
    if (!slug || seen.has(slug)) {
      continue;
    }
    seen.add(slug);
    customEntries.push({
      slug,
      name: slug,
      isCustom: true,
      capabilities: fallbackCapabilities,
    });
  }
  return customEntries.length === 0 ? models : [...models, ...customEntries];
}

function parseCodexSkillsListResponse(
  response: CodexSchema.V2SkillsListResponse,
  cwd: string,
): ReadonlyArray<ServerProviderSkill> {
  const matchingEntry = response.data.find((entry) => entry.cwd === cwd);
  const skills = matchingEntry
    ? matchingEntry.skills
    : response.data.flatMap((entry) => entry.skills);

  return skills.map((skill) => {
    const shortDescription =
      skill.shortDescription ?? skill.interface?.shortDescription ?? undefined;

    const parsedSkill: Types.Mutable<ServerProviderSkill> = {
      name: skill.name,
      path: skill.path,
      enabled: skill.enabled,
    };

    if (skill.description) {
      parsedSkill.description = skill.description;
    }
    if (skill.scope) {
      parsedSkill.scope = skill.scope;
    }
    if (skill.interface?.displayName) {
      parsedSkill.displayName = skill.interface.displayName;
    }
    if (shortDescription) {
      parsedSkill.shortDescription = shortDescription;
    }

    return parsedSkill;
  });
}

function compactOptionalString(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  return nonEmptyTrimmed(value);
}

function compactStringArray(values: ReadonlyArray<string> | null | undefined): string[] {
  return (values ?? []).flatMap((value) => {
    const trimmed = compactOptionalString(value);
    return trimmed ? [trimmed] : [];
  });
}

function parseCodexPluginSource(
  source:
    | CodexSchema.V2PluginListResponse__PluginSource
    | CodexSchema.V2PluginReadResponse__PluginSource,
): ServerProviderPlugin["source"] {
  if (source.type === "local") {
    return {
      type: "local",
      path: source.path,
    };
  }

  if (source.type === "git") {
    return {
      type: "git",
      url: source.url,
      ...(compactOptionalString(source.path) ? { path: compactOptionalString(source.path) } : {}),
      ...(compactOptionalString(source.refName)
        ? { refName: compactOptionalString(source.refName) }
        : {}),
      ...(compactOptionalString(source.sha) ? { sha: compactOptionalString(source.sha) } : {}),
    };
  }

  return { type: "remote" };
}

function parseCodexPluginInterface(
  pluginInterface:
    | CodexSchema.V2PluginListResponse__PluginInterface
    | CodexSchema.V2PluginReadResponse__PluginInterface
    | null
    | undefined,
): ServerProviderPlugin["interface"] {
  if (!pluginInterface) return undefined;

  return {
    capabilities: compactStringArray(pluginInterface.capabilities),
    defaultPrompt: compactStringArray(pluginInterface.defaultPrompt),
    screenshotUrls: compactStringArray(pluginInterface.screenshotUrls),
    screenshots: compactStringArray(pluginInterface.screenshots),
    ...(compactOptionalString(pluginInterface.brandColor)
      ? { brandColor: compactOptionalString(pluginInterface.brandColor) }
      : {}),
    ...(compactOptionalString(pluginInterface.category)
      ? { category: compactOptionalString(pluginInterface.category) }
      : {}),
    ...(compactOptionalString(pluginInterface.composerIcon)
      ? { composerIcon: compactOptionalString(pluginInterface.composerIcon) }
      : {}),
    ...(compactOptionalString(pluginInterface.composerIconUrl)
      ? { composerIconUrl: compactOptionalString(pluginInterface.composerIconUrl) }
      : {}),
    ...(compactOptionalString(pluginInterface.developerName)
      ? { developerName: compactOptionalString(pluginInterface.developerName) }
      : {}),
    ...(compactOptionalString(pluginInterface.displayName)
      ? { displayName: compactOptionalString(pluginInterface.displayName) }
      : {}),
    ...(compactOptionalString(pluginInterface.logo)
      ? { logo: compactOptionalString(pluginInterface.logo) }
      : {}),
    ...(compactOptionalString(pluginInterface.logoUrl)
      ? { logoUrl: compactOptionalString(pluginInterface.logoUrl) }
      : {}),
    ...(compactOptionalString(pluginInterface.longDescription)
      ? { longDescription: compactOptionalString(pluginInterface.longDescription) }
      : {}),
    ...(compactOptionalString(pluginInterface.privacyPolicyUrl)
      ? { privacyPolicyUrl: compactOptionalString(pluginInterface.privacyPolicyUrl) }
      : {}),
    ...(compactOptionalString(pluginInterface.shortDescription)
      ? { shortDescription: compactOptionalString(pluginInterface.shortDescription) }
      : {}),
    ...(compactOptionalString(pluginInterface.termsOfServiceUrl)
      ? { termsOfServiceUrl: compactOptionalString(pluginInterface.termsOfServiceUrl) }
      : {}),
    ...(compactOptionalString(pluginInterface.websiteUrl)
      ? { websiteUrl: compactOptionalString(pluginInterface.websiteUrl) }
      : {}),
  };
}

function parseCodexPluginSummary(
  input: {
    readonly marketplaceName: string;
    readonly marketplacePath?: string | null;
    readonly marketplaceDisplayName?: string | null;
    readonly featuredPluginIds?: ReadonlySet<string>;
  },
  plugin:
    | CodexSchema.V2PluginListResponse__PluginSummary
    | CodexSchema.V2PluginReadResponse__PluginSummary,
): ServerProviderPlugin {
  const pluginInterface = parseCodexPluginInterface(plugin.interface);
  return {
    id: plugin.id,
    name: plugin.name,
    enabled: plugin.enabled,
    installed: plugin.installed,
    authPolicy: plugin.authPolicy,
    installPolicy: plugin.installPolicy,
    marketplaceName: input.marketplaceName,
    ...(compactOptionalString(input.marketplacePath)
      ? { marketplacePath: compactOptionalString(input.marketplacePath) }
      : {}),
    ...(compactOptionalString(input.marketplaceDisplayName)
      ? { marketplaceDisplayName: compactOptionalString(input.marketplaceDisplayName) }
      : {}),
    featured: input.featuredPluginIds?.has(plugin.id) ?? false,
    source: parseCodexPluginSource(plugin.source),
    ...(pluginInterface ? { interface: pluginInterface } : {}),
  };
}

function parseCodexPluginListResponse(
  response: CodexSchema.V2PluginListResponse,
): ReadonlyArray<ServerProviderPlugin> {
  const featuredPluginIds = new Set(response.featuredPluginIds ?? []);
  return response.marketplaces.flatMap((marketplace) =>
    marketplace.plugins.map((plugin) =>
      parseCodexPluginSummary(
        {
          marketplaceName: marketplace.name,
          ...(marketplace.path ? { marketplacePath: marketplace.path } : {}),
          ...(marketplace.interface?.displayName
            ? { marketplaceDisplayName: marketplace.interface.displayName }
            : {}),
          featuredPluginIds,
        },
        plugin,
      ),
    ),
  );
}

function parseCodexPluginApps(
  apps: ReadonlyArray<
    CodexSchema.V2PluginInstallResponse__AppSummary | CodexSchema.V2PluginReadResponse__AppSummary
  >,
): ReadonlyArray<ServerProviderPluginAppSummary> {
  return apps.map((app) => ({
    id: app.id,
    name: app.name,
    needsAuth: app.needsAuth,
    ...(compactOptionalString(app.description)
      ? { description: compactOptionalString(app.description) }
      : {}),
    ...(compactOptionalString(app.installUrl)
      ? { installUrl: compactOptionalString(app.installUrl) }
      : {}),
  }));
}

function parseCodexPluginSkills(
  skills: ReadonlyArray<CodexSchema.V2PluginReadResponse__SkillSummary>,
): ReadonlyArray<ServerProviderPluginSkillSummary> {
  return skills.map((skill) => ({
    name: skill.name,
    path: skill.path,
    enabled: skill.enabled,
    ...(compactOptionalString(skill.description)
      ? { description: compactOptionalString(skill.description) }
      : {}),
    ...(compactOptionalString(skill.shortDescription)
      ? { shortDescription: compactOptionalString(skill.shortDescription) }
      : {}),
  }));
}

const requestAllCodexModels = Effect.fn("requestAllCodexModels")(function* (
  client: CodexClient.CodexAppServerClientShape,
) {
  const models: ServerProviderModel[] = [];
  let cursor: string | null | undefined = undefined;

  do {
    const response: CodexSchema.V2ModelListResponse = yield* client.request(
      "model/list",
      cursor ? { cursor } : {},
    );
    models.push(...parseCodexModelListResponse(response));
    cursor = response.nextCursor;
  } while (cursor);

  return models;
});

export function buildCodexInitializeParams(): CodexSchema.V1InitializeParams {
  return {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: packageJson.version,
    },
    capabilities: {
      experimentalApi: true,
    },
  };
}

const probeCodexAppServerProvider = Effect.fn("probeCodexAppServerProvider")(function* (input: {
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly cwd: string;
  readonly customModels?: ReadonlyArray<string>;
}) {
  const clientContext = yield* Layer.build(
    CodexClient.layerCommand({
      command: input.binaryPath,
      args: ["app-server"],
      cwd: input.cwd,
      env: providerProcessEnv(input.homePath ? { CODEX_HOME: expandHomePath(input.homePath) } : {}),
    }),
  );
  const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
    Effect.provide(clientContext),
  );

  const initialize = yield* client.request("initialize", {
    clientInfo: {
      name: "t3code_desktop",
      title: "T3 Code Desktop",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
    },
  });
  yield* client.notify("initialized", undefined);

  // Extract the version string after the first '/' in userAgent, up to the next space or the end
  const versionMatch = initialize.userAgent.match(/\/([^\s]+)/);
  const version = versionMatch ? versionMatch[1] : undefined;

  const accountResponse = yield* client.request("account/read", {});
  if (!accountResponse.account && accountResponse.requiresOpenaiAuth) {
    return {
      account: accountResponse,
      version,
      models: appendCustomCodexModels([], input.customModels ?? []),
      skills: [],
      plugins: [],
    } satisfies CodexAppServerProviderSnapshot;
  }

  const [skillsResponse, plugins, models] = yield* Effect.all(
    [
      client.request("skills/list", {
        cwds: [input.cwd],
      }),
      client
        .request("plugin/list", {
          cwds: [input.cwd],
        })
        .pipe(
          Effect.map(parseCodexPluginListResponse),
          Effect.tapError((error) =>
            Effect.logWarning("failed to read Codex plugin list, continuing without plugins", {
              error: error.message,
            }),
          ),
          Effect.orElseSucceed(() => [] as ReadonlyArray<ServerProviderPlugin>),
        ),
      requestAllCodexModels(client),
    ],
    { concurrency: "unbounded" },
  );

  return {
    account: accountResponse,
    version,
    models: appendCustomCodexModels(models, input.customModels ?? []),
    skills: parseCodexSkillsListResponse(skillsResponse, input.cwd),
    plugins,
  } satisfies CodexAppServerProviderSnapshot;
}, Effect.scoped);

function pluginActionInputParams(
  input: ServerProviderPluginReadInput | ServerProviderPluginInstallInput,
) {
  return {
    pluginName: input.pluginName,
    ...(input.marketplacePath ? { marketplacePath: input.marketplacePath } : {}),
    ...(input.remoteMarketplaceName ? { remoteMarketplaceName: input.remoteMarketplaceName } : {}),
  };
}

function mapCodexPluginActionError(error: unknown, action: string): ServerProviderPluginError {
  if (error instanceof ServerProviderPluginError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new ServerProviderPluginError({
    provider: PROVIDER,
    message: `Codex plugin ${action} failed: ${detail}`,
    cause: error,
  });
}

function withCodexAppServerClient<A>(
  cwd: string,
  action: string,
  operation: (
    client: CodexClient.CodexAppServerClientShape,
  ) => Effect.Effect<A, CodexErrors.CodexAppServerError>,
): Effect.Effect<
  A,
  ServerProviderPluginError,
  ServerSettingsService | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const codexSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.codex),
    );
    if (!codexSettings.enabled) {
      return yield* Effect.fail(
        new ServerProviderPluginError({
          provider: PROVIDER,
          message: "Codex is disabled in T3 Code settings.",
        }),
      );
    }

    const clientContext = yield* Layer.build(
      CodexClient.layerCommand({
        command: codexSettings.binaryPath,
        args: ["app-server"],
        cwd,
        env: providerProcessEnv(
          codexSettings.homePath ? { CODEX_HOME: expandHomePath(codexSettings.homePath) } : {},
        ),
      }),
    );
    const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
      Effect.provide(clientContext),
    );

    yield* client.request("initialize", buildCodexInitializeParams());
    yield* client.notify("initialized", undefined);
    return yield* operation(client);
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) => mapCodexPluginActionError(error, action)),
  );
}

export function readCodexProviderPlugin(
  input: ServerProviderPluginReadInput & { readonly cwd: string },
): Effect.Effect<
  ServerProviderPluginDetail,
  ServerProviderPluginError,
  ServerSettingsService | ChildProcessSpawner.ChildProcessSpawner
> {
  return withCodexAppServerClient(input.cwd, "read", (client) =>
    client.request("plugin/read", pluginActionInputParams(input)).pipe(
      Effect.map((response): ServerProviderPluginDetail => {
        const plugin = response.plugin;
        return {
          summary: parseCodexPluginSummary(
            {
              marketplaceName: plugin.marketplaceName,
              marketplacePath: plugin.marketplacePath,
              marketplaceDisplayName: plugin.marketplaceName,
            },
            plugin.summary,
          ),
          marketplaceName: plugin.marketplaceName,
          marketplacePath: plugin.marketplacePath,
          apps: parseCodexPluginApps(plugin.apps),
          mcpServers: compactStringArray(plugin.mcpServers),
          skills: parseCodexPluginSkills(plugin.skills),
          ...(compactOptionalString(plugin.description)
            ? { description: compactOptionalString(plugin.description) }
            : {}),
        };
      }),
    ),
  );
}

export function installCodexProviderPlugin(
  input: ServerProviderPluginInstallInput & { readonly cwd: string },
): Effect.Effect<
  ServerProviderPluginInstallResult,
  ServerProviderPluginError,
  ServerSettingsService | ChildProcessSpawner.ChildProcessSpawner
> {
  return withCodexAppServerClient(input.cwd, "install", (client) =>
    client.request("plugin/install", pluginActionInputParams(input)).pipe(
      Effect.map((response) => ({
        authPolicy: response.authPolicy,
        appsNeedingAuth: parseCodexPluginApps(response.appsNeedingAuth),
      })),
    ),
  );
}

export function uninstallCodexProviderPlugin(
  input: ServerProviderPluginUninstallInput & { readonly cwd: string },
): Effect.Effect<
  ServerProviderPluginUninstallResult,
  ServerProviderPluginError,
  ServerSettingsService | ChildProcessSpawner.ChildProcessSpawner
> {
  return withCodexAppServerClient(input.cwd, "uninstall", (client) =>
    client.request("plugin/uninstall", { pluginId: input.pluginId }).pipe(Effect.as({})),
  );
}

const emptyCodexModelsFromSettings = (codexSettings: CodexSettings): ServerProvider["models"] =>
  codexSettings.customModels
    .map((model) => model.trim())
    .filter((model, index, models) => model.length > 0 && models.indexOf(model) === index)
    .map((model) => ({
      slug: model,
      name: model,
      isCustom: true,
      capabilities: null,
    }));

const makePendingCodexProvider = (codexSettings: CodexSettings): ServerProvider => {
  const checkedAt = new Date().toISOString();
  const models = emptyCodexModelsFromSettings(codexSettings);

  if (!codexSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CODEX_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      skills: [],
      plugins: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    presentation: CODEX_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    skills: [],
    plugins: [],
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Codex provider status has not been checked in this session yet.",
    },
  });
};

function accountProbeStatus(account: CodexAppServerProviderSnapshot["account"]): {
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProvider["auth"];
  readonly message?: string;
} {
  const authLabel = codexAccountAuthLabel(account.account);
  const auth = {
    status: account.account ? ("authenticated" as const) : ("unknown" as const),
    ...(account.account?.type ? { type: account.account?.type } : {}),
    ...(authLabel ? { label: authLabel } : {}),
  } satisfies ServerProvider["auth"];

  if (account.account) {
    return { status: "ready", auth };
  }

  if (account.requiresOpenaiAuth) {
    return {
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  return { status: "ready", auth };
}

export const checkCodexProviderStatus = Effect.fn("checkCodexProviderStatus")(function* (
  probe: (input: {
    readonly binaryPath: string;
    readonly homePath?: string;
    readonly cwd: string;
    readonly customModels: ReadonlyArray<string>;
  }) => Effect.Effect<
    CodexAppServerProviderSnapshot,
    CodexErrors.CodexAppServerError,
    ChildProcessSpawner.ChildProcessSpawner
  > = probeCodexAppServerProvider,
): Effect.fn.Return<
  ServerProvider,
  ServerSettingsError,
  ServerSettingsService | ChildProcessSpawner.ChildProcessSpawner
> {
  const codexSettings = yield* Effect.service(ServerSettingsService).pipe(
    Effect.flatMap((service) => service.getSettings),
    Effect.map((settings) => settings.providers.codex),
  );
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const emptyModels = emptyCodexModelsFromSettings(codexSettings);

  if (!codexSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CODEX_PRESENTATION,
      enabled: false,
      checkedAt,
      models: emptyModels,
      skills: [],
      plugins: [],
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Codex is disabled in T3 Code settings.",
      },
    });
  }

  const probeResult = yield* probe({
    binaryPath: codexSettings.binaryPath,
    homePath: codexSettings.homePath,
    cwd: process.cwd(),
    customModels: codexSettings.customModels,
  }).pipe(Effect.timeoutOption(Duration.millis(PROVIDER_PROBE_TIMEOUT_MS)), Effect.result);

  if (Result.isFailure(probeResult)) {
    const error = probeResult.failure;
    const installed = !Schema.is(CodexErrors.CodexAppServerSpawnError)(error);
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CODEX_PRESENTATION,
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      plugins: [],
      probe: {
        installed,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: installed
          ? `Codex app-server provider probe failed: ${error.message}.`
          : "Codex CLI (`codex`) is not installed or not on PATH.",
      },
    });
  }

  if (Option.isNone(probeResult.success)) {
    return buildServerProvider({
      provider: PROVIDER,
      presentation: CODEX_PRESENTATION,
      enabled: codexSettings.enabled,
      checkedAt,
      models: emptyModels,
      skills: [],
      plugins: [],
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Timed out while checking Codex app-server provider status.",
      },
    });
  }

  const snapshot = probeResult.success.value;
  const accountStatus = accountProbeStatus(snapshot.account);

  return buildServerProvider({
    provider: PROVIDER,
    presentation: CODEX_PRESENTATION,
    enabled: codexSettings.enabled,
    checkedAt,
    models: snapshot.models,
    skills: snapshot.skills,
    plugins: snapshot.plugins,
    probe: {
      installed: true,
      version: snapshot.version ?? null,
      status: accountStatus.status,
      auth: accountStatus.auth,
      ...(accountStatus.message ? { message: accountStatus.message } : {}),
    },
  });
});

export const CodexProviderLive = Layer.effect(
  CodexProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const checkProvider = checkCodexProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CodexSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.codex),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.codex),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: makePendingCodexProvider,
      checkProvider,
      refreshInterval: Duration.minutes(5),
    });
  }),
);
