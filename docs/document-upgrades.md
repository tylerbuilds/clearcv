# Improve an existing CV

Choose **Improve an existing CV** in **Content**, or open **Library**. Upload a document, drop it on the import area or paste your CV text. ClearCV reads it on your device, including local English OCR for scans and images. Importing doesn't send your document to an AI provider.

## Check the imported details

Compare the extracted text with the original document, then check your name, contact details, profile, experience, education, skills and other sections. You can edit, add, remove and move the suggested entries.

Pay particular attention to names, dates, numbers and text from columns or images. If several lines could be your name, ClearCV leaves the name field blank and asks you to check it. An explicitly labelled name takes priority. Uncertain or oversized text stays in the source with a warning so you can find it and decide where it belongs.

The complete extracted text is kept in hidden source sections. It won't appear in the visible CV exports, but it remains in the editable CV and JSON backups. Keep the original file: extracted text doesn't preserve its photos, formatting or binary contents.

## Preview and save a copy

Choose **Preview this CV** to check the paper layout. You can export PDF, TXT or DOCX from this preview before saving.

- **Create CV** adds a new CV with the template and colour you've selected.
- Choose **Update a copy of an existing CV** to use a CV from your library as the starting point. Choose which profile fields to use and whether to add, replace or keep entries in each section, then select **Create updated copy**. The copy keeps that CV's style, cover letter and job description. You can change its style afterwards in **Design**.

Your original CV, snapshots, master profile, jobs and submitted copies stay in place. Imported custom sections and source text are kept. Only entries that match exactly, apart from their IDs, count as duplicates. Differences in case or line breaks make them separate entries.

If the CV or library is too large, the review draft stays open so you can make changes. If browser storage fails after creation, the new CV stays editable in the tab. Export a workspace backup before closing it.

## Choose a supported file

| Format | What ClearCV reads | What to check |
| --- | --- | --- |
| PDF | Selectable text, scans and mixed text/image pages. Password-protected files can be unlocked. Up to 10 MB and 20 pages. | English OCR runs on scanned or image-heavy pages with little text. Choose **Read all pages as images** if image text or a complex layout was missed. Check names, dates and numbers. |
| PNG, JPEG, WebP, BMP | Printed text through local English OCR. Up to 10 MB and 32 megapixels; images are reduced to at most 4 megapixels for recognition. | Handwriting, poor scans, columns and non-English text may read incorrectly. |
| Word DOCX | Main text and referenced headers, footers, notes and supported text boxes. Up to 2 MB. | Check reading order, columns and repeated headers. Photos and formatting aren't copied. Unused old document parts are excluded. |
| Word 97 to 2003 DOC | Main-body text from supported compound Word files. Up to 2 MB. | Encrypted and pre-97 files aren't supported. Headers, notes, tracked changes and formatting may be missing or unclear. Save as DOCX, ODT or PDF and compare with the original if needed. |
| ODT | Paragraphs, lists and table-cell text. Up to 2 MB. | Encrypted files aren't supported. Layout, drawings and images aren't copied. |
| RTF | Text, Unicode and supported encodings, including readable headers, footers and notes. Up to 2 MB. | Images and embedded objects are skipped. Invalid files and unsupported encodings are rejected. |
| TXT, Markdown | UTF-8 and supported UTF-16 text. Up to 2 MB. | Markdown is read as text. Check that headings and sections are in the right place. |
| HTML | Readable text and useful safe link addresses. Up to 2 MB. | Scripts, styles, embedded resources and other active content are removed. They aren't run or fetched. |
| ClearCV JSON | A validated document or workspace backup. Up to 1 MB per document or 4 MB per workspace. | Workspace imports add CVs with new IDs and keep the existing library and master profile. |

Convert spreadsheets, presentations, Pages, EPUB, TIFF and encrypted Office files to a supported format first. Imports don't recreate photos, exact typography, complex tables, columns, diagrams or embedded objects. Check the result against the original before using it.

Extracted text can contain up to 50,000 characters. Hidden source sections hold up to 30,000 characters each. A CV can have 60 entries per career list and 20 custom sections, within its 1 MB limit. The library can hold 100 CVs within 4 MB. See [consumer workflows](consumer-workflows.md) for formatting, job drafts and the current library limits; older research comparisons retain their dated counts.

OCR stops after two minutes, and you can choose **Cancel import** while it runs. Choosing another file or editing the source cancels the older result. PDF passwords are used only while the file is open; they aren't saved in CVs, backups or browser storage. Imported links are kept as text where useful. Macros, external resources and embedded objects aren't opened.

## Check spelling and tidy spacing

Open **Review** for British English spelling suggestions. Check the visible CV text, the cover letter or one selected field. Headings are included; contact details, dates, hidden source text and the pasted job advertisement aren't checked.

Choose a suggestion, enter your own correction or accept a valid name or specialist term for this session. Nothing changes until you apply it. Accepted words aren't saved in your CV or exports. Browser spelling hints are also available where supported.

For long text, the check covers up to 50,000 characters and 4,000 eligible words. It lists up to 60 different unknown words and suggests replacements for up to ten. Words longer than 40 characters are skipped. You can accept up to 500 words per session. A check stops after 30 seconds or when cancelled.

Spacing cleanup previews repeated spaces and excess blank lines without changing the words or punctuation. Apply the changes you want. **Undo** restores the last writing change if you haven't made newer edits. Save a named snapshot in **Library** to keep a version for later.

Spelling checks don't verify grammar, facts or employment history. Importing also can't tell you how an employer's ATS will read the CV.

## Technical sources

Local OCR uses [Tesseract.js](https://github.com/naptha/tesseract.js) and its pinned English model. Spelling checks use [Typo.js](https://github.com/cfinke/Typo.js) and the [British English Hunspell dictionary](https://github.com/wooorm/dictionaries). PDF reading uses [Mozilla PDF.js](https://github.com/mozilla/pdf.js). Licences and notices are bundled with the assets.

The ODT and RTF readers are independently written using the [OASIS package specification](https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part2-packages/OpenDocument-v1.3-os-part2-packages.html), [ODT schema](https://docs.oasis-open.org/office/OpenDocument/v1.3/os/part3-schema/OpenDocument-v1.3-os-part3-schema.html) and [Microsoft RTF syntax](https://learn.microsoft.com/en-us/previous-versions/office/developer/office2000/aa140284(v=office.10)). The [research ledger](research/parity-ledger.md) records the comparison with other CV-building tools, including gaps and unknowns.
