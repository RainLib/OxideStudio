# MongoDB document clone deferred validation

The clone workflow is complete at the Host, driver, service, and UI logic
layers. The following checks require controlled MongoDB servers or a packaged
desktop/WebView matrix and are deliberately not represented by fake-driver
tests.

## Server matrix

- MongoDB 4.4, 5.x, 6.x, 7.x, and 8.x with standalone and replica-set
  deployments.
- Accounts with read/write, read-only, collection-level, and revoked-during-
  preview permissions.
- Source deletion and source mutation between preview and execution; both must
  fail without inserting a clone.

## BSON round-trip

- ObjectId, Date, Int32, Int64 above JavaScript's safe range, Double, Decimal128,
  Binary with non-default subtype, UUID, Regex, Timestamp, JavaScript Code,
  MinKey/MaxKey, nested documents, and arrays containing mixed BSON values.
- Custom `_id` drafts and duplicate `_id` errors. The default draft must omit
  the source `_id` and let MongoDB generate a new identity.
- Added, changed, and removed top-level fields while every untouched field is
  byte-semantically equivalent to the source BSON value.

## Desktop behavior

- Windows WebView2 and macOS WebKit keyboard, selection, JSON paste, focus,
  reduced-motion, and screen-reader labels.
- Large but bounded documents, deeply nested Extended JSON, invalid wrappers,
  rapid review clicks, collection/tab switches, reconnects, and dialog close
  during preview.
- Refresh after a successful insert must not replay the mutation and must keep
  the success receipt visible even if refresh fails.

These checks do not expand the public MCP contract. External Agents remain
read-only unless a separate Desktop approval lease authorizes a supported
mutation.
