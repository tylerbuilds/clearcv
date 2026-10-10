# Write, design and apply

These workflows run locally without a subscription or AI provider. Start with **Create blank CV** or **New CV**; templates don't add example content.

## Format selected text

In Content or Letter, select words in a profile, description, custom section or letter body. Use **Bold**, **Italic**, **Underline** or **Add or edit a link** above the field. Ctrl/Cmd+B, I and U also work within supported fields. Enter a website or email address for a link, or use **Clear formatting and links** on the selected words.

Formatting is stored as ranges alongside plain text. It isn't imported HTML. Editing outside a formatted range keeps it; editing inside it clears the touched range so formatting doesn't drift onto unrelated words. Links reject unsafe protocols and addresses. JSON backups preserve the ranges, PDF uses the rendered text, and DOCX preserves the marks and links. TXT is plain text.

Imports into a copy deduplicate identical text, keeping the existing formatting where it differs. Text extraction doesn't reconstruct original styling.

## Arrange the paper

Design offers eleven original presets. Studio, Editorial, Concise, Folio and Ledger keep your type and spacing. Atlas adds a left sidebar; Letterpress a serif masthead; Signal an ink masthead; Outline a section-label gutter; Typewriter ruled monospace blocks; Margin a large name and editorial columns. These six apply their own type and spacing. All preserve your words, photo, colour and sections.

Adjust colour, columns, type, spacing, margins and paper afterwards. In two-column mode, place and order sections in either column. Hidden sections stay saved and out of exports. Local fonts may vary between devices. The six new presets start at 14–14.5 CSS pixels: 10.5–10.875 points on paper. Signal prints its masthead in ink on white without requiring background graphics.

Open **Headshot (optional)** in Content, or **Headshot** in Design. Add, replace or remove a PNG, JPEG or WebP photo. Uploads stay local and become 240-pixel squares. Limits are 5 MB, 16,384 pixels per edge and 40 megapixels, checked before and after decoding. Photos appear in the browser and PDF; leaving one out reserves no empty space.

Choose **Preview pages** to arrange the current CV or letter into sheets, keeping blocks together where they fit and continuing long text. The limit is 100 pages. Choose **Print / Save as PDF**, match the paper size, turn off browser headers and footers, and check the final print preview. Browser settings can affect the result. Manual page breaks aren't available.

Word export keeps editable text, body formatting, links, font choices and some page settings. Its sections remain in a linear order. It doesn't reproduce the browser's two-column layout, template geometry or photo, and its spacing can differ in Word. TXT keeps visible text in section order.

## Prepare a copy for a job

Save your fuller career history as the master in Library. In Match, paste the complete job description, choose **Current CV** or **Master CV from Library**, add the company and role, then choose **Prepare a draft**.

The local draft ranks existing experience, education, description lines and skills using exact matching words, without inventing facts or AI rewriting. Review the headline, summary, entries, skills and letter; omit entries, edit and preview before choosing **Create reviewed copy**. The original stays in Library. If it or the master changes while the draft is open, prepare a fresh draft.

Requirement checks show matching and missing words with visible CV excerpts. Word matches don't establish qualifications or eligibility; years of experience are prompts to check yourself. These aren't validated ATS tests or hiring scores. Hidden facts stay out of checks and generated letters.

## Keep the next step with each job

In Jobs, paste an advertisement and optional URL, then choose **Find job details**. Review the details before adding it. Extraction runs locally; URLs are saved links, not fetched pages. LinkedIn extraction and a capture extension aren't supplied.

Use Board to see stages together. Drag a job to another stage, or use its **Move** selector with the keyboard. List opens the detailed records. The six stages are fixed; dragging changes the stage rather than the order within it.

Link the CV you plan to send and use the job's matching action to open its description with that CV. Preparing a reviewed copy is a separate step. Add a task or follow-up date: **Next steps due** shows up to eight due or overdue items while Jobs is open. Completed tasks and archived jobs are excluded. There are no scheduled emails, desktop alerts or background reminders.

Before sending an application yourself, use **Save submitted CV + letter copy**. This captures the selected version for your records; it doesn't send the application or verify receipt. Later edits to the source CV don't change the saved copy.

## Reuse letters and back up

In Letter, enter a name and choose **Save this letter**. Keep up to 20 reusable letters independently of your CVs. Using one replaces the current letter after confirmation, preserving the profile and layout. Edit company and role before exporting. Deleting a reusable letter leaves copies in CVs intact.

The library holds up to 100 CVs within the existing 4 MB workspace limit. Photos, long descriptions, letters and snapshots all count towards that byte limit. A count allowance doesn't guarantee that every possible library fits. Quota or save errors leave the open changes available for export.

Workspace backups include reusable letters, CVs, range formatting, placements, master history, snapshots, applications and submitted copies. Older version 1 exports still import with default columns and empty formatting. These optional fields extend the version 1 format: an older ClearCV release may reject a newer export, so keep an original backup when moving between releases. Storage keys, recovery copies and conflict warnings remain in place; local storage doesn't provide account sync or automatic merging between tabs.

AI suggestions and shared editing remain optional services configured on your own Node server. The static demo doesn't provide hosted AI, account storage or cross-device sync. See [self-hosting](self-hosting.md) and [storage safety](storage-safety.md).
