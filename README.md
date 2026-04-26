# T3 Code (Privacy-Hardened Fork)

T3 Code is a minimal web GUI for coding agents (currently Codex and Claude, more coming soon).

This fork is configured for private, local-first personal and business use. The AI provider
CLIs and APIs still need network access to do their work, but repo-owned telemetry, update
checks, remote assets, and broad browser access are disabled or locked down by default.

## Privacy defaults in this fork

- Server binds to `127.0.0.1` by default.
- Browser API access uses explicit origin checks and non-wildcard CORS.
- PostHog telemetry is off unless `T3CODE_TELEMETRY_ENABLED=1` is set.
- OTLP export is off unless `T3CODE_ALLOW_OTLP_EXPORTS=1` is set.
- Local tracing, provider event logs, desktop file logs, and terminal history persistence are off by default.
- Desktop auto-update checks are off unless `T3CODE_ENABLE_AUTO_UPDATE=1` is set.
- Provider subprocesses receive common telemetry opt-out environment variables by default.
- Browser bearer secrets are stored in session storage, and legacy local storage secrets are scrubbed on migration.
- App state, logs, SQLite files, and secrets are written with private filesystem permissions where supported.
- Runtime Google Fonts and CDN icon requests have been removed.

## Running This Fork

### Daily command

Use this for normal local development on Linux, Windows, and macOS:

```bash
bun install
bun dev:desktop
```

After dependencies are installed once, daily startup is just:

```bash
bun dev:desktop
```

This opens the Electron desktop app. The command is intended to behave the same across supported
operating systems, assuming Bun and at least one AI provider CLI are installed on that machine.

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### What runs under the hood

T3 Code is a GUI/orchestrator for AI CLIs and APIs, but it still runs a private local backend:

- Electron opens the desktop window.
- The React web UI renders inside that window.
- The local server talks to Codex/Claude/etc, manages sessions, streams events, stores app state,
  and handles terminal/filesystem/git operations.
- The AI provider CLI/API is still the actual agent.

The local server exists because the UI should not directly own long-running CLI processes, terminal
PTYs, filesystem writes, git commands, auth/session state, and streaming agent events.

### Install dependencies

From the repo root:

```bash
cd /home/rei/Documents/github/t3code
bun install
```

This fork intentionally avoids workspace `prepare` scripts. In particular, it does not run the
Effect language-service TypeScript patch during install because that patch is optional for running
the app and can spawn large Node processes when repeated across the monorepo. This keeps normal
installs lighter, quieter, and less surprising.

For the most paranoid install mode, you can skip package lifecycle scripts:

```bash
bun install --ignore-scripts
```

That reduces install-time code execution, but it can break native dependencies such as `node-pty`,
which is needed for the integrated terminal on Linux. For normal Linux desktop use, prefer
plain `bun install`.

### Electron desktop development

This is the main way to run the app locally as an Electron desktop app:

```bash
bun dev:desktop
```

This starts the Vite web dev server, builds/watches the Electron main process, starts the local
backend, and opens the Electron window.

### Web development

```bash
bun dev
```

Open the local URL printed by the dev server, usually:

```text
http://localhost:5733
```

This starts the web UI and local backend without the Electron shell.

### Production-ish desktop run

Build the local desktop/server/web artifacts, then launch Electron from those built files:

```bash
bun build:desktop
bun start:desktop
```

This is useful for sanity-checking behavior closer to a packaged desktop app without creating an
installer/AppImage.

### Built web/server run

Build the web/server app and run from the built artifacts:

```bash
bun build
bun start
```

### Desktop builds

Build scripts exist for platform artifacts:

```bash
bun dist:desktop:linux
bun dist:desktop:dmg:arm64
bun dist:desktop:win:x64
```

Install desktop builds from this fork's [GitHub Releases](https://github.com/mmdmcy/t3code/releases)
when available. Package registry installers such as Homebrew, winget, and AUR may point at upstream
builds instead of this privacy-hardened fork.

## Some notes

We are very very early in this project. Expect bugs.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.
