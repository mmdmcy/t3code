import { Effect, FileSystem, Path } from "effect";
import * as Random from "effect/Random";

export const writeFileStringAtomically = (input: {
  readonly filePath: string;
  readonly contents: string;
  readonly mode?: number;
}) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempFileId = yield* Random.nextUUIDv4;
      const targetDirectory = path.dirname(input.filePath);

      yield* fs.makeDirectory(targetDirectory, {
        recursive: true,
        ...(input.mode !== undefined ? { mode: 0o700 } : {}),
      });
      if (input.mode !== undefined) {
        yield* fs.chmod(targetDirectory, 0o700);
      }
      const tempDirectory = yield* fs.makeTempDirectoryScoped({
        directory: targetDirectory,
        prefix: `${path.basename(input.filePath)}.`,
      });
      if (input.mode !== undefined) {
        yield* fs.chmod(tempDirectory, 0o700);
      }
      const tempPath = path.join(tempDirectory, `${tempFileId}.tmp`);

      yield* fs.writeFileString(tempPath, input.contents);
      if (input.mode !== undefined) {
        yield* fs.chmod(tempPath, input.mode);
      }
      yield* fs.rename(tempPath, input.filePath);
      if (input.mode !== undefined) {
        yield* fs.chmod(input.filePath, input.mode);
      }
    }),
  );
