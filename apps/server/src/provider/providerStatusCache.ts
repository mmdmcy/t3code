import * as nodePath from "node:path";
import { type ServerProvider, ServerProvider as ServerProviderSchema } from "@t3tools/contracts";
import { Cause, Effect, FileSystem, Schema } from "effect";

import { writeFileStringAtomically } from "../atomicWrite.ts";

export const PROVIDER_CACHE_IDS = [
  "codex",
  "claudeAgent",
  "opencode",
  "cursor",
] as const satisfies ReadonlyArray<ServerProvider["provider"]>;

const decodeProviderStatusCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ServerProviderSchema),
);

const providerOrderRank = (provider: ServerProvider["provider"]): number => {
  const rank = PROVIDER_CACHE_IDS.indexOf(provider);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
};

interface ParsedCodexPluginCachePath {
  readonly pluginCacheDir: string;
  readonly revision: string;
  readonly suffixParts: ReadonlyArray<string>;
}

function parseCodexPluginCachePath(filePath: string): ParsedCodexPluginCachePath | undefined {
  const normalizedPath = nodePath.normalize(filePath);
  const root = nodePath.parse(normalizedPath).root;
  const pathWithoutRoot = normalizedPath.slice(root.length);
  const parts = pathWithoutRoot.split(nodePath.sep).filter((part) => part.length > 0);
  const pluginsIndex = parts.findIndex(
    (part, index) => part === "plugins" && parts[index + 1] === "cache",
  );

  if (pluginsIndex === -1 || parts.length <= pluginsIndex + 5) {
    return undefined;
  }

  const pluginCacheDir = nodePath.join(root, ...parts.slice(0, pluginsIndex + 4));
  return {
    pluginCacheDir,
    revision: parts[pluginsIndex + 4]!,
    suffixParts: parts.slice(pluginsIndex + 5),
  };
}

const pathExists = (fs: FileSystem.FileSystem, filePath: string) =>
  fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));

const resolveCachedSkillPath = Effect.fn(function* (fs: FileSystem.FileSystem, filePath: string) {
  if (!nodePath.isAbsolute(filePath)) {
    return filePath;
  }
  if (yield* pathExists(fs, filePath)) {
    return filePath;
  }

  const parsedPath = parseCodexPluginCachePath(filePath);
  if (!parsedPath) {
    return undefined;
  }

  const revisions = yield* fs
    .readDirectory(parsedPath.pluginCacheDir)
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
  const candidates: string[] = [];
  for (const revision of revisions) {
    if (revision === parsedPath.revision) {
      continue;
    }
    const candidate = nodePath.join(parsedPath.pluginCacheDir, revision, ...parsedPath.suffixParts);
    if (yield* pathExists(fs, candidate)) {
      candidates.push(candidate);
    }
  }

  return candidates.length === 1 ? candidates[0] : undefined;
});

const repairCachedProviderSkillPaths = Effect.fn(function* (provider: ServerProvider) {
  const fs = yield* FileSystem.FileSystem;
  const repairedSkills = yield* Effect.forEach(
    provider.skills,
    (skill) =>
      resolveCachedSkillPath(fs, skill.path).pipe(
        Effect.map((resolvedPath) => (resolvedPath ? [{ ...skill, path: resolvedPath }] : [])),
      ),
    { concurrency: "unbounded" },
  ).pipe(Effect.map((skills) => skills.flat()));

  if (repairedSkills.length !== provider.skills.length) {
    yield* Effect.logWarning("dropped stale provider skill cache entries", {
      provider: provider.provider,
      staleSkillCount: provider.skills.length - repairedSkills.length,
    });
  }

  return {
    ...provider,
    skills: repairedSkills,
  };
});

const mergeProviderModels = (
  fallbackModels: ReadonlyArray<ServerProvider["models"][number]>,
  cachedModels: ReadonlyArray<ServerProvider["models"][number]>,
): ReadonlyArray<ServerProvider["models"][number]> => {
  const fallbackSlugs = new Set(fallbackModels.map((model) => model.slug));
  return [...fallbackModels, ...cachedModels.filter((model) => !fallbackSlugs.has(model.slug))];
};

export const orderProviderSnapshots = (
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> =>
  [...providers].toSorted(
    (left, right) => providerOrderRank(left.provider) - providerOrderRank(right.provider),
  );

export const hydrateCachedProvider = (input: {
  readonly cachedProvider: ServerProvider;
  readonly fallbackProvider: ServerProvider;
}): ServerProvider => {
  if (
    !input.fallbackProvider.enabled ||
    input.cachedProvider.enabled !== input.fallbackProvider.enabled
  ) {
    return input.fallbackProvider;
  }

  const { message: _fallbackMessage, ...fallbackWithoutMessage } = input.fallbackProvider;
  const hydratedProvider: ServerProvider = {
    ...fallbackWithoutMessage,
    models: mergeProviderModels(input.fallbackProvider.models, input.cachedProvider.models),
    installed: input.cachedProvider.installed,
    version: input.cachedProvider.version,
    status: input.cachedProvider.status,
    auth: input.cachedProvider.auth,
    checkedAt: input.cachedProvider.checkedAt,
    slashCommands: input.cachedProvider.slashCommands,
    skills: input.cachedProvider.skills,
    plugins: input.cachedProvider.plugins ?? [],
  };

  return input.cachedProvider.message
    ? { ...hydratedProvider, message: input.cachedProvider.message }
    : hydratedProvider;
};

export const resolveProviderStatusCachePath = (input: {
  readonly cacheDir: string;
  readonly provider: ServerProvider["provider"];
}) => nodePath.join(input.cacheDir, `${input.provider}.json`);

export const readProviderStatusCache = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
    if (!exists) {
      return undefined;
    }

    const raw = yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => ""));
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    return yield* decodeProviderStatusCache(trimmed).pipe(
      Effect.flatMap(repairCachedProviderSkillPaths),
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          Effect.logWarning("failed to parse provider status cache, ignoring", {
            path: filePath,
            issues: Cause.pretty(cause),
          }).pipe(Effect.as(undefined)),
        onSuccess: Effect.succeed,
      }),
    );
  });

export const writeProviderStatusCache = (input: {
  readonly filePath: string;
  readonly provider: ServerProvider;
}) =>
  writeFileStringAtomically({
    filePath: input.filePath,
    contents: `${JSON.stringify(input.provider, null, 2)}\n`,
    mode: 0o600,
  });
