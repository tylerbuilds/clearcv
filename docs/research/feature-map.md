# Public feature map

Research date: 9 October 2026. This page records the first observations of the [Enhancv public features page](https://enhancv.com/features/), read without signing in. For the wider comparison, see the [free and premium feature ledger](parity-ledger.md). Public descriptions show what a product advertises; they don't prove how it works or how effective it is.

The [REA investigation record](rea-provenance.md) lists the tool version, source revision and browser records. This research didn't access proprietary source code.

| Capability | Observation from public source | ClearCV decision | Status / gap |
| --- | --- | --- | --- |
| CV content and styling | The page advertises customised structure, content and style. | Editable profile, experience, education and skills; original layouts and accent selection. | Implemented initial workflow. Templates are original; feature parity is not established. |
| CV templates | The public navigation links a resume-template collection. | Three independently designed A4 text templates. | Implemented; no proprietary template assets copied. |
| Feedback and tailoring | The page advertises AI tailoring, feedback and a resume checker. | Deterministic, local job-description token overlap with its method stated in the interface. | Exact word comparison and reviewable factual ordering are implemented. Optional configured AI produces reviewed candidates; semantic ATS testing and hiring predictions are not supplied. |
| Writing assistance | The page advertises generated objectives, headlines and bullet points. | Users edit their own content; optional configured AI can generate reviewed summaries, bullets and letter bodies. | Actual configured runtime and UI qualification need separate receipts; no target model or effectiveness claim is adopted. |
| Career tools | Public navigation and feature sections advertise job tracking, interview help and translation. | Local stages, notes, dates, tasks, archive/search, custom fields, immutable submitted CV/letter copies, CSV and explicit current-state analytics are integrated. Optional AI supplies selected-field translation and reviewed interview notes. | External boards, automatic reminder delivery, spreadsheet import, custom pipeline stages, full-document translation and company/voice interview services remain gaps. |

## ClearCV's design choices

ClearCV lets you edit a CV, check a preview and export it. It saves in the browser, validates JSON backups and uses browser printing. These are ClearCV's design choices. This research doesn't establish how Enhancv stores or exports documents.

Entries have move-up and move-down controls. Content is shown as plain text, with each description line becoming a bullet. These choices keep the editor small and provide keyboard-accessible ordering; they don't describe Enhancv's internal editor.

## What this research can establish

- The app was built without signed-in Enhancv editor access, paid workflows, private account content or proprietary source.
- Product descriptions identify the features being compared. ClearCV's interface, examples, assets and layouts were written independently.
- Exact word matching can't assess suitability, facts, meaning or how an applicant-tracking system will read a CV.
- Linux and macOS support means running the app in a modern browser with a Node server. There is no native installer.
- Model tests check data changes and invalid imports. Browser, PDF and operating-system behaviour need separate checks.

Document imports now suggest editable CV fields from PDF, Word, ODT, RTF, text, Markdown, HTML and local OCR. You can check the extracted text, create a new CV or merge into a separate copy, then review British English spelling and spacing. The complete extracted text is retained. See the [upgrade guide](../document-upgrades.md) for formats and limits. This feature was written independently and doesn't establish matching algorithms in the other product.
