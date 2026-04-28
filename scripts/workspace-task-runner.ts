#!/usr/bin/env node

import { spawnSync } from "node:child_process";

interface WorkspaceTask {
  readonly label: string;
  readonly cwd: string;
  readonly script: string;
}

const TASKS = {
  contractsBuild: {
    label: "@t3tools/contracts build",
    cwd: "packages/contracts",
    script: "build",
  },
  contractsTypecheck: {
    label: "@t3tools/contracts typecheck",
    cwd: "packages/contracts",
    script: "typecheck",
  },
  contractsTest: {
    label: "@t3tools/contracts test",
    cwd: "packages/contracts",
    script: "test",
  },
  sharedTypecheck: {
    label: "@t3tools/shared typecheck",
    cwd: "packages/shared",
    script: "typecheck",
  },
  sharedTest: {
    label: "@t3tools/shared test",
    cwd: "packages/shared",
    script: "test",
  },
  clientRuntimeTypecheck: {
    label: "@t3tools/client-runtime typecheck",
    cwd: "packages/client-runtime",
    script: "typecheck",
  },
  clientRuntimeTest: {
    label: "@t3tools/client-runtime test",
    cwd: "packages/client-runtime",
    script: "test",
  },
  effectAcpBuild: {
    label: "effect-acp build",
    cwd: "packages/effect-acp",
    script: "build",
  },
  effectAcpTypecheck: {
    label: "effect-acp typecheck",
    cwd: "packages/effect-acp",
    script: "typecheck",
  },
  effectAcpTest: {
    label: "effect-acp test",
    cwd: "packages/effect-acp",
    script: "test",
  },
  effectCodexBuild: {
    label: "effect-codex-app-server build",
    cwd: "packages/effect-codex-app-server",
    script: "build",
  },
  effectCodexTypecheck: {
    label: "effect-codex-app-server typecheck",
    cwd: "packages/effect-codex-app-server",
    script: "typecheck",
  },
  effectCodexTest: {
    label: "effect-codex-app-server test",
    cwd: "packages/effect-codex-app-server",
    script: "test",
  },
  webBuild: {
    label: "@t3tools/web build",
    cwd: "apps/web",
    script: "build",
  },
  webTypecheck: {
    label: "@t3tools/web typecheck",
    cwd: "apps/web",
    script: "typecheck",
  },
  webTest: {
    label: "@t3tools/web test",
    cwd: "apps/web",
    script: "test",
  },
  serverBuild: {
    label: "t3 build",
    cwd: "apps/server",
    script: "build",
  },
  serverStart: {
    label: "t3 start",
    cwd: "apps/server",
    script: "start",
  },
  serverTypecheck: {
    label: "t3 typecheck",
    cwd: "apps/server",
    script: "typecheck",
  },
  serverTest: {
    label: "t3 test",
    cwd: "apps/server",
    script: "test",
  },
  desktopBuild: {
    label: "@t3tools/desktop build",
    cwd: "apps/desktop",
    script: "build",
  },
  desktopStart: {
    label: "@t3tools/desktop start",
    cwd: "apps/desktop",
    script: "start",
  },
  desktopTypecheck: {
    label: "@t3tools/desktop typecheck",
    cwd: "apps/desktop",
    script: "typecheck",
  },
  desktopTest: {
    label: "@t3tools/desktop test",
    cwd: "apps/desktop",
    script: "test",
  },
  desktopSmokeTest: {
    label: "@t3tools/desktop smoke-test",
    cwd: "apps/desktop",
    script: "smoke-test",
  },
  scriptsTypecheck: {
    label: "@t3tools/scripts typecheck",
    cwd: "scripts",
    script: "typecheck",
  },
  scriptsTest: {
    label: "@t3tools/scripts test",
    cwd: "scripts",
    script: "test",
  },
} as const satisfies Record<string, WorkspaceTask>;

