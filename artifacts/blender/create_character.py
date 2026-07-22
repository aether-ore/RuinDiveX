import bpy
import math
import os
from mathutils import Vector


OUT_DIR = os.path.dirname(os.path.abspath(__file__))
BLEND_PATH = os.path.join(OUT_DIR, "aero_guardian_rigged.blend")
GLB_PATH = os.path.join(OUT_DIR, "aero_guardian_rigged.glb")
RENDER_PATH = os.path.join(OUT_DIR, "aero_guardian_preview.png")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights, bpy.data.armatures):
        pass


def material(name, color, metallic=0.0, roughness=0.45, emission=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 3.5
    return mat


WHITE = material("Armor_Ivory", (0.88, 0.86, 0.78), 0.45, 0.28)
WHITE2 = material("Armor_Highlight", (0.98, 0.97, 0.91), 0.25, 0.22)
RED = material("Suit_Crimson", (0.38, 0.035, 0.025), 0.15, 0.35)
RED2 = material("Suit_Highlight", (0.68, 0.07, 0.04), 0.2, 0.28)
CYAN = material("Energy_Cyan", (0.01, 0.45, 0.58), 0.25, 0.2, (0.0, 0.75, 1.0))
DARK = material("Joint_Graphite", (0.025, 0.035, 0.04), 0.75, 0.24)
SKIN = material("Skin", (0.82, 0.52, 0.30), 0.0, 0.62)
HAIR = material("Hair_Orange", (0.88, 0.19, 0.025), 0.05, 0.36)
HAIR_DARK = material("Hair_Shadow", (0.45, 0.055, 0.01), 0.05, 0.42)
EYE_WHITE = material("Eye_White", (0.96, 0.98, 0.95), 0.0, 0.2)
EYE_BLUE = material("Eye_Blue", (0.0, 0.34, 0.62), 0.1, 0.12, (0.0, 0.16, 0.35))
BLACK = material("Ink_Black", (0.005, 0.008, 0.01), 0.1, 0.3)


def finish(obj, mat, bevel=0.05, smooth=True):
    if mat:
        obj.data.materials.append(mat)
    if smooth and hasattr(obj.data, "polygons"):
        for p in obj.data.polygons:
            p.use_smooth = True
    if bevel > 0:
        mod = obj.modifiers.new("Edge_Soften", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def box(name, loc, scale, mat, bevel=0.08, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, bevel, False)


def sphere(name, loc, scale, mat, segments=32, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, mat, 0.0, True)


def cylinder(name, loc, radius, depth, mat, rot=(0, 0, 0), verts=24, bevel=0.04):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat, bevel, True)


def cone_between(name, start, end, r1, r2, mat, verts=16):
    a, b = Vector(start), Vector(end)
    vec = b - a
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2,
                                    depth=vec.length, location=(a + b) * 0.5)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(vec.normalized())
    return finish(obj, mat, 0.025, True)


def hair_lock(name, start, end, width, mat):
    """Flattened tapered hair blade, designed to read like drawn anime locks."""
    a, b = Vector(start), Vector(end)
    direction = Vector((b.x - a.x, 0, b.z - a.z)).normalized()
    perp = Vector((-direction.z, 0, direction.x)) * (width * 0.5)
    thick = Vector((0, 0.055, 0))
    tip_perp = perp * 0.10
    verts = [
        a + perp - thick, a - perp - thick, a - perp + thick, a + perp + thick,
        b + tip_perp - thick * 0.45, b - tip_perp - thick * 0.45,
        b - tip_perp + thick * 0.45, b + tip_perp + thick * 0.45,
    ]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
             (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, mat, 0.035, False)


