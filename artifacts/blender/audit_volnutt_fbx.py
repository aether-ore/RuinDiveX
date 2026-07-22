import bpy

path = r"C:\Users\K\Documents\New Three.js Practice\assets\models\Mega Man Volnutt.fbx"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=path)
for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        print("MESH", obj.name, len(obj.data.vertices), len(obj.data.polygons), [m.name for m in obj.data.materials])
    elif obj.type == "ARMATURE":
        print("ARMATURE", obj.name, len(obj.data.bones), [b.name for b in obj.data.bones])
