# Dungeon V2 runtime art foundation

This folder is the V2-only environment-art foundation for the Ancient
Industrial Factory, Waterworks, Magma Processing, and Electrical Distribution
districts. The assets here are presentation data. Certified geometry, collision,
fall catchments, gates, hazards, and traversal remain authoritative elsewhere.

## Deterministic build

Run from the repository root:

```powershell
npm run art:dungeon-v2-textures
npm run check:dungeon-v2-textures
```

`scripts/dungeon-v2-texture-sources.json` defines every source hash, source
rectangle, semantic role, output asset, import mode, and shared material. The
builder verifies source bytes and dimensions, crops to 256x256 RGBA maps,
derives linear emission masks, removes the generated decal atlas's gray
background, writes deterministic Unity GUID/import metadata, and emits
`Textures/dungeon_v2_texture_manifest.json` with output SHA-256 values.

Do not edit generated textures, material YAML, or their `.meta` files by hand.
Change the source configuration or builder, rebuild, and run the stale-output
check.

## Built-in pipeline shaders

- `Ruin/IndustrialLit` supplies shared albedo, tint, optional vertex color, and
  masked emission for shells, catwalks, supports, and mechanisms.
- `Ruin/WaterSurface` supplies restrained scrolling detail, a small vertex wave,
  transparency, and low emission. It is presentation only; water state and
  traversal physics do not come from the shader.
- `Ruin/MagmaSurface` supplies layered scrolling heat and a pulsing emission
  mask. Damage timing remains owned by the deterministic hazard runtime.
- `Ruin/ElectricPanel` exposes `_Phase`: `0` safe, `1` charging, `2` live, and
  `3` grounded. Runtime presentation should set this through a
  `MaterialPropertyBlock`, never by cloning a material per panel.

These are Built-in Render Pipeline surface shaders. A URP or Shader Graph
migration is neither required nor implied.

## Module integration rules

- Use the shared materials; do not create one-off material instances for every
  generated module.
- Presentation meshes need UV0 on every visible submesh. Source masters must
  never be assigned directly to a runtime renderer.
- Every authored room composition needs textured floors, walls, ceilings,
  undersides, connector caps, and structurally legible supports.
- Decals add environmental history; they do not replace machinery, lighting,
  traversal composition, or certified geometry.
- A Large Mini-Dungeon is a deterministic 3-5-module composition grammar. It is
  not one monolithic art prefab or one stretched corridor shell.

See `PROVENANCE.md` before distributing any build or source asset.