const BUILD_DEPENDENCIES = [
  TASKS.contractsBuild,
  TASKS.effectAcpBuild,
  TASKS.effectCodexBuild,
] as const;
const WEB_AND_SERVER_BUILD = [...BUILD_DEPENDENCIES, TASKS.webBuild, TASKS.serverBuild] as const;
const DESKTOP_BUILD = [...WEB_AND_SERVER_BUILD, TASKS.desktopBuild] as const;
const TEST_BUILD_DEPENDENCIES = [...BUILD_DEPENDENCIES, TASKS.webBuild] as const;

const TYPECHECK_TASKS = [
  TASKS.contractsTypecheck,
  TASKS.sharedTypecheck,
  TASKS.clientRuntimeTypecheck,
  TASKS.effectAcpTypecheck,
  TASKS.effectCodexTypecheck,
  TASKS.webTypecheck,
  TASKS.serverTypecheck,
  TASKS.desktopTypecheck,
  TASKS.scriptsTypecheck,
] as const;

const TEST_TASKS = [
  TASKS.contractsTest,
  TASKS.sharedTest,
  TASKS.clientRuntimeTest,
  TASKS.effectAcpTest,
  TASKS.effectCodexTest,
  TASKS.webTest,
  TASKS.serverTest,
  TASKS.desktopTest,
  TASKS.scriptsTest,
] as const;

const COMMAND_NAMES = [
  "build",
  "build:contracts",
  "build:desktop",
  "start",
  "start:desktop",
  "test",
  "test:desktop-smoke",
  "typecheck",
] as const;

type WorkspaceCommandName = (typeof COMMAND_NAMES)[number];

function isWorkspaceCommandName(input: string): input is WorkspaceCommandName {
  return COMMAND_NAMES.includes(input as WorkspaceCommandName);
}

class WorkspaceTaskError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "WorkspaceTaskError";
    this.exitCode = exitCode;
  }
}

function runTask(task: WorkspaceTask, args: ReadonlyArray<string> = []): void {
  console.error(`[workspace] ${task.label}`);
  const result = spawnSync("bun", ["run", "--cwd", task.cwd, task.script, ...args], {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });

  if (result.error !== undefined) {
    throw new WorkspaceTaskError(`${task.label} failed: ${result.error.message}`);
  }
  if (result.signal !== null) {
    throw new WorkspaceTaskError(`${task.label} exited from signal ${result.signal}`, 1);
  }
  if (result.status !== 0) {
    throw new WorkspaceTaskError(
      `${task.label} exited with code ${result.status ?? 1}`,
      result.status ?? 1,
    );
  }
}

function runSequence(tasks: ReadonlyArray<WorkspaceTask>): void {
  for (const task of tasks) {
    runTask(task);
  }
}

export function runWorkspaceCommand(
  command: WorkspaceCommandName,
  args: ReadonlyArray<string> = [],
): void {
  switch (command) {
    case "build":
    case "build:desktop":
      runSequence(DESKTOP_BUILD);
      return;
    case "build:contracts":
      runTask(TASKS.contractsBuild);
      return;
    case "start":
      runSequence(WEB_AND_SERVER_BUILD);
      runTask(TASKS.serverStart, args);
      return;
    case "start:desktop":
      runSequence(DESKTOP_BUILD);
      runTask(TASKS.desktopStart, args);
      return;
    case "test":
      runSequence(TEST_BUILD_DEPENDENCIES);
      runSequence(TEST_TASKS);
      return;
    case "test:desktop-smoke":
      runSequence(DESKTOP_BUILD);
      runTask(TASKS.desktopSmokeTest, args);
      return;
    case "typecheck":
      runSequence(TYPECHECK_TASKS);
      return;
  }
}

function printHelp(): void {
  console.error(`Usage: node scripts/workspace-task-runner.ts <command>

Commands:
${COMMAND_NAMES.map((command) => `  ${command}`).join("\n")}`);
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);

  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    process.exitCode = command === undefined ? 1 : 0;
  } else if (!isWorkspaceCommandName(command)) {
    console.error(`Unknown workspace command: ${command}`);
    printHelp();
    process.exitCode = 1;
  } else {
    try {
      runWorkspaceCommand(command, args);
    } catch (error) {
      if (error instanceof WorkspaceTaskError) {
        console.error(error.message);
        process.exitCode = error.exitCode;
      } else {
        throw error;
      }
    }
  }
}
