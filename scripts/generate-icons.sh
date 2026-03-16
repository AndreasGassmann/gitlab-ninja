#!/bin/bash

# Icon Generation Script
# Converts the SVG icon to PNG files in various sizes

echo "🎨 GitLab Ninja Icon Generator"
echo ""

SVG_FILE="icons/icon.svg"

if [ ! -f "$SVG_FILE" ]; then
    echo "❌ Error: $SVG_FILE not found"
    exit 1
fi

# Check if ImageMagick is installed
if command -v convert &> /dev/null; then
    echo "Using ImageMagick to generate icons..."

    convert "$SVG_FILE" -resize 16x16 icons/icon16.png
    echo "✅ Created icons/icon16.png"

    convert "$SVG_FILE" -resize 48x48 icons/icon48.png
    echo "✅ Created icons/icon48.png"

    convert "$SVG_FILE" -resize 128x128 icons/icon128.png
    echo "✅ Created icons/icon128.png"

    echo ""
    echo "✨ All icons generated successfully!"

# Check if rsvg-convert is installed (librsvg)
elif command -v rsvg-convert &> /dev/null; then
    echo "Using rsvg-convert to generate icons..."

    rsvg-convert -w 16 -h 16 "$SVG_FILE" -o icons/icon16.png
    echo "✅ Created icons/icon16.png"

    rsvg-convert -w 48 -h 48 "$SVG_FILE" -o icons/icon48.png
    echo "✅ Created icons/icon48.png"

    rsvg-convert -w 128 -h 128 "$SVG_FILE" -o icons/icon128.png
    echo "✅ Created icons/icon128.png"

    echo ""
    echo "✨ All icons generated successfully!"

# Check if Inkscape is installed
elif command -v inkscape &> /dev/null; then
    echo "Using Inkscape to generate icons..."

    inkscape "$SVG_FILE" --export-filename=icons/icon16.png --export-width=16 --export-height=16
    echo "✅ Created icons/icon16.png"

    inkscape "$SVG_FILE" --export-filename=icons/icon48.png --export-width=48 --export-height=48
    echo "✅ Created icons/icon48.png"

    inkscape "$SVG_FILE" --export-filename=icons/icon128.png --export-width=128 --export-height=128
    echo "✅ Created icons/icon128.png"

    echo ""
    echo "✨ All icons generated successfully!"

else
    echo "❌ No SVG conversion tool found."
    echo ""
    echo "Please install one of the following:"
    echo "  • ImageMagick: brew install imagemagick (macOS) or apt-get install imagemagick (Linux)"
    echo "  • librsvg: brew install librsvg (macOS) or apt-get install librsvg2-bin (Linux)"
    echo "  • Inkscape: brew install inkscape (macOS) or apt-get install inkscape (Linux)"
    echo ""
    echo "Or use an online converter:"
    echo "  • https://cloudconvert.com/svg-to-png"
    echo "  • https://convertio.co/svg-png/"
    echo ""
    echo "Required sizes: 16x16, 48x48, 128x128"
    exit 1
fi
