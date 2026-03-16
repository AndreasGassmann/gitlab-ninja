#!/bin/bash

# GitLab Ninja Packaging Script
# Creates distribution packages for Chrome and Firefox

VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

echo "📦 GitLab Ninja Packager v$VERSION"
echo ""

# Check if dist directory exists
if [ ! -d "dist" ]; then
    echo "❌ Error: dist/ directory not found"
    echo "Please run 'npm run build' first to compile the TypeScript code"
    exit 1
fi

# Package a browser variant
# Usage: package_browser <browser> <manifest_file>
package_browser() {
    local browser="$1"
    local manifest="$2"

    echo "Building $browser package..."
    local output="gitlab-ninja-${browser}-v${VERSION}.zip"

    rm -f "$output"

    local temp_dir
    temp_dir=$(mktemp -d)

    # Copy all dist files
    cp dist/content.js dist/content.js.map "$temp_dir/"
    cp dist/injected.js dist/injected.js.map "$temp_dir/"
    cp dist/popup.js dist/popup.js.map "$temp_dir/"
    cp dist/popup.html "$temp_dir/"
    cp dist/options.js dist/options.js.map "$temp_dir/"
    cp dist/options.html "$temp_dir/"
    cp dist/background.js dist/background.js.map "$temp_dir/"
    cp dist/styles.css "$temp_dir/"
    cp README.md "$temp_dir/"
    cp -r dist/icons "$temp_dir/"
    cp "dist/$manifest" "$temp_dir/manifest.json"

    # Create zip
    cd "$temp_dir"
    zip -r "$OLDPWD/$output" * -x "*.DS_Store" "**/.DS_Store"
    cd "$OLDPWD"

    # Cleanup
    rm -rf "$temp_dir"

    echo "✅ $browser package created: $output"
}

# Main
case "$1" in
    chrome)
        package_browser chrome manifest.json
        ;;
    firefox)
        package_browser firefox manifest_firefox.json
        ;;
    safari)
        package_browser safari manifest_safari.json
        ;;
    all|"")
        package_browser chrome manifest.json
        echo ""
        package_browser firefox manifest_firefox.json
        echo ""
        package_browser safari manifest_safari.json
        ;;
    *)
        echo "Usage: $0 [chrome|firefox|safari|all]"
        echo "  chrome  - Build Chrome/Chromium package"
        echo "  firefox - Build Firefox package"
        echo "  safari  - Build Safari package"
        echo "  all     - Build all packages (default)"
        exit 1
        ;;
esac

echo ""
echo "✨ Done!"
