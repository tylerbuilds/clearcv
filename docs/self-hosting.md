# Run ClearCV with AI or shared CVs

Run `npm ci`, then `npm start` to use ClearCV's Node server. CV editing, PDF and Word imports, OCR and spelling work locally. AI and sharing need server configuration; they aren't available on the public GitHub Pages demo.

## Enable shared CVs

Choose a private data directory outside the repository and static build:

```sh
npm start -- --data-dir /absolute/private/clearcv-data
```

When you create or save a shared CV, the server receives the full editable selected CV. That includes hidden sections, its cover letter and the pasted job description. Your master profile, other CVs and application tracker stay local.

Owner, editor and viewer links have separate access tokens in their URL fragments. Anyone holding a link can use the access it grants. Keep the owner link private and save the links yourself: CV and workspace backups don't include the tokens. Revoking and re-enabling a role creates a new link token.

Comments and history survive a graceful server restart. If someone else saves a new revision before you do, resolve the conflict before saving again. Your local edits stay open.

The server listens on `127.0.0.1` by default. To make it available remotely, use an HTTPS reverse proxy, set `--public-origin https://your-app.example` and add an access layer you manage. The links grant access to documents; ClearCV doesn't provide OAuth accounts, team identities, enterprise SSO or billing.

Back up the private data directory separately from the app. Its lock stops two servers opening the same data. After a crash, check that the recorded process has ended before removing the lock.

## Connect an AI model

ClearCV supports an OpenAI-compatible chat-completions provider. Install or choose a provider, then keep its credentials in your native environment or a private environment file outside the repository:

```sh
npm start -- --ai-env-file /absolute/private/ai.env \
  --ai-base-url http://127.0.0.1:8000/v1 --ai-model your-local-model \
  --data-dir /absolute/private/clearcv-data
```

The environment file can use `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`. The server also accepts existing `FEDORA_VLLM_API_KEY` or `VLLM_API_KEY` keys. Remote providers require HTTPS. Provider keys stay on the server and never enter the browser.

The writing panel shows the source text and context before you choose **Generate suggestion**. Only that content is sent to the provider. Review the suggestion and choose **Use this text** if you want to keep it. Writing and translation quality depend on the model, and the provider's data handling applies.

**Cancel** stops the browser request; disconnecting also stops the upstream provider request. The server sets a timeout. A provider error leaves your CV unchanged.

The server connection was checked with a local model during development, but installing ClearCV doesn't install or configure a model for you. Commercial provider charges, image generation, external job feeds and enterprise services aren't included.

## Check import and export limits

PDF reading uses the locally bundled PDF.js 6.4.299 library. It accepts files up to 10 MB and 20 pages, reads selectable text and uses local English OCR for scanned or image-heavy pages. Supported images can also be read with OCR when requested. Check the extracted text before creating the CV. Text is limited to 50,000 characters, and the original typography and layout aren't recreated.

Word exports contain editable text, visible sections and layout settings. They don't exactly match the browser template or include photos. See [document upgrades](document-upgrades.md) for formats and limits.

`npm run build` includes PDF.js's Apache-2.0 licence and matching local worker. ClearCV's original source is MIT-licensed. The [third-party assets guide](third-party-assets.md) lists the OCR and dictionary licences.
