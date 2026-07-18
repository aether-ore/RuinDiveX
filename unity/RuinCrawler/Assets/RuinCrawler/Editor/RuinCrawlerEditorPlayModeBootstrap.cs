using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RuinCrawler.Editor
{
    /// <summary>
    /// Keeps the ordinary Unity Play button routed through production Boot,
    /// even when the Editor happens to open an empty or content-preview scene.
    /// This changes only the Editor play-mode start scene; player builds still
    /// use EditorBuildSettings with Boot at build index zero.
    /// </summary>
    [InitializeOnLoad]
    public static class RuinCrawlerEditorPlayModeBootstrap
    {
        public const string BootScenePath = "Assets/RuinCrawler/Scenes/Boot.unity";
        public const string CampScenePath = "Assets/RuinCrawler/Scenes/Camp.unity";

        static RuinCrawlerEditorPlayModeBootstrap()
        {
            EditorApplication.delayCall += () => EnsureProductionPlayModeStartScene();
        }

        [MenuItem("Ruin Crawler/Open Playable Camp", priority = 1)]
        public static void OpenPlayableCamp()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                Debug.LogWarning("Exit Play Mode before opening the authored Camp scene.");
                return;
            }

            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EditorSceneManager.OpenScene(CampScenePath, OpenSceneMode.Single);
            EnsureProductionPlayModeStartScene();
        }

        [MenuItem("Ruin Crawler/Play From Boot", priority = 2)]
        public static void PlayFromBoot()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!EnsureProductionPlayModeStartScene()) return;
            EditorApplication.isPlaying = true;
        }

        public static bool EnsureProductionPlayModeStartScene()
        {
            SceneAsset boot = AssetDatabase.LoadAssetAtPath<SceneAsset>(BootScenePath);
            if (boot == null)
            {
                Debug.LogError("Ruin Crawler cannot enter Play Mode because the production Boot scene is missing at '"
                    + BootScenePath + "'.");
                return false;
            }

            if (EditorSceneManager.playModeStartScene != boot)
            {
                EditorSceneManager.playModeStartScene = boot;
            }
            return true;
        }
    }
}
