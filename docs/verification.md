# Release checks

## 0.5.1 clearer wording

All **174 existing Node tests** and the build passed on Fedora with Node.js 24.14.0. Fresh Chrome checks covered starting a blank CV, editing, exports, reloads, importing text and reading the help. Separate checks deliberately damaged a saved library to test the recovery instructions and downloads. All **20 browser checks** passed.

The [desktop](screenshots/blank-start-0.5.1.png) and [phone](screenshots/blank-start-mobile-0.5.1.png) captures show the revised welcome screen. Earlier results below describe their own releases.

For Linux, macOS and publication status, open the [release workflow](https://github.com/tylerbuilds/clearcv/actions/workflows/verify.yml) and find the commit for your version. It runs the tests, build and browser checks on Ubuntu and macOS, then publishes to Pages after both platform jobs pass. The local Fedora results below don’t confirm a macOS run or the hosted version. ClearCV runs in a browser and has no native installer.

## 0.5 CV editing and saving

The 0.5 source passed **174 Node tests** on Fedora with Node.js 24.14.0 and **124 named Chromium checks**. The browser checks covered 20 first-use checks, nine checks that existing library content was kept, 59 storage and competing-tab checks, 12 panel and navigation checks, and 24 existing workflow checks. Three additional checks of the production build also passed; each combines several steps, rather than representing a separate workflow. These totals include routine rendering, error and source-stability checks. The source stayed fixed during each final pass. There were no uncaught browser errors, console errors, failed requests or external requests. This set of checks made no AI requests.

First-use checks started with an empty CV and master profile, with separate **Create blank CV**, **Import CV** and **Explore example** choices. New actions in the header and **Library** added blank CVs. The checks named a CV, entered contact and career details, chose a style, downloaded TXT, editable DOCX and document JSON, printed a Chromium PDF and reloaded the saved details. On a phone, **Preview → New** returned to a visible, focused name field. Checks with a populated library confirmed that adding blanks and examples, then backing up the workspace, kept every existing CV, snapshot, master profile, letter, job record and submitted copy. See [your first CV](first-cv.md).

Storage checks covered full storage, library limits, empty and corrupt saved recovery values, delayed imports, delayed image decoding and competing tabs. A tab with older data refused to overwrite a newer completed save and kept its open workspace for export. Reload checked the saved data before confirmation and again afterwards, without writing it. Two tabs saving at the same instant can still overwrite each other; the [storage guide](storage-safety.md) explains this limit. Separate tests deliberately changed saved data and confirmation responses. They checked cancelling reload, an unreadable save and another save while the confirmation was open. These tested the reload handlers separately from ordinary browser use.

A separate visual review opened **21 screenshots** of the tested version. It checked the warm paper editor, New actions and separate blank, import and example choices at desktop, tablet, 390px and 320px widths. It also checked labelled export menus, the phone preview and recovery controls with 44px targets. The [desktop](screenshots/blank-start-0.5.png) and [phone](screenshots/blank-start-mobile-0.5.png) welcome screenshots show empty fields without an automatically loaded example. The checks inspected headless Chromium PDF content. They didn't automate the operating-system print dialogue or native macOS clipboard, and don't certify full accessibility.

These results describe the 0.5 version. They don’t show that ClearCV matches every feature of a commercial product.

## 0.4 document imports and writing checks

The 0.4 version passed **163 Node tests** on Fedora with Node.js 24.14.0 and a separate **31-check Chromium pass**. Browser checks covered PDF, DOCX, supported Word 97 to 2003 DOC, ODT, RTF, TXT, Markdown and inert HTML imports. They also covered local image and mixed-page OCR, unlocking PDFs, source comparison, editable fields, creating new CVs, merging into separate copies, spelling suggestions and Undo. They confirmed that original CVs, job records and submitted copies stayed unchanged, and downloaded PDF, TXT and DOCX from the import preview before saving it.

Imports kept the complete extracted text, including document notices and possible alternative names for review. Text that couldn't be placed reliably stayed available for correction. The [upgrade guide](document-upgrades.md) lists the format and size limits. These checks cover those supported formats; they don't prove that every document will import correctly or that ClearCV matches proprietary algorithms.

Eight checks with synthetic example content covered desktop, tablet, 390px and 320px layouts, scrolling inside the import-preview dialogue, 44px action targets, and the source, field-mapping and writing screens. Visual review covered the warm paper editor and three original CV layouts. The [desktop](screenshots/document-upgrade-0.4.png) and [mobile](screenshots/document-upgrade-mobile-0.4.png) screenshots use synthetic content without a success overlay. File-drop events ran the app's real import handlers. Fedora checks didn't establish physical operating-system drag gestures or native macOS clipboard behaviour.

The [all-tier comparison](research/feature-comparison.md) records the older 0.3 inventory. The later import and writing tools don’t establish a complete match with a commercial product.

## 0.3 application tracking, AI and sharing

The 0.3.0 source was checked on Fedora with Node.js 24.14.0 and system Chrome. **85 Node tests**, **24 existing browser workflow checks** and **12 application-tracker browser checks** passed. File hashes tied the results to the recorded source. There were no uncaught page or console errors, or unrelated failed requests.

Tracker checks saved submitted CV and letter copies, then edited and deleted the source CVs to confirm the copies stayed unchanged. They covered read-only review, PDF, TXT, Word and JSON downloads, making editable library copies, tasks, due and completion filters, custom fields, archiving and restoring, literal search, CSV exports and weekly counts. After the current CV changed to Letter paper, Chromium still printed the captured letter as A4. A separate PDF inspection checked its page dimensions and saved content. The operating-system print dialogue wasn't automated.

Ten interface checks covered keyboard controls and desktop, tablet, 390px and 320px layouts. Separate sets of five keyboard, five resize and five mobile checks covered focus in the tracker, focus recovery when a filter hid a record, selected-tab visibility without changing page scroll or focus, labelled task controls and submitted-copy dialogues that fit both phone widths with 44px action targets. Screenshot review checked the warm paper design, readable text and control placement. Enlarging text in the test isn't the same as native browser zoom and doesn't certify full accessibility. The [desktop](screenshots/desktop.png) and [mobile](screenshots/mobile.png) screenshots use synthetic content.

AI writing passed ten separate integration checks, and persistent sharing passed eleven. Four explicit AI requests covered summary suggestions, tailoring, interview practice and cancellation. Exact file comparison confirmed that the AI code was unchanged; separate interface and workflow checks covered the final horizontal tab-resize change. Shared documents contained the selected CV and letter. Application records, submitted copies and workspace history weren't sent. The static demo supports local editing; AI and sharing require a configured Node server.

The release workflow also runs static-server checks on Ubuntu and macOS.

The [all-tier feature comparison](research/feature-comparison.md) records implemented features, gaps, primary sources and proof details with private data removed. Signed-in behaviour in the original product and matching proprietary algorithms remain unverified. These checks don't establish a complete match with every commercial feature.
