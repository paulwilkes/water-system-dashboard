#!/bin/bash

# YoLink Update Script
# This will download the corrected files from the outputs

echo "Updating YoLink integration files..."
echo ""

# Backup existing files
echo "Creating backups..."
cp lib/yolink.js lib/yolink.js.backup
cp test-yolink.js test-yolink.js.backup
echo "✓ Backups created"
echo ""

# Check if files exist in Downloads
if [ -f ~/Downloads/yolink.js ] && [ -f ~/Downloads/test-yolink.js ]; then
    echo "Found updated files in Downloads folder"
    cp ~/Downloads/yolink.js lib/yolink.js
    cp ~/Downloads/test-yolink.js test-yolink.js
    echo "✓ Files updated"
else
    echo "❌ Error: Could not find yolink.js and test-yolink.js in ~/Downloads"
    echo ""
    echo "Please download both files from Claude and try again:"
    echo "  1. yolink.js -> save to Downloads"
    echo "  2. test-yolink.js -> save to Downloads"
    echo "  3. Run this script again"
    exit 1
fi

echo ""
echo "Testing updated code..."
npm run test:yolink
