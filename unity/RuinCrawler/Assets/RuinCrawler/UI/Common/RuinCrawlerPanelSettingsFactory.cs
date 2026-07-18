using UnityEngine;
using UnityEngine.UIElements;

namespace RuinCrawler.UI.Common
{
    /// <summary>
    /// Shared runtime UI Toolkit presentation contract. Every generated panel
    /// uses the same default-derived theme so controls render in player builds
    /// and scenes never depend on an Editor-only PanelSettings asset.
    /// </summary>
    internal static class RuinCrawlerPanelSettingsFactory
    {
        private const string ThemeResource = "RuinCrawlerRuntimeTheme";

        public static PanelSettings Create(string name)
        {
            ThemeStyleSheet theme = Resources.Load<ThemeStyleSheet>(ThemeResource);
            if (theme == null)
            {
                Debug.LogError(
                    "[RuinCrawler UI] Required runtime theme is missing from Resources: "
                    + ThemeResource + ".tss");
            }

            PanelSettings settings = ScriptableObject.CreateInstance<PanelSettings>();
            settings.name = name;
            settings.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            settings.referenceResolution = new Vector2Int(1920, 1080);
            settings.themeStyleSheet = theme;
            return settings;
        }
    }
}
