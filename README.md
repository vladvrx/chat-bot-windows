# Grok Bot 0.18 — reconstructed and extended

![Grok Bot Router settings with Codex selected and local usage totals](docs/assets/router-settings.png)

This repository is an unofficial, source-oriented reconstruction of the
publicly shipped Grok Bot 0.18.0 macOS and Windows apps.

The project began as an attempt to understand how the desktop app was put
together. It now contains readable TypeScript implementations of its Electron,
host, coordinator, local-execution, protocol, and renderer boundaries, plus a
deterministic toolchain for turning those sources back into a working macOS
application.

It also adds a few practical experiments:

- an inference router for Cursor, Claude Code, Codex, and OpenRouter;
- Grok Bot plugin/MCP tools across the routed providers;
- local usage tracking for routed inference;
- an optional local Docker sandbox in place of the remote box; and
- a reconstructed settings surface integrated into the polished shipped UI.

This is a hacking and research project, not Anysphere's original monorepo and
not an official Grok Bot release. Names and module boundaries inferred from a
compiled application may differ from the original source.

## What is in the repository?

The checked-in tree contains the reviewed reconstruction, tests, manifests,
build scripts, and Git LFS preservation copies of the original macOS arm64 and
Windows x64 installers. It deliberately does **not** commit the extracted
upstream application, build output, local credentials, or the large forensic
recovery workspace.

The public Grok Bot 0.18.0 application is instead treated as a pinned build
input. During bootstrap, the toolchain downloads it, verifies its SHA-256
identity, and extracts the pieces required to assemble the reconstruction.

The resulting app is a hybrid by design:

- application runtimes are compiled from the readable sources under `source/`;
- the polished shipped renderer remains the UI baseline;
- a narrow deterministic transform adds the reconstructed Router settings UI;
- original and patched renderer chunk hashes are recorded and verified; and
- the finished app uses a separate bundle identifier and an ad-hoc signature.

The upstream app installed on the machine is never overwritten.

### Why retain the shipped renderer?

The distributed application did not include the original frontend source or
source maps. It contained optimized, minified production JavaScript and CSS
chunks: enough to inspect behavior and recover contracts, but not the authored
React components, names, comments, file structure, or design-system source.

Recreating the complete frontend with the same polish and behavior would have
been a separate, much larger reverse-engineering project. It was not a realistic
goal for a weekend build. The practical choice was therefore to reconstruct the
runtime and control-plane code, retain the checksum-pinned shipped renderer,
and make the smallest auditable UI patch needed for the new Router settings.

`frontend/` is a readable partial reconstruction and design workspace. It is
useful for understanding UI contracts and experimenting with clean components,
but it should not be mistaken for Anysphere's missing original frontend source
or a pixel-perfect replacement for the packaged renderer.

## Preserved original installers

Research copies of the exact 0.18.0 installers live under
`research-archives/original/0.18.0/` and are stored with Git LFS:

| Platform | File | SHA-256 |
| --- | --- | --- |
| macOS arm64 | `macos-arm64/Grok_Bot_0.18.0.dmg` | `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb` |
| Windows x64 | `windows-x64/Grok_Bot_0.18.0_Setup.exe` | `464079a15ef5fa8b61ccea8fffcc78f63cfcf6df65fb0ad5e725d8b95f7e437e` |

See [research-archives/README.md](research-archives/README.md) for source URLs,
sizes, verification commands, and the machine-readable artifact manifest.

## Current features

### Inference Router

Open **Settings → Router** to choose the backend used for new turns:

| Provider | Authentication | Tool support |
| --- | --- | --- |
| Cursor | Existing Grok Bot/Cursor session | Native Grok Bot tools and plugins |
| Claude Code | Existing Claude Code login | Routed Grok Bot MCP tools |
| Codex | Existing local ChatGPT/Codex login | Direct Responses transport with Grok Bot tools |
| OpenRouter | API key saved through the desktop secrets bridge | Grok Bot tool-execution loop |

Cursor is the default. Claude Code and Codex do not require separate API keys
when their local clients are already authenticated. The application preserves
streaming responses, thinking state, reactions, rich plugin mentions, and MCP
tool execution across routed conversations.

#### Codex setup on Windows

1. Install Codex and sign in with ChatGPT. If needed, run `codex login` from a
   terminal and finish the browser sign-in.
2. Start Grok Bot, open **Settings → Router**, and select **Codex**.
3. Confirm the Connection section says **Connected**. New turns now use Codex.

Grok Bot reads the existing sign-in from `%USERPROFILE%\.codex\auth.json`; it
does not ask for or store a separate API key. The model and reasoning effort in
`%USERPROFILE%\.codex\config.toml` provide the initial defaults. On Windows,
credential privacy is enforced by Windows ACLs, so the app does not apply the
POSIX mode bit check used on macOS and Linux. If the page says **Setup
required**, sign in to Codex again and reopen Grok Bot.

When Codex is selected and no legacy Cursor/Grok Bot account is available, the
Windows build opens the reconstructed Grok Bot shell with Codex behind it. The
standalone workspace uses the recovered sidebar, chat header, transcript,
composer, and animated character renderer.

Use **New** to create local bots. Each bot has its own persisted chat history,
name, original Grok Bot shape, color, and custom instructions. Open
**Customize** to change the character. Bots can also be renamed, duplicated,
pinned, and deleted from the sidebar menu.

Click the model label in the middle of the composer to choose a model and
reasoning effort for the current bot. The selection is saved per bot and is
sent with that bot's real Codex request. The current choices are 5.6 Sol,
5.6 Terra, 5.6 Luna, 5.5, and 5.4, with Minimal through Extra high reasoning.
Availability depends on the models enabled for the signed-in ChatGPT/Codex
account.

