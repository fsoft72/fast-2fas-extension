#!/bin/bash

# Define the output filename
ZIP_NAME="/ramdisk/fast-2fa-extension.zip"

# Remove existing zip if it exists
if [ -f "$ZIP_NAME" ]; then
    rm "$ZIP_NAME"
fi

# Create the zip file excluding the source high-res image and the git directory
# -r: recursive
# -x: exclude pattern
zip -r "$ZIP_NAME" . -x "images/fast-2fa.png" ".git/*" "publish-extension.sh" "CHANGES.md" ".gemini/*"

echo "Extension packaged into $ZIP_NAME"
