using System;
using UnityEngine;

namespace RuinCrawler.Runtime.Roll
{
    public enum RollAnimationKind
    {
        Idle = 0,
        Waving = 1,
        Talking = 2,
        Explaining = 3,
        Thinking = 4,
        Happy = 5,
        Thankful = 6,
        Bashful = 7
    }

    public sealed class RollWorkshopAnimator : MonoBehaviour
    {
        [SerializeField] private Animator animator;
        [SerializeField, Min(0f)] private float crossFadeSeconds = 0.12f;
        [SerializeField, Min(0.1f)] private float contextualHoldSeconds = 1.4f;

        private float returnToIdleRemaining;

        public void Configure(Animator targetAnimator)
        {
            animator = targetAnimator;
        }

        public void Play(RollAnimationKind kind, bool returnToIdle = true)
        {
            if (animator == null)
            {
                animator = GetComponentInChildren<Animator>();
            }

            if (animator == null)
            {
                return;
            }

            string stateName = kind.ToString();
            animator.CrossFadeInFixedTime(stateName, crossFadeSeconds, 0);
            returnToIdleRemaining = kind == RollAnimationKind.Idle || !returnToIdle
                ? 0f
                : contextualHoldSeconds;
        }

        private void Awake()
        {
            animator ??= GetComponentInChildren<Animator>();
        }

        private void Update()
        {
            if (returnToIdleRemaining <= 0f)
            {
                return;
            }

            returnToIdleRemaining = Mathf.Max(0f, returnToIdleRemaining - Time.deltaTime);
            if (returnToIdleRemaining <= 0f)
            {
                Play(RollAnimationKind.Idle, false);
            }
        }
    }
}
