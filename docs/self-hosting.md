# Optional AI and shared CVs

Install the pinned dependencies with `npm ci`, then run `npm start`. PDF and Word text imports run locally. The public GitHub Pages demo supports local CV workflows; AI and shared documents require the Node server.

To enable real sharing, choose a private data directory outside the repository and static build:

```sh
npm start -- --data-dir /absolute/private/clearcv-data
```

Sharing uploads the full editable selected CV, including hidden sections, its cover letter and the pasted job description, when you click Create or Save. It does not upload your master profile, other CVs or application tracker. Owner, editor and viewer links contain separate access tokens in their URL fragments. Preserve those links yourself; tokens are excluded from CV/workspace backups. Revoking and re-enabling a role creates a new token. Comments and history survive a graceful server restart. Concurrent updates require explicit conflict resolution; local edits are retained.

The service binds to `127.0.0.1` by default. For a deliberate remote deployment, use an HTTPS reverse proxy, an explicit `--public-origin https://your-app.example`, and an operator-managed access layer. Capability links grant document access; the app does not provide OAuth accounts, team identities, enterprise SSO or billing. Store and back up the private data directory separately. The single-writer lock prevents two servers opening the same data. After a crash, confirm the recorded process has ended before removing its lock.

AI uses an OpenAI-compatible chat-completions provider selected by the operator. Keep credentials in your native environment or a private environment file outside the repository:

```sh
npm start -- --ai-env-file /absolute/private/ai.env \
  --ai-base-url http://127.0.0.1:8000/v1 --ai-model your-local-model \
  --data-dir /absolute/private/clearcv-data
```

Supported file/environment keys are `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`. Existing native `FEDORA_VLLM_API_KEY` or `VLLM_API_KEY` keys are also accepted by the bridge. Remote providers require HTTPS. No provider key enters the browser. Only the source/context shown in the writing panel is sent when Generate is clicked; the result remains a review candidate until you Apply it. Translation and writing quality depend on the chosen model. Cancel aborts the client request and disconnecting aborts the upstream provider request; requests also have a server timeout. Your document does not change after an upstream error.

The shipped bridge was exercised against a real local model during development. A static demo has no AI provider, and installing this repository does not provision one. Commercial provider charges, image generation, external job feeds and enterprise services are not included.

PDF.js 6.4.299 is Apache-2.0 licensed. `npm run build` copies its licence and matching local worker into the deployment; ClearCV's original source remains MIT. PDF intake accepts up to 10 MB and 20 pages, reading selectable text and using bundled local English OCR for scanned or image-heavy pages. Supported images can also be recognised locally on request. Extracted text is limited to 50,000 characters and needs review before creating a CV; source typography and layout are not reconstructed. See [document upgrades](document-upgrades.md) for supported formats and limits, and [third-party assets](third-party-assets.md) for recognition and dictionary licences. Word exports contain editable text and visible sections, rather than an exact copy of the browser template; photos are not embedded in Word files.
