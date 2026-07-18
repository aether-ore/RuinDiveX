using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RuinCrawler.UI.Workshop
{
    /// <summary>
    /// In-world Support Car departure point. A normal procedural expedition is
    /// available without first selecting a Boss Hunt in the workshop.
    /// </summary>
    [DefaultExecutionOrder(-100)]
    public sealed class CampExpeditionInteraction : MonoBehaviour
    {
        [SerializeField] private ExpeditionFlowController expeditionFlow;
        [SerializeField] private ProductionPlayerController player;
        [SerializeField] private InputActionAsset inputActions;
        [SerializeField, Min(0.5f)] private float interactionRadius = 3f;
        [SerializeField] private TextMesh prompt;

        private InputAction interactAction;
        private bool departureInProgress;

        public bool IsPlayerInRange => player != null
            && Vector3.SqrMagnitude(player.transform.position - transform.position)
               <= interactionRadius * interactionRadius;
        public TextMesh Prompt => prompt;

        public void Configure(
            ProductionPlayerController targetPlayer,
            InputActionAsset actions,
            TextMesh interactionPrompt,
            ExpeditionFlowController flow = null)
        {
            player = targetPlayer;
            inputActions = actions;
            prompt = interactionPrompt;
            expeditionFlow = flow;
            BindInput();
        }

        public bool TryBeginExpedition(string runSeed = null)
        {
            ResolveReferences();
            if (departureInProgress || !IsPlayerInRange || expeditionFlow == null)
            {
                return false;
            }

            departureInProgress = true;
            SetPrompt(false);
            bool started = expeditionFlow.EnterOrResumeExpedition(runSeed);
            if (!started)
            {
                departureInProgress = false;
                SetPrompt(IsPlayerInRange);
            }

            return started;
        }

        private void Awake()
        {
            ResolveReferences();
            BindInput();
        }

        private void OnEnable()
        {
            BindInput();
        }

        private void OnDisable()
        {
            interactAction = null;
            SetPrompt(false);
        }

        private void Update()
        {
            ResolveReferences();
            bool nearby = !departureInProgress && IsPlayerInRange;
            SetPrompt(nearby);
            if (nearby && interactAction?.WasPressedThisFrame() == true)
            {
                TryBeginExpedition();
            }
        }

        private void ResolveReferences()
        {
            expeditionFlow ??= ExpeditionFlowController.Instance;
            player ??= FindAnyObjectByType<ProductionPlayerController>();
        }

        private void BindInput()
        {
            interactAction = inputActions?.FindAction("Gameplay/Interact", false);
        }

        private void SetPrompt(bool visible)
        {
            if (prompt == null)
            {
                return;
            }

            prompt.gameObject.SetActive(visible);
            prompt.text = expeditionFlow != null
                && expeditionFlow.HasActiveExpedition
                && expeditionFlow.CanResumeActiveExpedition
                    ? "F / X  RE-ENTER RUIN"
                : "F / X  ENTER RUIN";
            if (!visible || Camera.main == null)
            {
                return;
            }

            Vector3 facing = Vector3.ProjectOnPlane(
                Camera.main.transform.position - prompt.transform.position,
                Vector3.up);
            if (facing.sqrMagnitude > 0.0001f)
            {
                // TextMesh renders its readable face toward local -Z.
                prompt.transform.rotation = Quaternion.LookRotation(-facing, Vector3.up);
            }
        }
    }
}
