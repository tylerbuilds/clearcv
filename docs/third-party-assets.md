# Local document and spelling assets

ClearCV prepares these pinned open-source assets from its lockfile. The browser loads them from the app's own origin. Document contents, passwords and spelling text are not sent to a third-party service.

| Component | Version | Purpose | Licence |
|---|---|---|---|
| PDF.js | 6.4.299 | PDF text and page rendering | Apache-2.0 |
| Tesseract.js and its core | 7.0.0 | Local image text recognition | Apache-2.0 |
| @tesseract.js-data/eng | 1.0.0 | English recognition data | Apache-2.0 model; npm wrapper metadata declares MIT |
| Typo.js | 1.3.2 | Hunspell spelling checks and suggestions | BSD-3-Clause |
| dictionary-en-gb | 3.0.0 | British English spelling dictionary | MIT and BSD |

OCR and the spelling dictionary load when requested. OCR is not a guarantee of exact transcription: names, numbers, dates and low-quality scans need comparison with the original. The spelling dictionary can flag proper names and specialised vocabulary; corrections require review.

`scripts/prepare-assets.mjs` checks the installed versions and copies the runtime files and notices into `public/vendor`. The production build includes those assets. The original notices are retained alongside each library; Typo.js's full upstream licence is also retained in `scripts/vendor-notices`.

The English model bytes match `4.0.0/eng.traineddata.gz` in [naptha/tessdata at commit 806cd9a](https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc). Its Apache-2.0 licence, attribution and byte provenance ship in the model directory. The npm wrapper's MIT metadata is recorded separately from the model's licence.

Primary sources: [PDF.js](https://github.com/mozilla/pdf.js), [Tesseract.js](https://github.com/naptha/tesseract.js), [local Tesseract configuration](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [Typo.js](https://github.com/cfinke/Typo.js), and [British English dictionary](https://github.com/wooorm/dictionaries/tree/main/dictionaries/en-GB).
