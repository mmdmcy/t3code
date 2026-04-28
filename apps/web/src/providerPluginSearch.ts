import type { ServerProviderPlugin } from "@t3tools/contracts";
import {
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
} from "@t3tools/shared/searchRanking";

import {
  formatProviderPluginDescription,
  formatProviderPluginDisplayName,
  formatProviderPluginSource,
} from "./providerPluginPresentation";

function scoreProviderPlugin(plugin: ServerProviderPlugin, query: string): number | null {
  const scores = [
    scoreQueryMatch({
      value: plugin.name.toLowerCase(),
      query,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      fuzzyBase: 100,
      boundaryMarkers: ["-", "_", "/"],
    }),
    scoreQueryMatch({
      value: formatProviderPluginDisplayName(plugin).toLowerCase(),
      query,
      exactBase: 1,
      prefixBase: 3,
      boundaryBase: 5,
      includesBase: 7,
      fuzzyBase: 110,
    }),
    scoreQueryMatch({
      value: formatProviderPluginDescription(plugin).toLowerCase(),
      query,
      exactBase: 20,
      prefixBase: 22,
      boundaryBase: 24,
      includesBase: 26,
    }),
    scoreQueryMatch({
      value: formatProviderPluginSource(plugin).toLowerCase(),
      query,
      exactBase: 40,
      prefixBase: 42,
      includesBase: 44,
    }),
    scoreQueryMatch({
      value: plugin.marketplaceName.toLowerCase(),
      query,
      exactBase: 50,
      prefixBase: 52,
      includesBase: 54,
    }),
  ].filter((score): score is number => score !== null);

  return scores.length > 0 ? Math.min(...scores) : null;
}

export function searchProviderPlugins(
  plugins: ReadonlyArray<ServerProviderPlugin>,
  query: string,
  limit = Number.POSITIVE_INFINITY,
): ServerProviderPlugin[] {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    return [...plugins];
  }

  const ranked: Array<{
    item: ServerProviderPlugin;
    score: number;
    tieBreaker: string;
  }> = [];

  for (const plugin of plugins) {
    const score = scoreProviderPlugin(plugin, normalizedQuery);
    if (score === null) {
      continue;
    }

    insertRankedSearchResult(
      ranked,
      {
        item: plugin,
        score,
        tieBreaker: `${formatProviderPluginDisplayName(plugin).toLowerCase()}\u0000${plugin.name}`,
      },
      limit,
    );
  }

  return ranked.map((entry) => entry.item);
}
