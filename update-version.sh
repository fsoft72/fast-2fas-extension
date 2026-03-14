#!/bin/bash

# Update the version in manifest.json.
# Usage:
#   ./update-version.sh          # bumps patch version (1.1.0 -> 1.1.1)
#   ./update-version.sh 2.0.0    # sets version to 2.0.0

MANIFEST="manifest.json"
CURRENT=$(grep -oP '"version":\s*"\K[^"]+' "$MANIFEST")

if [ -z "$CURRENT" ]; then
  echo "ERROR: could not read version from $MANIFEST"
  exit 1
fi

if [ -n "$1" ]; then
  NEW_VERSION="$1"
else
  # Bump the patch (third) number
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
  PATCH=$((PATCH + 1))
  NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
fi

sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" "$MANIFEST"

echo "$CURRENT -> $NEW_VERSION"
