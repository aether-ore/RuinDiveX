using System;
using RuinCrawler.Core.Reaverbots;
using UnityEngine;

namespace RuinCrawler.Runtime.Reaverbots
{
    public sealed class ReaverbotSalvagePickup : MonoBehaviour
    {
        private UnidentifiedReaverbotRecovery recovery;
        private Func<ReaverbotSalvagePickup, UnidentifiedReaverbotRecovery, bool> collected;
        private Vector3 basePosition;
        private bool live;
        private float phaseOffset;

        public UnidentifiedReaverbotRecovery Recovery => recovery;
        public bool IsLive => live;

        public void Configure(
            UnidentifiedReaverbotRecovery source,
            Vector3 position,
            Material material,
            Func<ReaverbotSalvagePickup, UnidentifiedReaverbotRecovery, bool> onCollected)
        {
            recovery = source ?? throw new ArgumentNullException(nameof(source));
            collected = onCollected;
            basePosition = position;
            phaseOffset = (ReaverbotDeterminism.HashSeed(source.RecoveryId) & 0xffffu) / 65535f * Mathf.PI * 2f;
            transform.position = position;
            transform.rotation = Quaternion.identity;
            Renderer targetRenderer = GetComponent<Renderer>();
            if (targetRenderer != null) targetRenderer.sharedMaterial = material;
            live = true;
            gameObject.SetActive(true);
        }

        public bool Collect()
        {
            if (!live || recovery == null) return false;
            UnidentifiedReaverbotRecovery result = recovery;
            Func<ReaverbotSalvagePickup, UnidentifiedReaverbotRecovery, bool> callback = collected;
            if (callback != null && !callback(this, result))
            {
                return false;
            }

            live = false;
            recovery = null;
            collected = null;
            return true;
        }

        public void ResetForPool()
        {
            live = false;
            recovery = null;
            collected = null;
            gameObject.SetActive(false);
        }

        private void Update()
        {
            if (!live) return;
            float phase = Time.time * 2.4f + phaseOffset;
            transform.position = basePosition + Vector3.up * (0.12f + Mathf.Sin(phase) * 0.08f);
            transform.Rotate(Vector3.up, 72f * Time.deltaTime, Space.World);
        }

        private void OnTriggerEnter(Collider other)
        {
            if (!live || other == null) return;
            int playerLayer = LayerMask.NameToLayer("Player");
            if (other.gameObject.layer == playerLayer || other.CompareTag("Player"))
            {
                Collect();
            }
        }
    }
}
