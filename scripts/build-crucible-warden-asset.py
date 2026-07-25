"""Build only the retained Three.js Crucible Warden GLB and sidecar manifest.

Run with Blender 5.1 in background mode. This script intentionally contains no
Magma Refinery room, connector, collision-shell, or dungeon-library generation.
"""

from __future__ import annotations

import bpy
import hashlib
import json
import math
from pathlib import Path


PROJECT = Path(r"C:\Users\K\Documents\New Three.js Practice")
OUTPUT_ROOT = PROJECT / "assets" / "models" / "magma-refinery" / "boss"
OUTPUT_PATH = OUTPUT_ROOT / "crucible-warden.glb"


def reset_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def material(name, color, metallic=0.0, roughness=0.7, emission=None, strength=0.0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if emission is not None:
        principled.inputs["Emission Color"].default_value = (*emission, 1.0)
        principled.inputs["Emission Strength"].default_value = strength
    return value


def apply_material(obj, value):
    if getattr(obj.data, "materials", None) is not None:
        obj.data.materials.append(value)


def cube(name, size, position, value, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=position, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = tuple(component * 0.5 for component in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_material(obj, value)
    return obj


def cylinder(name, radius, depth, position, value, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=24,
        radius=radius,
        depth=depth,
        location=position,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    apply_material(obj, value)
    return obj


def torus(name, major_radius, minor_radius, position, value, rotation=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=24,
        minor_segments=8,
        location=position,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    apply_material(obj, value)
    return obj


def empty(name, position, semantic):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.location = position
    obj["semantic"] = semantic
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build():
    reset_scene()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    ancient = material("AncientBlackenedMetal", (0.16, 0.09, 0.06), 0.76, 0.42)
    ceramic = material("CrucibleCeramic", (0.35, 0.22, 0.16), 0.08, 0.58)
    cooling = material(
        "CoolingVentEmission",
        (0.22, 0.62, 0.72),
        0.18,
        0.34,
        emission=(0.08, 0.72, 0.95),
        strength=2.8,
    )

    bpy.ops.object.armature_add(location=(0.0, 0.0, 0.0))
    armature = bpy.context.object
    armature.name = "CrucibleWarden_Rig"
    bpy.ops.object.mode_set(mode="EDIT")
    root_bone = armature.data.edit_bones[0]
    root_bone.name = "root"
    root_bone.head = (0.0, 0.0, 0.0)
    root_bone.tail = (0.0, 0.0, 3.2)
    for index in range(3):
        angle = index * math.tau / 3
        bone = armature.data.edit_bones.new(f"leg_{index}")
        bone.head = (0.0, 0.0, 1.2)
        bone.tail = (math.sin(angle) * 3.2, math.cos(angle) * 3.2, 0.0)
        bone.parent = root_bone
    bpy.ops.object.mode_set(mode="OBJECT")

    parts = [cylinder("CrucibleWarden_Body", 2.2, 2.8, (0.0, 0.0, 2.7), ancient)]
    for index in range(3):
        angle = index * math.tau / 3
        parts.append(cube(
            f"CrucibleWarden_Leg_{index}",
            (0.55, 4.5, 0.55),
            (math.sin(angle) * 1.6, math.cos(angle) * 1.6, 1.0),
            ancient,
            rotation=(0.0, 0.0, -angle),
        ))
        vent = torus(
            f"CoolingVent_{index}",
            0.58,
            0.14,
            (math.sin(angle) * 2.0, math.cos(angle) * 2.0, 3.0),
            cooling,
            rotation=(math.pi / 2, 0.0, -angle),
        )
        vent["semantic"] = "coolingVentWeakPoint"
        vent["lockable"] = True
        parts.append(vent)

    nozzle = cylinder(
        "PerfectedCrucibleNozzle",
        0.72,
        3.4,
        (0.0, -2.4, 3.2),
        ceramic,
        rotation=(math.pi / 2, 0.0, 0.0),
    )
    nozzle["semantic"] = "flameNozzle"
    parts.append(nozzle)
    for index in range(6):
        angle = index * math.tau / 6
        plate = cube(
            f"RotatingArmor_{index}",
            (1.8, 0.28, 1.35),
            (math.sin(angle) * 2.15, math.cos(angle) * 2.15, 3.1),
            ancient,
            rotation=(0.0, 0.0, -angle),
        )
        plate["semantic"] = "rotatingArmor"
        parts.append(plate)

    for part in parts:
        part.parent = armature
    empty("anchor_flame_origin", (0.0, -4.1, 3.2), "weaponMuzzle").parent = armature
    empty("anchor_zone_controller", (0.0, 0.0, 0.0), "zoneController").parent = armature

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )
    export_hash = hashlib.sha256(OUTPUT_PATH.read_bytes()).hexdigest()
    manifest = {
        "schema": "ruindivex-boss-asset/v1",
        "assetId": "crucible-warden",
        "kind": "boss",
        "exportHash": export_hash,
        "rig": {
            "armature": armature.name,
            "bones": [bone.name for bone in armature.data.bones],
        },
        "semanticParts": [
            "flameNozzle",
            "rotatingArmor",
            "coolingVentWeakPoint",
            "zoneController",
        ],
        "dungeonFamilyDependency": None,
    }
    OUTPUT_PATH.with_name(OUTPUT_PATH.name + ".manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    return {"bosses": 1, "output": str(OUTPUT_PATH), "exportHash": export_hash}


RESULT = build()
