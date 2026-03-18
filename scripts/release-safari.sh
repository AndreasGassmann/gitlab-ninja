#!/bin/bash
set -euo pipefail

# GitLab Ninja — Safari Extension Release Script
# Automates: build → convert → archive → export → upload
#
# Prerequisites:
#   - Apple Developer account enrolled in Apple Developer Program
#   - Xcode installed with command-line tools
#   - Signed into Xcode with your Apple ID (Xcode → Settings → Accounts)
#   - App record created in App Store Connect (first time only)
#
# Usage:
#   ./scripts/release-safari.sh              # Build & convert to Xcode project only
#   ./scripts/release-safari.sh --archive    # Build, convert, archive & export
#   ./scripts/release-safari.sh --upload     # Build, convert, archive, export & upload

MODE="xcode"
case "${1:-}" in
    --archive) MODE="archive" ;;
    --upload)  MODE="upload" ;;
esac

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Load environment variables
if [ -f "$ROOT_DIR/.env" ]; then
    set -a
    source "$ROOT_DIR/.env"
    set +a
else
    echo "Error: .env file not found. Create one with APPLE_TEAM_ID=your_team_id"
    exit 1
fi

if [ -z "${APPLE_TEAM_ID:-}" ]; then
    echo "Error: APPLE_TEAM_ID not set in .env"
    exit 1
fi

VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
SAFARI_DIST="$ROOT_DIR/dist/safari"
XCODE_PROJECT_DIR="$ROOT_DIR/safari-extension"
ARCHIVE_PATH_MACOS="$ROOT_DIR/build/GitLabNinja-macOS.xcarchive"
ARCHIVE_PATH_IOS="$ROOT_DIR/build/GitLabNinja-iOS.xcarchive"
EXPORT_PATH="$ROOT_DIR/build/export"
EXPORT_OPTIONS="$ROOT_DIR/scripts/ExportOptions.plist"
APP_NAME="GitLab Ninja"
BUNDLE_ID="dev.andycodes.gitlab-ninja"
SCHEME_MACOS="$APP_NAME (macOS)"
SCHEME_IOS="$APP_NAME (iOS)"

echo "=== GitLab Ninja Safari Release v$VERSION ==="
echo ""

# ── Step 1: Build extension ──
echo "[1/6] Building extension..."
npm run build
echo "     Done."

# ── Step 2: Prepare Safari dist folder ──
echo "[2/6] Preparing Safari distribution..."
rm -rf "$SAFARI_DIST"
mkdir -p "$SAFARI_DIST"

cp dist/content.js dist/content.js.map "$SAFARI_DIST/"
cp dist/injected.js dist/injected.js.map "$SAFARI_DIST/"
cp dist/popup.js dist/popup.js.map "$SAFARI_DIST/"
cp dist/popup.html "$SAFARI_DIST/"
cp dist/options.js dist/options.js.map "$SAFARI_DIST/"
cp dist/options.html "$SAFARI_DIST/"
cp dist/background.js dist/background.js.map "$SAFARI_DIST/"
cp dist/styles.css "$SAFARI_DIST/"
cp -r dist/icons "$SAFARI_DIST/"
cp "dist/manifest_safari.json" "$SAFARI_DIST/manifest.json"
echo "     Done."

# ── Step 3: Convert to Xcode project ──
echo "[3/6] Converting to Xcode project..."
rm -rf "$XCODE_PROJECT_DIR"
xcrun safari-web-extension-converter "$SAFARI_DIST" \
    --project-location "$XCODE_PROJECT_DIR" \
    --app-name "$APP_NAME" \
    --bundle-identifier "$BUNDLE_ID" \
    --no-prompt \
    --no-open \
    --force
# Add required macOS app category
/usr/libexec/PlistBuddy -c "Add :LSApplicationCategoryType string public.app-category.developer-tools" \
    "$XCODE_PROJECT_DIR/$APP_NAME/macOS (App)/Info.plist" 2>/dev/null || \
/usr/libexec/PlistBuddy -c "Set :LSApplicationCategoryType public.app-category.developer-tools" \
    "$XCODE_PROJECT_DIR/$APP_NAME/macOS (App)/Info.plist"
# Set development team in the Xcode project file for all targets
sed -i '' "s/CODE_SIGN_STYLE = Automatic;/CODE_SIGN_STYLE = Automatic;\\
				DEVELOPMENT_TEAM = $APPLE_TEAM_ID;/g" \
    "$XCODE_PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj/project.pbxproj"
echo "     Done."

if [ "$MODE" = "xcode" ]; then
    echo ""
    echo "Xcode project ready at: $XCODE_PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj"
    open "$XCODE_PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj"
    echo ""
    echo "=== Done! ==="
    exit 0
fi

# ── Step 4: Build & Archive (both platforms) ──
echo "[4/6] Building & archiving Xcode project..."
mkdir -p "$ROOT_DIR/build"

echo "     Archiving for macOS..."
xcodebuild archive \
    -project "$XCODE_PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj" \
    -scheme "$SCHEME_MACOS" \
    -archivePath "$ARCHIVE_PATH_MACOS" \
    -destination "generic/platform=macOS" \
    -configuration Release \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$VERSION" \
    | tail -5

echo "     Archiving for iOS..."
xcodebuild archive \
    -project "$XCODE_PROJECT_DIR/$APP_NAME/$APP_NAME.xcodeproj" \
    -scheme "$SCHEME_IOS" \
    -archivePath "$ARCHIVE_PATH_IOS" \
    -destination "generic/platform=iOS" \
    -configuration Release \
    CODE_SIGN_STYLE=Automatic \
    DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$VERSION" \
    | tail -5

echo "     Archives created."

# ── Step 5: Export ──
echo "[5/6] Exporting for App Store..."

# Create ExportOptions.plist if it doesn't exist
if [ ! -f "$EXPORT_OPTIONS" ]; then
    cat > "$EXPORT_OPTIONS" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>destination</key>
    <string>upload</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
PLIST
    echo "     Created ExportOptions.plist (you may need to customize team/signing)"
fi

xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH_MACOS" \
    -exportOptionsPlist "$EXPORT_OPTIONS" \
    -exportPath "$EXPORT_PATH/macos" \
    | tail -5

xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH_IOS" \
    -exportOptionsPlist "$EXPORT_OPTIONS" \
    -exportPath "$EXPORT_PATH/ios" \
    | tail -5

echo "     Exported to $EXPORT_PATH"

# ── Step 6: Upload ──
if [ "$MODE" = "upload" ]; then
    echo "[6/6] Uploading to App Store Connect..."
    for platform in macos ios; do
        echo "     Uploading $platform..."
        xcrun altool --upload-app \
            -f "$EXPORT_PATH/$platform/$APP_NAME.pkg" \
            -t "$platform" \
            --apiKey "${APP_STORE_API_KEY:-}" \
            --apiIssuer "${APP_STORE_API_ISSUER:-}" \
            2>&1 || {
            echo ""
            echo "     Upload failed for $platform. You can upload manually:"
            echo "     1. Open Xcode → Window → Organizer"
            echo "     2. Select the archive and click 'Distribute App'"
            echo "     OR set APP_STORE_API_KEY and APP_STORE_API_ISSUER env vars"
        }
    done
else
    echo "[6/6] Skipping upload (run with --upload to upload)"
    echo ""
    echo "     To upload manually:"
    echo "     1. Open the archives:  open \"$ARCHIVE_PATH_MACOS\""
    echo "     2. Xcode Organizer → Distribute App → App Store Connect"
    echo "     3. Repeat for iOS archive"
fi

echo ""
echo "=== Done! ==="