def ring(name, loc, major, minor, mat, rot=(math.pi / 2, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                    major_segments=24, minor_segments=8,
                                    location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    return finish(obj, mat, 0.0, True)


def bolt(name, loc, rot=(math.pi / 2, 0, 0), radius=0.055):
    return cylinder(name, loc, radius, 0.035, CYAN, rot=rot, verts=16, bevel=0.015)


def parent_bone(obj, rig, bone):
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_world = world
    obj["rig_attachment"] = bone


def create_rig():
    arm = bpy.data.armatures.new("AeroGuardian_Skeleton")
    rig = bpy.data.objects.new("RIG_AeroGuardian", arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def eb(name, head, tail, parent=None, connected=False, deform=True):
        bone = arm.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        bone.use_deform = deform
        if parent:
            bone.parent = arm.edit_bones[parent]
            bone.use_connect = connected
        return bone

    eb("root", (0, 0, 0.15), (0, 0, 0.65), deform=False)
    eb("pelvis", (0, 0, 3.25), (0, 0, 4.05), "root")
    eb("spine", (0, 0, 4.05), (0, 0, 4.85), "pelvis", True)
    eb("chest", (0, 0, 4.85), (0, 0, 5.80), "spine", True)
    eb("neck", (0, 0, 5.80), (0, 0, 6.35), "chest", True)
    eb("head", (0, 0, 6.35), (0, 0, 7.85), "neck", True)
    eb("ponytail.01", (0, 0.25, 7.05), (0, 0.38, 6.45), "head")
    eb("ponytail.02", (0, 0.38, 6.45), (0, 0.40, 5.85), "ponytail.01", True)

    for side, x in (("L", 1), ("R", -1)):
        eb(f"upper_arm.{side}", (0.78*x, 0, 5.60), (1.55*x, 0, 4.95), "chest")
        eb(f"forearm.{side}", (1.55*x, 0, 4.95), (1.85*x, 0, 3.95), f"upper_arm.{side}", True)
        eb(f"hand.{side}", (1.85*x, 0, 3.95), (1.90*x, -0.03, 3.38), f"forearm.{side}", True)
        eb(f"thigh.{side}", (0.50*x, 0, 3.35), (0.55*x, 0, 2.15), "pelvis")
        eb(f"shin.{side}", (0.55*x, 0, 2.15), (0.55*x, 0, 0.85), f"thigh.{side}", True)
        eb(f"foot.{side}", (0.55*x, 0, 0.85), (0.55*x, -0.72, 0.42), f"shin.{side}", True)
        eb(f"hand_ik.{side}", (1.85*x, -0.03, 3.95), (1.85*x, -0.03, 3.55), "root", deform=False)
        eb(f"elbow_pole.{side}", (1.5*x, 0.85, 4.9), (1.5*x, 0.85, 5.2), "root", deform=False)
        eb(f"foot_ik.{side}", (0.55*x, -0.72, 0.42), (0.55*x, -0.72, 0.85), "root", deform=False)
        eb(f"knee_pole.{side}", (0.55*x, -0.95, 2.1), (0.55*x, -0.95, 2.4), "root", deform=False)

    bpy.ops.object.mode_set(mode="POSE")
    for side in ("L", "R"):
        con = rig.pose.bones[f"forearm.{side}"].constraints.new("IK")
        con.name = "Arm IK (enable influence)"
        con.target = rig
        con.subtarget = f"hand_ik.{side}"
        con.pole_target = rig
        con.pole_subtarget = f"elbow_pole.{side}"
        con.chain_count = 2
        con.influence = 0.0
        con = rig.pose.bones[f"shin.{side}"].constraints.new("IK")
        con.name = "Leg IK (enable influence)"
        con.target = rig
        con.subtarget = f"foot_ik.{side}"
        con.pole_target = rig
        con.pole_subtarget = f"knee_pole.{side}"
        con.chain_count = 2
        con.influence = 0.0
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.show_in_front = True
    rig.display_type = "WIRE"
    rig["character"] = "Aero Guardian"
    rig["rig_notes"] = "FK animation-ready humanoid; IK controls supplied with constraints at 0 influence. Rigid armor is bone-parented."
    return rig


def create_character(rig):
    parts = []
    def add(obj, bone):
        parent_bone(obj, rig, bone)
        parts.append(obj)
        return obj

    # Core suit and armor.
    add(sphere("Suit_Abdomen", (0, 0, 4.48), (0.58, 0.36, 0.78), RED), "spine")
    add(cylinder("Waist_Joint", (0, 0, 4.08), 0.59, 0.24, DARK, verts=32, bevel=0.06), "spine")
    add(sphere("Chest_Core", (0, 0.0, 5.22), (0.98, 0.47, 0.68), WHITE), "chest")
    add(sphere("Chest_Crimson_Inset", (0, -0.468, 5.03), (0.39, 0.035, 0.30), RED2, 24, 12), "chest")
    add(cone_between("Collar", (-0.01, 0, 5.72), (0, 0, 6.02), 0.56, 0.48, WHITE2, 32), "neck")
    add(sphere("Collar_Cyan", (0, -0.485, 5.87), (0.41, 0.035, 0.06), CYAN, 20, 10), "neck")
    for x in (-0.42, 0.42):
        add(ring(f"Chest_Clasp_{x:+}", (x, -0.395, 5.66), 0.12, 0.035, DARK), "chest")
        add(bolt(f"Chest_Light_{x:+}", (x, -0.43, 5.66), radius=0.055), "chest")
    for i, z in enumerate((5.40, 5.18, 4.96)):
        add(bolt(f"Chest_Button_{i+1}", (0.52, -0.385, z), radius=0.06), "chest")

    add(sphere("Pelvis_Armor", (0, 0.0, 3.69), (0.91, 0.48, 0.43), WHITE), "pelvis")
    add(sphere("Pelvis_Belt", (0, -0.465, 3.86), (0.58, 0.035, 0.09), CYAN, 20, 10), "pelvis")
    add(sphere("Pelvis_Red", (0, -0.445, 3.52), (0.61, 0.045, 0.19), RED2, 20, 10), "pelvis")

    # Head, face and expressive anime features.
    add(sphere("Head", (0, -0.03, 6.92), (0.63, 0.57, 0.74), SKIN), "head")
    add(sphere("Ear_L", (0.61, -0.02, 6.91), (0.11, 0.07, 0.16), SKIN), "head")
    add(sphere("Ear_R", (-0.61, -0.02, 6.91), (0.11, 0.07, 0.16), SKIN), "head")
    for side, x in (("L", 0.22), ("R", -0.22)):
        add(sphere(f"EyeWhite_{side}", (x, -0.585, 7.05), (0.155, 0.030, 0.23), EYE_WHITE, 24, 12), "head")
        add(sphere(f"Iris_{side}", (x, -0.615, 7.03), (0.078, 0.020, 0.135), EYE_BLUE, 20, 10), "head")
        add(sphere(f"Pupil_{side}", (x, -0.635, 7.03), (0.030, 0.010, 0.065), BLACK, 16, 8), "head")
        add(box(f"Brow_{side}", (x, -0.610, 7.30), (0.17, 0.018, 0.025), HAIR_DARK, 0.015,
                rot=(0, (0.10 if side == "L" else -0.10), 0)), "head")
    add(cone_between("Nose", (0, -0.58, 6.98), (0, -0.68, 6.91), 0.035, 0.005, SKIN, 12), "head")
    add(box("Mouth_Smile", (0, -0.625, 6.68), (0.15, 0.014, 0.022), HAIR_DARK, 0.012,
            rot=(0, 0, -0.04)), "head")

    # Layered orange hair cap and graphic spikes.
    add(sphere("Hair_Cap", (0, 0.02, 7.37), (0.60, 0.52, 0.52), HAIR), "head")
    spikes = [
        ((0.22, -0.48, 7.62), (-0.62, -0.53, 7.30), 0.28),
        ((0.08, -0.50, 7.65), (-0.43, -0.54, 7.07), 0.25),
        ((0.34, -0.42, 7.55), (0.05, -0.53, 7.21), 0.20),
        ((0.48, -0.25, 7.48), (0.57, -0.43, 7.13), 0.18),
        ((-0.32, -0.27, 7.51), (-0.68, -0.38, 7.18), 0.18),
        ((0.14, 0.22, 7.70), (0.35, 0.18, 8.00), 0.16),
        ((-0.06, 0.24, 7.71), (-0.02, 0.27, 8.05), 0.14),
    ]
    for i, (a, b, width) in enumerate(spikes):
        add(hair_lock(f"Hair_Lock_{i+1:02d}", a, b, width, HAIR), "head")
    add(ring("Ponytail_Band", (0, 0.37, 6.72), 0.12, 0.04, CYAN, rot=(0, 0, 0)), "ponytail.01")
    add(cone_between("Ponytail_Upper", (0, 0.34, 6.73), (0.03, 0.43, 6.20), 0.20, 0.14, HAIR, 16), "ponytail.01")
    add(cone_between("Ponytail_Lower", (0.03, 0.43, 6.22), (0.08, 0.40, 5.72), 0.15, 0.025, HAIR_DARK, 16), "ponytail.02")

    # Arms: reference asymmetry (left armored, right bare upper arm).
    for side, x in (("L", 1), ("R", -1)):
        upper_mid = 1.17*x
        fore_mid = 1.71*x
        shoulder_bone = f"upper_arm.{side}"
        fore_bone = f"forearm.{side}"
        hand_bone = f"hand.{side}"
        if side == "L":
            add(sphere("Shoulder_Armor_L", (0.88*x, 0, 5.55), (0.40, 0.42, 0.43), WHITE), shoulder_bone)
            add(bolt("Shoulder_Light_L", (0.96*x, -0.41, 5.56), radius=0.075), shoulder_bone)
            add(cone_between("UpperArm_Suit_L", (1.02*x, 0, 5.36), (1.48*x, 0, 4.98), 0.24, 0.20, RED, 20), shoulder_bone)
        else:
            add(cone_between("UpperArm_Bare_R", (0.92*x, 0, 5.45), (1.50*x, 0, 4.98), 0.23, 0.18, SKIN, 20), shoulder_bone)
            add(ring("Arm_Cuff_R", (1.48*x, 0, 4.96), 0.22, 0.055, CYAN, rot=(0, math.pi/2, 0)), shoulder_bone)
        add(cone_between(f"Forearm_Suit_{side}", (1.53*x, 0, 4.90), (1.83*x, 0, 4.02), 0.22, 0.17, RED2, 20), fore_bone)
        add(cone_between(f"Gauntlet_{side}", (1.63*x, 0, 4.62), (1.84*x, 0, 3.93),
                         0.30, 0.23, WHITE, 28), fore_bone)
        add(sphere(f"Gauntlet_Cyan_{side}", (1.79*x, -0.295, 4.12), (0.19, 0.035, 0.07), CYAN, 20, 10), fore_bone)
        add(sphere(f"Hand_{side}", (1.89*x, -0.01, 3.70), (0.25, 0.20, 0.30), RED), hand_bone)
        for finger in range(3):
            fx = 1.89*x + (0.10 - 0.10*finger)*x
            add(cone_between(f"Finger_{side}_{finger+1}", (fx, -0.10, 3.58), (fx, -0.15, 3.34), 0.055, 0.04, RED2, 10), hand_bone)

    # Legs, knee joints, shin armor and oversized boots.
    for side, x in (("L", 1), ("R", -1)):
        thigh_bone, shin_bone, foot_bone = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
        add(cone_between(f"Thigh_Suit_{side}", (0.46*x, 0, 3.38), (0.54*x, 0, 2.26), 0.39, 0.31, RED, 24), thigh_bone)
        add(sphere(f"Thigh_Armor_{side}", (0.53*x, -0.10, 2.91), (0.38, 0.33, 0.57), WHITE), thigh_bone)
        add(sphere(f"Knee_Joint_{side}", (0.55*x, 0, 2.15), (0.31, 0.29, 0.30), DARK), shin_bone)
        add(sphere(f"Knee_Armor_{side}", (0.55*x, -0.27, 2.18), (0.29, 0.13, 0.30), WHITE2), shin_bone)
        add(cone_between(f"Shin_Core_{side}", (0.55*x, 0, 2.00), (0.55*x, 0, 0.91), 0.31, 0.34, RED2, 24), shin_bone)
        add(sphere(f"Shin_Armor_{side}", (0.55*x, -0.10, 1.47), (0.37, 0.34, 0.58), WHITE), shin_bone)
        add(sphere(f"Shin_Cyan_{side}", (0.55*x, -0.435, 1.46), (0.048, 0.025, 0.39), CYAN, 16, 8), shin_bone)
        add(sphere(f"Boot_{side}", (0.55*x, -0.36, 0.58), (0.50, 0.66, 0.40), WHITE), foot_bone)
        add(sphere(f"Boot_Toe_{side}", (0.55*x, -0.78, 0.48), (0.42, 0.39, 0.26), RED2), foot_bone)
        add(sphere(f"Boot_Sole_{side}", (0.55*x, -0.40, 0.25), (0.51, 0.69, 0.12), DARK, 28, 12), foot_bone)
        add(ring(f"Ankle_Ring_{side}", (0.88*x, -0.13, 0.66), 0.16, 0.055, CYAN, rot=(0, math.pi/2, 0)), foot_bone)

    # Put all renderable pieces in a named collection.
    char_col = bpy.data.collections.new("AeroGuardian_Mesh")
    bpy.context.scene.collection.children.link(char_col)
    for obj in parts:
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        char_col.objects.link(obj)
    return parts


def create_actions(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"

    def action(name, frames):
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data_create()
        rig.animation_data.action = act
        for frame, poses in frames.items():
            for bone_name, rotation in poses.items():
                pb = rig.pose.bones[bone_name]
                pb.rotation_euler = rotation
                pb.keyframe_insert("rotation_euler", frame=frame, group=bone_name)
        return act

    idle = action("Idle_Breathe", {
        1: {"spine": (0, 0, -0.025), "chest": (0.01, 0, 0.025), "head": (0, 0, -0.02),
            "upper_arm.L": (0.03, 0.02, -0.03), "upper_arm.R": (-0.03, -0.02, 0.03)},
        20: {"spine": (0.025, 0, 0.0), "chest": (-0.015, 0, 0.0), "head": (-0.012, 0, 0.018),
             "upper_arm.L": (0.02, 0.01, -0.02), "upper_arm.R": (-0.02, -0.01, 0.02)},
        40: {"spine": (0, 0, -0.025), "chest": (0.01, 0, 0.025), "head": (0, 0, -0.02),
             "upper_arm.L": (0.03, 0.02, -0.03), "upper_arm.R": (-0.03, -0.02, 0.03)},
    })
    wave = action("Friendly_Wave", {
        1: {"upper_arm.R": (0, -0.15, 0.05), "forearm.R": (0, 0, 0), "hand.R": (0, 0, 0)},
        10: {"upper_arm.R": (0.15, -0.65, -0.55), "forearm.R": (0.1, 0.15, -1.05), "hand.R": (0, 0.25, 0.0)},
        18: {"upper_arm.R": (0.15, -0.65, -0.55), "forearm.R": (0.1, 0.15, -1.05), "hand.R": (0, -0.25, 0.0)},
        26: {"upper_arm.R": (0.15, -0.65, -0.55), "forearm.R": (0.1, 0.15, -1.05), "hand.R": (0, 0.25, 0.0)},
        34: {"upper_arm.R": (0.15, -0.65, -0.55), "forearm.R": (0.1, 0.15, -1.05), "hand.R": (0, -0.25, 0.0)},
        45: {"upper_arm.R": (0, -0.15, 0.05), "forearm.R": (0, 0, 0), "hand.R": (0, 0, 0)},
    })
    rig.animation_data.action = idle
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 40
    bpy.context.scene.frame_set(1)
    return idle, wave


def setup_scene(rig):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = RENDER_PATH
    scene.render.film_transparent = False
    scene.world.color = (0.035, 0.045, 0.065)
    world = scene.world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.025, 0.035, 0.055, 1)
    bg.inputs["Strength"].default_value = 0.32

    floor = cylinder("Display_Plint", (0, 0, 0.05), 2.25, 0.18, DARK, verts=64, bevel=0.07)
    ring("Plinth_Cyan", (0, 0, 0.15), 1.78, 0.035, CYAN, rot=(0, 0, 0))

    bpy.ops.object.camera_add(location=(10.8, -15.5, 8.6))
    cam = bpy.context.object
    cam.name = "Camera_Hero"
    scene.camera = cam
    target = Vector((0, 0, 4.15))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 64

    def light(name, loc, energy, color, size):
        bpy.ops.object.light_add(type="AREA", location=loc)
        obj = bpy.context.object
        obj.name = name
        obj.data.energy = energy
        obj.data.color = color
        obj.data.shape = "DISK"
        obj.data.size = size
        obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    light("Key", (5, -7, 10), 1200, (1.0, 0.72, 0.55), 4.0)
    light("Fill", (-6, -4, 6), 850, (0.35, 0.65, 1.0), 4.0)
    light("Rim", (3, 5, 9), 1500, (0.0, 0.75, 1.0), 3.0)

    scene["asset_name"] = "Aero Guardian"
    scene["source_reference"] = "codex-clipboard-08f9178f-74a8-42bd-a4f7-0580c0b1b925.png"
    scene["design_notes"] = "Stylized anime sci-fi hero: orange ponytail, ivory/crimson armor, cyan energy accents, asymmetric arms."


def save_export_render(rig):
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    try:
        bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format="GLB", export_animations=True,
                                  export_skins=True, export_apply=False)
    except Exception as exc:
        print("GLB export warning:", exc)
    bpy.context.scene.render.filepath = RENDER_PATH
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)


clear_scene()
rig = create_rig()
parts = create_character(rig)
idle, wave = create_actions(rig)
setup_scene(rig)
save_export_render(rig)
print(f"CREATED {BLEND_PATH}")
print(f"PARTS {len(parts)} BONES {len(rig.data.bones)} ACTIONS {len(bpy.data.actions)}")
