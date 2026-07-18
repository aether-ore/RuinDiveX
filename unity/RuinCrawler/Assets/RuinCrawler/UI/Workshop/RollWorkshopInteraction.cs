using RuinCrawler.Runtime.Player;
using UnityEngine;
using UnityEngine.InputSystem;

namespace RuinCrawler.UI.Workshop
{
    [DefaultExecutionOrder(-100)]
    public sealed class RollWorkshopInteraction : MonoBehaviour
    {
        [SerializeField] private RollWorkshopController workshop;
        [SerializeField] private ProductionPlayerController player;
        [SerializeField] private InputActionAsset inputActions;
        [SerializeField, Min(0.5f)] private float interactionRadius = 2.6f;
        [SerializeField] private TextMesh prompt;

        private InputAction interactAction;

        public bool IsPlayerInRange => player != null
            && Vector3.SqrMagnitude(player.transform.position - transform.position)
               <= interactionRadius * interactionRadius;
        public TextMesh Prompt => prompt;

        public void Configure(
            RollWorkshopController targetWorkshop,
            ProductionPlayerController targetPlayer,
            InputActionAsset actions,
            TextMesh interactionPrompt = null)
        {
            workshop = targetWorkshop;
            player = targetPlayer;
            inputActions = actions;
            prompt = interactionPrompt;
            BindInput();
        }

        public bool TryInteract()
        {
            ResolveReferences();
            if (!IsPlayerInRange || workshop == null)
            {
                return false;
            }

            workshop.Toggle();
            return true;
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
            if (workshop == null || player == null)
            {
                SetPrompt(false);
                return;
            }

            bool nearby = IsPlayerInRange;
            SetPrompt(nearby && !workshop.IsOpen);
            if (nearby && interactAction?.WasPressedThisFrame() == true)
            {
                TryInteract();
            }
        }

        private void ResolveReferences()
        {
            workshop ??= FindAnyObjectByType<RollWorkshopController>();
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
            prompt.text = "F / X  TALK TO ROLL";
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
