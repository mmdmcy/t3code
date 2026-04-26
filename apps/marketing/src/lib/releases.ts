const REPO = "pingdotgg/t3code";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;

const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const CACHE_KEY = "t3code-latest-release";
const RELEASE_LOOKUP_ENABLED = import.meta.env.PUBLIC_T3CODE_RELEASE_LOOKUP_ENABLED === "1";

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export async function fetchLatestRelease(): Promise<Release | null> {
  if (!RELEASE_LOOKUP_ENABLED) {
    return null;
  }

  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const data = await fetch(API_URL).then((r) => r.json());

  if (data?.assets) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }

  return data;
}
