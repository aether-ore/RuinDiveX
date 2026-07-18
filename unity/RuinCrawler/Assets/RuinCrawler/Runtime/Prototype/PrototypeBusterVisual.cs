using System;
using UnityEngine;

namespace RuinCrawler.Port.Prototype
{
    /// <summary>
    /// Owns the visual replacement contract for Volnutt's invariant left-arm
    /// Mega Buster. Gameplay equipment can use SetEquipped later without
    /// knowing which imported renderer contains the normal lower arm.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class PrototypeBusterVisual : MonoBehaviour
    {
        [SerializeField] private GameObject busterRoot;
        [SerializeField] private Renderer[] replacedLeftArmRenderers = Array.Empty<Renderer>();
        [SerializeField] private bool equipped = true;

        public GameObject BusterRoot => busterRoot;
        public bool IsEquipped => equipped;

        public void Configure(GameObject authoredBusterRoot, Renderer[] replacedRenderers)
        {
            busterRoot = authoredBusterRoot;
            replacedLeftArmRenderers = replacedRenderers ?? Array.Empty<Renderer>();
            ApplyVisibility();
        }

        public void SetEquipped(bool value)
        {
            equipped = value;
            ApplyVisibility();
        }

        private void Awake()
        {
            ApplyVisibility();
        }

        private void ApplyVisibility()
        {
            if (busterRoot != null)
            {
                busterRoot.SetActive(equipped);
            }

            foreach (Renderer replacedRenderer in replacedLeftArmRenderers)
            {
                if (replacedRenderer != null)
                {
                    replacedRenderer.enabled = !equipped;
                }
            }
        }
    }
}
