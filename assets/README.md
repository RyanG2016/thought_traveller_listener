# Icon Assets for Claude Traveller

## Required Files

### macOS
- `iconTemplate.png` - 22x22 black icon with transparency (for menu bar)
- `iconTemplate@2x.png` - 44x44 retina version

**Note**: Using "Template" suffix enables automatic dark/light mode adaptation.
The icon should be black with transparent background.

### Windows
- `icon.ico` - Multi-resolution icon (16x16, 32x32, 48x48)

## Current Status

The app currently uses embedded base64 placeholder icons.
Replace these files with proper designs and update `src/tray-menu.ts` to load them from disk.

## Converting Icons

### PNG to ICO (Windows)
```bash
# Using ImageMagick
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```

### Creating Template Icons (macOS)
- Design icon in black (#000000)
- Save as PNG with transparency
- Name with "Template" suffix for automatic dark mode support