The Windows local workspace loads separately from the full cloud interface. It
uses a native text composer and a compact transcript, leaves the rich editor
and cloud workspace unloaded, and pauses small character animations while they
are idle. This keeps typing and sending responsive without removing character
customization.

The original Grok Bot remote computer, cloud roster, plugins, and computer-use
tools still require the upstream Cursor/Grok Bot service and are not available
in standalone mode. The computer button only reports the local Codex connection
state in this build.

**Usage & Billing** shows the locally recorded request and token totals for
providers that return usage data. These figures are activity records, not an
authoritative provider invoice.

### Local Docker sandbox

The Router page also has a **Use local Docker VM** toggle. When enabled, Grok
Bot runs its box host and execution daemon in an owned local container instead
of connecting to the remote sandbox.

The container:

- is bound only to loopback ports;
- mounts content-addressed host and daemon artifacts read-only;
- reuses the user's existing provider authentication where needed;
- is validated before the coordinator connects; and
- is stopped or replaced through the same settings lifecycle.

Docker Desktop, or another compatible local Docker daemon, must be running.
Remote mode remains the default.

## Requirements

- macOS on Apple Silicon, or Windows 10/11 on x64
- Node.js 26.5.x
- Git LFS
- Xcode Command Line Tools on macOS
- Docker Desktop (optional, only for the local sandbox)
- local Claude Code or Codex authentication for those router choices

## Quick start

```sh
git clone <your-repository-url>
cd grok-bot-0.18-reconstructed
git lfs install
git lfs pull
npm ci
npm run bootstrap
npm run check
npm run package
```

On macOS, launch:

```sh
open "dist/Grok Bot 0.18 Reconstructed.app"
```

On Windows, launch:

```powershell
& ".\dist\Grok Bot 0.18 Reconstructed-win32-x64\Grok Bot 0.18 Reconstructed.exe"
```

`npm run bootstrap` first uses the Git LFS preservation copy for the current
platform. If that archive is absent, it falls back to the original public URL.
`GROK_BOT_018_APP` can also point to an existing application copy. Bootstrap
verifies the installer and platform-specific `app.asar`, caches the matching
Electron runtime, and hydrates the ignored `src/app/dist` build input. Windows
bootstrap extracts the installer without executing it.

`npm run package` compiles the reconstructed runtimes, applies the narrow
renderer/settings transform, assigns a separate reconstructed identity, and
verifies the result. The Windows package overlays the readable source-built
frontend so the local Codex workspace and model picker are included in the
executable. macOS builds receive an ad-hoc signature. Windows builds remove the
upstream Authenticode payload before writing reconstructed version metadata.
Output is written to one of:

```text
dist/Grok Bot 0.18 Reconstructed.app
dist/Grok Bot 0.18 Reconstructed-win32-x64/Grok Bot 0.18 Reconstructed.exe
```

Reconstructed packages disable the upstream updater at the packaging boundary
and default upstream Sentry and telemetry emission off. Explicitly supplied
environment configuration is still respected.

## Architecture

```text
polished shipped renderer
          │
          │ desktop preload / RPC
          ▼
     Electron main
          │
          ├── settings, secrets, auth and plugin lifecycle
          ├── remote box connector
          └── owned local Docker connector
                       │
                       ▼
              coordinator + host
                       │
              inference router
           ┌───────────┼───────────┐
        Cursor      Claude       Codex / OpenRouter
                       │
                 Grok Bot MCP tools
```

The main source areas are:

- `source/electron-main/` — desktop lifecycle, settings, auth, box connectors,
  coordinator ownership, and RPC handlers;
- `source/electron-preload/` — the narrow trusted bridge exposed to the UI;
- `source/host/` — inference, tools, MCP, settings, and turn execution;
- `source/node-agent-coordinator/` — transcript routing, streaming activity,
  reactions, and the routed MCP bridge;
- `source/shared/` — shared contracts, settings, protocol, and provider helpers;
- `frontend/` — readable React/TypeScript renderer reconstruction and design
  workspace;
- `scripts/` — bootstrap, compilation, renderer patching, packaging, signing,
  and verification; and
- `tests/` — publication and router regressions.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for more detail.

## Development commands

```sh
npm test                  # focused regression tests
npm run typecheck         # renderer TypeScript
npm run source:typecheck  # runtime TypeScript
npm run frontend:build    # build the readable renderer reconstruction
npm run package           # build and verify the current platform's app
npm run package:windows   # build and verify the portable Windows app
npm run verify            # verify an existing packaged app
npm run smoke:windows     # load required native modules with packaged Electron
npm run smoke             # bounded native smoke check
npm run publication:check # prove a fresh-history export is lossless
```

Generated directories including `.cache`, `.build`, `dist`, `src/app/dist`,
`recovered`, `recovery`, and local probe roots are ignored.

## Project status

The app launches and the core reconstructed flows are usable, including routed
inference, connected plugins, and the local Docker sandbox. This is still an
experimental reconstruction: it targets the pinned macOS/arm64 and Windows/x64
0.18.0 releases, depends on external provider sessions, and does not promise
compatibility with future Grok Bot versions.

For changes, read [CONTRIBUTING.md](CONTRIBUTING.md). For the clean-history
export procedure, see [docs/PUBLISHING.md](docs/PUBLISHING.md). Technical
provenance and retained upstream boundaries are described in
[PROVENANCE.md](PROVENANCE.md) and [NOTICE.md](NOTICE.md).
