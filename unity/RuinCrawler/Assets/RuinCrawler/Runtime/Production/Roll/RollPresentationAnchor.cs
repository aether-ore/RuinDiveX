using UnityEngine;

namespace RuinCrawler.Runtime.Roll
{
    /// <summary>
    /// Keeps Roll's animated visual grounded without putting presentation scale
    /// on the logical NPC root. The root owns interaction and collision in world
    /// units; only the imported FBX child is scaled.
    /// </summary>
    [DefaultExecutionOrder(500)]
    [DisallowMultipleComponent]
    public sealed class RollPresentationAnchor : MonoBehaviour
    {
        [SerializeField] private Transform visualRoot;
        [SerializeField, Min(0f)] private float groundingTolerance = 0.002f;

        public Transform VisualRoot => visualRoot;

        public void Configure(Transform targetVisual)
        {
            visualRoot = targetVisual;
            GroundNow();
        }

        public bool TryGetVisualBounds(out Bounds bounds)
        {
            bounds = default;
            if (visualRoot == null)
            {
                return false;
            }

            Renderer[] renderers = visualRoot.GetComponentsInChildren<Renderer>(true);
            bool found = false;
            foreach (Renderer renderer in renderers)
            {
                if (renderer == null)
                {
                    continue;
                }

                if (!found)
                {
                    bounds = renderer.bounds;
                    found = true;
                }
                else
                {
                    bounds.Encapsulate(renderer.bounds);
                }
            }

            return found;
        }

        public void GroundNow()
        {
            if (!TryGetVisualBounds(out Bounds bounds))
            {
                return;
            }

            float correction = transform.position.y - bounds.min.y;
            if (Mathf.Abs(correction) <= groundingTolerance)
            {
                return;
            }

            visualRoot.position += Vector3.up * correction;
        }

        private void Awake()
        {
            visualRoot ??= transform.Find("Roll_Visual");
        }

        private void Start()
        {
            GroundNow();
        }

        private void LateUpdate()
        {
            GroundNow();
        }
    }
}
