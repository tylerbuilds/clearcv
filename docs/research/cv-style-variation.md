# CV style variation

Checked 10 October 2026. These are independently designed ClearCV compositions, informed by public guidance. No template artwork, proprietary styling or source was copied. The source review describes layout contracts; it does not replace browser and print checks.

[Enhancv’s modern gallery](https://enhancv.com/resume-templates/modern/) documents one or two columns and left or right sidebars. Its [simple](https://enhancv.com/resume-templates/simple/) and [creative](https://enhancv.com/resume-templates/creative/) galleries contrast restrained presentation with expressive headers and accents. The [new-editor guide](https://help.enhancv.com/en/articles/14432262-how-to-add-a-new-section-to-your-resume-in-the-new-editor-toolbox-on-top), dated 7 April 2026, distinguishes Templates from Design & Font. These observations support meaningful composition choices; they establish neither ClearCV feature parity nor paid-plan entitlement.

ClearCV should vary name hierarchy, alignment, type, section rhythm and column placement. Changing only accent colour produces little useful choice. The current contract lists eleven presets and six system-font families in [layout.js](../../src/layout.js#L1). Recommended distinctions are:

| Preset | Composition to preserve |
| --- | --- |
| Studio | Open left masthead, neutral sans, clear single column. |
| Editorial | Centred serif header and measured horizontal rules. |
| Concise | Tighter section rhythm and a slim vertical accent. |
| Folio | Serif headings and two columns for projects and supporting detail. |
| Ledger | Quiet right sidebar with a broad experience column. |
| Atlas | Left sidebar, humanist type and compact supporting information. |
| Letterpress | Spacious serif masthead, generous gaps and restrained ornament. |
| Signal | Strong ink masthead with readable, plain body text. |
| Outline | Section labels beside the body, creating a clear reading rail. |
| Typewriter | Monospace headings and rules, with consistent alignment. |
| Margin | Large editorial name and asymmetric columns. |

These are design recommendations, not occupation-specific promises. Presets should keep the person’s content and allow further adjustment. Long experience entries and a nearly empty CV must both look intentional. Thumbnails should show actual hierarchy and sidebar position.

[Oxford Careers](https://www.ox.ac.uk/careers/careers-guidance/job-search-and-applications/writing-applications/cvs) recommends clear headings, white space and comfortably readable margins. Its font guidance varies between 10–11 pt and an 11 pt minimum checklist; this is not a universal numeric rule. [Harvard’s student résumé guide](https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/) recommends consistent emphasis and checking PDF formatting. Keep body text dark and accents subordinate. For the on-screen preview, [W3C’s contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) supplies 4.5:1 for ordinary text and 3:1 for large text; it is not a printed-CV certification.

Photos stay optional. Harvard advises omitting them in its US student context and acknowledges international differences. Oxford’s cited page supplies no photo rule. [Germany’s employment service](https://www.arbeitsagentur.de/bildung/bewerbung/bewerbungsunterlagen) describes photos as optional despite continued convention in many industries. Follow the destination and application instructions; no regional legal requirement is inferred. [Enhancv’s photo guide](https://help.enhancv.com/en/articles/2809420-how-to-upload-a-photo-to-your-resume-or-hide-the-photo), dated 28 February 2024, documents upload and hide controls. A photo-free default with a discreet add/remove control is a product choice.

Exports differ. Browser PDF uses the styled preview, portrait and measured pages, followed by the browser’s print dialogue; check final paper size, fonts and headers/footers ([app.js](../../src/app.js#L802), [page-preview.js](../../src/page-preview.js#L53)). DOCX is an editable sequence of visible sections with inline marks, safe links, mapped typeface, paper and margins. It does not export portraits, CSS compositions, sidebars or measured page breaks ([formats.js](../../src/formats.js#L50)). Browser text size uses CSS pixels; DOCX uses Word half-points, so equal settings do not guarantee equal physical size. Qualification should inspect long and short CVs, optional portraits, A4/Letter and monochrome print output; no ATS compatibility or hiring-outcome claim is made.
