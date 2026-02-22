# Changelog

## [Unreleased]
- SEC: Replaced broken encryption scheme (random AES key stored in `chrome.storage.local` +
  unsalted SHA-256 verification) with PBKDF2-derived keys (310k iterations, SHA-256).
  A single PBKDF2 call produces 512 bits: first 256 for verification, last 256 as the AES-GCM key.
- SEC: AES key is never stored persistently. Session caching stores the derived hex key
  (not the plaintext password) in `chrome.storage.session`.
- SEC: Added migration path from old format — existing users are transparently migrated
  on next unlock, with atomic rollback on interruption.
- SEC: `saveServices()` now uses write-then-cleanup instead of `chrome.storage.sync.clear()`,
  preventing data loss if the write is interrupted.
- SEC: Added sender validation in `background.js` to reject messages from other extensions.
- SEC: Added restrictive Content Security Policy (`script-src 'self'; object-src 'none';
  connect-src 'none'`) — blocks all outbound network requests.
- SEC: Sanitized error messages in import flow to avoid leaking internal details.
- SEC: Removed debug `console.log` from `saveServices()`.
- UI: Hide TOTP code section when no service is selected.
- FIX: Password caching ("Save pwd for x minutes") now survives service worker restarts.
  Replaced in-memory variables with `chrome.storage.session` in `background.js`.
  Replaced `setTimeout`-based expiration with timestamp-based expiration checking.
- Generated extension icons (16, 32, 48, 128px) from `images/fast-2fa.png`.
- Updated `manifest.json` to include the `icons` configuration.
- Created `publish-extension.sh` script to package the extension for the Chrome Web Store.
