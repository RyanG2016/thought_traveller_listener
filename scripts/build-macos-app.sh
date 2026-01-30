#!/bin/bash
set -e

# Build script for macOS .app bundle
# Creates ThoughtTravellerListener.app with the packaged executable

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$PROJECT_ROOT/dist"
APP_NAME="ThoughtTravellerListener"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"

echo "Building macOS application bundle..."

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    PKG_TARGET="node18-macos-arm64"
    EXECUTABLE_SUFFIX="-macos-arm64"
else
    PKG_TARGET="node18-macos-x64"
    EXECUTABLE_SUFFIX="-macos-x64"
fi

echo "Target architecture: $ARCH"

# Step 1: Build TypeScript
echo "Compiling TypeScript..."
cd "$PROJECT_ROOT"
npm run build

# Step 2: Package with pkg for current architecture
echo "Packaging executable with pkg..."
npx pkg dist/tray.js --targets "$PKG_TARGET" --output "$DIST_DIR/ThoughtTraveller$EXECUTABLE_SUFFIX" --compress GZip

EXECUTABLE="$DIST_DIR/ThoughtTraveller$EXECUTABLE_SUFFIX"

if [ ! -f "$EXECUTABLE" ]; then
    echo "Error: pkg failed to create executable"
    exit 1
fi

# Step 3: Create .app bundle structure
echo "Creating .app bundle structure..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Step 4: Copy Info.plist
cp "$PROJECT_ROOT/assets/macos/Info.plist" "$APP_BUNDLE/Contents/Info.plist"

# Step 5: Create launcher script that runs the executable
cat > "$APP_BUNDLE/Contents/MacOS/thought-traveller-launcher" << 'EOF'
#!/bin/bash
# Launcher script for Thought Traveller Listener
# This script ensures the app runs properly as a macOS application

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECUTABLE="$SCRIPT_DIR/ThoughtTraveller"

# Set up environment
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# Run the main executable
exec "$EXECUTABLE"
EOF

chmod +x "$APP_BUNDLE/Contents/MacOS/thought-traveller-launcher"

# Step 6: Copy the packaged executable
cp "$EXECUTABLE" "$APP_BUNDLE/Contents/MacOS/ThoughtTraveller"
chmod +x "$APP_BUNDLE/Contents/MacOS/ThoughtTraveller"

# Step 7: Create a simple icon (optional - uses default if not present)
# You can replace this with a proper .icns file later
if [ -f "$PROJECT_ROOT/assets/macos/AppIcon.icns" ]; then
    cp "$PROJECT_ROOT/assets/macos/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
fi

# Step 8: Create PkgInfo file
echo "APPL????" > "$APP_BUNDLE/Contents/PkgInfo"

echo ""
echo "Build complete!"
echo "Application bundle: $APP_BUNDLE"
echo ""
echo "To install:"
echo "  1. Copy $APP_NAME.app to /Applications"
echo "  2. Open System Settings → General → Login Items"
echo "  3. Add $APP_NAME to 'Open at Login'"
echo ""
echo "Or run directly:"
echo "  open \"$APP_BUNDLE\""
