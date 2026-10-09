# ClearCV

![Original application screenshot](docs/screenshots/desktop.png)

[Try the live demo](https://tylerbuilds.github.io/clearcv/) · [Linux/macOS checks](https://github.com/tylerbuilds/clearcv/actions/workflows/verify.yml)

A calm, local-first CV workspace. Write your story, choose an original layout, compare job keywords and save a PDF — without an account, subscription or external service.

ClearCV is an independently written open-source implementation of publicly observable CV-building behaviours. It is not affiliated with Enhancv and does not contain its code, branding, templates or private data. This is an initial working release, not a complete reproduction of that product.

## Run on Linux or macOS

Install Node.js **22.19 or newer** (Node 24.11+ is also supported), then run:

```sh
git clone https://github.com/tylerbuilds/clearcv.git
cd clearcv
npm start
```

Open **http://localhost:4201** in a recent browser. There are no runtime dependencies and no install step is needed. The development server binds to localhost by default.

```sh
npm test            # Model and import validation checks
npm run build       # Produces the static site in dist/
npm run preview     # Serves the production build on port 4201
```

This is a browser application for Linux and macOS, not a native desktop package. Windows should work with the same commands but is not part of the initial qualification target.

## What works

- Editable name, professional title, contact details and summary with a live preview.
- Experience, education and skills: add, edit, remove and move entries up or down.
- Three original A4 templates: Studio, Editorial and Concise, with five accent colours.
- Automatic saves in the current browser, plus versioned JSON import and export.
- Browser printing and **Save as PDF**, including flowing long CVs over multiple pages.
- A transparent job-description keyword comparison. It selects up to 24 frequent words, filters common words and compares exact tokens against your CV. **It is not an ATS score, an AI assessment or a hiring prediction.**

To export a PDF, choose **Save as PDF**, select the browser’s PDF destination, use A4 paper and disable browser headers and footers. Check the preview before saving; pagination varies between browsers. All contact values remain plain text.

## Your data

CVs and pasted job descriptions stay in this browser’s `localStorage`. ClearCV contains no analytics, telemetry, remote APIs or account system. Anyone with access to the same browser profile may be able to read your saved CV. Private browsing and storage restrictions can prevent saves; the app reports this and keeps the current edits open for JSON export.

A JSON backup includes the full CV **and the pasted job description**. Keep it somewhere you trust. Imports must use the ClearCV version 1 schema and stay below 1 MB. Unknown fields, invalid templates, duplicate IDs and malformed values are rejected without replacing your current CV. Starting a blank CV or loading the example asks before replacing saved work.

## Research and scope

[Feature map](docs/research/feature-map.md) distinguishes source observations, implementation decisions and gaps. [REA provenance](docs/research/rea-provenance.md) records the pinned reverse-engineering tool used for public discovery. Browser captures and verification receipts are recorded separately by the coordinating workflow.

Current limits: one CV per browser profile, no PDF/DOCX import, no AI rewriting, semantic job matching, collaboration, application tracking, cloud synchronisation or native installers. Layouts are original and prioritise clear text and printable output.

Next: accessible section ordering, multiple local CVs, cover letters, stronger browser print qualification and optional desktop packaging. These are plans, not shipped capabilities.

## Contribute

The app uses standard browser modules with no runtime dependencies. Keep pure state operations in `src/model.js` and user interface code in `src/app.js`. Render user content as text, validate imported data before storing it, and retain the local-first/no-external-calls contract. Use British English and original layouts, copy and assets.

Run `npm test` and `npm run build` before submitting a pull request. See [AGENTS.md](AGENTS.md) for repository-specific constraints.

MIT licensed. See [LICENSE](LICENSE).

## Browser verification

The runtime has no package dependencies. To run the development browser checks, install the pinned tools and Chromium:

```sh
npm ci
npx playwright install chromium
npm run build
npm run test:browser
```

Linux runners may need `npx playwright install --with-deps chromium` for browser system libraries. `BROWSER_EXECUTABLE=/path/to/chrome npm run test:browser` uses an existing browser. The GitHub workflow runs model tests, a static build and real browser edit/persistence/export checks on both Ubuntu and macOS, then publishes the static demo only after both pass.

[REA investigation provenance](docs/research/rea-provenance.md) records public observations, receipt digests and explicit research limits.
