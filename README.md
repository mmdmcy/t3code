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

## Installation

> [!WARNING]
> T3 Code currently supports Codex and Claude.
> Install and authenticate at least one provider before use:
>
> - Codex: install [Codex CLI](https://github.com/openai/codex) and run `codex login`
> - Claude: install Claude Code and run `claude auth login`

### Run without installing

```bash
npx t3
```

### Desktop app

Install desktop builds from this fork's [GitHub Releases](https://github.com/mmdmcy/t3code/releases)
when available. Package registry installers may point at upstream builds instead of this
privacy-hardened fork.

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## Some notes

We are very very early in this project. Expect bugs.

Observability guide: [docs/observability.md](./docs/observability.md)

## If you REALLY want to contribute still.... read this first

Before local development, prepare the environment and install dependencies:

```bash
# Optional: only needed if you use mise for dev tool management.
mise install
bun install .
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.
