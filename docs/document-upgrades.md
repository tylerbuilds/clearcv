# Improve an existing CV

Choose **Improve an existing CV** in Content, or open Library. Choose a document, drop it on the intake area, or paste the text of your CV. Extraction and recognition run locally with bundled assets; importing does not send your document to an AI provider.

Review the source and the proposed name, contact details, profile, experience, education, skills and other sections. You can edit, add, remove and move mapped entries. Uncertain text remains visible for review; the complete extracted text is retained in hidden source sections. This is the extracted text, not a copy of the original binary file. Keep the original document for comparison.

Document notices and page labels remain in uncertain text rather than becoming your name or title. An explicitly labelled name takes priority. If several unlabelled lines look like competing identities, the proposed name stays blank with a warning; compare the source and enter the correct identity. These rules support mononyms, Unicode names and name particles, but every proposal still needs your review.

**Preview the reviewed CV** opens the actual paper layout and can export its PDF, TXT or DOCX before saving it. Choose an original ClearCV template and accent for a new CV. For an upgraded copy, the selected existing CV’s style, cover letter and job description are retained; Design changes them afterwards.

**Create reviewed CV** adds a separate CV. **Upgrade a separate copy** lets you choose which profile fields to use and whether to append, replace or keep career lists. Only entries whose non-ID fields match exactly are considered duplicates; case and line breaks remain significant. Imported custom sections and source text are retained. The original CV, its snapshots, master, jobs and submitted attachments stay unchanged. A document or library limit leaves the review draft intact. If browser storage fails, the new CV remains editable in memory and a warning asks you to export a workspace backup before closing.

## Supported intake

| Format | Useful content | Limits and caveats |
| --- | --- | --- |
| PDF | Selectable text, mixed text/scan pages and scanned pages; password unlock | Up to 10 MB / 20 pages. Local English OCR reads image-only and image-heavy pages with little selectable text. Use **Read every PDF page visually with OCR** if facts inside images or a complex layout were missed. OCR can misread names, dates and numbers. |
| PNG, JPEG, WebP, BMP | Printed text through explicit local English OCR | Up to 10 MB and 32 megapixels; recognition images are reduced to at most 4 megapixels. Handwriting, poor scans, columns and non-English text may be inaccurate. |
| Word DOCX | Main text, referenced headers, footers, footnotes, endnotes and supported visible textboxes | Up to 2 MB. Unreferenced stale parts are excluded. Formatting and photos are not copied. Extracted parts have a documented reading order; check columns and repeated headers. Hyperlink targets are retained as inert text where meaningful. Macros, external relationships and objects never execute or load. |
| Word97–2003 DOC | Readable main-body text from supported compound Word files | Up to 2 MB. Encrypted files, pre-97 variants and non-body stories are outside the supported parser; hidden/deleted revisions and formatting are not resolved. Save these as DOCX, ODT or PDF and compare the result with the original to retain other facts. |
| ODT | Paragraphs, lists and table-cell text | Up to 2 MB. Encrypted packages reject. Layout, drawings and images are not imported. |
| RTF | Text, Unicode, supported code pages and readable headers/footers/notes | Up to 2 MB. Images, embedded objects and active destinations are skipped; malformed groups and unsupported encodings reject. |
| TXT, Markdown | UTF-8 / supported UTF-16 text | Up to 2 MB. Markdown remains readable text for section mapping; it is not rendered as executable HTML. |
| HTML | Inert readable text and meaningful safe hyperlink targets | Up to 2 MB. Scripts, styles, embedded resources and active content are discarded and never fetched. |
| ClearCV JSON | Validated document or workspace backup | Existing 1 MB document / 4 MB workspace limits. Workspace backups merge with fresh identities; existing library and master data are kept. |

Extracted text is limited to 50,000 characters. Source chunks are at most 30,000 characters and are hidden from visible exports. Existing document limits still apply: 60 entries per career list, 20 custom sections, 1 MB per CV, 25 library CVs and 4 MB per workspace. Oversized or ambiguous fields stay in retained source with warnings instead of invented or silently truncated facts. Recognition has a two-minute timeout and a Cancel control; new files or source edits invalidate older unfinished results. A password is used in memory only and is not saved in CVs, backups or browser storage.

Unsupported formats such as spreadsheet, presentation, Pages, EPUB, TIFF and encrypted office files require conversion to a supported format. This intake is deliberately broader than raw-text paste, but it does not claim that every document format or layout can be interpreted faithfully.

## Spelling and cleanup

Open Review for the bundled British English Hunspell check. Check all visible CV writing, the cover letter or one selected field. Visible headings are included. Contacts, dates, hidden source and the pasted job advertisement are excluded. Review a suggested replacement, type your own correction, or accept a valid name or specialist term for the current session. Nothing changes automatically.

The worker checks at most 50,000 characters / 4,000 eligible words, reports the first occurrence of at most 60 distinct unknown words, and skips words longer than 40 characters. Up to ten distinct unknown words receive automatic suggestions. A 30-second timeout or cancellation terminates the worker. Accepted words are session-only, limited to 500, and are not part of CV exports. Browser spelling hints are also enabled where the browser supports them.

Whitespace cleanup previews repeated-space and excess-blank-line changes. It keeps all non-whitespace characters identical. Apply each change explicitly. Undo restores the last writing change while the document is otherwise unchanged; it refuses to overwrite newer edits. Save a named library snapshot for a lasting checkpoint.

## Implementation sources and remaining limits

Local recognition uses [Tesseract.js](https://github.com/naptha/tesseract.js) and the pinned English model. Spellchecking uses [Typo.js](https://github.com/cfinke/Typo.js) with the [British English Hunspell dictionary](https://github.com/wooorm/dictionaries). Their licences and bundled notices ship with the assets. PDF extraction/rendering uses [Mozilla PDF.js](https://github.com/mozilla/pdf.js).

The original ODT and RTF readers follow the [OASIS package specification](https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/OpenDocument-v1.3-os-part2-packages.html), [ODT schema](https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part3-schema/OpenDocument-v1.3-os-part3-schema.html) and [Microsoft RTF syntax](https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140284(v=office.10)). Extraction and section mapping are independent implementations. They do not recover proprietary parsers or guarantee an employer’s ATS interpretation.

Photos, exact source typography, complex tables/columns, diagrams and arbitrary embedded objects are not reconstructed. Imported dates and career blocks still require human review. Dictionary checking does not validate grammar, factual claims or employment history. ClearCV retains its three original templates, layout controls and editable local exports; it does not claim the target product’s complete style catalogue or algorithm parity.
