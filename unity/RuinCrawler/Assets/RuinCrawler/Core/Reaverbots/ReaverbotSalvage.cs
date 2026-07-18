using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Reaverbots
{
    public sealed class ReaverbotSalvageCatalog
    {
        private readonly IReadOnlyDictionary<string, ReaverbotSalvageAspect> _aspects;
        private readonly IReadOnlyDictionary<string, ReaverbotSalvageMaterial> _materials;
        private readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> _sourceMaps;

        private ReaverbotSalvageCatalog(
            IReadOnlyDictionary<string, ReaverbotSalvageAspect> aspects,
            IReadOnlyDictionary<string, ReaverbotSalvageMaterial> materials,
            IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> sourceMaps,
            IReadOnlyList<string> bossOnlyMaterialIds)
        {
            _aspects = aspects;
            _materials = materials;
            _sourceMaps = sourceMaps;
            BossOnlyMaterialIds = bossOnlyMaterialIds;
        }

        public IReadOnlyDictionary<string, ReaverbotSalvageAspect> Aspects => _aspects;
        public IReadOnlyDictionary<string, ReaverbotSalvageMaterial> Materials => _materials;
        public IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> SourceMaps => _sourceMaps;
        public IReadOnlyList<string> BossOnlyMaterialIds { get; }

        public bool TryGetMaterial(
            string aspect,
            string moduleId,
            out ReaverbotSalvageMaterial material)
        {
            material = null;
            if (string.IsNullOrEmpty(aspect)
                || string.IsNullOrEmpty(moduleId)
                || !_sourceMaps.TryGetValue(aspect, out IReadOnlyDictionary<string, string> sourceMap)
                || !sourceMap.TryGetValue(moduleId, out string materialId))
            {
                return false;
            }

            return _materials.TryGetValue(materialId, out material);
        }

        internal static ReaverbotSalvageCatalog Load(
            ReaverbotSalvageCatalogDto source,
            ICollection<string> errors)
        {
            var aspects = new Dictionary<string, ReaverbotSalvageAspect>(StringComparer.Ordinal);
            var materials = new Dictionary<string, ReaverbotSalvageMaterial>(StringComparer.Ordinal);
            var sourceMaps = new Dictionary<string, IReadOnlyDictionary<string, string>>(StringComparer.Ordinal);

            if (source == null)
            {
                errors.Add("missing-salvage-catalog");
                return new ReaverbotSalvageCatalog(
                    ContractCollections.Freeze(aspects),
                    ContractCollections.Freeze(materials),
                    ContractCollections.Freeze(sourceMaps),
                    ContractCollections.Freeze(Array.Empty<string>()));
            }

            foreach (ReaverbotSalvageAspectRecord record in source.aspects ?? Array.Empty<ReaverbotSalvageAspectRecord>())
            {
                string id = record?.id;
                if (string.IsNullOrWhiteSpace(id))
                {
                    errors.Add("missing-salvage-aspect-id");
                }
                else if (aspects.ContainsKey(id))
                {
                    errors.Add("duplicate-salvage-aspect:" + id);
                }
                else
                {
                    aspects.Add(id, new ReaverbotSalvageAspect(
                        id,
                        record.label ?? id,
                        record.baseDropChance));
                }
            }

            foreach (ReaverbotSalvageMaterialRecord record in source.materials ?? Array.Empty<ReaverbotSalvageMaterialRecord>())
            {
                string id = record?.id;
                if (string.IsNullOrWhiteSpace(id))
                {
                    errors.Add("missing-salvage-material-id");
                }
                else if (materials.ContainsKey(id))
                {
                    errors.Add("duplicate-salvage-material:" + id);
                }
                else if (!aspects.ContainsKey(record.aspect ?? string.Empty))
                {
                    errors.Add("unknown-material-aspect:" + id + ":" + (record.aspect ?? string.Empty));
                }
                else
                {
                    materials.Add(id, new ReaverbotSalvageMaterial(record));
                }
            }

            foreach (ReaverbotSalvageSourceMapRecord record in source.sourceMaps ?? Array.Empty<ReaverbotSalvageSourceMapRecord>())
            {
                string aspect = record?.aspect;
                if (string.IsNullOrWhiteSpace(aspect) || !aspects.ContainsKey(aspect))
                {
                    errors.Add("unknown-source-map-aspect:" + (aspect ?? string.Empty));
                    continue;
                }

                if (sourceMaps.ContainsKey(aspect))
                {
                    errors.Add("duplicate-source-map:" + aspect);
                    continue;
                }

                var map = new Dictionary<string, string>(StringComparer.Ordinal);
                foreach (ReaverbotSalvageSourceRecord entry in record.sources ?? Array.Empty<ReaverbotSalvageSourceRecord>())
                {
                    string moduleId = entry?.moduleId;
                    string materialId = entry?.materialId;
                    if (string.IsNullOrWhiteSpace(moduleId))
                    {
                        errors.Add("missing-source-module:" + aspect);
                    }
                    else if (map.ContainsKey(moduleId))
                    {
                        errors.Add("duplicate-source-module:" + aspect + ":" + moduleId);
                    }
                    else if (!materials.TryGetValue(materialId ?? string.Empty, out ReaverbotSalvageMaterial material))
                    {
                        errors.Add("unknown-source-material:" + aspect + ":" + moduleId + ":" + (materialId ?? string.Empty));
                    }
                    else if (!string.Equals(material.Aspect, aspect, StringComparison.Ordinal))
                    {
                        errors.Add("source-material-aspect-mismatch:" + aspect + ":" + moduleId + ":" + materialId);
                    }
                    else
                    {
                        map.Add(moduleId, materialId);
                    }
                }

                sourceMaps.Add(aspect, ContractCollections.Freeze(map));
            }

            var bossOnly = new List<string>();
            foreach (string materialId in source.bossOnlyMaterialIds ?? Array.Empty<string>())
            {
                if (!materials.ContainsKey(materialId ?? string.Empty))
                {
                    errors.Add("unknown-boss-only-material:" + (materialId ?? string.Empty));
                }
                else if (!bossOnly.Contains(materialId))
                {
                    bossOnly.Add(materialId);
                }
            }

            return new ReaverbotSalvageCatalog(
                ContractCollections.Freeze(aspects),
                ContractCollections.Freeze(materials),
                ContractCollections.Freeze(sourceMaps),
                ContractCollections.Freeze(bossOnly));
        }
    }

    public sealed class ReaverbotSalvageAspect
    {
        internal ReaverbotSalvageAspect(string id, string label, double baseDropChance)
        {
            Id = id;
            Label = label;
            BaseDropChance = baseDropChance;
        }

        public string Id { get; }
        public string Label { get; }
        public double BaseDropChance { get; }
    }

    public sealed class ReaverbotSalvageMaterial
    {
        internal ReaverbotSalvageMaterial(ReaverbotSalvageMaterialRecord source)
        {
            Id = source.id;
            Name = source.name ?? source.id;
            Aspect = source.aspect;
            Family = source.family ?? string.Empty;
            Tier = source.tier ?? string.Empty;
            Color = source.color ?? string.Empty;
            CraftingTags = ContractCollections.Freeze(source.craftingTags);
            ExampleUses = ContractCollections.Freeze(source.exampleUses);
            Description = source.description ?? string.Empty;
        }

        public string Id { get; }
        public string Name { get; }
        public string Aspect { get; }
        public string Family { get; }
        public string Tier { get; }
        public string Color { get; }
        public IReadOnlyList<string> CraftingTags { get; }
        public IReadOnlyList<string> ExampleUses { get; }
        public string Description { get; }
    }

    public sealed class ReaverbotSalvageCandidate
    {
        internal ReaverbotSalvageCandidate(
            string aspect,
            string aspectLabel,
            string moduleId,
            string moduleLabel,
            ReaverbotSalvageMaterial material)
        {
            Aspect = aspect;
            AspectLabel = aspectLabel;
            ModuleId = moduleId;
            ModuleLabel = moduleLabel;
            MaterialId = material.Id;
            Material = material;
        }

        public string Aspect { get; }
        public string AspectLabel { get; }
        public string ModuleId { get; }
        public string ModuleLabel { get; }
        public string MaterialId { get; }
        public ReaverbotSalvageMaterial Material { get; }
    }

    public static class ReaverbotSalvageProfile
    {
        public static IReadOnlyList<ReaverbotSalvageCandidate> Create(
            ReaverbotGenome genome,
            ReaverbotSalvageCatalog catalog)
        {
            if (catalog == null)
            {
                throw new ArgumentNullException(nameof(catalog));
            }

            if (genome == null)
            {
                return ContractCollections.Freeze(Array.Empty<ReaverbotSalvageCandidate>());
            }

            var result = new List<ReaverbotSalvageCandidate>(7);
            Add(result, catalog, "behavior", genome.ArchetypeId, genome.ArchetypeLabel);
            Add(
                result,
                catalog,
                "body",
                genome.Body.MobilitySalvageId ?? genome.Body.PlanId,
                genome.Body.MobilityLabel ?? genome.Body.Label);
            Add(result, catalog, "eye", genome.Modules.Eye.Id, "Ruby Reaverbot Eye");
            Add(result, catalog, "weapon", genome.Modules.Weapon.Id, genome.Modules.Weapon.Label);
            if (genome.Modules.Charge != null)
            {
                Add(result, catalog, "charge", genome.Modules.Charge.Id, genome.Modules.Charge.Label);
            }

            if (genome.Modules.Defense != null)
            {
                Add(result, catalog, "defense", genome.Modules.Defense.Id, genome.Modules.Defense.Label);
            }

            Add(result, catalog, "weakPoint", genome.Modules.WeakPoint.Id, genome.Modules.WeakPoint.Label);
            return ContractCollections.Freeze(result);
        }

        private static void Add(
            ICollection<ReaverbotSalvageCandidate> result,
            ReaverbotSalvageCatalog catalog,
            string aspect,
            string moduleId,
            string moduleLabel)
        {
            if (!catalog.Aspects.TryGetValue(aspect, out ReaverbotSalvageAspect aspectDefinition)
                || !catalog.TryGetMaterial(aspect, moduleId, out ReaverbotSalvageMaterial material))
            {
                return;
            }

            result.Add(new ReaverbotSalvageCandidate(
                aspect,
                aspectDefinition.Label,
                moduleId,
                moduleLabel,
                material));
        }
    }
}
