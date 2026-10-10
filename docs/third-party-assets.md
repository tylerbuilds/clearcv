# Local document and spelling assets

ClearCV bundles the following open-source libraries and data at the versions listed below. They load from the same server as the app. Importing and spelling checks process document text and passwords in your browser, without sending them to a third-party service.

| Component | Version | Purpose | Licence |
|---|---|---|---|
| PDF.js | 6.4.299 | PDF text and page rendering | Apache-2.0 |
| Tesseract.js and its core | 7.0.0 | Local image text recognition | Apache-2.0 |
| @tesseract.js-data/eng | 1.0.0 | English recognition data | Apache-2.0 model; npm wrapper metadata declares MIT |
| Typo.js | 1.3.2 | Hunspell spelling checks and suggestions | BSD-3-Clause |
| dictionary-en-gb | 3.0.0 | British English spelling dictionary | MIT and BSD |

OCR and the spelling dictionary load when you use them. Compare recognised names, numbers and dates with the original, especially on poor scans. The dictionary may flag valid names and specialist terms, so check a suggestion before accepting it.

`scripts/prepare-assets.mjs` checks the installed versions and copies the files and licence notices into `public/vendor`. The production build includes them. Each library keeps its original notices; Typo.js's full upstream licence is also kept in `scripts/vendor-notices`.

The English model file matches `4.0.0/eng.traineddata.gz` in [naptha/tessdata at commit 806cd9a](https://github.com/naptha/tessdata/tree/806cd9adc8c6e8abc11c782db1818c990576bebc). The model directory includes its Apache-2.0 licence, attribution and file verification details. The npm wrapper's MIT metadata is recorded separately from the model's licence.

Primary sources: [PDF.js](https://github.com/mozilla/pdf.js), [Tesseract.js](https://github.com/naptha/tesseract.js), [local Tesseract configuration](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [Typo.js](https://github.com/cfinke/Typo.js), and [British English dictionary](https://github.com/wooorm/dictionaries/tree/main/dictionaries/en-GB).
