import { Effect, Layer, FileSystem, Path } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>;
};
const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

const secureSqliteFiles = Effect.fn("secureSqliteFiles")(function* (dbPath: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.all(
    [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((filePath) =>
      fs
        .chmod(filePath, 0o600)
        .pipe(
          Effect.catch((cause) =>
            cause.reason._tag === "NotFound"
              ? Effect.void
              : Effect.logWarning("failed to secure sqlite file", { filePath, cause }),
          ),
        ),
    ),
    { concurrency: "unbounded" },
  );
});

const setup = (dbPath: string | null) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA journal_mode = WAL;`;
      yield* sql`PRAGMA foreign_keys = ON;`;
      yield* runMigrations();
      if (dbPath !== null) {
        yield* secureSqliteFiles(dbPath);
      }
    }),
  );

const setupMemory = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* runMigrations();
  }),
);

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dbDirectory = path.dirname(dbPath);
  yield* fs.makeDirectory(dbDirectory, { recursive: true, mode: 0o700 });
  yield* fs.chmod(dbDirectory, 0o700);

  return Layer.provideMerge(
    setup(dbPath),
    makeRuntimeSqliteLayer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "t3-server",
      },
    }),
  );
}, Layer.unwrap);

export const SqlitePersistenceMemory = Layer.provideMerge(
  setupMemory,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
