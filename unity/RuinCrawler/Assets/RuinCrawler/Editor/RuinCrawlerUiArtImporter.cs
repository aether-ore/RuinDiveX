using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Editor
{
    /// <summary>Build-oriented import settings for the user-supplied UI style references.</summary>
    public sealed class RuinCrawlerUiArtImporter : AssetPostprocessor
    {
        private const string UiRoot = "Assets/RuinCrawler/UI/";

        private void OnPreprocessTexture()
        {
            if (!assetPath.StartsWith(UiRoot, System.StringComparison.Ordinal)
                || !assetPath.Contains("doni-arts-"))
            {
                return;
            }

            var importer = (TextureImporter)assetImporter;
            importer.textureType = TextureImporterType.Default;
            importer.sRGBTexture = true;
            importer.mipmapEnabled = false;
            importer.alphaSource = TextureImporterAlphaSource.None;
            importer.wrapMode = assetPath.Contains("mechanical-surface")
                ? TextureWrapMode.Repeat
                : TextureWrapMode.Clamp;
            importer.filterMode = FilterMode.Bilinear;
            importer.anisoLevel = 0;
            importer.maxTextureSize = 1024;
            importer.textureCompression = TextureImporterCompression.CompressedHQ;
            importer.isReadable = false;
        }
    }
}
