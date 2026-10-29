# HARBOR — art direction

HARBOR is the sixth piece in the family after MEADOW (draw a sheep), POND, HIVE, SKY and TIDE: the same hand, a new world, and still one gesture. **You draw the outline of a boat on the water; it becomes a little sailing dinghy and sets off.** Everything is measured against MEADOW's "Illustrated aerial references" (`meadow/docs/REFERENCE_ANALYSIS.md`) — a painted tile on warm paper — and against the siblings' interface.

## What carries over unchanged
- **Tile on paper.** A rounded rectangle of paint on `#f4efe4`, its edge thinning into dry-brush specks. The harbour is an object on a page; the open sea simply fades into the paper.
- **One painted light.** `paintLight`: a warm lit side and a cool lavender shade (`#bdb9e3`); sun high, upper left; shadows fall lower right. One sun shadow map for everything, with contact hardening.
- **Gouache texture.** Flat-ish washes with soft internal gradients, long dry-brush strokes, a fine pigment stipple. No photo textures, no gloss, no black.
- **Puff modelling.** Trees, clouds and gulls are MEADOW's fleece fields (soft clumped SDF surfaces with a dry-brush silhouette).
- **Interface.** Inter Tight + Fraunces, wordmark top left ("HARBOR / *draw a boat*"), cream pill toolbar, a thin blue selection box with a measured label, a contextual bar under the selection.

## The world: a harbour town from above
- **Two thirds water.** Calm, glassy turquoise inside the harbour; a deeper painted blue with soft white dabs of crest beyond the breakwater; a pale sandy shelf off the beach. Water is *painted, not simulated*: layered streaks drift with the breeze, darker strokes lie in deep water, glints come and go, and the town's reflection is broken into horizontal ripples.
- **The town climbs a hillside** behind a curved flagstone quay: three terraces of stacked narrow houses in pastel washes (rose, mint, butter, sky, peach, lilac) with terracotta pantiles, shutters, a striped café awning on the quay, washing strung between houses, low stone retaining walls and a stair lane up the hill. A whitewashed chapel with a bell tower sits on the hill at the left, among cypresses.
- **The lighthouse** stands on a rocky point at the right: white with one red band, its lantern turning once every twelve seconds — a soft beam sweeps the water by the point and the lamp brightens as it swings toward us.
- **The breakwater** runs across the front-left in big squared blocks, weedy at the waterline, with a green beacon on its tip; the gap between it and the point is the way out to sea.
- **Small life, never competing with the boats:** three puff gulls wheeling on lazy circles (flapping, then gliding), a blue flag on the quay streaming downwind, red mooring buoys bobbing with little rings of ripples, bollards and rope coils, clouds along the edges.
- **One breeze.** It blows from the sea at the back-right, steady in direction and slowly freshening and easing. It shows in the flag, the drift of the water's streaks and crests, the pennants and the sails.

## The boat
- **Your outline is the hull.** The drawn loop is closed, oriented bow to stern (the bow is the narrower, more pointed end), made mostly — not perfectly — symmetric so it keeps its personality, clamped to a sensible size, and lofted into a shallow hull with round bilges, a sheer that lifts toward the bow, transoms where the drawing was wide, a painted rim and a honey-planked deck with a cockpit and a thwart.
- **One rig.** A mast, a boom and one triangular sail of cloth that fills, flaps and swings across; a tiller; a pennant at the masthead. No sailors.
- **A small painted set.** The seed picks a pastel hull (cream, pale blue, rose, mint) with a contrasting stripe and rim, and a sail in cream, red ochre, sea blue or butter yellow, with or without a stripe. The name is painted across the stern deck.
- **Drawn larger than life.** A boat is about a cottage long. Labels report a real dinghy's length (world units × 2.2 m).

## Motion
- **Painted in**, MEADOW-style: brush strokes sweep the hull in from stern to bow, then the mast rises, then the sail unfurls up the mast and fills with a little snap. Shadows arrive only after the reveal; a ring of ripples spreads from the launch.
- **Sailing is the piece.** A points-of-sail model drives every boat: fastest on a beam reach, slower close-hauled and running, nothing in the no-go zone — so a boat sent upwind beats there in zig-zags, the boom swinging across and the heel flipping at each tack. Boats heel with the wind (more in the gusts), pitch and bob on a gentle swell, and leave a short white wake and a faint V of ripples.
- **A life of their own.** Left alone, a boat sails out through the gap, makes a loop at sea, comes home, shoots up into the wind onto a free mooring with its sail flapping, rests a while, and goes out again.

## Rules learned from the siblings
- `new THREE.Color('#hex')` is already linear; don't convert again.
- Shadows never arrive before the thing that casts them.
- Things mid-reveal stay pickable.
- Canvas-only recording loses the SVG ink; the recorder composites the ink in.
- Benchmark with back-to-back frames and a GPU sync, on a loaded machine.
