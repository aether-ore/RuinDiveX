# Dungeon V2 art provenance

## Shipping status

All Dungeon V2 derived textures are development-only pending provenance and
redistribution clearance. A crop, resize, mask, or transparent derivative does
not acquire more permissive rights than its source master.

## Owner-supplied source masters

The project owner supplied these files on 2026-07-18. Their original creator,
generation workflow, prompt, license, and redistribution grant were not supplied:

- `industrial_factory_tilesheet.png` — SHA-256
  `21AFE098D962220C1049AB719BFB6C957DDDF7EF638F1D917F15B09F26A07075`.
- `waterworks_tilesheet.png` — SHA-256
  `7415DEDB77F08012055F5FBF278DFB6ED992FFC7B0ABE80B785EE9A95BAF9981`.
- `magma_factory_tilesheet.png` — SHA-256
  `F3FF37B818F21B5AA83C0BE751B11C68C99E257783CE39F9A99006A12A54C76E`.
- `electrical_factory_tilesheet.png` — SHA-256
  `EA1DE9E52DA75E1D147E8C4BB35F4B547B456FCA96700A760E4C1CB6CECC8EA1`.

The two room concept images remain visual references and are not cropped into
runtime materials.

## Project-generated environmental decal master

- File: `environment_storytelling_decals_master.png`.
- Original imagegen output: `exec-dbfd62d6-16fa-459a-b41f-fbc70447682d.png`.
- Tool: built-in OpenAI imagegen.
- Date: 2026-07-18.
- Dimensions: 1536x1024 RGB, exact 3x2 grid of 512x512 cells.
- SHA-256:
  `96B072C804838489B76434A76DB1273DB42410C9459388487B5B3405FF61CC68`.
- Cell order: oily rust leak; pale mineral waterline; blackened furnace
  scorch; blue-white electrical arc burn; Reaverbot metal scrape; greasy cable
  drag marks.
- Prompt record: “1536x1024 exact 3x2 512-cell atlas, mid-gray #808080, cells
  in order oily rust leak / pale mineral waterline / blackened furnace scorch /
  blue-white electrical arc burn / Reaverbot metal scrape / greasy cable drag
  marks; faux-PS1 industrial decal style based on supplied
  Factory/Waterworks/Magma tilesheets; centered isolated marks, no
  gutters/labels/frames/props/text; broad readable shapes, low noise.”

The deterministic builder converts the gray background to alpha and records
every derived PNG hash in the runtime texture manifest.

## Required clearance record

Before a public build, record for every source: creator/rightsholder, source or
generation method, applicable license/terms, whether redistribution in a game
and in source control is permitted, and the date the project owner accepted the
record. Unknown or restricted assets remain excluded from shipping.
