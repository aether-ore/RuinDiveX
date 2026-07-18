using System;
using System.Collections.Generic;
using UnityEngine;

namespace RuinCrawler.Art.DungeonV2
{
    [CreateAssetMenu(
        fileName = "DungeonV2MaterialCatalog",
        menuName = "Ruin Crawler/Dungeon V2/Material Catalog")]
    public sealed class DungeonV2MaterialCatalog : ScriptableObject
    {
        [Serializable]
        public sealed class Entry
        {
            [SerializeField] private string roleId = string.Empty;
            [SerializeField] private Material material;

            public string RoleId => roleId;
            public Material Material => material;
        }

        [SerializeField] private Entry[] entries = Array.Empty<Entry>();

        public IReadOnlyList<Entry> Entries => entries;

        public bool TryGetMaterial(string roleId, out Material material)
        {
            if (!string.IsNullOrWhiteSpace(roleId))
            {
                foreach (Entry entry in entries)
                {
                    if (entry != null && string.Equals(
                            entry.RoleId,
                            roleId,
                            StringComparison.Ordinal))
                    {
                        material = entry.Material;
                        return material != null;
                    }
                }
            }

            material = null;
            return false;
        }

        public bool Validate(out string[] errors)
        {
            var issues = new List<string>();
            var roles = new HashSet<string>(StringComparer.Ordinal);
            foreach (Entry entry in entries)
            {
                if (entry == null)
                {
                    issues.Add("Catalog contains a null entry.");
                    continue;
                }

                if (string.IsNullOrWhiteSpace(entry.RoleId))
                {
                    issues.Add("Catalog contains an empty semantic role ID.");
                }
                else if (!roles.Add(entry.RoleId))
                {
                    issues.Add("Catalog contains duplicate role '" + entry.RoleId + "'.");
                }

                if (entry.Material == null)
                {
                    issues.Add("Role '" + entry.RoleId + "' has no material.");
                }
                else if (entry.Material.shader == null ||
                         !entry.Material.shader.name.StartsWith("Ruin/", StringComparison.Ordinal))
                {
                    issues.Add("Role '" + entry.RoleId + "' does not use a Ruin shader.");
                }
            }

            errors = issues.ToArray();
            return errors.Length == 0;
        }
    }
}
