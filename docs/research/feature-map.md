# Public feature map

Research date: 9 October 2026. The [free and premium parity ledger](parity-ledger.md) is the detailed capability record for the functional expansion; this page retains the initial public observation map. Target: [Enhancv public features page](https://enhancv.com/features/). This page was read without signing in. Public marketing claims are evidence of advertised capabilities, not proof of their internal implementation or effectiveness.

REA tooling and pinned source are recorded in [rea-provenance.md](rea-provenance.md). REA/browser discovery receipts are added by the coordinating research workflow. Nothing here claims access to proprietary source code.

| Capability | Observation from public source | ClearCV decision | Status / gap |
| --- | --- | --- | --- |
| CV content and styling | The page advertises customised structure, content and style. | Editable profile, experience, education and skills; original layouts and accent selection. | Implemented initial workflow. Templates are original; feature parity is not established. |
| CV templates | The public navigation links a resume-template collection. | Three independently designed A4 text templates. | Implemented; no proprietary template assets copied. |
| Feedback and tailoring | The page advertises AI tailoring, feedback and a resume checker. | Deterministic, local job-description token overlap with its method stated in the interface. | Exact word comparison and reviewable factual ordering are implemented. Optional configured AI produces reviewed candidates; semantic ATS testing and hiring predictions are not supplied. |
| Writing assistance | The page advertises generated objectives, headlines and bullet points. | Users edit their own content; optional configured AI can generate reviewed summaries, bullets and letter bodies. | Actual configured runtime and UI qualification need separate receipts; no target model or effectiveness claim is adopted. |
| Career tools | Public navigation and feature sections advertise job tracking, interview help and translation. | Local stages, notes, dates, tasks, archive/search, custom fields, immutable submitted CV/letter copies, CSV and explicit current-state analytics are integrated. Optional AI supplies selected-field translation and reviewed interview notes. | External boards, automatic reminder delivery, spreadsheet import, custom pipeline stages, full-document translation and company/voice interview services remain gaps. |

## Implementation inferences

The minimum useful independent CV builder needs stateful editing, a legible preview and an output path. ClearCV implements automatic browser-local saves, validated JSON backups and browser printing from that product decision. These are ClearCV decisions; this research page does not establish how Enhancv stores documents or exports them.

Entry controls use explicit move-up/move-down actions. Content is rendered as plain text. Each description line becomes a bullet. This provides an accessible, small dependency-free workflow and is not evidence about the target’s internal editor.

## Honest boundaries

- No authenticated Enhancv editor state, paid workflow, private account content or proprietary source was used to build this app.
- Marketing wording is paraphrased only to identify capability families. ClearCV’s UI, sample content, assets and layouts were written independently.
- Exact token overlap cannot assess suitability, factual accuracy, semantic similarity or how a particular applicant-tracking system will parse a CV.
- Linux and macOS support refers to a modern browser served by Node. Native desktop packaging is not shipped.
- Automated model checks validate state transitions and import rejection. Browser/PDF and OS qualification require their own receipts; a local unit-test pass does not establish those results.

The document-upgrade workflow now maps reviewed local PDF/Word/ODT/RTF/text/Markdown/HTML and OCR output into existing editable CV fields. It keeps the complete extracted source, supports independent new/merged copies, and provides local British English spelling and whitespace review. Exact format support and remaining layout/parser limits are documented in the [upgrade guide](../document-upgrades.md). This is independently implemented behaviour, not proof of target algorithm parity.
