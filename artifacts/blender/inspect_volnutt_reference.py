import bpy
import os
from mathutils import Vector

root = r"C:\Users\K\Documents\New Three.js Practice"
obj_path = os.path.join(root, "assets", "models", "Mega Man Volnutt.obj")
out_path = os.path.join(root, "artifacts", "blender", "volnutt_reference_preview.png")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.wm.obj_import(filepath=obj_path)
models = [o for o in bpy.context.selected_objects if o.type == "MESH"]

points = [o.matrix_world @ Vector(corner) for o in models for corner in o.bound_box]
min_v = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
max_v = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
center = (min_v + max_v) * 0.5
height = max_v.z - min_v.z
scale = 7.6 / height
for obj in models:
    obj.location -= center
    obj.scale *= scale
    obj.location *= scale

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 720
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = out_path
scene.world.color = (0.03, 0.04, 0.06)

bpy.ops.object.camera_add(location=(9.3, -13.8, 6.6))
cam = bpy.context.object
target = Vector((0, 0, 3.7))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 62
scene.camera = cam

for name, loc, energy, color, size in (
    ("Key", (5, -7, 10), 1100, (1.0, 0.8, 0.65), 4),
    ("Fill", (-5, -4, 6), 700, (0.35, 0.6, 1.0), 4),
    ("Rim", (3, 5, 8), 1200, (0.1, 0.7, 1.0), 3),
):
    bpy.ops.object.light_add(type="AREA", location=loc)
    lamp = bpy.context.object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.color = color
    lamp.data.shape = "DISK"
    lamp.data.size = size
    lamp.rotation_euler = (target - lamp.location).to_track_quat("-Z", "Y").to_euler()

bpy.ops.render.render(write_still=True)
print("REFERENCE_AUDIT", {
    "objects": len(models),
    "vertices": sum(len(o.data.vertices) for o in models),
    "polygons": sum(len(o.data.polygons) for o in models),
    "original_bounds": [list(min_v), list(max_v)],
    "materials": [m.name for m in bpy.data.materials],
})
