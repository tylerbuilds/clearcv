# Write, design and apply

ClearCV keeps these workflows on your device. They don't require a subscription or an AI provider. Start with **Create blank CV** or **New CV**; a template changes its appearance without adding example content.

## Format selected text

In Content or Letter, select words in a profile, description, custom section or letter body. Use **Bold**, **Italic**, **Underline** or **Add or edit a link** above the field. Ctrl/Cmd+B, I and U also work within supported fields. Enter a website or email address for a link, or use **Clear formatting and links** on the selected words.

Formatting is stored as ranges alongside plain text. It isn't imported HTML. Editing outside a formatted range keeps it; editing inside it clears the touched range so formatting doesn't drift onto unrelated words. Links reject unsafe protocols and addresses. JSON backups preserve the ranges, PDF uses the rendered text, and DOCX preserves the marks and links. TXT is plain text.

When importing into a copy, identical text entries are deduplicated. If their text matches but their formatting differs, ClearCV keeps the existing entry's formatting. Text extraction from other file formats doesn't reconstruct their original styling.

## Arrange the paper

Design offers five original presets: Studio, Editorial, Concise, Folio and Ledger. You can still choose your own colour, one or two columns, column proportions, font size, spacing, margins and A4 or Letter paper. Each section has a placement selector when two columns are enabled. Ordering applies within each column; hidden sections remain saved and don't appear in the exported text.

Six font families use fonts available on the device, without downloading font files. A particular face may vary between devices. The optional profile photo appears in the browser view and PDF. Portrait uploads can be at most 5 MB, 16,384 pixels on either edge and 40 megapixels. Recognised image headers are checked before decoding; the decoded dimensions are checked again before cropping. Imported CV photos use the same declared-dimension limits.

Choose **Preview pages** from the preview toolbar or Design. It arranges the current CV or letter into sheets at the selected paper size, keeping blocks together where they fit and continuing long text on another page. The view is capped at 100 pages. Choose **Print / Save as PDF**, match the paper size, turn off browser headers and footers, and inspect the final print preview. Browser print settings can still affect the result. There is no manual page-break editor.

Word export keeps editable text, body formatting, links, font choices and some page settings. Its sections remain in a linear order. It doesn't reproduce the browser's two-column layout, template geometry or photo, and its spacing can differ in Word. TXT keeps visible text in section order.

## Prepare a copy for a job

Save your fuller career history as the master in Library. In Match, paste the complete job description, choose **Current CV** or **Master CV from Library**, add the company and role, then choose **Prepare a draft**.

The local draft ranks existing experience, education, description lines and skills using exact matching words. It doesn't invent career facts or rewrite them with AI. Review the headline, summary, entries, skills and letter. Omit irrelevant entries, edit the text, preview it, and choose **Create reviewed copy**. Your original CV remains in the library. If its content or the master changes while the draft is open, prepare a fresh draft before saving it.

Requirement checks show words found and missing for each recognised requirement, plus excerpts from visible CV text. A word match doesn't prove that you have a qualification or meet an experience requirement. Years of experience are prompts for you to check, not calculated eligibility. The checks aren't a validated ATS test or hiring score. Hidden facts stay out of these checks and the generated letter.

## Keep the next step with each job

In Jobs, paste an advertisement and optionally its URL, then choose **Find job details**. Check the company, role, location, salary and description before adding it. Extraction uses pasted text locally; the URL is saved as a link and isn't fetched. LinkedIn extraction and a browser capture extension aren't supplied.

Use Board to see stages together. Drag a job to another stage, or use its **Move** selector with the keyboard. List opens the detailed records. The six stages are fixed; dragging changes the stage rather than the order within it.

Link the CV you plan to send and use the job's matching action to open its description with that CV. Preparing a reviewed copy is a separate step. Add a task or follow-up date: **Next steps due** shows up to eight due or overdue items while Jobs is open. Completed tasks and archived jobs are excluded. There are no scheduled emails, desktop alerts or background reminders.

Before sending an application yourself, use **Save submitted CV + letter copy**. This captures the selected version for your records; it doesn't send the application or verify receipt. Later edits to the source CV don't change the saved copy.

## Reuse letters and back up

In Letter, enter a name and choose **Save this letter**. You can keep up to 20 reusable letters independently of the current CV. Using one replaces that CV's letter after confirmation, while preserving its profile and layout. Edit the company and role before exporting. Deleting a saved letter doesn't delete the letter already in a CV.

The library holds up to 100 CVs within the existing 4 MB workspace limit. Photos, long descriptions, letters and snapshots all count towards that byte limit. A count allowance doesn't guarantee that every possible library fits. Quota or save errors leave the open changes available for export.

Workspace backups include reusable letters, CVs, range formatting, placements, master history, snapshots, applications and submitted copies. Older version 1 exports still import with default columns and empty formatting. These optional fields extend the version 1 format: an older ClearCV release may reject a newer export, so keep an original backup when moving between releases. Storage keys, recovery copies and conflict warnings remain in place; local storage doesn't provide account sync or automatic merging between tabs.

AI suggestions and shared editing remain optional services configured on your own Node server. The static demo doesn't provide hosted AI, account storage or cross-device sync. See [self-hosting](self-hosting.md) and [storage safety](storage-safety.md).
