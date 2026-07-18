# Dungeon V2 source-reference masters

These user-supplied images are visual source masters for the
`industrial-factory-v2` art pass. They are not authoritative traversal,
collision, hazard, or minimap data. Runtime geometry must continue to come
from the certified module bakes and immutable V2 plan.

## Source inventory and semantic routing

| Project asset | Original attachment | Dimensions | SHA-256 | Intended use |
| --- | --- | ---: | --- | --- |
| `industrial_factory_tilesheet.png` | `ChatGPT Image Jul 18, 2026, 02_42_13 AM (1).png` | 1254x1254 RGB | `21AFE098D962220C1049AB719BFB6C957DDDF7EF638F1D917F15B09F26A07075` | Factory armor plates, grates, cargo/conveyor panels, doors, and cyan mechanism accents. |
| `magma_factory_tilesheet.png` | `ChatGPT Image Jul 18, 2026, 02_42_13 AM (3).png` | 1254x1254 RGB | `F3FF37B818F21B5AA83C0BE751B11C68C99E257783CE39F9A99006A12A54C76E` | Magma Processing heat panels, furnace grilles, cracked hot surfaces, and hazard borders. |
| `electrical_factory_tilesheet.png` | `ChatGPT Image Jul 18, 2026, 02_42_13 AM (4).png` | 1254x1254 RGB | `EA1DE9E52DA75E1D147E8C4BB35F4B547B456FCA96700A760E4C1CB6CECC8EA1` | Electrical Distribution coils, insulated panels, live-grid motifs, and cyan circuit accents. |
| `waterworks_tilesheet.png` | `ChatGPT Image Jul 18, 2026, 02_42_13 AM (2).png` | 1254x1254 RGB | `7415DEDB77F08012055F5FBF278DFB6ED992FFC7B0ABE80B785EE9A95BAF9981` | Filled/drained water surfaces, wet metal, waterlines, valves, pipes, and routing-console language. |
| `corkscrew_gear_platform_concept.png` | `ruindivex_corkscrew_gear_platform_concept.png` | 1536x1024 RGB | `BCFE57F14A8F26207CC1C95482A3A445551D26A36B1A5694F736938671773701` | Reference for a future certified vertical gear/corkscrew module variant with explicit safe landings and catchments. |
| `flooded_factory_waterworks_concept.png` | `ruindivex_flooded_factory_waterworks_concept.png` | 1312x1199 RGB | `91D9A4A044C8359E3E57C4F6D917C6648CC4FF1137E7815A60C1EF5434647D0B` | Waterworks lighting, bridge, broken-route, pump, valve, and cross-room landmark reference. |

## Runtime-art rules

- Slice and clean individual semantic cells before runtime use; do not ship a
  full reference sheet as a material.
- Downsample deliberately for the faux-PS1 camera, keep color groups readable,
  and avoid high-frequency shimmer.
- Hazard color is not the only cue: preserve emissive motion, borders, timing,
  particles, and audio.
- A painted rail, bridge, opening, platform, waterline, or mechanism does not
  exist in gameplay until it is represented in the certified geometry and plan.
- The concepts may guide authored module variants, but cannot bypass solid-floor,
  fall-catchment, protected-boundary, or deterministic-generation validation.

## Provenance

Supplied by the project owner on 2026-07-18. No creator, generation workflow,
prompt, license, or redistribution grant was supplied with the attachments.
Preserve the original image bytes and keep these masters development-only until
the project owner confirms generation/source provenance and redistribution
rights for a shipping build.
