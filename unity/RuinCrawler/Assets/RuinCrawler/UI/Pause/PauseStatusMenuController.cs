using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using RuinCrawler.Core.Campaign;
using RuinCrawler.Runtime.Persistence;
using RuinCrawler.Runtime.Player;
using RuinCrawler.UI.Common;
using RuinCrawler.UI.Workshop;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RuinCrawler.UI.Pause
{
    /// <summary>
    /// Production pause/status screen inspired by the supplied MML2 HD mockup.
    /// It owns no campaign state: readouts are projections of the persistent
    /// session and player health, and opening it only suppresses transient input.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class PauseStatusMenuController : MonoBehaviour
    {
        private static readonly string[] SectionMessages =
        {
            "Review the active expedition route, location, and deterministic run seed.",
            "Review recovered scrap, named components, and unidentified field recoveries.",
            "Review Mega Man's equipped arms and fixed-function Gear assignments.",
            "Review controls and presentation settings. Persistent options will be added through versioned settings data.",
            "Return to the game."
        };

        [SerializeField] private InputActionAsset inputActions;
        [SerializeField] private ProductionPlayerController player;
        [SerializeField] private CampaignSession campaignSession;
        [SerializeField] private bool freezeWorld = true;
        [SerializeField] private bool openOnStart;

        private UIDocument document;
        private PanelSettings ownedPanelSettings;
        private VisualElement rootOverlay;
        private VisualElement sectionContent;
        private VisualElement healthFill;
        private Label locationLabel;
        private Label scrapLabel;
        private Label timeLabel;
        private Label healthLabel;
        private Label loadoutLabel;
        private Label messageLabel;
        private InputAction pauseAction;
        private readonly List<Button> navigationButtons = new List<Button>();
        private PauseSection selectedSection;
        private bool built;
        private bool hasStoredTimeScale;
        private float storedTimeScale = 1f;
        private float sessionStartRealtime;
        private float nextRefreshAt;
        private int suppressInputThroughFrame;

        public bool IsOpen { get; private set; }
        public string SelectedSectionId => selectedSection.ToString();
        public VisualElement VisualRoot => document?.rootVisualElement;

        public void Configure(
            InputActionAsset actions,
            ProductionPlayerController targetPlayer,
            CampaignSession session = null)
        {
            UnbindInput();
            inputActions = actions;
            player = targetPlayer;
            campaignSession = session;
            BindInput();
            RefreshStatus();
        }

        public void Toggle()
        {
            SetOpen(!IsOpen);
        }

        public void SetOpen(bool value)
        {
            if (!built)
            {
                Build();
            }

            if (IsOpen == value)
            {
                if (rootOverlay != null)
                {
                    rootOverlay.style.display = value ? DisplayStyle.Flex : DisplayStyle.None;
                }
                return;
            }

            IsOpen = value;
            rootOverlay.style.display = value ? DisplayStyle.Flex : DisplayStyle.None;
            suppressInputThroughFrame = Time.frameCount + 1;
            if (value)
            {
                campaignSession ??= CampaignSession.Instance;
                player?.SetGameplayEnabled(false);
                // ProductionPlayerController disables the Gameplay map as a unit.
                // Re-enable only Pause so the same key/button can close this screen.
                pauseAction?.Enable();
                if (freezeWorld)
                {
                    storedTimeScale = Time.timeScale;
                    hasStoredTimeScale = true;
                    Time.timeScale = 0f;
                }
                RefreshStatus();
                FocusSelectedButton();
            }
            else
            {
                if (hasStoredTimeScale)
                {
                    Time.timeScale = storedTimeScale;
                    hasStoredTimeScale = false;
                }
                player?.SetGameplayEnabled(true);
            }
        }

        public void SelectSection(string sectionId)
        {
            if (Enum.TryParse(sectionId, true, out PauseSection section))
            {
                SelectSection(section);
            }
        }

        private void Awake()
        {
            document = GetComponent<UIDocument>();
            if (document.panelSettings == null)
            {
                ownedPanelSettings = RuinCrawlerPanelSettingsFactory.Create("RuntimePausePanelSettings");
                document.panelSettings = ownedPanelSettings;
            }

            // UIDocument sorting only orders documents inside one panel. The HUD
            // owns a separate runtime PanelSettings instance, so elevate both.
            document.sortingOrder = 1000;
            document.panelSettings.sortingOrder = 1000;

            campaignSession ??= CampaignSession.Instance;
            sessionStartRealtime = Time.realtimeSinceStartup;
            Build();
        }

        private void Start()
        {
            BindInput();
            SetOpen(openOnStart);
        }

        private void OnEnable()
        {
            BindInput();
        }

        private void OnDisable()
        {
            UnbindInput();
            RestoreGameplayState();
        }

        private void OnDestroy()
        {
            UnbindInput();
            RestoreGameplayState();
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

            if (Time.unscaledTime >= nextRefreshAt)
            {
                RefreshStatus();
                nextRefreshAt = Time.unscaledTime + 0.25f;
            }

            if (Time.frameCount <= suppressInputThroughFrame)
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
                SetOpen(false);
            }
            else if (gamepad.dpad.up.wasPressedThisFrame)
            {
                MoveSelection(-1);
            }
            else if (gamepad.dpad.down.wasPressedThisFrame)
            {
                MoveSelection(1);
            }
            else if (gamepad.buttonSouth.wasPressedThisFrame)
            {
                ActivateSelected();
            }
        }

        private void BindInput()
        {
            if (!isActiveAndEnabled || inputActions == null || pauseAction != null)
            {
                return;
            }

            pauseAction = inputActions.FindAction("Gameplay/Pause", false);
            if (pauseAction != null)
            {
                pauseAction.performed += HandlePausePerformed;
                pauseAction.Enable();
            }
        }

        private void UnbindInput()
        {
            if (pauseAction != null)
            {
                pauseAction.performed -= HandlePausePerformed;
                pauseAction = null;
            }
        }

        private void HandlePausePerformed(InputAction.CallbackContext _)
        {
            if (Time.frameCount <= suppressInputThroughFrame)
            {
                return;
            }

            RollWorkshopController workshop = FindAnyObjectByType<RollWorkshopController>();
            if (!IsOpen && workshop != null && workshop.IsOpen)
            {
                return;
            }

            Toggle();
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
            root.pickingMode = PickingMode.Ignore;

            rootOverlay = new VisualElement
            {
                name = "pause-status-root",
                pickingMode = PickingMode.Position
            };
            rootOverlay.style.position = Position.Absolute;
            rootOverlay.style.left = 0f;
            rootOverlay.style.right = 0f;
            rootOverlay.style.top = 0f;
            rootOverlay.style.bottom = 0f;
            rootOverlay.style.alignItems = Align.Center;
            rootOverlay.style.justifyContent = Justify.Center;
            rootOverlay.style.backgroundColor = new Color(0.015f, 0.03f, 0.055f, 0.9f);
            root.Add(rootOverlay);

            var shell = new VisualElement { name = "pause-status-shell" };
            shell.style.width = Length.Percent(88f);
            shell.style.height = Length.Percent(90f);
            shell.style.maxWidth = 1480f;
            shell.style.paddingLeft = 28f;
            shell.style.paddingRight = 28f;
            shell.style.paddingTop = 18f;
            shell.style.paddingBottom = 18f;
            shell.style.backgroundColor = (Color)new Color32(238, 247, 244, 255);
            RuinCrawlerUiTheme.StyleMechanicalFrame(shell, true);
            RuinCrawlerUiTheme.AddMechanicalSurface(shell, false, 0.09f);
            RuinCrawlerUiTheme.AddCornerRivets(shell);
            rootOverlay.Add(shell);

            var title = new Label("STATUS") { name = "pause-title" };
            RuinCrawlerUiTheme.StyleHeading(title, 36, true);
            title.style.color = RuinCrawlerUiTheme.PaleCyan;
            title.style.height = 52f;
            shell.Add(title);

            locationLabel = new Label("LOCATION") { name = "pause-location" };
            RuinCrawlerUiTheme.StyleHeading(locationLabel, 19, true);
            locationLabel.style.color = RuinCrawlerUiTheme.PaleCyan;
            shell.Add(locationLabel);

            var main = new VisualElement { name = "pause-main-row" };
            main.style.flexGrow = 1f;
            main.style.flexDirection = FlexDirection.Row;
            main.style.marginTop = 10f;
            main.style.marginBottom = 12f;
            shell.Add(main);

            main.Add(BuildNavigation());
            main.Add(BuildStatusColumn());
            main.Add(BuildLoadoutPanel());

            var message = new VisualElement { name = "pause-message-box" };
            message.style.height = 132f;
            message.style.paddingLeft = 32f;
            message.style.paddingRight = 32f;
            message.style.paddingTop = 22f;
            message.style.paddingBottom = 18f;
            RuinCrawlerUiTheme.StyleDialogueBox(message);
            messageLabel = new Label(SectionMessages[0]) { name = "pause-message-text" };
            RuinCrawlerUiTheme.StyleBodyText(messageLabel, 18);
            messageLabel.style.color = Color.white;
            message.Add(messageLabel);
            shell.Add(message);

            var hints = new Label("[ENTER / A] CONFIRM        [ESC / B] CANCEL")
            {
                name = "pause-control-hints"
            };
            RuinCrawlerUiTheme.StyleHeading(hints, 15, true);
            hints.style.color = RuinCrawlerUiTheme.MutedText;
            hints.style.height = 30f;
            shell.Add(hints);

            rootOverlay.RegisterCallback<KeyDownEvent>(HandleKeyDown, TrickleDown.TrickleDown);
            selectedSection = PauseSection.Map;
            RefreshNavigationStyle();
            rootOverlay.style.display = DisplayStyle.None;
            built = true;
        }

        private VisualElement BuildNavigation()
        {
            var frame = new VisualElement { name = "pause-navigation" };
            frame.style.width = 242f;
            frame.style.marginRight = 18f;
            frame.style.paddingLeft = 16f;
            frame.style.paddingRight = 16f;
            frame.style.paddingTop = 20f;
            frame.style.paddingBottom = 20f;
            RuinCrawlerUiTheme.StyleMechanicalFrame(frame, true);
            RuinCrawlerUiTheme.AddMechanicalSurface(frame, true, 0.17f);

            AddNavigationButton(frame, "MAP", PauseSection.Map);
            AddNavigationButton(frame, "ITEMS", PauseSection.Items);
            AddNavigationButton(frame, "EQUIPMENT", PauseSection.Equipment);
            AddNavigationButton(frame, "OPTIONS", PauseSection.Options);
            var spacer = new VisualElement();
            spacer.style.flexGrow = 1f;
            frame.Add(spacer);
            AddNavigationButton(frame, "BACK", PauseSection.Back);
            return frame;
        }

        private VisualElement BuildStatusColumn()
        {
            var column = new VisualElement { name = "pause-status-column" };
            column.style.flexGrow = 1f;
            column.style.marginRight = 18f;

            var readouts = new VisualElement { name = "pause-readouts" };
            readouts.style.flexDirection = FlexDirection.Row;
            readouts.style.height = 92f;
            column.Add(readouts);
            scrapLabel = CreateReadout("RECOVERY SCRAP", "00000000", "pause-readout-scrap");
            timeLabel = CreateReadout("SESSION TIME", "0:00:00", "pause-readout-time");
            readouts.Add(scrapLabel);
            readouts.Add(timeLabel);

            sectionContent = new VisualElement { name = "pause-section-content" };
            sectionContent.style.flexGrow = 1f;
            sectionContent.style.marginTop = 14f;
            sectionContent.style.paddingLeft = 20f;
            sectionContent.style.paddingRight = 20f;
            sectionContent.style.paddingTop = 18f;
            sectionContent.style.paddingBottom = 18f;
            RuinCrawlerUiTheme.StyleMechanicalFrame(sectionContent);
            column.Add(sectionContent);
            return column;
        }

        private VisualElement BuildLoadoutPanel()
        {
            var frame = new VisualElement { name = "pause-loadout" };
            frame.style.width = 278f;
            frame.style.paddingLeft = 18f;
            frame.style.paddingRight = 18f;
            frame.style.paddingTop = 20f;
            frame.style.paddingBottom = 20f;
            RuinCrawlerUiTheme.StyleMechanicalFrame(frame, true);

            var heading = new Label("LOADOUT");
            RuinCrawlerUiTheme.StyleHeading(heading, 20, true);
            heading.style.color = RuinCrawlerUiTheme.PaleCyan;
            frame.Add(heading);

            var healthHeading = new Label("LIFE ENERGY");
            RuinCrawlerUiTheme.StyleHeading(healthHeading, 13);
            healthHeading.style.marginTop = 20f;
            frame.Add(healthHeading);

            var healthTrack = new VisualElement();
            healthTrack.style.height = 22f;
            healthTrack.style.marginTop = 7f;
            healthTrack.style.backgroundColor = (Color)new Color32(42, 56, 86, 255);
            RuinCrawlerUiTheme.SetBorder(healthTrack, RuinCrawlerUiTheme.PaleCyan, 2f);
            frame.Add(healthTrack);
            healthFill = new VisualElement { name = "pause-health-fill" };
            healthFill.style.height = Length.Percent(100f);
            healthFill.style.width = Length.Percent(100f);
            healthFill.style.backgroundColor = RuinCrawlerUiTheme.Mint;
            healthTrack.Add(healthFill);

            healthLabel = new Label("160 / 160") { name = "pause-health-value" };
            RuinCrawlerUiTheme.StyleBodyText(healthLabel, 13);
            healthLabel.style.unityTextAlign = TextAnchor.MiddleRight;
            frame.Add(healthLabel);

            loadoutLabel = new Label("MEGA BUSTER\nARMOR / REINFORCED FRAME")
            {
                name = "pause-loadout-text"
            };
            RuinCrawlerUiTheme.StyleBodyText(loadoutLabel, 14);
            loadoutLabel.style.marginTop = 26f;
            loadoutLabel.style.color = Color.white;
            frame.Add(loadoutLabel);
            return frame;
        }

        private void AddNavigationButton(VisualElement parent, string text, PauseSection section)
        {
            var button = new Button(() =>
            {
                SelectSection(section);
                if (section == PauseSection.Back)
                {
                    SetOpen(false);
                }
            })
            {
                text = text,
                name = "pause-nav-" + section.ToString().ToLowerInvariant(),
                focusable = true
            };
            button.userData = section;
            parent.Add(button);
            navigationButtons.Add(button);
        }

        private Label CreateReadout(string heading, string value, string name)
        {
            var label = new Label(heading + "\n" + value) { name = name };
            label.style.flexGrow = 1f;
            label.style.marginRight = 8f;
            label.style.paddingLeft = 14f;
            label.style.paddingRight = 14f;
            label.style.paddingTop = 8f;
            label.style.paddingBottom = 8f;
            label.style.unityTextAlign = TextAnchor.MiddleCenter;
            label.style.fontSize = 19f;
            label.style.unityFontStyleAndWeight = FontStyle.Bold;
            label.style.color = Color.white;
            RuinCrawlerUiTheme.StyleMechanicalFrame(label);
            return label;
        }

        private void SelectSection(PauseSection section)
        {
            selectedSection = section;
            RefreshNavigationStyle();
            RefreshStatus();
        }

        private void MoveSelection(int direction)
        {
            int count = navigationButtons.Count;
            int index = Mathf.Clamp((int)selectedSection, 0, count - 1);
            index = (index + Math.Sign(direction) + count) % count;
            SelectSection((PauseSection)index);
            FocusSelectedButton();
        }

        private void ActivateSelected()
        {
            if (selectedSection == PauseSection.Back)
            {
                SetOpen(false);
            }
        }

        private void FocusSelectedButton()
        {
            int index = Mathf.Clamp((int)selectedSection, 0, navigationButtons.Count - 1);
            if (navigationButtons.Count == 0) return;
            rootOverlay.schedule.Execute(() => navigationButtons[index].Focus()).ExecuteLater(1L);
        }

        private void RefreshNavigationStyle()
        {
            for (int index = 0; index < navigationButtons.Count; index += 1)
            {
                RuinCrawlerUiTheme.StyleMenuButton(
                    navigationButtons[index],
                    index == (int)selectedSection);
            }

            if (messageLabel != null)
            {
                messageLabel.text = SectionMessages[Mathf.Clamp((int)selectedSection, 0, SectionMessages.Length - 1)];
            }
        }

        private void RefreshStatus()
        {
            if (!built)
            {
                return;
            }

            string location = SceneManager.GetActiveScene().name;
            locationLabel.text = string.IsNullOrWhiteSpace(location) ? "UNKNOWN LOCATION" : location.ToUpperInvariant();
            TimeSpan elapsed = TimeSpan.FromSeconds(Mathf.Max(0f, Time.realtimeSinceStartup - sessionStartRealtime));
            timeLabel.text = $"SESSION TIME\n{(int)elapsed.TotalHours}:{elapsed.Minutes:00}:{elapsed.Seconds:00}";

            CampaignStateV1 state = campaignSession != null ? campaignSession.Snapshot : null;
            int scrap = state?.salvage?.identifiedScrap ?? 0;
            scrapLabel.text = $"RECOVERY SCRAP\n{scrap:00000000}";
            RefreshHealth();
            RefreshLoadout(state);
            RefreshSectionContent(state);
        }

        private void RefreshHealth()
        {
            if (player?.Vitality == null)
            {
                healthFill.style.width = Length.Percent(0f);
                healthLabel.text = "OFFLINE";
                return;
            }

            var health = player.Vitality.Snapshot;
            healthFill.style.width = Length.Percent(Mathf.Clamp01((float)health.Normalized) * 100f);
            healthLabel.text = $"{Mathf.CeilToInt((float)health.Current)} / {Mathf.CeilToInt((float)health.Maximum)}";
        }

        private void RefreshLoadout(CampaignStateV1 state)
        {
            if (state == null)
            {
                loadoutLabel.text = "CAMPAIGN DATA OFFLINE";
                return;
            }

            IEnumerable<string> arms = state.armAssignments
                .Where(value => value != null && !string.IsNullOrWhiteSpace(value.itemId))
                .Select(value => HumanizeStableId(value.slotId) + " / " + HumanizeStableId(value.itemId));
            IEnumerable<string> gear = state.gearAssignments
                .Where(value => value != null && !string.IsNullOrWhiteSpace(value.itemId))
                .Select(value => HumanizeStableId(value.slotId) + " / " + HumanizeStableId(value.itemId));
            string text = string.Join("\n", arms.Concat(gear));
            loadoutLabel.text = string.IsNullOrWhiteSpace(text) ? "NO EQUIPMENT ASSIGNED" : text;
        }

        private void RefreshSectionContent(CampaignStateV1 state)
        {
            sectionContent.Clear();
            var heading = new Label(selectedSection.ToString().ToUpperInvariant());
            RuinCrawlerUiTheme.StyleHeading(heading, 23);
            heading.style.color = RuinCrawlerUiTheme.PaleCyan;
            sectionContent.Add(heading);

            string detail;
            switch (selectedSection)
            {
                case PauseSection.Map:
                    detail = state?.expedition != null && !string.IsNullOrWhiteSpace(state.expedition.runSeed)
                        ? $"EXPEDITION {state.expedition.expeditionId}\nRUN SEED {state.expedition.runSeed}\nDUNGEON {state.expedition.dungeonProfileId}"
                        : "NO ACTIVE EXPEDITION\nDungeon routes are generated deterministically when you depart with Roll.";
                    break;
                case PauseSection.Items:
                    int recoveries = state?.unidentifiedRecoveries?.Sum(value => Mathf.Max(0, value?.quantity ?? 0)) ?? 0;
                    int parts = state?.salvage?.parts?.Sum(value => Mathf.Max(0, value?.quantity ?? 0)) ?? 0;
                    int identifiedScrap = state?.salvage?.identifiedScrap ?? 0;
                    detail = $"UNIDENTIFIED RECOVERIES  {recoveries:000}\nNAMED PARTS  {parts:000}\nIDENTIFIED SCRAP  {identifiedScrap:00000000}";
                    break;
                case PauseSection.Equipment:
                    detail = loadoutLabel.text;
                    break;
                case PauseSection.Options:
                    detail = "KEYBOARD / MOUSE AND GAMEPAD ENABLED\nESC / START  PAUSE\nENTER / A  CONFIRM\nESC / B  CANCEL\n\nGameplay settings remain source state and will not be mixed into campaign saves.";
                    break;
                default:
                    detail = "Resume the current scene with gameplay input restored.";
                    break;
            }

            var body = new Label(detail) { name = "pause-section-detail" };
            RuinCrawlerUiTheme.StyleBodyText(body, 16);
            body.style.marginTop = 16f;
            sectionContent.Add(body);
        }

        private void HandleKeyDown(KeyDownEvent evt)
        {
            // The same Escape press that opens the menu can also be dispatched
            // as a UI Toolkit key event later in the input update. Ignore that
            // opening frame so the screen cannot immediately close itself.
            if (Time.frameCount <= suppressInputThroughFrame)
            {
                return;
            }

            bool handled = true;
            switch (evt.keyCode)
            {
                case KeyCode.Escape:
                    SetOpen(false);
                    break;
                case KeyCode.UpArrow:
                    MoveSelection(-1);
                    break;
                case KeyCode.DownArrow:
                    MoveSelection(1);
                    break;
                case KeyCode.Return:
                case KeyCode.KeypadEnter:
                case KeyCode.Space:
                    ActivateSelected();
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

        private static string HumanizeStableId(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "UNASSIGNED";
            }

            var result = new StringBuilder(value.Length + 8);
            char previous = '\0';
            foreach (char current in value.Trim())
            {
                if (current == '-' || current == '_' || current == '.' || char.IsWhiteSpace(current))
                {
                    if (result.Length > 0 && result[result.Length - 1] != ' ')
                    {
                        result.Append(' ');
                    }
                    previous = '\0';
                    continue;
                }

                bool camelBoundary = previous != '\0'
                    && char.IsUpper(current)
                    && (char.IsLower(previous) || char.IsDigit(previous));
                bool numberBoundary = previous != '\0'
                    && char.IsDigit(current)
                    && char.IsLetter(previous);
                if ((camelBoundary || numberBoundary)
                    && result.Length > 0
                    && result[result.Length - 1] != ' ')
                {
                    result.Append(' ');
                }

                result.Append(char.ToUpperInvariant(current));
                previous = current;
            }

            return result.ToString().Trim();
        }

        private void RestoreGameplayState()
        {
            if (hasStoredTimeScale)
            {
                Time.timeScale = storedTimeScale;
                hasStoredTimeScale = false;
            }
            if (IsOpen)
            {
                IsOpen = false;
                player?.SetGameplayEnabled(true);
            }
        }

        private enum PauseSection
        {
            Map,
            Items,
            Equipment,
            Options,
            Back
        }
    }
}
