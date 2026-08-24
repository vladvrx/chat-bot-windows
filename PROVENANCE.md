# Provenance

This repository (`vladvrx/chat-bot-windows`) is an unofficial, evidence-based reconstruction of the publicly distributed **Grok Bot 0.18.0** desktop application (Anysphere / Cursor).

## Upstream artifacts used

**macOS arm64**
- Product: Grok Bot 0.18.0
- Bundle ID: `com.anysphere.sand`
- Electron: 42.1.0
- DMG: https://downloads.cursor.com/grokbot/stable/darwin-arm64/0.18.0/Grok_Bot_0.18.0.dmg
- SHA-256: `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb`

**Windows x64**
- Installer: https://downloads.cursor.com/grokbot/stable/win32-x64/0.18.0/Grok_Bot_0.18.0_Setup.exe
- SHA-256: `464079a15ef5fa8b61ccea8fffcc78f63cfcf6df65fb0ad5e725d8b95f7e437e`
- Additional hashes recorded in `research-archives/original/0.18.0/artifacts.json`

The original installers are preserved via Git LFS for research continuity only. They remain subject to Anysphere’s terms.

## Reconstruction approach

- Runtime code (Electron main, host, coordinator, protocol, etc.) was reconstructed from inspectable artifacts (emitted code, strings, IPC contracts, runtime behavior).
- The shipped minified renderer is retained as the UI baseline in packaged builds; only narrow, hash-recorded transforms are applied.
- `frontend/` is a partial, evidence-backed readable reconstruction — **not** the original authored source.
- Reconstructed builds use a distinct identity and do not claim the original code signature or notarization.

## Licensing statement

**No upstream source-code license is implied or granted.**

This material is derived from a proprietary binary.  
Anyone who publishes, forks, or distributes this repository or resulting binaries must perform their own independent legal review of:

- Copyright
- Trademark
- Reverse-engineering / decompilation restrictions in the original EULA / ToS
- Third-party dependency licenses
- OpenAI / Codex terms (when using the Codex router)

## Evidence-only rule

Recovered source may only express behavior supported by at least one inspectable artifact anchor. Speculative or invented product behavior is not permitted.
