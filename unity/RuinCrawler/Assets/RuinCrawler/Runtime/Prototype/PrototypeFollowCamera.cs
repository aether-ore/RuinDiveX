using RuinCrawler.Port.Porting;
using UnityEngine;

namespace RuinCrawler.Port.Prototype
{
    public sealed class PrototypeFollowCamera : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private Vector3 offset = new Vector3(
            0f,
            SourceGameplayContract.CameraHeight,
            -SourceGameplayContract.CameraDistance);
        [SerializeField] private float response = SourceGameplayContract.CameraFollowResponsiveness;

        public void Configure(Transform followTarget)
        {
            target = followTarget;
        }

        private void LateUpdate()
        {
            if (target == null)
            {
                return;
            }

            Vector3 desiredPosition = target.position + target.rotation * offset;
            transform.position = Vector3.Lerp(
                transform.position,
                desiredPosition,
                1f - Mathf.Exp(-response * Time.deltaTime));
            Vector3 lookTarget = target.position
                                 + target.forward * SourceGameplayContract.CameraLookAhead
                                 + Vector3.up * SourceGameplayContract.CameraLookHeight;
            transform.LookAt(lookTarget);
        }
    }
}
