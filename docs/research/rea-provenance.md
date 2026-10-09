# REA investigation provenance

This initial implementation was investigated with [REA (Reverse Engineer Anything)](https://github.com/morluto/rea), the repository starred by tylerbuilds. REA is MIT licensed. The cloned source revision was `6ce3288f3bd65a886e47905455ed5c9b661015e6`; the local CLI package was `rea-agents@6.2.0`, executed with Node.js 24.14.0 and system Chromium on Linux. No global agent or MCP configuration was changed.

## Scope

The investigation used anonymous public browser capture of [Enhancv](https://enhancv.com/features/). REA recorded the rendered DOM, accessibility representation, browser viewport, URL and browser events. Raw target captures are retained separately and are not distributed in this repository. The code, layouts and assets in this project were written independently.

Public product descriptions and browser observations support the feature map. They do not establish the private implementation, authenticated application behaviour, proprietary algorithms or complete feature parity. See [feature-map.md](feature-map.md) for implemented behaviour and known gaps.

## Reproduce a public observation

Use a supported REA runtime (Node.js 22.19, 24.11 or a version accepted by the pinned package), and install `rea-agents@6.2.0` in a separate research directory. Run its `capture-browser-scenario` command against a scenario describing an anonymous public URL. See REA's [browser investigation documentation](https://github.com/morluto/rea/tree/main/docs). Set the browser executable to your local Chrome or Chromium installation. Keep private account state and credentials outside this repository.

## Recorded outcomes

- [Public feature catalogue](https://enhancv.com/features/): `observed`; REA evidence `ev_1e0bae7f8703bdd0d5a597e79bf5b7e01e62711345df79842dcf0c99f3461031`.
- [Anonymous application onboarding shell](https://app.enhancv.com/): `observed`; REA evidence `ev_bc0356395e8dd8930b4998de94331d28bf33851d34062315d443098fb38a4711`.

See [rea-findings.json](rea-findings.json) for sanitised tool versions, receipt digests, public observations, static inferences and explicit unknowns. Raw third-party content is excluded.
