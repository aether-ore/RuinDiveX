using System;
using System.Collections.Generic;
using UnityEngine;

namespace RuinCrawler.Port.Porting
{
    [CreateAssetMenu(menuName = "Ruin Crawler/Porting Manifest", fileName = "PortingManifest")]
    public sealed class PortingManifest : ScriptableObject
    {
        [SerializeField] private string sourceProject = "Three.js Ruin Crawler";
        [SerializeField] private string sourceRevision;
        [SerializeField] private string generatedUtc;
        [SerializeField] private PortedAssetEntry[] entries = Array.Empty<PortedAssetEntry>();

        public string SourceProject => sourceProject;
        public string SourceRevision => sourceRevision;
        public string GeneratedUtc => generatedUtc;
        public IReadOnlyList<PortedAssetEntry> Entries => entries;

        public void Replace(string revision, string timestamp, PortedAssetEntry[] replacements)
        {
            sourceRevision = revision ?? string.Empty;
            generatedUtc = timestamp ?? string.Empty;
            entries = replacements ?? Array.Empty<PortedAssetEntry>();
        }
    }

    [Serializable]
    public struct PortedAssetEntry
    {
        public string id;
        public string kind;
        public string sourceAssetPath;
        public string unityAssetPath;
        public string status;
        public string notes;

        public PortedAssetEntry(
            string id,
            string kind,
            string sourceAssetPath,
            string unityAssetPath,
            string status,
            string notes)
        {
            this.id = id;
            this.kind = kind;
            this.sourceAssetPath = sourceAssetPath;
            this.unityAssetPath = unityAssetPath;
            this.status = status;
            this.notes = notes;
        }
    }
}
