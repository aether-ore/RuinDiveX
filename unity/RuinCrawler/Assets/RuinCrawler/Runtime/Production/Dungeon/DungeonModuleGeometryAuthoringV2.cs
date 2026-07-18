using UnityEngine;

namespace RuinCrawler.Runtime.Dungeon
{
    [DisallowMultipleComponent]
    public sealed class DungeonModuleGeometryAuthoringV2 : MonoBehaviour
    {
        [SerializeField] private string templateId = "module-template-v2";
        [SerializeField] private string descriptorId = "module-descriptor-v2";
        [SerializeField] private string archetypeId = "module-archetype-v2";
        [SerializeField] private string compositionContractId = "module-composition-v2";
        [SerializeField] private bool requireEveryColliderCertified = true;
        [SerializeField] private DungeonCertifiedGeometryAssetV2 certifiedGeometry;
        [SerializeField] private Transform certifiedGeometryRoot;
        [SerializeField] private Transform presentationRoot;
        [SerializeField] private Transform runtimeBindingsRoot;

        public string TemplateId => templateId;
        public string DescriptorId => descriptorId;
        public string ArchetypeId => archetypeId;
        public string CompositionContractId => compositionContractId;
        public bool RequireEveryColliderCertified => requireEveryColliderCertified;
        public DungeonCertifiedGeometryAssetV2 CertifiedGeometry => certifiedGeometry;
        public Transform CertifiedGeometryRoot => certifiedGeometryRoot;
        public Transform PresentationRoot => presentationRoot;
        public Transform RuntimeBindingsRoot => runtimeBindingsRoot;

        public void Configure(
            string stableTemplateId,
            bool requireCertifiedColliders = true,
            DungeonCertifiedGeometryAssetV2 geometry = null)
        {
            templateId = stableTemplateId;
            requireEveryColliderCertified = requireCertifiedColliders;
            certifiedGeometry = geometry;
        }

        /// <summary>
        /// Defines the authored-module contract. The three roots must be direct,
        /// unit-scale children of this object. Editor validation deliberately
        /// does not infer or manufacture these hierarchies: a shipping module is
        /// always an intentionally-authored prefab.
        /// </summary>
        public void ConfigureAuthored(
            string stableTemplateId,
            string stableDescriptorId,
            string stableArchetypeId,
            string stableCompositionContractId,
            Transform geometryRoot,
            Transform visiblePresentationRoot,
            Transform bindingRoot,
            DungeonCertifiedGeometryAssetV2 geometry = null,
            bool requireCertifiedColliders = true)
        {
            templateId = stableTemplateId;
            descriptorId = stableDescriptorId;
            archetypeId = stableArchetypeId;
            compositionContractId = stableCompositionContractId;
            certifiedGeometryRoot = geometryRoot;
            presentationRoot = visiblePresentationRoot;
            runtimeBindingsRoot = bindingRoot;
            certifiedGeometry = geometry;
            requireEveryColliderCertified = requireCertifiedColliders;
        }

        public void AssignCertifiedGeometry(DungeonCertifiedGeometryAssetV2 geometry)
        {
            certifiedGeometry = geometry;
        }

        public bool HasAuthoredHierarchy(out string error)
        {
            if (transform.localScale != Vector3.one)
            {
                error = "Authored module roots must use unit scale; runtime scaling is prohibited.";
                return false;
            }

            if (certifiedGeometryRoot == null
                || presentationRoot == null
                || runtimeBindingsRoot == null)
            {
                error = "CertifiedGeometry, Presentation, and RuntimeBindings roots are all required.";
                return false;
            }

            if (certifiedGeometryRoot.parent != transform
                || presentationRoot.parent != transform
                || runtimeBindingsRoot.parent != transform)
            {
                error = "CertifiedGeometry, Presentation, and RuntimeBindings must be direct children of the module root.";
                return false;
            }

            if (certifiedGeometryRoot == presentationRoot
                || certifiedGeometryRoot == runtimeBindingsRoot
                || presentationRoot == runtimeBindingsRoot)
            {
                error = "Authored module hierarchy roots must be three distinct objects.";
                return false;
            }

            if (certifiedGeometryRoot.name != "CertifiedGeometry"
                || presentationRoot.name != "Presentation"
                || runtimeBindingsRoot.name != "RuntimeBindings")
            {
                error = "Authored hierarchy roots must be named CertifiedGeometry, Presentation, and RuntimeBindings.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(templateId)
                || string.IsNullOrWhiteSpace(descriptorId)
                || string.IsNullOrWhiteSpace(archetypeId)
                || string.IsNullOrWhiteSpace(compositionContractId))
            {
                error = "Template, descriptor, archetype, and composition contract IDs are required.";
                return false;
            }

            error = string.Empty;
            return true;
        }
    }
}
