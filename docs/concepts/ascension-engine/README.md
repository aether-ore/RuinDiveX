# Ascension Engine Concept Provenance

## Source

- Project asset: `docs/concepts/ascension-engine/concept-board.png`
- Supplied by: the user in the Codex task that implemented VA-RUK 09
- Received: 2026-07-16
- Source type: user-supplied concept board / clipboard attachment
- SHA-256: `C8B741C9BC5CFCC37803B04F60984B354FF6194CB7508F22B5DBE921F0E16DA0`

No external creator, model, generation prompt, or license metadata was supplied with the attachment. Preserve the original file unchanged unless the user provides corrected provenance.

## Approved runtime interpretation

The board is used as a visual-direction reference for:

- the shrine-tower torso and ancient vertical-reliquary architecture;
- the dominant faceted ruby hip optic;
- the long black-and-gold telescoping compression spine;
- four readable orange Compression Seals;
- twin downward boosters;
- three broad landing claws;
- a pale ruin-stone, verdigris, charcoal, and restrained gold material grouping.

The implemented boss and environment are code-authored low-poly Three.js geometry in `src/reaverbots/AuthoredAscensionEngine.js` and `src/reaverbots/bosses/VerticalTransitReliquary.js`. The concept board is not sampled as a runtime texture, used as a billboard, or treated as evidence that a mechanic exists.

## Portrait and visual-QA policy

The Boss Hunt portrait is a headless capture of the implemented runtime boss, never a crop or repaint of this board. Its runtime path is:

```text
assets/textures/reaverbots/bosses/ascensionEngine/hunt-portrait.png
```

Capture with:

```text
npm run art:boss-portraits -- ascensionEngine
```

The capture script validates a 256×256, 8-bit RGBA PNG. The portrait and initial gameplay-distance capture below were produced and inspected on 2026-07-16.

| Evidence | Status | Path / notes |
|---|---|---|
| Original concept board | Present | `docs/concepts/ascension-engine/concept-board.png` |
| Runtime Boss Hunt portrait | Present | `assets/textures/reaverbots/bosses/ascensionEngine/hunt-portrait.png`; captured 2026-07-16; SHA-256 `97915B238602FABB687631C09113F559AEF785D7B8310E581AF1765C248C57FE`. |
| Compression Foundry gameplay view | Present | `docs/concepts/ascension-engine/gameplay-qa.png`; captured 2026-07-16; gameplay HUD, initial support volume, impact-route objective, Seal One state, and authored shaft scale; SHA-256 `3CD5924B076F8BC665C937322A8EAFF11A8BFAE91AC3C7DDE12051F257D0B076`. |
| Broken Elevator Spine gameplay view | Pending record | Show wall-rebound readability and a raised counterweight or bridge. |
| Suspended Machinery Sea gameplay view | Pending record | Show the three-platform launch chain and booster wash lane. |
| Summit gameplay view | Pending record | Show a summit attack, active final seal, and HUD at combat distance. |
| Post-clear mastery ascent view | Pending record | Show Jump Springs equipped and all four gear-gated mastery ledges online; include at least one 3.82-unit shortcut bypassing its original impact chain. |
