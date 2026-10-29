# Notes from the siblings

What HARBOR took from each piece in the family (all MIT, same author; code is copied and adapted, never imported across repos).

- **SKY** (`~/Development/sky`) — the starting engine: `Engine` (fixed-step override for tests and recording, dynamic resolution, context loss, PNG capture), `SunShadows`, the post pass, the painted light (`shaderChunks.ts`), the baked-ground terrain, the gabled-building builder and its painted wall/roof shader, puff trees and edge-hugging clouds, the store/history/persistence layer, the pointer state machine, the SVG ink overlay and the recorder that composites ink into video. SKY's flight sheet became the water plane; its rolling-frame flight became a points-of-sail simulation.
- **MEADOW** (`~/Development/meadow`) — the art direction ("Illustrated aerial references"), the brush-stroke reveal (`revealClip` in the sheep materials → the hull's stern-to-bow reveal), the shiver-away for rejected ink, the worker for geometry (wool → hull loft), the selection box with a measured label and a contextual bar.
- **TIDE** (`~/Development/tide`) — painted water: washes from shallows to deep, dry-brush streaks, cellular lace for foam, speckled glints, ripple rings, the dry-brush paper edge on water.
- **POND** — the calm turquoise of enclosed water, ripple rings round floating things (here, the mooring buoys).
- **HIVE** — the engine lineage TIDE and SKY were forked from; QA script habits (shoot, sheet, perf, demo).

Lessons carried over verbatim: hex colours are already linear in three.js; shadows only after a reveal; mid-reveal things stay pickable; record with the ink; benchmark with GPU-synced back-to-back frames.
