using System;
using System.Collections.Generic;
using System.Globalization;
using RuinCrawler.Core.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.Reaverbots
{
    public enum ReaverbotSemanticRole
    {
        PrimaryArmor,
        SecondaryArmor,
        WeaponHousing,
        Trim,
        DarkJoint,
        Emissive,
        RubyEye,
        WeakPoint,
        Defense,
    }

    public sealed class ReaverbotSemanticPart : MonoBehaviour
    {
        [SerializeField] private string aspect;
        [SerializeField] private string moduleId;
        [SerializeField] private ReaverbotSemanticRole role;

        public string Aspect => aspect;
        public string ModuleId => moduleId;
        public ReaverbotSemanticRole Role => role;

        public void Configure(string sourceAspect, string sourceModuleId, ReaverbotSemanticRole semanticRole)
        {
            aspect = sourceAspect ?? string.Empty;
            moduleId = sourceModuleId ?? string.Empty;
            role = semanticRole;
        }
    }

    /// <summary>
    /// Owns the small palette/role material set shared by all generated
    /// Reaverbot instances in one spawner. Geometry uses Unity's shared
    /// primitive meshes, so only these materials require explicit disposal.
    /// </summary>
    public sealed class ReaverbotMaterialLibrary : IDisposable
    {
        private readonly Dictionary<string, Material> materials = new Dictionary<string, Material>(StringComparer.Ordinal);
        private bool disposed;

        public int MaterialCount => materials.Count;

        public Material Get(ReaverbotPaletteDefinition palette, ReaverbotSemanticRole role)
        {
            if (disposed)
            {
                throw new ObjectDisposedException(nameof(ReaverbotMaterialLibrary));
            }

            if (palette == null)
            {
                throw new ArgumentNullException(nameof(palette));
            }

            string key = palette.Id + ":" + role;
            if (materials.TryGetValue(key, out Material existing) && existing != null)
            {
                return existing;
            }

            Shader shader = Shader.Find("Universal Render Pipeline/Lit")
                ?? Shader.Find("Standard")
                ?? Shader.Find("Sprites/Default");
            var material = new Material(shader)
            {
                name = "Reaverbot_" + palette.Id + "_" + role,
                enableInstancing = true,
                hideFlags = HideFlags.DontSave,
            };
            Color color = ResolveColor(palette, role);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Color")) material.SetColor("_Color", color);
            if (role == ReaverbotSemanticRole.Emissive
                || role == ReaverbotSemanticRole.RubyEye
                || role == ReaverbotSemanticRole.WeakPoint)
            {
                material.EnableKeyword("_EMISSION");
                if (material.HasProperty("_EmissionColor"))
                {
                    material.SetColor("_EmissionColor", color * (role == ReaverbotSemanticRole.RubyEye ? 2.4f : 1.7f));
                }
            }

            materials.Add(key, material);
            return material;
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            foreach (Material material in materials.Values)
            {
                if (material == null) continue;
                if (Application.isPlaying) UnityEngine.Object.Destroy(material);
                else UnityEngine.Object.DestroyImmediate(material);
            }
            materials.Clear();
        }

        private static Color ResolveColor(ReaverbotPaletteDefinition palette, ReaverbotSemanticRole role)
        {
            uint rgb = role switch
            {
                ReaverbotSemanticRole.PrimaryArmor => palette.Primary,
                ReaverbotSemanticRole.SecondaryArmor => palette.Secondary,
                ReaverbotSemanticRole.WeaponHousing => palette.Secondary,
                ReaverbotSemanticRole.Trim => palette.Trim,
                ReaverbotSemanticRole.DarkJoint => palette.Dark,
                ReaverbotSemanticRole.Defense => palette.Trim,
                ReaverbotSemanticRole.RubyEye => 0xff254fu,
                ReaverbotSemanticRole.WeakPoint => palette.Emissive,
                _ => palette.Emissive,
            };
            return new Color32(
                (byte)((rgb >> 16) & 0xffu),
                (byte)((rgb >> 8) & 0xffu),
                (byte)(rgb & 0xffu),
                255);
        }
    }

    public sealed class ReaverbotVisualRig
    {
        private readonly Vector3 weakPointBaseScale;

        internal ReaverbotVisualRig(
            Transform visualRoot,
            Transform bodyAim,
            Transform muzzle,
            Transform weakPoint,
            Renderer weakPointRenderer,
            GameObject telegraph,
            string visualKey)
        {
            VisualRoot = visualRoot;
            BodyAim = bodyAim;
            Muzzle = muzzle;
            WeakPoint = weakPoint;
            WeakPointRenderer = weakPointRenderer;
            Telegraph = telegraph;
            VisualKey = visualKey;
            weakPointBaseScale = weakPoint != null ? weakPoint.localScale : Vector3.one;
        }

        public Transform VisualRoot { get; }
        public Transform BodyAim { get; }
        public Transform Muzzle { get; }
        public Transform WeakPoint { get; }
        public Renderer WeakPointRenderer { get; }
        public GameObject Telegraph { get; }
        public string VisualKey { get; }

        public void SetTelegraph(bool visible, float normalizedProgress = 0f)
        {
            if (Telegraph == null) return;
            Telegraph.SetActive(visible);
            if (visible)
            {
                float scale = Mathf.Lerp(0.35f, 1.25f, Mathf.Clamp01(normalizedProgress));
                Telegraph.transform.localScale = Vector3.one * scale;
            }
        }

        public void SetWeakPointExposed(bool exposed)
        {
            if (WeakPoint == null) return;
            WeakPoint.localScale = weakPointBaseScale * (exposed ? 1.15f : 0.72f);
        }

        public void ResetPose()
        {
            if (VisualRoot != null)
            {
                VisualRoot.localRotation = Quaternion.identity;
                VisualRoot.localPosition = Vector3.zero;
            }
            SetTelegraph(false);
            SetWeakPointExposed(false);
        }

        public void SetDeathPose(float normalizedProgress)
        {
            if (VisualRoot == null) return;
            float eased = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(normalizedProgress));
            VisualRoot.localRotation = Quaternion.Euler(0f, 0f, -82f * eased);
            VisualRoot.localPosition = new Vector3(0f, -0.18f * eased, 0f);
        }
    }

    public static class ReaverbotVisualFactory
    {
        public static ReaverbotVisualRig Build(
            Transform instanceRoot,
            ReaverbotGenome genome,
            ReaverbotMaterialLibrary materials)
        {
            if (instanceRoot == null) throw new ArgumentNullException(nameof(instanceRoot));
            if (genome == null) throw new ArgumentNullException(nameof(genome));
            if (materials == null) throw new ArgumentNullException(nameof(materials));

            var visualObject = new GameObject("GeneratedVisual_" + genome.GenomeId);
            visualObject.transform.SetParent(instanceRoot, false);
            Transform visualRoot = visualObject.transform;

            float height = Mathf.Max(0.8f, (float)genome.Stats.CollisionHeight);
            float radius = Mathf.Max(0.32f, (float)genome.Stats.Radius);
            float torsoWidth = radius * Mathf.Lerp(1.2f, 1.8f, (float)genome.Body.Proportions.TorsoWidth);
            float torsoLength = radius * Mathf.Lerp(1.15f, 2.0f, (float)genome.Body.Proportions.TorsoLength);
            float torsoHeight = height * 0.38f;
            float torsoY = height * 0.58f;
            string mobilityId = genome.Body.MobilitySalvageId ?? genome.Body.PlanId;

            BuildBody(
                visualRoot,
                genome,
                materials,
                height,
                radius,
                torsoWidth,
                torsoLength,
                torsoHeight,
                torsoY,
                mobilityId);

            Transform bodyAim = CreateAnchor(visualRoot, "BodyAim", new Vector3(0f, height * 0.64f, 0f));
            Transform eye = BuildEye(visualRoot, genome, materials, height, radius, torsoLength);
            Transform muzzle = BuildWeapon(visualRoot, genome, materials, height, radius, torsoWidth, torsoLength);
            BuildChargeModule(visualRoot, genome, materials, height, radius);
            BuildDefense(visualRoot, genome, materials, height, radius, torsoWidth, torsoLength);
            Transform weakPoint = BuildWeakPoint(
                visualRoot,
                genome,
                materials,
                eye,
                height,
                radius,
                torsoWidth,
                torsoLength);
            Renderer weakRenderer = weakPoint != null ? weakPoint.GetComponentInChildren<Renderer>(true) : null;

            GameObject telegraph = CreatePrimitive(
                PrimitiveType.Sphere,
                "AttackTelegraph",
                muzzle,
                Vector3.zero,
                Vector3.one * Mathf.Max(0.08f, radius * 0.18f),
                Quaternion.identity,
                materials.Get(genome.Palette, ReaverbotSemanticRole.Emissive),
                "weapon",
                genome.Modules.Weapon.Id,
                ReaverbotSemanticRole.Emissive);
            telegraph.SetActive(false);

            return new ReaverbotVisualRig(
                visualRoot,
                bodyAim,
                muzzle,
                weakPoint,
                weakRenderer,
                telegraph,
                CreateVisualKey(genome));
        }

        public static string CreateVisualKey(ReaverbotGenome genome)
        {
            if (genome == null) throw new ArgumentNullException(nameof(genome));
            ReaverbotProportions p = genome.Body.Proportions;
            return string.Join(
                ":",
                genome.ArchetypeId,
                genome.Body.PlanId,
                genome.Body.MobilityId,
                genome.Modules.Weapon.Id,
                genome.Modules.Defense?.Id ?? "none",
                genome.Modules.WeakPoint.Id,
                genome.PaletteId,
                p.OverallScale.ToString("F3", CultureInfo.InvariantCulture),
                p.TorsoWidth.ToString("F3", CultureInfo.InvariantCulture),
                p.TorsoLength.ToString("F3", CultureInfo.InvariantCulture),
                p.LimbLength.ToString("F3", CultureInfo.InvariantCulture));
        }

        private static void BuildBody(
            Transform root,
            ReaverbotGenome genome,
            ReaverbotMaterialLibrary materials,
            float height,
            float radius,
            float torsoWidth,
            float torsoLength,
            float torsoHeight,
            float torsoY,
            string mobilityId)
        {
            Material primary = materials.Get(genome.Palette, ReaverbotSemanticRole.PrimaryArmor);
            Material secondary = materials.Get(genome.Palette, ReaverbotSemanticRole.SecondaryArmor);
            Material joints = materials.Get(genome.Palette, ReaverbotSemanticRole.DarkJoint);
            string plan = genome.Body.PlanId;

            if (plan == "hoverBell")
            {
                CreatePrimitive(PrimitiveType.Cylinder, "HoverBellBody", root,
                    new Vector3(0f, torsoY, 0f),
                    new Vector3(torsoWidth, torsoHeight * 0.5f, torsoLength),
                    Quaternion.identity, primary, "body", mobilityId, ReaverbotSemanticRole.PrimaryArmor);
                CreatePrimitive(PrimitiveType.Cylinder, "HoverSkirt", root,
                    new Vector3(0f, height * 0.28f, 0f),
                    new Vector3(radius * 2.2f, height * 0.08f, radius * 2.2f),
                    Quaternion.identity, secondary, "body", mobilityId, ReaverbotSemanticRole.SecondaryArmor);
                return;
            }

            if (plan == "flyer")
            {
                CreatePrimitive(PrimitiveType.Sphere, "FlyerCore", root,
                    new Vector3(0f, torsoY, 0f),
                    new Vector3(torsoWidth, torsoHeight, torsoLength),
                    Quaternion.identity, primary, "body", mobilityId, ReaverbotSemanticRole.PrimaryArmor);
                for (int side = -1; side <= 1; side += 2)
                {
                    CreatePrimitive(PrimitiveType.Cube, side < 0 ? "LeftWing" : "RightWing", root,
                        new Vector3(side * torsoWidth * 0.72f, torsoY, -radius * 0.08f),
                        new Vector3(torsoWidth * 0.8f, height * 0.08f, torsoLength * 0.72f),
                        Quaternion.Euler(0f, 0f, side * -8f), secondary, "body", mobilityId, ReaverbotSemanticRole.SecondaryArmor);
                }
                return;
            }

            if (plan == "crawler")
            {
                CreatePrimitive(PrimitiveType.Cube, "CrawlerHull", root,
                    new Vector3(0f, height * 0.5f, 0f),
                    new Vector3(torsoWidth, torsoHeight, torsoLength * 1.3f),
                    Quaternion.identity, primary, "body", mobilityId, ReaverbotSemanticRole.PrimaryArmor);
                for (int side = -1; side <= 1; side += 2)
                {
                    CreatePrimitive(PrimitiveType.Cube, side < 0 ? "LeftTrack" : "RightTrack", root,
                        new Vector3(side * torsoWidth * 0.64f, height * 0.23f, 0f),
                        new Vector3(radius * 0.38f, height * 0.25f, torsoLength * 1.5f),
                        Quaternion.identity, joints, "body", mobilityId, ReaverbotSemanticRole.DarkJoint);
                }
                return;
            }

            CreatePrimitive(PrimitiveType.Cube, "Torso", root,
                new Vector3(0f, torsoY, 0f),
                new Vector3(torsoWidth, torsoHeight, torsoLength),
                Quaternion.identity, primary, "body", mobilityId, ReaverbotSemanticRole.PrimaryArmor);

            int legCount = plan == "quadruped" ? 4 : plan == "tripod" ? 3 : 2;
            float legHeight = Mathf.Max(height * 0.34f, 0.3f);
            for (int index = 0; index < legCount; index += 1)
            {
                float x;
                float z;
                if (legCount == 4)
                {
                    x = (index % 2 == 0 ? -1f : 1f) * torsoWidth * 0.42f;
                    z = (index < 2 ? -1f : 1f) * torsoLength * 0.35f;
                }
                else if (legCount == 3)
                {
                    float angle = (index * Mathf.PI * 2f / 3f) + Mathf.PI * 0.5f;
                    x = Mathf.Cos(angle) * torsoWidth * 0.48f;
                    z = Mathf.Sin(angle) * torsoLength * 0.42f;
                }
                else
                {
                    x = (index == 0 ? -1f : 1f) * torsoWidth * 0.35f;
                    z = 0f;
                }

                CreatePrimitive(PrimitiveType.Cube, "MobilityLeg_" + index, root,
                    new Vector3(x, legHeight * 0.5f, z),
                    new Vector3(radius * 0.25f, legHeight, radius * 0.28f),
                    Quaternion.Euler(index % 2 == 0 ? -4f : 4f, 0f, 0f),
                    secondary, "body", mobilityId, ReaverbotSemanticRole.SecondaryArmor);
                CreatePrimitive(PrimitiveType.Cube, "Foot_" + index, root,
                    new Vector3(x, radius * 0.11f, z + radius * 0.12f),
                    new Vector3(radius * 0.42f, radius * 0.2f, radius * 0.58f),
                    Quaternion.identity, joints, "body", mobilityId, ReaverbotSemanticRole.DarkJoint);
            }
        }

        private static Transform BuildEye(
            Transform root,
            ReaverbotGenome genome,
            ReaverbotMaterialLibrary materials,
            float height,
            float radius,
            float torsoLength)
        {
            GameObject housing = CreatePrimitive(PrimitiveType.Cube, "RubyEyeHousing", root,
                new Vector3(0f, height * 0.76f, torsoLength * 0.53f),
                new Vector3(radius * 0.62f, radius * 0.42f, radius * 0.23f),
                Quaternion.identity,
                materials.Get(genome.Palette, ReaverbotSemanticRole.DarkJoint),
                "eye", genome.Modules.Eye.Id, ReaverbotSemanticRole.DarkJoint);
            GameObject eye = CreatePrimitive(PrimitiveType.Sphere, "RubyEyeLens", housing.transform,
                new Vector3(0f, 0f, radius * 0.14f),
                Vector3.one * radius * 0.3f,
                Quaternion.identity,
                materials.Get(genome.Palette, ReaverbotSemanticRole.RubyEye),
                "eye", genome.Modules.Eye.Id, ReaverbotSemanticRole.RubyEye);
            return eye.transform;
        }

        private static Transform BuildWeapon(
            Transform root,
            ReaverbotGenome genome,
            ReaverbotMaterialLibrary materials,
            float height,
            float radius,
            float torsoWidth,
            float torsoLength)
        {
            string id = genome.Modules.Weapon.Id;
            string kind = genome.Modules.Weapon.AttackKind;
            Material housing = materials.Get(genome.Palette, ReaverbotSemanticRole.WeaponHousing);
            Material trim = materials.Get(genome.Palette, ReaverbotSemanticRole.Trim);
            Vector3 mount = new Vector3(0f, height * 0.67f, torsoLength * 0.55f);
            var mountObject = new GameObject("WeaponMount_" + id);
            mountObject.transform.SetParent(root, false);
            mountObject.transform.localPosition = mount;

            bool melee = genome.Modules.Weapon.HasTag("melee") || kind == "charge" || kind == "clawMoveset";
            if (melee)
            {
                for (int side = -1; side <= 1; side += 2)
                {
                    GameObject arm = CreatePrimitive(PrimitiveType.Cylinder, side < 0 ? "LeftWeaponArm" : "RightWeaponArm",
                        mountObject.transform,
                        new Vector3(side * torsoWidth * 0.58f, -radius * 0.05f, radius * 0.28f),
                        new Vector3(radius * 0.34f, radius * 0.5f, radius * 0.34f),
                        Quaternion.Euler(90f, 0f, 0f), housing, "weapon", id, ReaverbotSemanticRole.WeaponHousing);
                    CreatePrimitive(PrimitiveType.Cylinder, side < 0 ? "LeftWeaponTip" : "RightWeaponTip",
                        arm.transform,
                        new Vector3(0f, radius * 0.48f, 0f),
                        new Vector3(radius * 0.2f, radius * 0.42f, radius * 0.2f),
                        Quaternion.identity, trim, "weapon", id, ReaverbotSemanticRole.Trim);
                }
            }
            else if (kind == "mortar")
            {
                CreatePrimitive(PrimitiveType.Cylinder, "MortarTube", mountObject.transform,
                    new Vector3(0f, radius * 0.32f, 0f),
                    new Vector3(radius * 0.54f, radius * 0.72f, radius * 0.54f),
                    Quaternion.Euler(48f, 0f, 0f), housing, "weapon", id, ReaverbotSemanticRole.WeaponHousing);
            }
            else
            {
                CreatePrimitive(PrimitiveType.Cube, "WeaponHousing", mountObject.transform,
                    Vector3.zero,
                    new Vector3(radius * 0.72f, radius * 0.52f, radius * 0.7f),
                    Quaternion.identity, housing, "weapon", id, ReaverbotSemanticRole.WeaponHousing);
                CreatePrimitive(PrimitiveType.Cylinder, "WeaponBarrel", mountObject.transform,
                    new Vector3(0f, 0f, radius * 0.62f),
                    new Vector3(radius * 0.32f, radius * 0.72f, radius * 0.32f),
                    Quaternion.Euler(90f, 0f, 0f), trim, "weapon", id, ReaverbotSemanticRole.Trim);
            }

            return CreateAnchor(
                mountObject.transform,
                "Muzzle",
                new Vector3(0f, 0f, melee ? radius * 1.3f : radius * 1.38f));
        }

        private static void BuildChargeModule(
            Transform root,
            ReaverbotGenome genome,
            ReaverbotMaterialLibrary materials,
            float height,
            float radius)
        {
            if (genome.Modules.Charge == null) return;
            string id = genome.Modules.Charge.Id;
            int count = Mathf.Max(1, genome.Modules.Charge.NozzleCount);
            for (int index = 0; index < count; index += 1)
            {
                float x = (index - ((count - 1) * 0.5f)) * radius * 0.52f;
                CreatePrimitive(PrimitiveType.Cylinder, "ChargeNozzle_" + index, root,
                    new Vector3(x, height * 0.55f, -radius * 0.72f),
                    new Vector3(radius * 0.25f, radius * 0.4f, radius * 0.25f),
                    Quaternion.Euler(90f, 0f, 0f),
                    materials.Get(genome.Palette, ReaverbotSemanticRole.Emissive),
                    "charge", id, ReaverbotSemanticRole.Emissive);
            }
        }

        private static void BuildDefense(
            Transform root,
            ReaverbotGenome genome,
            ReaverbotMaterialLibrary materials,
            float height,
            float radius,
            float torsoWidth,
            float torsoLength)
        {
            if (genome.Modules.Defense == null) return;
            string id = genome.Modules.Defense.Id;
            Material defense = materials.Get(genome.Palette, ReaverbotSemanticRole.Defense);
            if (id == "directionalShield" || id == "guardArms")
            {
                CreatePrimitive(PrimitiveType.Cube, "Defense_" + id, root,
                    new Vector3(torsoWidth * 0.62f, height * 0.58f, torsoLength * 0.63f),
                    new Vector3(radius * 0.18f, height * 0.52f, torsoWidth * 0.72f),
                    Quaternion.Euler(0f, -18f, 0f), defense, "defense", id, ReaverbotSemanticRole.Defense);
            }
            else if (id == "energyMembrane" || id == "phaseShell" || id == "rotatingPlates")
            {
                for (int side = -1; side <= 1; side += 2)
                {
                    CreatePrimitive(PrimitiveType.Cube, "DefensePlate_" + side, root,
                        new Vector3(side * torsoWidth * 0.62f, height * 0.58f, 0f),
                        new Vector3(radius * 0.14f, height * 0.45f, torsoLength * 1.1f),
                        Quaternion.Euler(0f, side * 12f, side * 7f), defense, "defense", id, ReaverbotSemanticRole.Defense);
                }
            }
            else
            {
                CreatePrimitive(PrimitiveType.Cube, "DefenseArmor_" + id, root,
                    new Vector3(0f, height * 0.72f, -torsoLength * 0.5f),
                    new Vector3(torsoWidth * 1.05f, height * 0.2f, radius * 0.18f),
                    Quaternion.identity, defense, "defense", id, ReaverbotSemanticRole.Defense);
            }
        }

        private static Transform BuildWeakPoint(
            Transform root,
            ReaverbotGenome genome,
            ReaverbotMaterialLibrary materials,
            Transform eye,
            float height,
            float radius,
            float torsoWidth,
            float torsoLength)
        {
            ReaverbotWeakPointModule weak = genome.Modules.WeakPoint;
            Vector3 position = weak.Location switch
            {
                "rearHigh" => new Vector3(0f, height * 0.73f, -torsoLength * 0.58f),
                "rear" => new Vector3(0f, height * 0.56f, -torsoLength * 0.61f),
                "belly" => new Vector3(0f, height * 0.35f, torsoLength * 0.15f),
                "side" => new Vector3(torsoWidth * 0.58f, height * 0.56f, 0f),
                "rotorOpposite" => new Vector3(0f, height * 0.75f, -torsoLength * 0.66f),
                "frontLow" => new Vector3(0f, height * 0.42f, torsoLength * 0.62f),
                "leg" => new Vector3(-torsoWidth * 0.34f, height * 0.24f, radius * 0.08f),
                "frontSide" => new Vector3(torsoWidth * 0.58f, height * 0.62f, torsoLength * 0.48f),
                "clawPalm" => new Vector3(-torsoWidth * 0.64f, height * 0.63f, torsoLength * 0.88f),
                "center" => new Vector3(0f, height * 0.58f, torsoLength * 0.5f),
                _ => eye != null ? eye.position : new Vector3(0f, height * 0.72f, torsoLength * 0.55f),
            };
            if (weak.Location == "eye" && eye != null)
            {
                position = eye.localToWorldMatrix.MultiplyPoint3x4(Vector3.zero);
                position = root.InverseTransformPoint(position);
            }

            Transform anchor = CreateAnchor(root, "WeakPoint_" + weak.Id, position);
            float diameter = Mathf.Max(0.12f, (float)weak.Radius * 2f);
            CreatePrimitive(PrimitiveType.Sphere, "WeakPointVisual_" + weak.Id, anchor,
                Vector3.zero,
                Vector3.one * diameter,
                Quaternion.identity,
                materials.Get(genome.Palette, ReaverbotSemanticRole.WeakPoint),
                "weakPoint", weak.Id, ReaverbotSemanticRole.WeakPoint);
            return anchor;
        }

        private static Transform CreateAnchor(Transform parent, string name, Vector3 localPosition)
        {
            var anchor = new GameObject(name);
            anchor.transform.SetParent(parent, false);
            anchor.transform.localPosition = localPosition;
            return anchor.transform;
        }

        private static GameObject CreatePrimitive(
            PrimitiveType primitiveType,
            string name,
            Transform parent,
            Vector3 localPosition,
            Vector3 localScale,
            Quaternion localRotation,
            Material material,
            string aspect,
            string moduleId,
            ReaverbotSemanticRole role)
        {
            GameObject part = GameObject.CreatePrimitive(primitiveType);
            part.name = name;
            part.transform.SetParent(parent, false);
            part.transform.localPosition = localPosition;
            part.transform.localRotation = localRotation;
            part.transform.localScale = localScale;
            Collider collider = part.GetComponent<Collider>();
            if (collider != null)
            {
                collider.enabled = false;
                if (Application.isPlaying) UnityEngine.Object.Destroy(collider);
                else UnityEngine.Object.DestroyImmediate(collider);
            }

            Renderer renderer = part.GetComponent<Renderer>();
            if (renderer != null) renderer.sharedMaterial = material;
            part.AddComponent<ReaverbotSemanticPart>().Configure(aspect, moduleId, role);
            return part;
        }
    }
}
