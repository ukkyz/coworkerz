# Office art budget · v1

**What exists:** `src/components/VirtualOfficeCanvas.tsx` builds the room and two reusable articulated executive rigs from procedural geometry. It uses `WebGLRenderer`, OrbitControls, ACES tone mapping, a PMREM room environment, a 2048² sun shadow map (1024² on phone initialization) and DPR capped at 2 (1.25 at ≤600px). The floor (512²), walnut (256²) and two station displays (640×360 each) are canvas textures. Presence rings, a dialogue line and projected DOM labels/bubbles convey state. There is no imported character pack, hero LOD chain, particle engine or measured device baseline in the checkout.

**What to budget:** these are **proposed acceptance ceilings for new work**, not current measurements or implemented quality tiers. Put the target device, row below, instance count and total allowance in the brief **before** modeling, shading or authoring VFX. If the existing scene already exceeds a ceiling, record the baseline and agree a reduction or explicit exception; do not report a pass.

| Worst visible frame (both participants) | Integrated-GPU laptop · 1920×1080 buffer | Midrange phone · 390×844 CSS, DPR ≤1.5 |
| --- | ---: | ---: |
| Target FPS / p95 frame-time budget | 60 / 16.7 ms | 30 / 33.3 ms |
| Submitted triangles / draw calls, **all passes** | 250k / 180 | 90k / 90 |
| Resident art textures, mipmaps included (render targets tracked separately) | 96 MiB | 32 MiB |
| Simultaneous live particles, scene total | 128 | 32 |
| Shadow-casting lights / max shadow map | 1 / 2048² | 1 / 1024² (or baked) |

### Per-asset intake limits

Triangles below are per instance at **LOD0 / LOD1 / LOD2 / LOD3**; `0` means culled. Start the phone at LOD1 or lower. Calls are **main color pass** per asset (or per named batch), desktop / phone; shadow, double-sided and transmission passes still spend from the scene total. Texture limits are map count × maximum dimension, desktop / phone. An asset not in the table needs a budget row before production.

| Asset unit | Triangle caps by LOD | Calls D/P | Texture cap D/P | Live particles D/P |
| --- | --- | --- | --- | --- |
| One hero executive including hair/clothes | 24k / 12k / 5k / 1k | 4 / 2 | 3×2048 / 3×1024 | 0 / 0 |
| Room shell incl. floor, walls and ceiling | 12k / 6k / 2k / 500 | 8 / 4 | 3×1024 / 3×512 | 0 / 0 |
| One furnishing/station incl. table or planter | 3k / 1.5k / 500 / 80 | 3 / 2 | 2×1024 / 2×512 | 0 / 0 |
| Repeated trim/slats or skyline, per instanced batch | 24 / 12 / 12 / 0 per copy | 1 / 1 | 1×512 / 1×256 shared | 0 / 0 |
| Display/glass/decal, per surface | 12 / 2 / 2 / 0 | 1 / 1 | 1×1024 / 1×512 | 0 / 0 |
| Ring/arc/highlight, per effect | 192 / 96 / 32 / 0 | 1 / 1 | 1×256 / 1×128 | 0 / 0 |
| New particle emitter (camera-facing quads) | 128 / 64 / 16 / 0, at 2 tris/sprite | 1 / 1 | 1×512 / 1×256 atlas | 64 / 16 |
| Projected DOM cues (up to 2 nameplates, 1 bubble, 1 insight label) | 0 WebGL tris at every level | 0 / 0 WebGL | 0 / 0 | 0 / 0 |

DOM cues still cost CPU layout and compositing time; include them in the browser trace. Texture dimensions are ceilings, not entitlements: heroes with separate uncompressed maps at their per-map maximum can exceed the entire resident texture budget.

- **LOD gate:** ship all four hero representations, even for a procedural replacement (vary segments, combine rigid parts, simplify accessories). As a starting point, switch at projected body heights of 320, 160 and 80 px; use a 10% hysteresis band. Sweep both directions in `focus-CTO`, `follow-huddle` and `boardroom-overview`. Preserve foot pivot, joints, speaking mouth, badge anchors and visible-rig → current executive ID picking across levels. Non-hero assets also need reviewed simplification/cull levels; a two-triangle card may reuse its geometry across them.
- **Materials:** favor an opaque PBR atlas, shared geometry/materials and instancing for repeated slats. Use sRGB for color; keep normals/roughness/metalness linear. For future imports, budget decoded GPU bytes including mips, not just download size. Consider KTX2/Basis textures only with tested loader/transcode support; the existing `CanvasTexture`s are not compressed imports. Avoid introducing another renderer or an asset pack to change a highlight.
- **Mobile overdraw gate:** measure at the camera with the most overlap. Cap new translucent/additive FX together at 15% screen coverage and at most two overlapping FX layers on the phone; count particles against **both** emitter and scene caps. Audit existing curtain glass, tabletop, pad and rings separately in the same frame. Use a frame capture/overdraw view or coverage mask, and compare frame times with FX on/off. Reduce sprite size/lifetime, drop transmission or replace blended layers with opaque/cutout geometry before increasing resolution.

### Live roster change: reuse only

Incremental art budget per asset type: **zero** new mesh triangles, textures, WebGL draw calls, emitters or particles. A single reusable pair plays the speaker/listener (one for a CEO reply); offscreen members cost no rig, ring or nameplate. On phones the existing curtain transmission mesh, tabletop pad, presence rings and dialogue arc are hidden; the tabletop is opaque and only the active zone disc may blend. No additive FX were added. This bounds the added overdraw by construction; it is **not** a measured frame-time or full-scene throughput claim. Legacy rigs are not new LOD0–3 assets. Keep the intake gate above for future replacement art.

### CEO radar: dashboard only

The dashboard uses one static SVG: eight topic axes, four rings, at most eight data dots and one filled area (only for complete data). No new meshes, textures, WebGL draw calls, particles or animation loop. At phone widths the full-screen intelligence dock hides the room and its keyboard controls; the existing renderer pauses at zero size and resumes without rebuilding the scene. This is a work bound, not a hardware benchmark.

### Capture sheet (fill in, don't estimate results)

1. Pin hardware/GPU, browser, build/revision, actual drawing-buffer size, DPR, shadow settings and session state. Use the same idle CEO POV, active `follow-huddle` and close-up path before/after. Use real hardware for sign-off; label emulation as such.
2. Warm for 5 s; capture three 20 s runs per view. Record worst-run p95 **unclamped** frame interval (`performance.now()`/browser trace, not the animation's capped `dt`), peak calls/triangles from `renderer.info.render` or a full-frame capture, and peak live particles. Count all passes; for multiple renders per frame reset info once at the frame boundary. Separate JS/DOM time from GPU time where GPU timers are available.
3. Save a same-camera comparison of silhouette, lighting, station text and speaker/listener cues. Select each executive, orbit/resize, and remount twice; check for extra canvases, RAF loops, listeners or growing resource counts. Dispose owned geometries, materials, textures and render targets when releasing them.

`device | view | p95 ms before → after | peak calls / tris | texture MiB | particles / overdraw | visual & picking result | pass / fail / unmeasured`
