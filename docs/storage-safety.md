# Keep your browser library safe

ClearCV saves your library in this browser's `localStorage`. Use one editing tab where possible and download workspace backups regularly. The library doesn't automatically sync to another browser or device.

## If another tab saves changes

ClearCV checks whether the saved library has changed before saving your open edits. If another tab has saved a newer version, it leaves that version in place and keeps your edits open.

1. Open **Library** and choose **Download open workspace** to keep this tab's CVs and edits.
2. Choose **Reload newer saved library**.
3. Confirm the reload after you've downloaded the backup.

Reload checks that the saved library can be read and hasn't changed again, then opens it in this tab without writing to storage. Cancelling, unreadable saved data or another change during confirmation leaves your open edits in place.

You can import the backup afterwards to add its CVs to the library. Check for duplicate versions before continuing.

## If browser storage fails

If ClearCV can't read or write storage, or the browser store is full, your open edits stay in the tab. Download a workspace backup before closing it.

The workspace can hold 25 CVs within 4 MB. Changes that exceed these limits don't replace the saved library. Back up before removing CVs, snapshots or photos to free space.

If saved data is unreadable, ClearCV keeps a recovery copy before replacing it. If the recovery copy can't be saved, autosave pauses. **Library** then offers the original data as a download and asks you to choose when to replace it.

## Avoid editing in two tabs at once

The check catches a tab that tries to overwrite a newer completed save. Two tabs saving at almost exactly the same moment can still overwrite each other: browser storage doesn't lock the whole check-and-save sequence. The [HTML storage standard](https://html.spec.whatwg.org/multipage/webstorage.html) explains this limit.

Keep one editing tab and use backups when moving between devices. Optional shared CVs have separate server checks for conflicting revisions, but sharing doesn't synchronise your whole browser library.
