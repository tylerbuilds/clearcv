# REA investigation record

The initial research used [REA (Reverse Engineer Anything)](https://github.com/morluto/rea), a repository starred by tylerbuilds. REA is MIT-licensed. The source revision was `6ce3288f3bd65a886e47905455ed5c9b661015e6`, with `rea-agents@6.2.0` running on Node.js 24.14.0 and system Chromium on Linux. Global agent and MCP settings were left in place.

## What was observed

REA opened [Enhancv's public features page](https://enhancv.com/features/) without signing in. It recorded the rendered DOM, accessibility representation, browser viewport, URL and browser events. Raw captures are kept separately from this public repository. ClearCV's code, layouts and assets were written independently.

The [feature map](feature-map.md) uses those observations and public product descriptions. It records ClearCV's features and known gaps. The research doesn't show the private implementation, signed-in behaviour or proprietary algorithms, and doesn't establish a complete match between products.

## Reproduce a public observation

Install `rea-agents@6.2.0` in a separate research directory with a supported runtime: Node.js 22.19, 24.11 or another version accepted by that package. Set the browser executable to your local Chrome or Chromium installation, then run `capture-browser-scenario` with a scenario for an anonymous public URL. Follow REA's [browser investigation documentation](https://github.com/morluto/rea/tree/main/docs). Keep private account state and credentials outside this repository.

## Recorded outcomes

- [Public feature catalogue](https://enhancv.com/features/): `observed`; REA evidence `ev_1e0bae7f8703bdd0d5a597e79bf5b7e01e62711345df79842dcf0c99f3461031`.
- [Anonymous application onboarding shell](https://app.enhancv.com/): `observed`; REA evidence `ev_bc0356395e8dd8930b4998de94331d28bf33851d34062315d443098fb38a4711`.

The [REA findings](rea-findings.json) include tool versions, receipt digests, public observations, inferences and unknowns. They exclude private data and raw third-party content.
