# Adversarial checks

The 10 October 2026 sweep checked document imports, library state, spelling workers, optional AI, sharing and the local server. The full Node suite passed 273 tests, including 99 new adversarial tests. The static build also passed on Fedora with Node.js 24.14.0.

Run the checks yourself:

```sh
npm ci
npm test
npm run build
```

Tests use fictional CVs, generated files, temporary service stores and mocked providers. They do not open your saved library or call an external AI provider.

## What changed

- Document and library validators reject type-coerced IDs, unsupported hidden fields, accessors and malformed arrays before reading or copying them.
- Async document readers keep a copy of the bytes they started with. Changing the caller's buffer cannot alter a pending import.
- OCR keeps even very thin images within its four-megapixel render budget. A valid CV with 24,990 short lines imports without repeatedly scanning all previous lines.
- Reviewed imports reject inherited replacement options, and snapshots reject impossible calendar dates. Failed edits leave the original CVs and submitted copies intact.
- Spelling checks reject corrupt worker results and terminate their worker when starting or checking fails.
- AI and sharing replies have streamed byte limits and cancellation. Share links for another server are rejected before their access token is sent.
- Local server tests cover file handling, request limits, unfinished request bodies and releasing the private workspace lock during shutdown.

## Coverage

| Category | Examples |
| --- | --- |
| Malformed inputs | Invalid JSON, broken archives, malformed XML and misleading file types |
| Race conditions | Buffer changes during imports, imports finishing out of order, cancelled workers, concurrent server writes and shutdown |
| Boundary values | Empty files, exact text limits, snapshot capacity, leap days and image dimensions |
| Resource exhaustion | Large response streams, compressed files, deep markup, long short-line CVs and stalled requests |
| State corruption | Truncated files, bad checksums, invalid encoding, impossible dates and unreadable backups |
| Type confusion | Numeric IDs, array colours, object-shaped errors, sparse lists and non-finite numbers |
| Injection | Active links, HTML, XML entities, archive traversal, filesystem aliases and spreadsheet formulas |
| Invalid assumptions | Duplicate IDs, unsupported object properties, unavailable services, late results and failed worker startup |

Browser parsers and clients have no SQL engine or shell interpreter. Their SQL and shell-shaped text fixtures remain ordinary text; execution attacks against those absent components do not apply.

## Limits

These tests do not prove complete feature parity or remove every possible browser fault. PDF and OCR decoder behaviour also needs the browser checks run for each release.

ClearCV's browser storage checks catch a tab that tries to replace an already completed newer save. Two tabs can still save at almost the same moment because `localStorage` does not provide an atomic check-and-save operation. Use one editing tab and keep workspace backups. See [storage safety](storage-safety.md).
