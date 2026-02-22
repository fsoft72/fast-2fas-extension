# Changelog

## [Unreleased]
- FIX: Password caching ("Save pwd for x minutes") now survives service worker restarts.
  Replaced in-memory variables with `chrome.storage.session` in `background.js`.
  Replaced `setTimeout`-based expiration with timestamp-based expiration checking.
- Generated extension icons (16, 32, 48, 128px) from `images/fast-2fa.png`.
- Updated `manifest.json` to include the `icons` configuration.
- Created `publish-extension.sh` script to package the extension for the Chrome Web Store.
