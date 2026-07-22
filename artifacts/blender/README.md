# Aero Guardian — Blender Asset

Generated from the supplied anime sci-fi turnaround in Blender 5.1.2. The current revision uses the project's `assets/models/Mega Man Volnutt.obj` and `.fbx` as its proportion and surface-language references: rounded torso and pelvis shells, tapered cylindrical limbs, inset ball joints, a narrow waist, a larger head, and curved oversized boots replace the earlier block-based construction.

## Files

- `aero_guardian_rigged.blend` — editable master scene
- `aero_guardian_rigged.glb` — portable rigged glTF export
- `aero_guardian_preview.png` — verified hero render
- `character_reference.png` — preserved source turnaround
- `create_character.py` — deterministic Blender generator

## Rig

The armature is named `RIG_AeroGuardian` and contains 28 bones. Armor and body pieces are rigidly bone-parented, which keeps the hard-surface panels crisp during animation. It includes FK limbs, hand/foot IK targets, elbow/knee pole targets, a two-bone ponytail chain, and four IK constraints. IK constraints ship at zero influence so the included FK actions play consistently; raise their influence when animating with the IK controls.

Included actions:

- `Idle_Breathe` (frames 1–40)
- `Friendly_Wave` (frames 1–45)

## Blender MCP

The official Blender Lab MCP extension is installed and enabled. The official server source and isolated Python environment live under `tools/blender_mcp`, and Codex has a global `blender` MCP entry pointing to its executable.

Blender's **Allow Online Access** preference is enabled, and the MCP extension's **Auto Start** option is enabled. The local bridge was verified listening successfully on `127.0.0.1:9876`.

Restart Codex after setup so it loads the newly registered MCP server.
