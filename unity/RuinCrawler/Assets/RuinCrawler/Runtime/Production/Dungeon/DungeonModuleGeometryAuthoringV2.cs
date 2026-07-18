using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonModuleGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string templateId = "module-template-v2";
        [SerializeField] private bool requireEveryColliderCertified = true;
        [SerializeField] private DungeonCertifiedGeometryAssetV2 certifiedGeometry;

        public string TemplateId => templateId;
        public bool RequireEveryColliderCertified => requireEveryColliderCertified;
        public DungeonCertifiedGeometryAssetV2 CertifiedGeometry => certifiedGeometry;

        public void Configure(
            string stableTemplateId,
            bool requireCertifiedColliders = true,
            DungeonCertifiedGeometryAssetV2 geometry = null)
        {
            templateId = stableTemplateId;
            requireEveryColliderCertified = requireCertifiedColliders;
            certifiedGeometry = geometry;
        }

        public void AssignCertifiedGeometry(DungeonCertifiedGeometryAssetV2 geometry)
        {
            certifiedGeometry = geometry;
        }
    }
}
