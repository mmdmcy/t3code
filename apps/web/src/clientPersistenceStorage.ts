import {
  ClientSettingsSchema,
  EnvironmentId,
  type ClientSettings,
  type EnvironmentId as EnvironmentIdValue,
  type PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";
export const SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY = "t3code:saved-environment-registry:v1";
export const SAVED_ENVIRONMENT_SECRETS_STORAGE_KEY = "t3code:saved-environment-secrets:v1";

const BrowserSavedEnvironmentRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  bearerToken: Schema.optionalKey(Schema.String),
});
type BrowserSavedEnvironmentRecord = typeof BrowserSavedEnvironmentRecordSchema.Type;

const BrowserSavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(BrowserSavedEnvironmentRecordSchema)),
});
type BrowserSavedEnvironmentRegistryDocument =
  typeof BrowserSavedEnvironmentRegistryDocumentSchema.Type;

const BrowserSavedEnvironmentSecretsDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  bearerTokens: Schema.optionalKey(Schema.Record(EnvironmentId, Schema.String)),
});
type BrowserSavedEnvironmentSecretsDocument =
  typeof BrowserSavedEnvironmentSecretsDocumentSchema.Type;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function getSessionStorage(): Storage | null {
  if (!hasWindow()) {
    return null;
  }
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentRecord,
): PersistedSavedEnvironmentRecord {
  return {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
  } catch {
    return null;
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}

function readBrowserSavedEnvironmentRegistryDocument(): BrowserSavedEnvironmentRegistryDocument {
  if (!hasWindow()) {
    return {};
  }

  try {
    const parsed = getLocalStorageItem(
      SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      BrowserSavedEnvironmentRegistryDocumentSchema,
    );
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeBrowserSavedEnvironmentRegistryDocument(
  document: BrowserSavedEnvironmentRegistryDocument,
): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
    document,
    BrowserSavedEnvironmentRegistryDocumentSchema,
  );
}

function readBrowserSavedEnvironmentSecretsDocument(): BrowserSavedEnvironmentSecretsDocument {
  const sessionStorage = getSessionStorage();
  if (!sessionStorage) {
    return {};
  }

  try {
    const raw = sessionStorage.getItem(SAVED_ENVIRONMENT_SECRETS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    return Schema.decodeUnknownSync(BrowserSavedEnvironmentSecretsDocumentSchema)(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeBrowserSavedEnvironmentSecretsDocument(
  document: BrowserSavedEnvironmentSecretsDocument,
): void {
  const sessionStorage = getSessionStorage();
  if (!sessionStorage) {
    return;
  }

  sessionStorage.setItem(
    SAVED_ENVIRONMENT_SECRETS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      bearerTokens: document.bearerTokens ?? {},
    } satisfies BrowserSavedEnvironmentSecretsDocument),
  );
}

function scrubLegacyBrowserSavedEnvironmentSecrets(): void {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  let changed = false;
  const records = (document.records ?? []).map((record) => {
    if (record.bearerToken === undefined) {
      return record;
    }
    changed = true;
    return toPersistedSavedEnvironmentRecord(record);
  });

  if (!changed) {
    return;
  }

  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records,
  });
}

function readBrowserSavedEnvironmentRecordsWithSecrets(): ReadonlyArray<BrowserSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRegistryDocument().records ?? [];
}

function writeBrowserSavedEnvironmentRecords(
  records: ReadonlyArray<BrowserSavedEnvironmentRecord>,
): void {
  writeBrowserSavedEnvironmentRegistryDocument({
    version: 1,
    records,
  });
}

export function readBrowserSavedEnvironmentRegistry(): ReadonlyArray<PersistedSavedEnvironmentRecord> {
  return readBrowserSavedEnvironmentRecordsWithSecrets().map((record) =>
    toPersistedSavedEnvironmentRecord(record),
  );
}

export function writeBrowserSavedEnvironmentRegistry(
  records: ReadonlyArray<PersistedSavedEnvironmentRecord>,
): void {
  writeBrowserSavedEnvironmentRecords(
    records.map((record) => toPersistedSavedEnvironmentRecord(record)),
  );

  const allowedIds = new Set(records.map((record) => record.environmentId));
  const secrets = readBrowserSavedEnvironmentSecretsDocument().bearerTokens ?? {};
  writeBrowserSavedEnvironmentSecretsDocument({
    bearerTokens: Object.fromEntries(
      Object.entries(secrets).filter(([environmentId]) =>
        allowedIds.has(environmentId as EnvironmentIdValue),
      ),
    ),
  });
}

export function readBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
): string | null {
  const sessionToken =
    readBrowserSavedEnvironmentSecretsDocument().bearerTokens?.[environmentId] ?? null;
  if (sessionToken) {
    return sessionToken;
  }

  // Legacy migration path: older builds stored bearer tokens in localStorage.
  // Keep reading them so existing sessions still work, but never write them back.
  const legacyToken =
    readBrowserSavedEnvironmentRecordsWithSecrets().find(
      (record) => record.environmentId === environmentId,
    )?.bearerToken ?? null;
  if (!legacyToken) {
    return null;
  }

  const currentSecrets = readBrowserSavedEnvironmentSecretsDocument().bearerTokens ?? {};
  writeBrowserSavedEnvironmentSecretsDocument({
    bearerTokens: {
      ...currentSecrets,
      [environmentId]: legacyToken,
    },
  });
  scrubLegacyBrowserSavedEnvironmentSecrets();
  return legacyToken;
}

export function writeBrowserSavedEnvironmentSecret(
  environmentId: EnvironmentIdValue,
  secret: string,
): boolean {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  const records = document.records ?? [];
  if (!records.some((record) => record.environmentId === environmentId)) {
    return false;
  }

  const currentSecrets = readBrowserSavedEnvironmentSecretsDocument().bearerTokens ?? {};
  writeBrowserSavedEnvironmentSecretsDocument({
    bearerTokens: {
      ...currentSecrets,
      [environmentId]: secret,
    },
  });

  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: records.map((record) => toPersistedSavedEnvironmentRecord(record)),
  });
  return true;
}

export function removeBrowserSavedEnvironmentSecret(environmentId: EnvironmentIdValue): void {
  const document = readBrowserSavedEnvironmentRegistryDocument();
  const currentSecrets = readBrowserSavedEnvironmentSecretsDocument().bearerTokens ?? {};
  const { [environmentId]: _removed, ...remainingSecrets } = currentSecrets;
  writeBrowserSavedEnvironmentSecretsDocument({
    bearerTokens: remainingSecrets,
  });

  writeBrowserSavedEnvironmentRegistryDocument({
    version: document.version ?? 1,
    records: (document.records ?? []).map((record) => {
      if (record.environmentId !== environmentId) {
        return record;
      }
      return toPersistedSavedEnvironmentRecord(record);
    }),
  });
}
