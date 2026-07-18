using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Editor.DungeonV2
{
    /// <summary>
    /// Editor-only, deterministic extraction of the three existing industrial
    /// room GLBs. glTFast owns import; this command converts imported meshes to
    /// project-owned, collision-free presentation assets with normalized
    /// normals, UV0, semantic materials, and stable node names. It never adds
    /// authoritative traversal collision.
    /// </summary>
    public static class DungeonSourceGlbExtractorV2
    {
        private const string OutputRoot =
            "Assets/RuinCrawler/Art/DungeonV2/ImportedProps";
        private const string ManifestPath =
            OutputRoot + "/dungeon_v2_imported_props_manifest.json";
        private const string ProfileId = "industrial-factory-v2";
        private const string ExtractorVersion = "dungeon-source-glb-extractor-v2.1";

        private static readonly Source[] Sources =
        {
            new Source(
                "server_crypt_source",
                "Packages/com.ruincrawler.source-assets/models/rooms/alien_server_room_example.glb",
                "Factory"),
            new Source(
                "coolant_works_source",
                "Packages/com.ruincrawler.source-assets/models/rooms/industrial_coolant_relay_puzzle_room.glb",
                "Waterworks"),
            new Source(
                "machine_factory_source",
                "Packages/com.ruincrawler.source-assets/models/rooms/industrial_machine_factory_room.glb",
                "Factory")
        };

        [MenuItem("Tools/RuinCrawler/Dungeon V2/Extract Existing Industrial GLBs")]
        public static void ExtractAll()
        {
            EnsureFolder(OutputRoot);
            var failures = new List<string>();
            var extractedSources = new List<SourceManifestRecord>();
            foreach (Source source in Sources)
            {
                try
                {
                    extractedSources.Add(Extract(source));
                }
                catch (Exception exception)
                {
                    failures.Add(source.Id + ": " + exception.Message);
                }
            }

            AssetDatabase.SaveAssets();
            if (failures.Count > 0)
            {
                throw new InvalidOperationException(
                    "Dungeon source GLB extraction failed:\n- "
                    + string.Join("\n- ", failures));
            }

            WriteManifest(extractedSources);
            AssetDatabase.ImportAsset(ManifestPath, ImportAssetOptions.ForceSynchronousImport);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("Extracted three project-owned Dungeon V2 industrial prop libraries.");
        }

        private static SourceManifestRecord Extract(Source source)
        {
            string physicalSourcePath = ResolvePhysicalAssetPath(source.AssetPath);
            string sourceSha256 = ComputeSha256(physicalSourcePath);
            long sourceByteLength = new FileInfo(physicalSourcePath).Length;
            GameObject imported = AssetDatabase.LoadAssetAtPath<GameObject>(source.AssetPath);
            if (imported == null)
            {
                throw new InvalidOperationException(
                    "The GLB is not imported as a GameObject. Confirm com.unity.cloud.gltfast is installed: "
                    + source.AssetPath);
            }

            string folder = OutputRoot + "/" + source.Id;
            EnsureFolder(folder);
            GameObject instance = UnityEngine.Object.Instantiate(imported);
            instance.name = source.Id + "_ImportScratch";
            var prefabRoot = new GameObject(source.Id);
            var outputs = new List<OutputManifestRecord>();
            try
            {
                var staticGroups = new Dictionary<GroupKey, List<MeshPart>>();
                foreach (MeshFilter filter in instance.GetComponentsInChildren<MeshFilter>(true)
                    .OrderBy(value => HierarchyPath(value.transform), StringComparer.Ordinal))
                {
                    MeshRenderer renderer = filter.GetComponent<MeshRenderer>();
                    if (renderer == null || filter.sharedMesh == null) continue;

                    string nodeName = filter.gameObject.name;
                    string sourceNodePath = HierarchyPathRelativeTo(
                        instance.transform,
                        filter.transform);
                    string zone = ClassifyZone(nodeName);
                    Material material = ResolveMaterial(source.Theme, nodeName, zone);
                    Mesh processed = ProcessMesh(filter.sharedMesh, nodeName);
                    Matrix4x4 localMatrix = instance.transform.worldToLocalMatrix
                        * filter.transform.localToWorldMatrix;

                    if (IsMechanism(nodeName))
                    {
                        string meshPath = folder + "/" + SafeName(nodeName) + ".asset";
                        processed.name = source.Id + "__" + SafeName(nodeName);
                        Mesh saved = StoreMesh(meshPath, processed);
                        GameObject child = new GameObject(nodeName);
                        child.transform.SetParent(prefabRoot.transform, false);
                        ApplyMatrix(child.transform, localMatrix);
                        child.AddComponent<MeshFilter>().sharedMesh = saved;
                        child.AddComponent<MeshRenderer>().sharedMaterial = material;
                        outputs.Add(new OutputManifestRecord
                        {
                            outputObjectName = nodeName,
                            meshAssetPath = meshPath,
                            materialAssetPath = AssetDatabase.GetAssetPath(material),
                            zone = zone,
                            isMechanism = true,
                            sourceNodePaths = new[] { sourceNodePath }
                        });
                        continue;
                    }

                    var key = new GroupKey(zone, AssetDatabase.GetAssetPath(material));
                    if (!staticGroups.TryGetValue(key, out List<MeshPart> parts))
                    {
                        parts = new List<MeshPart>();
                        staticGroups.Add(key, parts);
                    }
                    parts.Add(new MeshPart(processed, localMatrix, sourceNodePath));
                }

                foreach (KeyValuePair<GroupKey, List<MeshPart>> group in staticGroups
                    .OrderBy(value => value.Key.Zone, StringComparer.Ordinal)
                    .ThenBy(value => value.Key.MaterialPath, StringComparer.Ordinal))
                {
                    string materialName = Path.GetFileNameWithoutExtension(group.Key.MaterialPath);
                    string outputObjectName = source.Id + "_" + group.Key.Zone + "_"
                        + materialName + "_StaticGroup";
                    var combined = new Mesh
                    {
                        name = outputObjectName,
                        indexFormat = UnityEngine.Rendering.IndexFormat.UInt32
                    };
                    combined.CombineMeshes(group.Value.Select(value => new CombineInstance
                    {
                        mesh = value.Mesh,
                        transform = value.Transform
                    }).ToArray(), true, true, false);
                    combined.RecalculateBounds();
                    string meshPath = folder + "/" + SafeName(outputObjectName) + ".asset";
                    Mesh saved = StoreMesh(meshPath, combined);
                    var child = new GameObject(outputObjectName);
                    child.transform.SetParent(prefabRoot.transform, false);
                    child.AddComponent<MeshFilter>().sharedMesh = saved;
                    child.AddComponent<MeshRenderer>().sharedMaterial =
                        AssetDatabase.LoadAssetAtPath<Material>(group.Key.MaterialPath);
                    outputs.Add(new OutputManifestRecord
                    {
                        outputObjectName = outputObjectName,
                        meshAssetPath = meshPath,
                        materialAssetPath = group.Key.MaterialPath,
                        zone = group.Key.Zone,
                        isMechanism = false,
                        sourceNodePaths = group.Value
                            .Select(value => value.SourceNodePath)
                            .OrderBy(value => value, StringComparer.Ordinal)
                            .ToArray()
                    });
                    foreach (MeshPart part in group.Value)
                        UnityEngine.Object.DestroyImmediate(part.Mesh);
                }

                string prefabPath = folder + "/" + source.Id + ".prefab";
                GameObject savedPrefab = PrefabUtility.SaveAsPrefabAsset(
                    prefabRoot,
                    prefabPath);
                AssetDatabase.SetLabels(savedPrefab, new[]
                {
                    "RuinCrawlerDungeonV2Extracted",
                    source.Id,
                    source.Theme
                });

                return new SourceManifestRecord
                {
                    id = source.Id,
                    theme = source.Theme,
                    sourceAssetPath = source.AssetPath,
                    sourceAssetGuid = AssetDatabase.AssetPathToGUID(source.AssetPath),
                    sourceSha256 = sourceSha256,
                    sourceByteLength = sourceByteLength,
                    sourceMeshNodeCount = outputs.Sum(value => value.sourceNodePaths.Length),
                    outputPrefabPath = prefabPath,
                    outputs = outputs
                        .OrderBy(value => value.outputObjectName, StringComparer.Ordinal)
                        .ThenBy(value => value.meshAssetPath, StringComparer.Ordinal)
                        .ToArray()
                };
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
                UnityEngine.Object.DestroyImmediate(prefabRoot);
            }
        }

        private static Mesh ProcessMesh(Mesh source, string nodeName)
        {
            Mesh mesh = UnityEngine.Object.Instantiate(source);
            mesh.name = SafeName(nodeName) + "_processed";
            mesh.RecalculateNormals();
            Vector3[] vertices = mesh.vertices;
            Vector3[] normals = mesh.normals;
            var uv = new Vector2[vertices.Length];
            for (int index = 0; index < vertices.Length; index += 1)
            {
                Vector3 normal = index < normals.Length ? normals[index] : Vector3.up;
                Vector3 vertex = vertices[index];
                Vector3 absolute = new Vector3(Mathf.Abs(normal.x), Mathf.Abs(normal.y), Mathf.Abs(normal.z));
                if (absolute.y >= absolute.x && absolute.y >= absolute.z)
                    uv[index] = new Vector2(vertex.x, vertex.z) * 0.25f;
                else if (absolute.x >= absolute.z)
                    uv[index] = new Vector2(vertex.z, vertex.y) * 0.25f;
                else
                    uv[index] = new Vector2(vertex.x, vertex.y) * 0.25f;
            }
            mesh.uv = uv;
            mesh.RecalculateTangents();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh StoreMesh(string path, Mesh generated)
        {
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(generated, path);
                return generated;
            }

            EditorUtility.CopySerialized(generated, existing);
            UnityEngine.Object.DestroyImmediate(generated);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        private static Material ResolveMaterial(string theme, string name, string zone)
        {
            string lower = name.ToLowerInvariant();
            string materialName;
            // Every authored fluid volume uses the explicit `liquid` semantic.
            // `coolant` also appears in opaque tank, cap, pipe, and status-light
            // node names and must not route those solids through a transparent
            // water-surface shader.
            if (lower.Contains("liquid"))
                materialName = "WaterworksSurface";
            else if (lower.Contains("pipe") || lower.Contains("valve") || lower.Contains("tank"))
                materialName = theme == "Waterworks" ? "WaterworksPipes" : "FactoryConduit";
            else if (lower.Contains("floor") || lower.Contains("bridge") || lower.Contains("catwalk")
                || lower.Contains("stair") || lower.Contains("walkway"))
                materialName = theme == "Waterworks" ? "WaterworksFloor" : "FactoryCatwalk";
            else if (zone == "Structural")
                materialName = theme == "Waterworks" ? "WaterworksWall" : "FactoryWall";
            else
                materialName = theme == "Waterworks" ? "WaterworksPipes" : "FactoryConduit";

            string path = "Assets/RuinCrawler/Art/DungeonV2/Materials/" + materialName + ".mat";
            Material result = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (result == null) throw new InvalidOperationException("Missing semantic material: " + path);
            return result;
        }

        private static string ClassifyZone(string name)
        {
            string lower = name.ToLowerInvariant();
            if (lower.Contains("floor") || lower.Contains("wall") || lower.Contains("catwalk")
                || lower.Contains("bridge") || lower.Contains("rail") || lower.Contains("stair")
                || lower.Contains("support") || lower.Contains("trim") || lower.Contains("seam")
                || lower.Contains("grate")) return "Structural";
            if (lower.Contains("screen") || lower.Contains("light") || lower.Contains("eye")
                || lower.Contains("crystal") || lower.Contains("energy") || lower.Contains("status")
                || lower.Contains("flow") || lower.Contains("liquid")) return "Emissive";
            if (lower.Contains("tank") || lower.Contains("pipe") || lower.Contains("server")
                || lower.Contains("conveyor") || lower.Contains("machine") || lower.Contains("press")
                || lower.Contains("reaverbot")) return "Machinery";
            return "Props";
        }

        private static bool IsMechanism(string name)
        {
            string lower = name.ToLowerInvariant();
            return lower.Contains("valve") || lower.Contains("console") || lower.Contains("gate")
                || lower.Contains("robot_arm") || lower.Contains("piston")
                || lower.Contains("crane_trolley") || lower.Contains("crane_hook")
                || lower.Contains("refractor") || lower.Contains("pressure_core");
        }

        private static void ApplyMatrix(Transform target, Matrix4x4 matrix)
        {
            target.localPosition = matrix.GetColumn(3);
            target.localRotation = Quaternion.LookRotation(matrix.GetColumn(2), matrix.GetColumn(1));
            target.localScale = new Vector3(
                matrix.GetColumn(0).magnitude,
                matrix.GetColumn(1).magnitude,
                matrix.GetColumn(2).magnitude);
        }

        private static string HierarchyPath(Transform target)
        {
            string path = target.name;
            while (target.parent != null)
            {
                target = target.parent;
                path = target.name + "/" + path;
            }
            return path;
        }

        private static string HierarchyPathRelativeTo(Transform root, Transform target)
        {
            var segments = new Stack<string>();
            Transform cursor = target;
            while (cursor != null && cursor != root)
            {
                segments.Push(cursor.name);
                cursor = cursor.parent;
            }
            if (cursor != root)
                throw new InvalidOperationException(target.name + " is not below " + root.name + ".");
            return string.Join("/", segments);
        }

        private static string SafeName(string value)
        {
            char[] invalid = Path.GetInvalidFileNameChars();
            return new string(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray());
        }

        private static void EnsureFolder(string path)
        {
            string current = "Assets";
            foreach (string segment in path.Split('/').Skip(1))
            {
                string next = current + "/" + segment;
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, segment);
                current = next;
            }
        }

        private static void WriteManifest(IEnumerable<SourceManifestRecord> sources)
        {
            var manifest = new ExtractionManifest
            {
                schemaVersion = 1,
                profileId = ProfileId,
                extractorVersion = ExtractorVersion,
                sources = sources
                    .OrderBy(value => value.id, StringComparer.Ordinal)
                    .ToArray()
            };
            string projectRoot = Directory.GetParent(Application.dataPath)?.FullName
                ?? throw new InvalidOperationException("Unable to resolve the Unity project root.");
            string absolutePath = Path.Combine(
                projectRoot,
                ManifestPath.Replace('/', Path.DirectorySeparatorChar));
            File.WriteAllText(
                absolutePath,
                JsonUtility.ToJson(manifest, true) + "\n",
                new UTF8Encoding(false));
        }

        private static string ResolvePhysicalAssetPath(string assetPath)
        {
            if (assetPath.StartsWith("Assets/", StringComparison.Ordinal))
            {
                string projectRoot = Directory.GetParent(Application.dataPath)?.FullName
                    ?? throw new InvalidOperationException("Unable to resolve the Unity project root.");
                return Path.Combine(projectRoot, assetPath.Replace('/', Path.DirectorySeparatorChar));
            }

            if (assetPath.StartsWith("Packages/", StringComparison.Ordinal))
            {
                UnityEditor.PackageManager.PackageInfo package =
                    UnityEditor.PackageManager.PackageInfo.FindForAssetPath(assetPath);
                if (package == null)
                    throw new InvalidOperationException("Unable to resolve source package for " + assetPath);
                string packagePrefix = "Packages/" + package.name;
                string relativePath = assetPath.Substring(packagePrefix.Length)
                    .TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                return Path.Combine(package.resolvedPath, relativePath);
            }

            throw new InvalidOperationException("Unsupported Unity asset path: " + assetPath);
        }

        private static string ComputeSha256(string path)
        {
            using (var stream = File.OpenRead(path))
            using (SHA256 sha256 = SHA256.Create())
            {
                return BitConverter.ToString(sha256.ComputeHash(stream))
                    .Replace("-", string.Empty)
                    .ToLowerInvariant();
            }
        }

        [Serializable]
        private sealed class ExtractionManifest
        {
            public int schemaVersion;
            public string profileId;
            public string extractorVersion;
            public SourceManifestRecord[] sources;
        }

        [Serializable]
        private sealed class SourceManifestRecord
        {
            public string id;
            public string theme;
            public string sourceAssetPath;
            public string sourceAssetGuid;
            public string sourceSha256;
            public long sourceByteLength;
            public int sourceMeshNodeCount;
            public string outputPrefabPath;
            public OutputManifestRecord[] outputs;
        }

        [Serializable]
        private sealed class OutputManifestRecord
        {
            public string outputObjectName;
            public string meshAssetPath;
            public string materialAssetPath;
            public string zone;
            public bool isMechanism;
            public string[] sourceNodePaths;
        }

        private readonly struct Source
        {
            public Source(string id, string assetPath, string theme)
            {
                Id = id;
                AssetPath = assetPath;
                Theme = theme;
            }
            public string Id { get; }
            public string AssetPath { get; }
            public string Theme { get; }
        }

        private readonly struct GroupKey : IEquatable<GroupKey>
        {
            public GroupKey(string zone, string materialPath)
            {
                Zone = zone;
                MaterialPath = materialPath;
            }
            public string Zone { get; }
            public string MaterialPath { get; }
            public bool Equals(GroupKey other) => Zone == other.Zone && MaterialPath == other.MaterialPath;
            public override bool Equals(object obj) => obj is GroupKey other && Equals(other);
            public override int GetHashCode() => (Zone?.GetHashCode() ?? 0) * 397 ^ (MaterialPath?.GetHashCode() ?? 0);
        }

        private readonly struct MeshPart
        {
            public MeshPart(Mesh mesh, Matrix4x4 transform, string sourceNodePath)
            {
                Mesh = mesh;
                Transform = transform;
                SourceNodePath = sourceNodePath;
            }
            public Mesh Mesh { get; }
            public Matrix4x4 Transform { get; }
            public string SourceNodePath { get; }
        }
    }
}
