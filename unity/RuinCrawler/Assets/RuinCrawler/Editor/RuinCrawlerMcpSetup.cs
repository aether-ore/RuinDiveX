using System;
using System.IO;
using System.Linq;
using MCPForUnity.Editor.Clients;
using MCPForUnity.Editor.Helpers;
using MCPForUnity.Editor.Services;
using UnityEditor;
using UnityEngine;

namespace RuinCrawler.Port.Editor
{
    /// <summary>
    /// Reproducible, Codex-only Unity MCP setup. This deliberately avoids the
    /// broad "configure all clients" operation.
    /// </summary>
    public static class RuinCrawlerMcpSetup
    {
        private const string LocalBaseUrl = "http://127.0.0.1:8080";
        private const string AutoStartPreference = "MCPForUnity.AutoStartOnLoad";
        private const string SetupCompletedPreference = "MCPForUnity.SetupCompleted";

        [MenuItem("Ruin Crawler/Porting/Configure Unity MCP for Codex")]
        public static void ConfigureCodex()
        {
            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string uvxPath = Path.Combine(userProfile, ".local", "bin", "uvx.exe");
            if (!File.Exists(uvxPath))
            {
                throw new FileNotFoundException(
                    "Unity MCP requires uvx. Run the documented bootstrap before configuring Codex.",
                    uvxPath);
            }

            EditorConfigurationCache.Instance.SetUseHttpTransport(true);
            EditorConfigurationCache.Instance.SetHttpTransportScope("local");
            HttpEndpointUtility.SaveLocalBaseUrl(LocalBaseUrl);
            MCPServiceLocator.Paths.SetUvxPathOverride(uvxPath);

            IMcpClientConfigurator codex = McpClientRegistry.All.SingleOrDefault(client =>
                string.Equals(client.DisplayName, "Codex", StringComparison.OrdinalIgnoreCase));
            if (codex == null)
            {
                throw new InvalidOperationException("CoplayDev Unity MCP did not register its Codex configurator.");
            }

            MCPServiceLocator.Client.ConfigureClient(codex);
            codex.CheckStatus(attemptAutoRewrite: false);

            EditorPrefs.SetBool(AutoStartPreference, true);
            EditorPrefs.SetBool(SetupCompletedPreference, true);
            Debug.Log(
                $"Unity MCP configured for Codex only. Endpoint: {HttpEndpointUtility.GetLocalMcpRpcUrl()}, " +
                $"client status: {codex.Status}, uvx: {uvxPath}");
        }
    }
}
