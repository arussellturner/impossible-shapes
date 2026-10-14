# EscherCAD — Isometric Impossible Shape Studio

An interactive 3D isometric voxel editor for designing **M.C. Escher** and **Penrose** "impossible shapes" in the browser.

## How It Works

1. **Isometric Ray Equivalence**: In a 3D isometric projection looking along $(1, 1, 1)$, shifting any block by $(+k, +k, +k)$ changes its 3D depth while projecting to the **exact same 2D screen coordinates** $(u, v) = (y - x, y - z)$.
2. **Automatic Escher Welds (`⚡`)**: When you place blocks in 3D that visually touch in the 2D isometric projection across a depth gap $\Delta k \neq 0$, the engine automatically creates an **Escher Weld**:
   - **Local Paradox Depth Weaving**: Uses shortest-path local virtual 3D offsets around each junction so cyclic loops (like the Penrose Triangle or Penrose Staircase) weave seamlessly without global depth conflicts.
   - **Coplanar Ribbon Merging**: Automatically hides internal voxel seams between connected coplanar faces ($\Delta F = 0$) and merges collinear contour/crease strokes into crisp vector line art.
3. **Interactive Controls**:
   - **Add Blocks**: Hover near any existing block face to preview and place blocks along all 6 isometric directions (`+X, -X, +Y, -Y, +Z, -Z`), or use the **3D Axis Step Builder** pad.
   - **Flip or Unmerge Welds**: Click any `⚡` badge on the canvas to cycle between **Natural Weld**, **Flipped Weave** (reversing which beam passes in front), and **Disconnected** (true 3D depth).
   - **Inspect 3D Depth Illusion**: Drag the **Inspect 3D Depth Illusion** slider to tilt the projection off the isometric axis and reveal the hidden 3D depth gaps bridged by each Escher weld.
   - **Export**: Download crisp **SVG** vector line art or **2× Retina PNG** renders.

## Getting Started

```bash
npm install
npm run dev
```
