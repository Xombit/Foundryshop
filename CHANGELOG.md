# Changelog

## 1.0.0 — Initial release

Foundryshop is a Photoshop-style drawing and layers toolbox for Foundry VTT v14,
built for GMs who draw maps live at the table. This first release includes:

> **Requires [Precise Drawing Tools](https://github.com/shemetz/precise-drawing-tools)**
> for high-resolution drawing. Foundry installs it automatically with Foundryshop.

### Drawing Toolbox
- Floating, draggable toolbox with a **tool rail** (select, rectangle, ellipse,
  polygon, freehand, path, label, stamp and a quick-layer flyout). Native Text
  is available in the Labels workspace and Foundry's drawing controls.
- **Brush bar**: stroke/fill targets, swap, no-fill toggle, saved **brush
  presets**, a width slider with one-tap sizes, line and fill opacity, and
  recent colors.
- **Selection bar** for editing, applying or clearing label text and copying
  the selection to a stamp.
- Grouped panels — **Style**, **Color**, **Layers**, **Assets** — plus a
  Settings panel behind the ⚙ button, a collapsed mode, and remembered
  position and panel.
- Slate, Foundry and system themes, compact/comfortable/tablet sizes, and UI scale.

### Layers
- Nested **layers and groups** stored per Scene, ordered top to bottom.
- Separate **GM view** and **Players** visibility, inherited by groups.
- Active layer, locks, duplicate, rename, move to group, keyboard reordering,
  per-layer remembered brushes, and **Repair Drawing Order**.
- An **Unassigned** bucket for drawings that are not on any layer yet.
- **Copy selected drawings here** in each layer's actions: exact in-place
  duplication for seamless reveal overlaps, including hidden destinations.
  Originals stay unchanged; complete retained paths receive independent
  identities, with explicit partial/damaged-path editability warnings.
- Layer copies, stamps and project-import recovery fingerprints work over
  LAN HTTP without Web Crypto, using equivalent SHA-256 rather than weakening
  existing-artwork protection.

### Presentation
- **Presentation presets** that snapshot which layers players can see, so a
  reveal is a single click.

### Color
- Named palettes (built-in and world-shared), paired stroke+fill swatches,
  and an advanced color selector with an on-canvas eyedropper, preset swatches
  and recent colors.

### Assets
- Waypoint paths with plain, railway, road and river styles, adjustable smooth
  curves or straight segments, live previews, grid-square widths and railway
  sleepers spaced along the curve.
- Optional seeded natural meanders for every path style, with grid-square
  amplitude/bend spacing and fixed waypoint anchors. Plain lines support thin
  strokes as well as wide routes.
- Editable retained paths backed by Scene recipes and native Drawing components:
  numbered waypoints, Automatic/Smooth/Corner handles, exact non-meandering
  curve insertion, closed loops, draft appearance/variation controls and presets.
- Whole-path move, independent duplicate, confirmed delete/detach and separate
  bounded draft/committed Path Undo/Redo. Verified native transactions and
  reload-safe recovery preserve recipes and artwork together.
- Complete path portability through JSON projects, copied stamps and saved
  shapes, including rotation/scale and identity remapping. Partial/damaged
  export warnings and explicit conflict review preserve current artwork without
  silently overwriting edits or rebuilding missing components.
- Six original Mining stamps: empty/loaded minecarts, ore pile, timber support,
  railway buffer stop and pickaxe.
- Fifteen original seamless **materials** for textured fills.
- **Stamps** and a searchable **Library** of starter shapes, saved shapes and
  saved projects, with WEBP artwork and SVG vector export.
- **Map labels** with starter label styles.

### Tracing and projects
- **Tracing reference**: turn a sketch layer into a translucent Tile to draw over.
- **Project export and import** (`.foundryshop.json`) that carries layers,
  drawings and their assets between Scenes and Worlds, including two example
  projects.

### Credits
Foundryshop began from [Boneyard Drawing Tools](https://github.com/operation404/boneyard-drawing-tools)
by Lich (operation404), MIT licensed. The development history from that
starting point is kept in [docs/CHANGELOG-history.md](docs/CHANGELOG-history.md).
