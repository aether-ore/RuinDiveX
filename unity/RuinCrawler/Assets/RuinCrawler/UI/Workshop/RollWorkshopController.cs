using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Buster;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Runtime.Contracts;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using RuinCrawler.Runtime.Roll;
using RuinCrawler.UI.Common;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RuinCrawler.UI.Workshop
{
    [RequireComponent(typeof(UIDocument))]
    public sealed class RollWorkshopController : MonoBehaviour
    {
        private static readonly Color Panel = new Color(0.035f, 0.055f, 0.075f, 0.98f);
        private static readonly Color Cyan = new Color(0.35f, 0.92f, 1f, 1f);
        private static readonly Color Amber = new Color(1f, 0.72f, 0.22f, 1f);
        private static readonly Color Muted = new Color(0.55f, 0.67f, 0.72f, 1f);

        [SerializeField] private CampaignSession campaignSession;
        [SerializeField] private UnityContractCatalogProvider contractProvider;
        [SerializeField] private ProductionPlayerController player;
        [SerializeField] private RollWorkshopAnimator rollAnimator;
        [SerializeField] private ExpeditionFlowController expeditionFlow;
        [SerializeField] private bool isSafeArea = true;
        [SerializeField] private bool openOnStart;

        private UIDocument document;
        private VisualElement window;
        private ScrollView content;
        private Label status;
        private WorkshopTab currentTab;
        private BusterSourceV1 busterDraft;
        private bool built;
        private PanelSettings ownedPanelSettings;
        private VisualElement focusedControl;
        private int suppressSubmitThroughFrame;
        private readonly Dictionary<WorkshopTab, Button> tabButtons = new Dictionary<WorkshopTab, Button>();

        public bool IsOpen { get; private set; }
        public string CurrentTabId => currentTab.ToString();
        public string FocusedControlName => focusedControl?.name;

        public void Configure(
            CampaignSession session,
            UnityContractCatalogProvider contracts,
            ProductionPlayerController targetPlayer,
            bool safeArea,
            RollWorkshopAnimator animator = null,
            ExpeditionFlowController flow = null)
        {
            Unbind();
            campaignSession = session;
            contractProvider = contracts;
            player = targetPlayer;
            rollAnimator = animator;
            expeditionFlow = flow;
            isSafeArea = safeArea;
            Bind();
            Refresh();
        }

        public void Open()
        {
            if (!built)
            {
                Build();
            }

            IsOpen = true;
            window.style.display = DisplayStyle.Flex;
            player?.SetGameplayEnabled(false);
            rollAnimator?.Play(RollAnimationKind.Waving);
            suppressSubmitThroughFrame = Time.frameCount + 1;
            Refresh();
            ScheduleFocus(TabControlName(currentTab));
        }

        public void Close()
        {
            IsOpen = false;
            if (window != null)
            {
                window.style.display = DisplayStyle.None;
            }

            player?.SetGameplayEnabled(true);
            rollAnimator?.Play(RollAnimationKind.Idle, false);
            focusedControl = null;
        }

        public void Toggle()
        {
            if (IsOpen) Close(); else Open();
        }

        public bool TryShowSection(string sectionId)
        {
            if (!Enum.TryParse(sectionId, true, out WorkshopTab tab))
            {
                return false;
            }

            SelectTab(tab);
            return true;
        }

        public bool TryFocusControl(string controlName)
        {
            if (!IsOpen || string.IsNullOrWhiteSpace(controlName))
            {
                return false;
            }

            VisualElement target = CollectFocusableControls().FirstOrDefault(value =>
                string.Equals(value.name, controlName, StringComparison.Ordinal));
            if (target == null)
            {
                return false;
            }

            focusedControl = target;
            target.Focus();
            return true;
        }

        public void NavigateFocus(int direction)
        {
            MoveFocus(direction);
        }

        public bool ActivateFocusedControl()
        {
            return SubmitFocused();
        }

        private void Awake()
        {
            document = GetComponent<UIDocument>();
            if (document.panelSettings == null)
            {
                ownedPanelSettings = RuinCrawlerPanelSettingsFactory.Create("RuntimeWorkshopPanelSettings");
                document.panelSettings = ownedPanelSettings;
            }

            // Workshop is modal and owns a panel distinct from the HUD. Raise
            // both layers while keeping Pause (1000) authoritative above it.
            document.sortingOrder = 900;
            document.panelSettings.sortingOrder = 900;

            campaignSession ??= CampaignSession.Instance;
            contractProvider ??= UnityContractCatalogProvider.Instance;
            expeditionFlow ??= ExpeditionFlowController.Instance;
            Build();
        }

        private void Start()
        {
            Bind();
            if (openOnStart)
            {
                Open();
            }
            else
            {
                Close();
            }
        }

        private void OnDestroy()
        {
            Unbind();
            if (IsOpen)
            {
                player?.SetGameplayEnabled(true);
            }

            if (ownedPanelSettings != null)
            {
                Destroy(ownedPanelSettings);
                ownedPanelSettings = null;
            }
        }

        private void Update()
        {
            if (!IsOpen)
            {
                return;
            }

            Gamepad gamepad = Gamepad.current;
            if (gamepad == null)
            {
                return;
            }

            if (gamepad.buttonEast.wasPressedThisFrame)
            {
                Close();
                return;
            }

            if (gamepad.leftShoulder.wasPressedThisFrame)
            {
                CycleTab(-1);
                return;
            }

            if (gamepad.rightShoulder.wasPressedThisFrame)
            {
                CycleTab(1);
                return;
            }

            if (gamepad.dpad.up.wasPressedThisFrame)
            {
                MoveFocus(-1);
            }
            else if (gamepad.dpad.down.wasPressedThisFrame)
            {
                MoveFocus(1);
            }
            else if (gamepad.dpad.left.wasPressedThisFrame)
            {
                if (!AdjustFocusedSlider(-1)) MoveFocus(-1);
            }
            else if (gamepad.dpad.right.wasPressedThisFrame)
            {
                if (!AdjustFocusedSlider(1)) MoveFocus(1);
            }

            if (Time.frameCount > suppressSubmitThroughFrame && gamepad.buttonSouth.wasPressedThisFrame)
            {
                SubmitFocused();
            }
        }

        private void Bind()
        {
            if (campaignSession != null)
            {
                campaignSession.StateChanged -= HandleStateChanged;
                campaignSession.StateChanged += HandleStateChanged;
            }
        }

        private void Unbind()
        {
            if (campaignSession != null)
            {
                campaignSession.StateChanged -= HandleStateChanged;
            }
        }

        private void HandleStateChanged(CampaignStateV1 _, string __)
        {
            Refresh();
        }

        private void Build()
        {
            if (built || document == null)
            {
                return;
            }

            VisualElement root = document.rootVisualElement;
            root.Clear();
            RuinCrawlerUiTheme.StyleScreenRoot(root);
            root.style.alignItems = Align.Center;
            root.style.justifyContent = Justify.Center;

            window = new VisualElement { name = "roll-workshop-window", focusable = true };
            window.style.width = Length.Percent(82f);
            window.style.height = Length.Percent(86f);
            window.style.maxWidth = 1260f;
            window.style.paddingLeft = 22f;
            window.style.paddingRight = 22f;
            window.style.paddingTop = 16f;
            window.style.paddingBottom = 16f;
            window.style.backgroundColor = Panel;
            RuinCrawlerUiTheme.StyleMechanicalFrame(window, true);
            RuinCrawlerUiTheme.AddMechanicalSurface(window, true, 0.11f);
            RuinCrawlerUiTheme.AddCornerRivets(window);
            root.Add(window);

            Label title = Heading("ROLL'S WORKSHOP", 26);
            title.style.color = Cyan;
            window.Add(title);
            Label subtitle = Small("Identify field recoveries, fabricate deterministic equipment, and prepare the next expedition.");
            window.Add(subtitle);

            VisualElement tabs = Row();
            tabs.style.marginTop = 12f;
            window.Add(tabs);
            AddTab(tabs, "SALVAGE", WorkshopTab.Salvage);
            AddTab(tabs, "FABRICATION", WorkshopTab.Fabrication);
            AddTab(tabs, "LOADOUT", WorkshopTab.Loadout);
            AddTab(tabs, "BUSTER LAB", WorkshopTab.BusterLab);
            AddTab(tabs, "EXPEDITIONS", WorkshopTab.BossHunts);

            content = new ScrollView(ScrollViewMode.Vertical);
            content.style.flexGrow = 1f;
            content.style.marginTop = 12f;
            content.style.marginBottom = 10f;
            window.Add(content);

            VisualElement footer = Row();
            footer.style.minHeight = 48f;
            footer.style.paddingLeft = 12f;
            footer.style.paddingRight = 8f;
            footer.style.paddingTop = 5f;
            footer.style.paddingBottom = 5f;
            RuinCrawlerUiTheme.StyleDialogueBox(footer, false);
            status = Small("Roll: Let's see what you brought back.");
            status.name = "roll-workshop-status";
            status.style.flexGrow = 1f;
            status.style.color = Color.white;
            footer.Add(status);
            Button close = ActionButton("CLOSE", Close, "roll-close");
            close.tooltip = "Close Roll's workshop and restore gameplay controls.";
            footer.Add(close);
            window.Add(footer);

            window.RegisterCallback<KeyDownEvent>(HandleKeyDown, TrickleDown.TrickleDown);
            built = true;
            currentTab = WorkshopTab.Salvage;
            RefreshTabStyles();
        }

        private void AddTab(VisualElement parent, string label, WorkshopTab tab)
        {
            Button button = ActionButton(label, () => SelectTab(tab), TabControlName(tab));
            button.style.flexGrow = 1f;
            parent.Add(button);
            tabButtons[tab] = button;
        }

        private void Refresh()
        {
            if (!built || content == null || !IsOpen)
            {
                return;
            }

            string preferredFocus = focusedControl?.name;
            focusedControl = null;
            content.Clear();
            RefreshTabStyles();
            campaignSession ??= CampaignSession.Instance;
            contractProvider ??= UnityContractCatalogProvider.Instance;
            if (campaignSession == null || contractProvider?.Catalog == null)
            {
                content.Add(Heading("WORKSHOP SERVICES OFFLINE", 20));
                content.Add(Small("The campaign save or Unity contract pack is unavailable. Check the Console; no fallback items will be substituted."));
                return;
            }

            CampaignStateV1 state = campaignSession.Snapshot;
            switch (currentTab)
            {
                case WorkshopTab.Salvage:
                    BuildSalvage(state);
                    break;
                case WorkshopTab.Fabrication:
                    BuildFabrication(state);
                    break;
                case WorkshopTab.Loadout:
                    BuildLoadout(state);
                    break;
                case WorkshopTab.BusterLab:
                    BuildBusterLab(state);
                    break;
                case WorkshopTab.BossHunts:
                    BuildBossHunts(state);
                    break;
            }

            ScheduleFocus(string.IsNullOrWhiteSpace(preferredFocus)
                ? TabControlName(currentTab)
                : preferredFocus);
        }

        private void BuildSalvage(CampaignStateV1 state)
        {
            content.Add(Heading("SALVAGE ANALYSIS", 20));
            int pending = state.unidentifiedRecoveries.Sum(value => Mathf.Max(0, value?.quantity ?? 0));
            content.Add(Small($"UNIDENTIFIED RECOVERIES  {pending:000}     IDENTIFIED SCRAP  {state.salvage.identifiedScrap:000}"));

            content.Add(Section("EXPEDITION ACCESS"));
            bool expeditionActive = !string.IsNullOrEmpty(state.bossHunts.activeExpeditionId);
            bool resumable = expeditionFlow != null && expeditionFlow.CanResumeActiveExpedition;
            bool selectedHunt = !string.IsNullOrEmpty(state.bossHunts.selectedProfileId);
            content.Add(Small(expeditionActive
                ? resumable
                    ? "Your committed ruin is still available. Re-enter the same generated dungeon, or abandon it to unlock another Boss Hunt."
                    : "Start an expedition to enter a newly generated ruin."
                : selectedHunt
                    ? "A Boss Hunt is selected. Depart now to enter its generated dungeon, or change the hunt under EXPEDITIONS."
                    : "Depart immediately for a procedurally generated ruin. A Boss Hunt selection is optional."));
            Button depart = ActionButton(
                expeditionActive
                    ? resumable
                        ? "RE-ENTER ACTIVE EXPEDITION"
                        : "START EXPEDITION"
                    : selectedHunt
                        ? "DEPART FOR SELECTED HUNT"
                        : "DEPART TO DUNGEON",
                () =>
            {
                bool wasActive = expeditionActive;
                bool wasResumable = resumable;
                bool started = expeditionFlow != null && expeditionFlow.EnterOrResumeExpedition();
                SetStatus(
                    started
                        ? wasActive
                            ? wasResumable
                                ? "Re-entering the committed expedition."
                                : "Entering a newly generated ruin."
                            : "Expedition committed. Departing camp."
                        : "The expedition could not begin.",
                    started);
            }, "roll-standard-expedition-depart");
            depart.SetEnabled(expeditionFlow != null);
            depart.tooltip = expeditionFlow == null
                ? "Support Car expedition services are offline."
                : expeditionActive
                    ? resumable
                        ? "Re-enter the active expedition with its existing ID, seed, dungeon, and Boss Hunt."
                        : "Start a newly generated ruin."
                    : selectedHunt
                        ? "Commit the selected Boss Hunt and enter its generated dungeon."
                        : "Commit a normal run seed and enter a generated ruin without selecting a Boss Hunt.";
            content.Add(depart);
            if (expeditionActive)
            {
                Button abandon = ActionButton("ABANDON ACTIVE EXPEDITION", () =>
                {
                    bool abandoned = expeditionFlow != null && expeditionFlow.AbandonActiveExpedition();
                    SetStatus(
                        abandoned
                            ? "Active expedition abandoned. Boss Hunt selection is unlocked."
                            : "The active expedition could not be abandoned; no campaign state was changed.",
                        abandoned);
                    Refresh();
                }, "roll-active-expedition-abandon");
                abandon.SetEnabled(expeditionFlow != null);
                abandon.tooltip = expeditionFlow == null
                    ? "Support Car expedition services are offline."
                    : "End this run without awarding rewards. Collected salvage and the selected hunt are preserved.";
                content.Add(abandon);
            }

            content.Add(Section("SALVAGE STORAGE"));
            Button identify = ActionButton("IDENTIFY ALL", () =>
            {
                WorkshopTransactionResult result = campaignSession.IdentifyAll();
                rollAnimator?.Play(result.Success ? RollAnimationKind.Thankful : RollAnimationKind.Thinking);
                SetStatus(result.Success
                    ? $"Roll processed {result.ProcessedRecoveries} recoveries: {result.PartsStored} named parts, {result.ScrapStored} scrap."
                    : result.Message ?? result.FailureCode,
                    result.Success);
                Refresh();
            }, "roll-identify-all");
            identify.SetEnabled(pending > 0);
            identify.tooltip = pending > 0 ? "Atomically identify every stored recovery." : "No unidentified recoveries are stored.";
            content.Add(identify);

            content.Add(Section("NAMED-PART STOCKPILE"));
            if (state.salvage.parts.Count == 0)
            {
                content.Add(Small("No named Reaverbot components are currently stored."));
            }
            else
            {
                foreach (NamedPartStackV1 part in state.salvage.parts.OrderBy(value => value.family).ThenBy(value => value.name))
                {
                    content.Add(Card(part.name, $"{part.family} · {part.aspect} · {part.tier}", $"x{part.quantity:00}"));
                }
            }

            content.Add(Section("DISCOVERIES"));
            if (state.discoveryHistory.Count == 0)
            {
                content.Add(Small("No named-part discoveries have been recorded yet."));
            }
            foreach (SalvageDiscoveryV1 discovery in state.discoveryHistory.OrderBy(value => value.sequence))
            {
                content.Add(Small($"#{discovery.sequence:000}  {discovery.name}  [{discovery.sourceKind}:{discovery.sourceId}]"));
            }

            if (state.unknownIdQuarantine.Count > 0)
            {
                Label warning = Section("QUARANTINED UNKNOWN IDS");
                warning.style.color = Amber;
                content.Add(warning);
                foreach (QuarantinedUnknownIdV1 unknown in state.unknownIdQuarantine)
                {
                    content.Add(Small($"{unknown.category}: {unknown.unknownId} ({unknown.path})"));
                }
            }
        }

        private void BuildFabrication(CampaignStateV1 state)
        {
            content.Add(Heading("EQUIPMENT & MODULE FABRICATION", 20));
            content.Add(Small($"IDENTIFIED SCRAP  {state.salvage.identifiedScrap:000}. Named parts are consumed only after every requirement and the durable save commit succeed."));
            foreach (WorkshopRecipeV1 recipe in contractProvider.Catalog.Recipes.Values.OrderBy(value => value.outputKind).ThenBy(value => value.label))
            {
                VisualElement card = PanelCard();
                VisualElement header = Row();
                Label name = Heading(recipe.label, 16);
                name.style.flexGrow = 1f;
                header.Add(name);
                header.Add(Small(recipe.outputKind.ToUpperInvariant()));
                card.Add(header);
                string requirements = recipe.identifiedScrapCost + " scrap";
                if (recipe.parts.Count > 0)
                {
                    requirements += " · " + string.Join(" · ", recipe.parts.Select(value =>
                    {
                        string materialName = contractProvider.Catalog.Materials.TryGetValue(value.materialId, out UnityContractCatalog.SalvageMaterialContract material)
                            ? material.Name
                            : value.materialId;
                        return materialName + " x" + value.quantity;
                    }));
                }

                card.Add(Small(requirements));
                string disabledReason = GetFabricationDisabledReason(state, recipe);
                Button fabricate = ActionButton("FABRICATE", () =>
                {
                    WorkshopTransactionResult result = campaignSession.Fabricate(recipe);
                    rollAnimator?.Play(result.Success ? RollAnimationKind.Happy : RollAnimationKind.Thinking);
                    SetStatus(result.Success ? recipe.label + " materialized." : result.Message ?? result.FailureCode, result.Success);
                    Refresh();
                }, "roll-fabricate-" + recipe.recipeId);
                fabricate.SetEnabled(disabledReason == null);
                fabricate.tooltip = disabledReason ?? "Fabricate and commit this item atomically.";
                card.Add(fabricate);
                if (disabledReason != null)
                {
                    Label reason = Small(disabledReason);
                    reason.style.color = Muted;
                    card.Add(reason);
                }

                content.Add(card);
            }

        }

        private void BuildLoadout(CampaignStateV1 state)
        {
            content.Add(Heading("ARMS & GEAR LOADOUT", 20));
            content.Add(Small(isSafeArea
                ? "SAFE AREA VERIFIED — loadout transactions are enabled."
                : "LOADOUT LOCKED — return to camp or another safe area."));

            content.Add(Section("SPECIAL ARMS"));
            foreach (string armId in state.ownedArmIds)
            {
                string label = FindRecipeLabelByOutput(armId) ?? armId;
                string slot = string.Equals(armId, "megaBuster", StringComparison.Ordinal)
                    ? "megaBuster"
                    : "special1";
                Button equip = ActionButton(
                    "EQUIP " + label.ToUpperInvariant(),
                    () => Equip("arm", slot, armId),
                    "roll-equip-arm-" + armId);
                equip.SetEnabled(isSafeArea);
                equip.tooltip = isSafeArea ? "Assign to " + slot + "." : "Safe area required.";
                content.Add(equip);
            }

            foreach (BusterSourceV1 build in state.busterSources)
            {
                Button equip = ActionButton(
                    $"EQUIP {build.buildId.ToUpperInvariant()} r{build.revision}",
                    () => AssignBuster(build.buildId),
                    "roll-equip-buster-" + build.buildId);
                equip.SetEnabled(isSafeArea);
                equip.tooltip = isSafeArea ? "Assign this immutable Custom Buster revision." : "Safe area required.";
                content.Add(equip);
            }

            content.Add(Section("FIXED-FUNCTION GEAR"));
            foreach (string gearId in state.ownedGearIds)
            {
                string slot = PreferredGearSlot(gearId);
                string label = FindRecipeLabelByOutput(gearId) ?? gearId;
                Button equip = ActionButton(
                    $"EQUIP {label.ToUpperInvariant()} · {slot.ToUpperInvariant()}",
                    () => Equip("gear", slot, gearId),
                    "roll-equip-gear-" + gearId);
                bool slotUnlocked = state.unlockedGearSlotIds.Contains(slot);
                equip.SetEnabled(isSafeArea && slotUnlocked);
                equip.tooltip = !isSafeArea ? "Safe area required." : !slotUnlocked ? "This Gear slot is locked." : "Equip fixed-function Gear.";
                content.Add(equip);
            }

            content.Add(Section("CURRENT ASSIGNMENTS"));
            foreach (LoadoutAssignmentV1 value in state.armAssignments.Concat(state.gearAssignments))
            {
                VisualElement assignment = Row();
                Label assignmentLabel = Small($"{value.slotId.ToUpperInvariant(),-12}  {value.itemId}");
                assignmentLabel.style.flexGrow = 1f;
                assignment.Add(assignmentLabel);
                bool armAssignment = state.armAssignments.Contains(value);
                Button clear = ActionButton(
                    "CLEAR",
                    () => Equip(armAssignment ? "arm" : "gear", value.slotId, null),
                    "roll-clear-" + value.slotId);
                clear.SetEnabled(isSafeArea);
                clear.tooltip = isSafeArea ? "Unequip this physical item." : "Safe area required.";
                assignment.Add(clear);
                content.Add(assignment);
            }
        }

        private void BuildBusterLab(CampaignStateV1 state)
        {
            EnsureDraft(state);
            content.Add(Heading("CUSTOM BUSTER LAB", 20));
            content.Add(Small("Schema 1 · custom-buster-v0.2 · immutable compilation · weapon-local battery"));
            content.Add(Small($"DRAFT {busterDraft.buildId} · BASE REVISION {busterDraft.revision} · CAPACITY {busterDraft.modules.Count}/{BusterRuleset.ChassisCapacity}"));

            AddTuningSlider("POWER", "power", value => busterDraft.power = value, busterDraft.power);
            AddTuningSlider("ENERGY", "energy", value => busterDraft.energy = value, busterDraft.energy);
            AddTuningSlider("RANGE", "range", value => busterDraft.range = value, busterDraft.range);
            AddTuningSlider("RAPID", "rapid", value => busterDraft.rapid = value, busterDraft.rapid);
            int total = busterDraft.power + busterDraft.energy + busterDraft.range + busterDraft.rapid;
            Label totalLabel = Small($"TUNING TOTAL {total}/{BusterRuleset.TuningTotal}");
            totalLabel.style.color = total == BusterRuleset.TuningTotal ? Cyan : Amber;
            content.Add(totalLabel);

            content.Add(Section("OWNED MODULES"));
            if (state.ownedModuleIds.Count == 0)
            {
                content.Add(Small("No physical Buster modules are owned. Fabricate one from the Fabrication tab."));
            }
            foreach (string moduleId in state.ownedModuleIds)
            {
                BusterModuleDefinition definition = BusterModuleCatalog.Get(moduleId);
                Button add = ActionButton("ADD " + (definition?.Label ?? moduleId).ToUpperInvariant(), () =>
                {
                    AddDraftModule(moduleId);
                    Refresh();
                }, "roll-buster-add-" + moduleId);
                bool hasCapacity = busterDraft.modules.Count < BusterRuleset.ChassisCapacity;
                bool alreadyInstalled = busterDraft.modules.Exists(value => value.moduleId == moduleId);
                add.SetEnabled(hasCapacity && !alreadyInstalled);
                add.tooltip = !hasCapacity
                    ? "The chassis has no remaining module capacity."
                    : alreadyInstalled
                        ? "One physical module cannot occupy multiple graph nodes."
                        : "Add this owned physical module to the draft graph.";
                content.Add(add);
            }

            content.Add(Section("PROGRAM"));
            if (busterDraft.modules.Count == 0)
            {
                content.Add(Small("Empty graph. Add an emitter first."));
            }
            else
            {
                for (int index = 0; index < busterDraft.modules.Count; index += 1)
                {
                    BusterModuleSourceV1 node = busterDraft.modules[index];
                    content.Add(Small($"{index + 1:00}  {node.nodeId}  →  {node.moduleId}"));
                }
                Button remove = ActionButton("REMOVE LAST NODE", () =>
                {
                    RemoveLastDraftModule();
                    Refresh();
                }, "roll-buster-remove-last");
                content.Add(remove);
            }

            BusterWorkshopResult preview = BusterWorkshopService.ValidateDraft(state, busterDraft);
            Label verdict = Section(preview.Success ? "VALID PLAN" : "PLAN BLOCKED");
            verdict.style.color = preview.Success ? Cyan : Amber;
            content.Add(verdict);
            if (preview.Success)
            {
                content.Add(Small(preview.Plan.Description));
                content.Add(Small($"POWER {preview.Plan.Stats.EffectivePower:0.00} · ENERGY {preview.Plan.Stats.EnergyCost:0.00}/{preview.Plan.Stats.MaxEnergy:0.00} · CYCLE {preview.Plan.Stats.CycleTime:0.000}s · SHOTS {preview.Plan.Stats.ShotsPerCharge}"));
            }
            else
            {
                content.Add(Small(preview.Message ?? preview.FailureCode));
                foreach (BusterValidationIssue issue in preview.ValidationIssues.Take(6))
                {
                    content.Add(Small(issue.Code + " · " + issue.Message));
                }
            }

            VisualElement actions = Row();
            Button materialize = ActionButton(
                "MATERIALIZE REVISION",
                MaterializeBuster,
                "roll-buster-materialize");
            materialize.SetEnabled(preview.Success && isSafeArea);
            materialize.tooltip = !isSafeArea ? "Safe area required." : !preview.Success ? "Resolve validation errors first." : "Commit an immutable Buster revision.";
            actions.Add(materialize);
            bool materializedCurrentDraft = IsCurrentDraftMaterialized(state);
            Button testRange = ActionButton("ASSIGN & LAUNCH TEST RANGE", () =>
            {
                if (!preview.Success || !materializedCurrentDraft || !AssignBuster(busterDraft.buildId)) return;
                Close();
                if (expeditionFlow != null)
                {
                    expeditionFlow.LaunchTestRange();
                }
                else
                {
                    SceneManager.LoadScene("TestRange");
                }
            }, "roll-buster-test-range");
            testRange.SetEnabled(preview.Success && materializedCurrentDraft && isSafeArea);
            testRange.tooltip = !preview.Success
                ? "Resolve validation errors first."
                : !materializedCurrentDraft
                    ? "Materialize this exact draft revision before testing it."
                    : !isSafeArea
                        ? "Safe area required."
                        : "Assign the immutable revision and launch the diagnostic Test Range.";
            actions.Add(testRange);
            content.Add(actions);
        }

        private void BuildBossHunts(CampaignStateV1 state)
        {
            content.Add(Heading("EXPEDITIONS & BOSS HUNTS", 20));
            bool expeditionActive = !string.IsNullOrWhiteSpace(state.bossHunts.activeExpeditionId);
            content.Add(Small(state.bossHunts.selectionLocked
                ? $"SELECTION LOCKED · EXPEDITION {state.bossHunts.activeExpeditionId}"
                : "Depart without a selection for a standard generated dungeon, or select an advertised recovery for a Boss Hunt. Selection locks when the expedition begins."));
            BuildBossHuntDepartureActions(state, expeditionActive);
            foreach (UnityContractCatalog.BossProfileContract boss in contractProvider.Catalog.BossProfiles.Values.OrderBy(value => value.Title))
            {
                VisualElement card = PanelCard();
                card.Add(Heading(boss.DisplayName, 16));
                string recovery = ResolveAdvertisedRecovery(boss);
                card.Add(Small("ADVERTISED RECOVERY · " + recovery));
                card.Add(Small("ROLE · " + boss.RoleClue));
                bool selected = string.Equals(state.bossHunts.selectedProfileId, boss.Id, StringComparison.Ordinal);
                bool cleared = state.bossHunts.clearedProfileIds.Contains(boss.Id);
                Button select = ActionButton(selected ? "SELECTED" : "SELECT HUNT", () =>
                {
                    WorkshopTransactionResult result = campaignSession.SelectBossHunt(boss.Id, true);
                    SetStatus(result.Success ? boss.Title + " selected." : result.Message ?? result.FailureCode, result.Success);
                    Refresh();
                }, "roll-boss-select-" + boss.Id);
                select.SetEnabled(!state.bossHunts.selectionLocked && !selected);
                select.tooltip = state.bossHunts.selectionLocked ? "Selection is locked for the active expedition." : selected ? "This hunt is already selected." : "Select this hunt.";
                card.Add(select);
                card.Add(Small(cleared ? "CLEAR HISTORY · COMPLETE" : "CLEAR HISTORY · NONE"));
                content.Add(card);
            }
        }

        private void BuildBossHuntDepartureActions(CampaignStateV1 state, bool expeditionActive)
        {
            bool selectedHunt = !string.IsNullOrEmpty(state.bossHunts.selectedProfileId);
            Button depart = ActionButton(
                expeditionActive
                    ? "RE-ENTER ACTIVE EXPEDITION"
                    : selectedHunt
                        ? "DEPART FOR SELECTED HUNT"
                        : "DEPART TO STANDARD DUNGEON",
                () =>
            {
                bool wasActive = expeditionActive;
                bool started = expeditionFlow != null && expeditionFlow.EnterOrResumeExpedition();
                SetStatus(
                    started
                        ? wasActive
                            ? "Re-entering the committed expedition."
                            : "Expedition committed. Departing camp."
                        : wasActive
                            ? "The saved expedition could not be resumed. You can abandon it below."
                            : "Expedition could not begin.",
                    started);
            }, "roll-support-car-depart");
            bool resumable = expeditionFlow != null && expeditionFlow.CanResumeActiveExpedition;
            depart.SetEnabled(expeditionFlow != null
                && (!expeditionActive || resumable));
            depart.tooltip = expeditionFlow == null
                ? "Support Car expedition services are offline."
                : expeditionActive
                    ? resumable
                        ? "Re-enter the active expedition with its existing ID, seed, dungeon, and Boss Hunt."
                        : "The saved expedition source is incomplete. Abandon it to unlock a new run."
                    : selectedHunt
                        ? "Commit the selected Boss Hunt run seed and depart."
                        : "Commit a standard procedural dungeon without selecting a Boss Hunt.";
            content.Add(depart);
            if (expeditionActive)
            {
                Button abandon = ActionButton("ABANDON ACTIVE EXPEDITION", () =>
                {
                    bool abandoned = expeditionFlow != null && expeditionFlow.AbandonActiveExpedition();
                    SetStatus(
                        abandoned
                            ? "Active expedition abandoned. Choose a Boss Hunt or depart for a standard dungeon."
                            : "The active expedition could not be abandoned; no campaign state was changed.",
                        abandoned);
                    Refresh();
                }, "roll-active-expedition-abandon");
                abandon.SetEnabled(expeditionFlow != null);
                abandon.tooltip = expeditionFlow == null
                    ? "Support Car expedition services are offline."
                    : "End this run without awarding rewards. Collected salvage and the selected hunt are preserved.";
                content.Add(abandon);
            }
        }

        private void EnsureDraft(CampaignStateV1 state)
        {
            if (busterDraft != null)
            {
                return;
            }

            BusterSourceV1 existing = state.busterSources.FirstOrDefault();
            busterDraft = existing?.Clone() ?? new BusterSourceV1
            {
                buildId = "custom-buster-01",
                chassisId = "custom-buster-chassis",
                rulesetVersion = BusterRuleset.RulesetVersion,
                revision = 0,
                power = 4,
                energy = 4,
                range = 4,
                rapid = 4
            };
        }

        private void AddDraftModule(string moduleId)
        {
            BusterModuleDefinition definition = BusterModuleCatalog.Get(moduleId);
            if (definition == null || busterDraft.modules.Count >= BusterRuleset.ChassisCapacity)
            {
                return;
            }

            string nodeId = moduleId + "-" + (busterDraft.modules.Count + 1);
            var node = new BusterModuleSourceV1
            {
                nodeId = nodeId,
                moduleId = moduleId,
                instanceId = busterDraft.buildId + ":" + nodeId
            };
            if (busterDraft.modules.Count == 0)
            {
                busterDraft.rootNodeId = nodeId;
            }
            else
            {
                BusterModuleSourceV1 previous = busterDraft.modules[busterDraft.modules.Count - 1];
                busterDraft.edges.Add(new BusterEdgeSourceV1
                {
                    fromNodeId = previous.nodeId,
                    port = BusterEdgePorts.Next,
                    toNodeId = nodeId
                });
            }

            busterDraft.modules.Add(node);
        }

        private void RemoveLastDraftModule()
        {
            if (busterDraft.modules.Count == 0) return;
            BusterModuleSourceV1 removed = busterDraft.modules[busterDraft.modules.Count - 1];
            busterDraft.modules.RemoveAt(busterDraft.modules.Count - 1);
            busterDraft.edges.RemoveAll(value => value.fromNodeId == removed.nodeId || value.toNodeId == removed.nodeId);
            if (busterDraft.modules.Count == 0) busterDraft.rootNodeId = null;
        }

        private void MaterializeBuster()
        {
            BusterWorkshopResult planned = BusterWorkshopService.MaterializeRevision(
                campaignSession.Snapshot,
                busterDraft,
                Guid.NewGuid().ToString("N"),
                DateTime.UtcNow.ToString("O"));
            if (!planned.Success)
            {
                rollAnimator?.Play(RollAnimationKind.Thinking);
                SetStatus(planned.Message ?? planned.FailureCode, false);
                return;
            }

            var commit = campaignSession.Commit("roll-materialize-buster:" + busterDraft.buildId, planned.State);
            if (commit.Success)
            {
                rollAnimator?.Play(RollAnimationKind.Happy);
                busterDraft = commit.Envelope.State.busterSources.First(value => value.buildId == busterDraft.buildId).Clone();
                SetStatus($"{busterDraft.buildId} revision {busterDraft.revision} materialized.", true);
            }
            else
            {
                SetStatus(commit.Message ?? "Buster save failed.", false);
            }
            Refresh();
        }

        private bool AssignBuster(string buildId)
        {
            BusterWorkshopResult planned = BusterWorkshopService.AssignBuild(
                campaignSession.Snapshot, buildId, "megaBuster", isSafeArea);
            if (!planned.Success)
            {
                SetStatus(planned.Message ?? planned.FailureCode, false);
                return false;
            }

            var commit = campaignSession.Commit("roll-assign-buster:" + buildId, planned.State);
            SetStatus(commit.Success ? buildId + " equipped." : commit.Message ?? "Assignment save failed.", commit.Success);
            Refresh();
            return commit.Success;
        }

        private void Equip(string kind, string slot, string itemId)
        {
            WorkshopTransactionResult result = campaignSession.Equip(kind, slot, itemId, isSafeArea);
            string successMessage = string.IsNullOrEmpty(itemId)
                ? slot + " cleared."
                : itemId + " equipped in " + slot + ".";
            SetStatus(result.Success ? successMessage : result.Message ?? result.FailureCode, result.Success);
            Refresh();
        }

        private void AddTuningSlider(string label, string id, Action<int> setter, int value)
        {
            var slider = new SliderInt(label, BusterRuleset.TuningMinimum, BusterRuleset.TuningMaximum)
            {
                value = value,
                showInputField = true,
                name = "roll-buster-tuning-" + id,
                focusable = true
            };
            RegisterFocusable(slider);
            slider.RegisterValueChangedCallback(evt =>
            {
                setter(evt.newValue);
                Refresh();
            });
            content.Add(slider);
        }

        private bool IsCurrentDraftMaterialized(CampaignStateV1 state)
        {
            BusterSourceV1 committed = state.busterSources.FirstOrDefault(value => value != null
                && string.Equals(value.buildId, busterDraft?.buildId, StringComparison.Ordinal));
            return committed != null
                && string.Equals(
                    JsonUtility.ToJson(committed),
                    JsonUtility.ToJson(busterDraft),
                    StringComparison.Ordinal);
        }

        private string GetFabricationDisabledReason(CampaignStateV1 state, WorkshopRecipeV1 recipe)
        {
            if (!recipe.repeatable && state.fabricationHistory.Exists(value => value.recipeId == recipe.recipeId))
                return "Already fabricated; deterministic one-time ownership is recorded.";
            if (IsRecipeOutputOwned(state, recipe))
                return "This physical output is already owned.";
            if (recipe.requiresDefenseUnlock && !state.unlockedGearSlotIds.Contains("defense"))
                return "Defense Gear slot is locked.";
            if (state.salvage.identifiedScrap < recipe.identifiedScrapCost)
                return $"Needs {recipe.identifiedScrapCost - state.salvage.identifiedScrap} more identified scrap.";
            foreach (WorkshopPartRequirementV1 requirement in recipe.parts)
            {
                int count = state.salvage.parts.FirstOrDefault(value => value.materialId == requirement.materialId)?.quantity ?? 0;
                if (count < requirement.quantity)
                    return $"Missing {requirement.materialId} x{requirement.quantity - count}.";
            }
            return null;
        }

        private static bool IsRecipeOutputOwned(CampaignStateV1 state, WorkshopRecipeV1 recipe)
        {
            switch (recipe.outputKind)
            {
                case "arm":
                    return state.ownedArmIds.Contains(recipe.outputId);
                case "gear":
                    return state.ownedGearIds.Contains(recipe.outputId);
                case "module":
                    return state.ownedModuleIds.Contains(recipe.outputId);
                case "chassis":
                    return state.ownedChassisIds.Contains(recipe.outputId);
                default:
                    return false;
            }
        }

        private string FindRecipeLabelByOutput(string outputId)
        {
            return contractProvider.Catalog.Recipes.Values.FirstOrDefault(value => value.outputId == outputId)?.label;
        }

        private string ResolveAdvertisedRecovery(UnityContractCatalog.BossProfileContract boss)
        {
            string materialId = boss.RewardMaterialId;
            if (!string.IsNullOrEmpty(materialId)
                && contractProvider.Catalog.Materials.TryGetValue(materialId, out UnityContractCatalog.SalvageMaterialContract material))
            {
                return material.Name + (boss.FirstClearGuaranteed ? " · FIRST CLEAR GUARANTEED" : string.Empty);
            }
            return string.IsNullOrWhiteSpace(boss.RoleClue) ? boss.FeaturedModuleId ?? "UNKNOWN" : boss.RoleClue.ToUpperInvariant();
        }

        private static string PreferredGearSlot(string gearId)
        {
            if (gearId == "reinforcedArmorFrame") return "armor";
            if (gearId == "jumpSprings") return "mobility";
            if (gearId == "guardProjector") return "defense";
            if (gearId == "fastSwapAdapter") return "utility2";
            return "utility1";
        }

        private void HandleKeyDown(KeyDownEvent evt)
        {
            bool handled = true;
            switch (evt.keyCode)
            {
                case KeyCode.Escape:
                    Close();
                    break;
                case KeyCode.Tab:
                    MoveFocus(evt.shiftKey ? -1 : 1);
                    break;
                case KeyCode.PageUp:
                    CycleTab(-1);
                    break;
                case KeyCode.PageDown:
                    CycleTab(1);
                    break;
                case KeyCode.UpArrow:
                    MoveFocus(-1);
                    break;
                case KeyCode.DownArrow:
                    MoveFocus(1);
                    break;
                case KeyCode.LeftArrow:
                    if (!AdjustFocusedSlider(-1)) MoveFocus(-1);
                    break;
                case KeyCode.RightArrow:
                    if (!AdjustFocusedSlider(1)) MoveFocus(1);
                    break;
                case KeyCode.Return:
                case KeyCode.KeypadEnter:
                case KeyCode.Space:
                    SubmitFocused();
                    break;
                default:
                    handled = false;
                    break;
            }

            if (handled)
            {
                evt.StopImmediatePropagation();
            }
        }

        private void SelectTab(WorkshopTab tab)
        {
            currentTab = tab;
            Refresh();
            ScheduleFocus(TabControlName(tab));
        }

        private void CycleTab(int direction)
        {
            int tabCount = Enum.GetValues(typeof(WorkshopTab)).Length;
            int index = ((int)currentTab + Math.Sign(direction) + tabCount) % tabCount;
            SelectTab((WorkshopTab)index);
        }

        private void RefreshTabStyles()
        {
            foreach (KeyValuePair<WorkshopTab, Button> pair in tabButtons)
            {
                bool selected = pair.Key == currentTab;
                RuinCrawlerUiTheme.StyleMenuButton(pair.Value, selected);
                pair.Value.tooltip = selected
                    ? "Current workshop section."
                    : "Open the " + (pair.Key == WorkshopTab.BossHunts ? "EXPEDITIONS" : pair.Key.ToString()) + " section.";
            }
        }

        private static string TabControlName(WorkshopTab tab)
        {
            switch (tab)
            {
                case WorkshopTab.Salvage:
                    return "roll-tab-salvage";
                case WorkshopTab.Fabrication:
                    return "roll-tab-fabrication";
                case WorkshopTab.Loadout:
                    return "roll-tab-loadout";
                case WorkshopTab.BusterLab:
                    return "roll-tab-buster-lab";
                case WorkshopTab.BossHunts:
                    return "roll-tab-boss-hunts";
                default:
                    return "roll-tab-salvage";
            }
        }

        private void RegisterFocusable(VisualElement element)
        {
            if (element == null)
            {
                return;
            }

            element.RegisterCallback<FocusInEvent>(_ => focusedControl = element);
            element.RegisterCallback<FocusOutEvent>(_ =>
            {
                if (ReferenceEquals(focusedControl, element))
                {
                    focusedControl = null;
                }
            });
        }

        private void ScheduleFocus(string preferredName)
        {
            if (window == null || !IsOpen)
            {
                return;
            }

            window.schedule.Execute(() =>
            {
                if (!IsOpen)
                {
                    return;
                }

                List<VisualElement> controls = CollectFocusableControls();
                VisualElement target = controls.FirstOrDefault(value =>
                    string.Equals(value.name, preferredName, StringComparison.Ordinal));
                target ??= controls.FirstOrDefault();
                if (target != null)
                {
                    focusedControl = target;
                    target.Focus();
                }
            }).ExecuteLater(1L);
        }

        private void MoveFocus(int direction)
        {
            List<VisualElement> controls = CollectFocusableControls();
            if (controls.Count == 0)
            {
                return;
            }

            int currentIndex = focusedControl == null ? -1 : controls.IndexOf(focusedControl);
            int delta = Math.Sign(direction);
            int nextIndex = currentIndex < 0
                ? (delta < 0 ? controls.Count - 1 : 0)
                : (currentIndex + delta + controls.Count) % controls.Count;
            focusedControl = controls[nextIndex];
            focusedControl.Focus();
        }

        private bool AdjustFocusedSlider(int direction)
        {
            if (!(focusedControl is SliderInt slider) || !slider.enabledInHierarchy)
            {
                return false;
            }

            slider.value = Mathf.Clamp(slider.value + Math.Sign(direction), slider.lowValue, slider.highValue);
            return true;
        }

        private bool SubmitFocused()
        {
            if (focusedControl is WorkshopActionButton button && button.enabledInHierarchy)
            {
                button.InvokeAction();
                return true;
            }

            return false;
        }

        private List<VisualElement> CollectFocusableControls()
        {
            var result = new List<VisualElement>();
            if (window != null)
            {
                CollectFocusableControls(window, result);
            }

            return result;
        }

        private static void CollectFocusableControls(VisualElement parent, ICollection<VisualElement> result)
        {
            foreach (VisualElement child in parent.Children())
            {
                if (child.focusable && child.enabledInHierarchy
                    && child.resolvedStyle.display != DisplayStyle.None)
                {
                    result.Add(child);
                }

                CollectFocusableControls(child, result);
            }
        }

        private void SetStatus(string text, bool success)
        {
            if (status == null) return;
            status.text = text ?? string.Empty;
            status.style.color = success ? Cyan : Amber;
        }

        private static VisualElement Card(string title, string detail, string value)
        {
            VisualElement card = PanelCard();
            VisualElement row = Row();
            Label titleLabel = Heading(title, 15);
            titleLabel.style.flexGrow = 1f;
            row.Add(titleLabel);
            row.Add(Heading(value, 15));
            card.Add(row);
            card.Add(Small(detail));
            return card;
        }

        private static VisualElement PanelCard()
        {
            var card = new VisualElement();
            card.style.paddingLeft = 10f;
            card.style.paddingRight = 10f;
            card.style.paddingTop = 8f;
            card.style.paddingBottom = 8f;
            card.style.marginBottom = 7f;
            card.style.backgroundColor = new Color(0.06f, 0.085f, 0.105f, 0.94f);
            RuinCrawlerUiTheme.StyleMechanicalFrame(card);
            return card;
        }

        private static VisualElement Row()
        {
            var row = new VisualElement();
            row.style.flexDirection = FlexDirection.Row;
            row.style.alignItems = Align.Center;
            return row;
        }

        private static Label Heading(string text, int size)
        {
            var label = new Label(text);
            RuinCrawlerUiTheme.StyleHeading(label, size);
            return label;
        }

        private static Label Section(string text)
        {
            Label label = Heading(text, 17);
            label.style.marginTop = 16f;
            label.style.marginBottom = 5f;
            label.style.color = Cyan;
            return label;
        }

        private static Label Small(string text)
        {
            var label = new Label(text);
            RuinCrawlerUiTheme.StyleBodyText(label, 12);
            return label;
        }

        private Button ActionButton(string text, Action action, string controlName = null)
        {
            var button = new WorkshopActionButton(action)
            {
                text = text,
                name = controlName ?? string.Empty,
                focusable = true
            };
            button.style.height = 32f;
            button.style.marginRight = 6f;
            button.style.marginTop = 5f;
            button.style.unityFontStyleAndWeight = FontStyle.Bold;
            RuinCrawlerUiTheme.StyleMenuButton(button);
            RegisterFocusable(button);
            return button;
        }

        private static void SetBorder(VisualElement element, Color color, float width)
        {
            element.style.borderTopWidth = width;
            element.style.borderRightWidth = width;
            element.style.borderBottomWidth = width;
            element.style.borderLeftWidth = width;
            element.style.borderTopColor = color;
            element.style.borderRightColor = color;
            element.style.borderBottomColor = color;
            element.style.borderLeftColor = color;
        }

        private enum WorkshopTab
        {
            Salvage,
            Fabrication,
            Loadout,
            BusterLab,
            BossHunts
        }

        private sealed class WorkshopActionButton : Button
        {
            private readonly Action action;

            public WorkshopActionButton(Action action)
                : base(action)
            {
                this.action = action;
            }

            public void InvokeAction()
            {
                action?.Invoke();
            }
        }
    }
}
