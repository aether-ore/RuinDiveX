using System;
using System.Collections.Generic;
using System.Linq;
using RuinCrawler.Core.Dungeon.V2;
using RuinCrawler.Core.Foundation;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.BossHunts;
using RuinCrawler.Runtime.Dungeon;
using RuinCrawler.Runtime.Player;
using RuinCrawler.UI.Common;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace RuinCrawler.UI.Hud
{
    [RequireComponent(typeof(UIDocument))]
    public sealed class RuinCrawlerHudController : MonoBehaviour
    {
        private static readonly Color Cyan = new Color(0.36f, 0.95f, 1f, 1f);
        private static readonly Color Amber = new Color(1f, 0.76f, 0.2f, 1f);
        private static readonly Color Warning = new Color(1f, 0.23f, 0.18f, 1f);
        private static readonly Color Panel = new Color(0.025f, 0.045f, 0.07f, 0.9f);

        [SerializeField] private ProductionPlayerController player;
        [SerializeField] private Camera gameplayCamera;

        private UIDocument document;
        private VisualElement healthFill;
        private Label healthValue;
        private VisualElement energyFill;
        private Label energyValue;
        private Label weaponName;
        private Label weaponState;
        private Label weaponStats;
        private VisualElement targetPanel;
        private VisualElement targetFill;
        private Label targetName;
        private Label targetValue;
        private Label targetPart;
        private VisualElement bossPanel;
        private VisualElement bossFill;
        private Label bossName;
        private Label bossValue;
        private Label bossPhase;
        private VisualElement lockMarker;
        private Label lockMarkerGlyph;
        private VisualElement minimapPanel;
        private VisualElement minimapCanvas;
        private Label minimapLayer;
        private Label minimapState;
        private DungeonLayeredMinimapComponentV2 dungeonMinimap;
        private DungeonEnvironmentRuntimeV2 dungeonEnvironment;
        private float minimapSearchRemaining;
        private float damagePulseRemaining;
        private float bossSearchRemaining;
        private BossHuntRuntimeController bossEncounter;
        private bool built;

        public void Configure(ProductionPlayerController targetPlayer, Camera targetCamera)
        {
            UnbindPlayer();
            player = targetPlayer;
            gameplayCamera = targetCamera;
            BindPlayer();
        }

        private void Awake()
        {
            document = GetComponent<UIDocument>();
            if (document.panelSettings == null)
            {
                document.panelSettings = RuinCrawlerPanelSettingsFactory.Create(
                    "RuntimeHudPanelSettings");
            }

            if (gameplayCamera == null)
            {
                gameplayCamera = Camera.main;
            }
        }

        private void OnEnable()
        {
            BuildVisualTree();
            BindPlayer();
        }

        private void OnDisable()
        {
            UnbindPlayer();
            UnbindMinimap();
        }

        private void Update()
        {
            if (!built || player == null)
            {
                return;
            }

            damagePulseRemaining = Mathf.Max(0f, damagePulseRemaining - Time.deltaTime);
            UpdateMinimap();
            UpdateHealth();
            UpdateWeapon();
            UpdateTarget();
            UpdateBoss();
        }

        private void BuildVisualTree()
        {
            if (built || document == null)
            {
                return;
            }

            VisualElement root = document.rootVisualElement;
            root.Clear();
            RuinCrawlerUiTheme.StyleScreenRoot(root);
            root.pickingMode = PickingMode.Ignore;

            VisualElement playerPanel = CreatePanel(24f, 24f, 360f, 148f);
            root.Add(playerPanel);
            playerPanel.Add(CreateHeading("MEGA MAN"));
            (healthFill, healthValue) = CreateMeter(playerPanel, "HP", Cyan);

            weaponName = CreateHeading("MEGA BUSTER");
            weaponName.style.marginTop = 10f;
            playerPanel.Add(weaponName);
            (energyFill, energyValue) = CreateMeter(playerPanel, "BAT", Amber);
            weaponState = CreateSmallLabel("READY");
            playerPanel.Add(weaponState);
            weaponStats = CreateSmallLabel("PWR 00  ENG 00  RNG 00  RPD 00  MAG 00");
            playerPanel.Add(weaponStats);

            targetPanel = CreatePanel(0f, 24f, 440f, 96f);
            targetPanel.style.left = new Length(50f, LengthUnit.Percent);
            targetPanel.style.marginLeft = -220f;
            root.Add(targetPanel);
            targetName = CreateHeading("TARGET");
            targetName.style.unityTextAlign = TextAnchor.MiddleCenter;
            targetPanel.Add(targetName);
            (targetFill, targetValue) = CreateMeter(targetPanel, "HP", Amber);
            targetPart = CreateSmallLabel(string.Empty);
            targetPart.style.unityTextAlign = TextAnchor.MiddleCenter;
            targetPanel.Add(targetPart);
            targetPanel.style.display = DisplayStyle.None;

            bossPanel = CreatePanel(0f, 132f, 520f, 94f);
            bossPanel.style.left = new Length(50f, LengthUnit.Percent);
            bossPanel.style.marginLeft = -260f;
            root.Add(bossPanel);
            bossName = CreateHeading("BOSS");
            bossName.style.unityTextAlign = TextAnchor.MiddleCenter;
            bossPanel.Add(bossName);
            (bossFill, bossValue) = CreateMeter(bossPanel, "HP", Warning);
            bossPhase = CreateSmallLabel("PHASE ONE");
            bossPhase.style.unityTextAlign = TextAnchor.MiddleCenter;
            bossPanel.Add(bossPhase);
            bossPanel.style.display = DisplayStyle.None;

            lockMarker = new VisualElement();
            lockMarker.style.position = Position.Absolute;
            lockMarker.style.width = 44f;
            lockMarker.style.height = 44f;
            lockMarker.style.borderTopWidth = 2f;
            lockMarker.style.borderRightWidth = 2f;
            lockMarker.style.borderBottomWidth = 2f;
            lockMarker.style.borderLeftWidth = 2f;
            lockMarker.style.borderTopLeftRadius = 8f;
            lockMarker.style.borderTopRightRadius = 8f;
            lockMarker.style.borderBottomLeftRadius = 8f;
            lockMarker.style.borderBottomRightRadius = 8f;
            lockMarker.pickingMode = PickingMode.Ignore;
            lockMarkerGlyph = new Label("+");
            lockMarkerGlyph.style.flexGrow = 1f;
            lockMarkerGlyph.style.unityTextAlign = TextAnchor.MiddleCenter;
            lockMarkerGlyph.style.fontSize = 24f;
            lockMarker.Add(lockMarkerGlyph);
            lockMarker.style.display = DisplayStyle.None;
            root.Add(lockMarker);

            minimapPanel = CreatePanel(24f, 0f, 320f, 232f);
            minimapPanel.style.top = StyleKeyword.Auto;
            minimapPanel.style.bottom = 24f;
            root.Add(minimapPanel);
            minimapLayer = CreateHeading("RUIN MAP — ENTRY");
            minimapPanel.Add(minimapLayer);
            minimapState = CreateSmallLabel("SCANNING TOPOLOGY  •  [ , / . ] LAYER");
            minimapPanel.Add(minimapState);
            minimapCanvas = new VisualElement();
            minimapCanvas.style.position = Position.Relative;
            minimapCanvas.style.height = 168f;
            minimapCanvas.style.marginTop = 6f;
            minimapCanvas.style.backgroundColor = new Color(0.015f, 0.035f, 0.055f, 0.94f);
            minimapCanvas.style.borderTopWidth = 1f;
            minimapCanvas.style.borderRightWidth = 1f;
            minimapCanvas.style.borderBottomWidth = 1f;
            minimapCanvas.style.borderLeftWidth = 1f;
            minimapCanvas.style.borderTopColor = RuinCrawlerUiTheme.PaleCyan;
            minimapCanvas.style.borderRightColor = RuinCrawlerUiTheme.PaleCyan;
            minimapCanvas.style.borderBottomColor = RuinCrawlerUiTheme.PaleCyan;
            minimapCanvas.style.borderLeftColor = RuinCrawlerUiTheme.PaleCyan;
            minimapPanel.Add(minimapCanvas);
            minimapPanel.style.display = DisplayStyle.None;
            built = true;
        }

        private void BindPlayer()
        {
            if (player?.Vitality != null)
            {
                player.Vitality.Damaged -= HandlePlayerDamaged;
                player.Vitality.Damaged += HandlePlayerDamaged;
            }
        }

        private void UnbindPlayer()
        {
            if (player?.Vitality != null)
            {
                player.Vitality.Damaged -= HandlePlayerDamaged;
            }
        }

        private void HandlePlayerDamaged(DamageResult _)
        {
            damagePulseRemaining = 0.36f;
        }

        private void UpdateHealth()
        {
            if (player.Vitality == null)
            {
                return;
            }

            HealthSnapshot health = player.Vitality.Snapshot;
            float ratio = Mathf.Clamp01((float)health.Normalized);
            healthFill.style.width = new Length(ratio * 100f, LengthUnit.Percent);
            Color color = ratio <= 0.25f ? Warning : Cyan;
            if (damagePulseRemaining > 0f)
            {
                color = Color.Lerp(color, Color.white, Mathf.PingPong(damagePulseRemaining * 14f, 1f));
            }

            healthFill.style.backgroundColor = color;
            healthValue.text = $"{Mathf.CeilToInt((float)health.Current)} / {Mathf.CeilToInt((float)health.Maximum)}";
        }

        private void UpdateWeapon()
        {
            IPlayerWeapon weapon = player.Weapon;
            if (weapon == null)
            {
                weaponName.text = "BUSTER OFFLINE";
                energyFill.style.width = Length.Percent(0f);
                energyValue.text = "0 / 0";
                return;
            }

            WeaponTelemetrySnapshot telemetry = weapon.Telemetry;
            weaponName.text = telemetry.WeaponName.ToUpperInvariant();
            energyFill.style.width = new Length(Mathf.Clamp01((float)telemetry.NormalizedEnergy) * 100f, LengthUnit.Percent);
            energyValue.text = $"{Mathf.CeilToInt((float)telemetry.CurrentEnergy)} / {Mathf.CeilToInt((float)telemetry.MaximumEnergy)}   {telemetry.ShotsRemaining} SHOTS";
            weaponState.text = telemetry.State.ToString().ToUpperInvariant();
            energyFill.style.backgroundColor = telemetry.State == WeaponReadinessState.Ready ? Cyan : Amber;
            weaponStats.text = $"PWR {telemetry.Power:00}  ENG {telemetry.Energy:00}  RNG {telemetry.Range:00}  RPD {telemetry.Rapid:00}  MAG {telemetry.Magazine:00}";
        }

        private void UpdateTarget()
        {
            LockOnController lockOn = player.LockOn;
            CombatTargetComponent target = lockOn?.CurrentTarget;
            bool visible = target != null && target.OwnerHealth != null && !target.OwnerHealth.IsDead;
            targetPanel.style.display = visible ? DisplayStyle.Flex : DisplayStyle.None;
            lockMarker.style.display = visible ? DisplayStyle.Flex : DisplayStyle.None;
            if (!visible)
            {
                return;
            }

            HealthSnapshot health = target.OwnerHealth.Snapshot;
            targetName.text = target.DisplayName.ToUpperInvariant();
            targetPart.text = string.IsNullOrWhiteSpace(target.PartLabel) ? string.Empty : target.PartLabel.ToUpperInvariant();
            targetFill.style.width = new Length(Mathf.Clamp01((float)health.Normalized) * 100f, LengthUnit.Percent);
            targetValue.text = $"{Mathf.CeilToInt((float)health.Current)} / {Mathf.CeilToInt((float)health.Maximum)}";

            Camera activeCamera = gameplayCamera != null ? gameplayCamera : Camera.main;
            if (activeCamera == null)
            {
                lockMarker.style.display = DisplayStyle.None;
                return;
            }

            Vector3 screen = activeCamera.WorldToScreenPoint(target.AimTransform.position);
            if (screen.z <= 0f)
            {
                lockMarker.style.display = DisplayStyle.None;
                return;
            }

            lockMarker.style.left = screen.x - 22f;
            lockMarker.style.top = Screen.height - screen.y - 22f;
            Color lockColor = lockOn.IsLocked ? Cyan : Amber;
            lockMarker.style.borderTopColor = lockColor;
            lockMarker.style.borderRightColor = lockColor;
            lockMarker.style.borderBottomColor = lockColor;
            lockMarker.style.borderLeftColor = lockColor;
            lockMarkerGlyph.style.color = lockColor;
            lockMarker.style.opacity = Mathf.Lerp(0.45f, 1f, lockOn.LockProgress);
        }

        // Map binding exists only in Expedition; other scenes keep this panel hidden.
        private void UpdateMinimap()
        {
            if (dungeonMinimap == null)
            {
                minimapSearchRemaining = Mathf.Max(0f, minimapSearchRemaining - Time.unscaledDeltaTime);
                if (minimapSearchRemaining <= 0f)
                {
                    BindMinimap(FindAnyObjectByType<DungeonLayeredMinimapComponentV2>());
                    minimapSearchRemaining = 0.5f;
                }
            }

            if (dungeonMinimap == null)
            {
                if (minimapPanel != null) minimapPanel.style.display = DisplayStyle.None;
                return;
            }

            Keyboard keyboard = Keyboard.current;
            if (keyboard?.commaKey.wasPressedThisFrame == true) dungeonMinimap.CycleLayer(-1);
            if (keyboard?.periodKey.wasPressedThisFrame == true) dungeonMinimap.CycleLayer(1);
            UpdateMinimapStatus(dungeonMinimap.ViewState);
        }

        private void BindMinimap(DungeonLayeredMinimapComponentV2 minimap)
        {
            if (dungeonMinimap == minimap) return;
            UnbindMinimap();
            dungeonMinimap = minimap;
            if (dungeonMinimap == null) return;
            dungeonEnvironment = dungeonMinimap.GetComponent<DungeonEnvironmentRuntimeV2>();
            dungeonMinimap.ViewChanged += HandleMinimapChanged;
            HandleMinimapChanged(dungeonMinimap.ViewState);
        }

        private void UnbindMinimap()
        {
            if (dungeonMinimap != null)
            {
                dungeonMinimap.ViewChanged -= HandleMinimapChanged;
            }

            dungeonMinimap = null;
            dungeonEnvironment = null;
        }

        private void HandleMinimapChanged(DungeonLayeredMinimapViewStateV2 state)
        {
            if (minimapCanvas == null || state == null) return;
            minimapPanel.style.display = DisplayStyle.Flex;
            minimapCanvas.Clear();
            IReadOnlyList<DungeonLayeredMapRegionV2> regions = state.Regions;
            if (regions.Count == 0)
            {
                var unknown = CreateSmallLabel("NO SURVEYED REGIONS ON THIS STRATUM");
                unknown.style.unityTextAlign = TextAnchor.MiddleCenter;
                unknown.style.flexGrow = 1f;
                minimapCanvas.Add(unknown);
                UpdateMinimapStatus(state);
                return;
            }

            var knowledge = new Dictionary<string, DungeonMapKnowledgeLevelV2>(StringComparer.Ordinal);
            foreach (DungeonRegionKnowledgeV2 region in state.RegionKnowledge)
            {
                knowledge[region.RegionId] = region.Level;
            }

            float minimumX = regions.Min(value => value.Center.x - value.Size.x * 0.5f);
            float maximumX = regions.Max(value => value.Center.x + value.Size.x * 0.5f);
            float minimumY = regions.Min(value => value.Center.y - value.Size.y * 0.5f);
            float maximumY = regions.Max(value => value.Center.y + value.Size.y * 0.5f);
            float scale = Mathf.Min(282f / Mathf.Max(1f, maximumX - minimumX),
                132f / Mathf.Max(1f, maximumY - minimumY));

            foreach (DungeonLayeredMapBasinV2 basin in state.Basins)
            {
                var water = new VisualElement();
                water.style.position = Position.Absolute;
                water.style.left = 10f + (basin.Center.x - basin.Size.x * 0.5f - minimumX) * scale;
                water.style.top = 10f + (maximumY - (basin.Center.y + basin.Size.y * 0.5f)) * scale;
                water.style.width = Mathf.Max(10f, basin.Size.x * scale);
                water.style.height = Mathf.Max(8f, basin.Size.y * scale);
                water.style.backgroundColor = basin.IsFilled
                    ? new Color(0.08f, 0.48f, 0.92f, 0.42f)
                    : new Color(0.08f, 0.34f, 0.56f, 0.10f);
                water.style.borderTopWidth = 1f;
                water.style.borderRightWidth = 1f;
                water.style.borderBottomWidth = 1f;
                water.style.borderLeftWidth = 1f;
                Color basinBorder = basin.IsFilled
                    ? new Color(0.28f, 0.84f, 1f, 0.9f)
                    : new Color(0.24f, 0.52f, 0.66f, 0.55f);
                water.style.borderTopColor = basinBorder;
                water.style.borderRightColor = basinBorder;
                water.style.borderBottomColor = basinBorder;
                water.style.borderLeftColor = basinBorder;
                water.tooltip = basin.Id + " - "
                    + (basin.IsFilled ? "FILLED" : "DRAINED")
                    + " (" + basin.ConfigurationId + ")";
                minimapCanvas.Add(water);
            }

            foreach (DungeonLayeredMapRegionV2 region in regions)
            {
                DungeonMapKnowledgeLevelV2 level = knowledge.TryGetValue(region.Id, out DungeonMapKnowledgeLevelV2 known)
                    ? known
                    : DungeonMapKnowledgeLevelV2.Seen;
                var room = new VisualElement();
                room.style.position = Position.Absolute;
                room.style.left = 10f + (region.Center.x - region.Size.x * 0.5f - minimumX) * scale;
                room.style.top = 10f + (maximumY - (region.Center.y + region.Size.y * 0.5f)) * scale;
                room.style.width = Mathf.Max(12f, region.Size.x * scale);
                room.style.height = Mathf.Max(10f, region.Size.y * scale);
                Color color = ResolveDistrictMapColor(region.DistrictId);
                room.style.backgroundColor = new Color(color.r, color.g, color.b,
                    level == DungeonMapKnowledgeLevelV2.Seen ? 0.24f
                    : level == DungeonMapKnowledgeLevelV2.Visited ? 0.56f : 0.88f);
                room.style.borderTopWidth = level == DungeonMapKnowledgeLevelV2.Explored ? 2f : 1f;
                room.style.borderRightWidth = room.style.borderTopWidth;
                room.style.borderBottomWidth = room.style.borderTopWidth;
                room.style.borderLeftWidth = room.style.borderTopWidth;
                room.style.borderTopColor = color;
                room.style.borderRightColor = color;
                room.style.borderBottomColor = color;
                room.style.borderLeftColor = color;
                room.tooltip = region.Id + " - " + level;
                minimapCanvas.Add(room);
            }

            foreach (DungeonLayeredMapConnectionV2 connection in state.Connections)
            {
                DungeonLayeredMapRegionV2 from = regions.FirstOrDefault(value => value.Id == connection.FromRegionId);
                DungeonLayeredMapRegionV2 to = regions.FirstOrDefault(value => value.Id == connection.ToRegionId);
                if (from == null || to == null) continue;
                float x1 = 10f + (from.Center.x - minimumX) * scale;
                float y1 = 10f + (maximumY - from.Center.y) * scale;
                float x2 = 10f + (to.Center.x - minimumX) * scale;
                float y2 = 10f + (maximumY - to.Center.y) * scale;
                float length = Vector2.Distance(new Vector2(x1, y1), new Vector2(x2, y2));
                var line = new VisualElement();
                line.style.position = Position.Absolute;
                line.style.left = x1;
                line.style.top = y1;
                line.style.width = length;
                line.style.height = connection.Kind == DungeonConnectorKindV2.WaterTunnel ? 3f : 2f;
                line.style.backgroundColor = connection.Kind == DungeonConnectorKindV2.WaterTunnel
                    ? new Color(0.18f, 0.68f, 1f, 0.9f)
                    : new Color(0.55f, 0.95f, 0.86f, 0.82f);
                float angle = Mathf.Atan2(y2 - y1, x2 - x1) * Mathf.Rad2Deg;
                line.style.transformOrigin = new TransformOrigin(Length.Percent(0f), Length.Percent(50f));
                line.style.rotate = new Rotate(new Angle(angle, AngleUnit.Degree));
                minimapCanvas.Add(line);
                line.SendToBack();
            }

            foreach (DungeonLayeredMapMarkerV2 marker in state.Markers)
            {
                var icon = new Label(ResolveMapMarkerGlyph(marker.Kind));
                icon.style.position = Position.Absolute;
                icon.style.left = 6f + (marker.Position.x - minimumX) * scale;
                icon.style.top = 6f + (maximumY - marker.Position.y) * scale;
                icon.style.width = 12f;
                icon.style.height = 12f;
                icon.style.unityTextAlign = TextAnchor.MiddleCenter;
                icon.style.fontSize = 8f;
                icon.style.unityFontStyleAndWeight = FontStyle.Bold;
                icon.style.color = Color.white;
                icon.style.backgroundColor = ResolveMapMarkerColor(marker.Kind);
                icon.style.borderTopLeftRadius = 6f;
                icon.style.borderTopRightRadius = 6f;
                icon.style.borderBottomLeftRadius = 6f;
                icon.style.borderBottomRightRadius = 6f;
                icon.tooltip = marker.Kind.ToString().ToUpperInvariant() + " - " + marker.Id
                    + (string.IsNullOrWhiteSpace(marker.StateId) ? string.Empty : " [" + marker.StateId + "]");
                minimapCanvas.Add(icon);
            }

            UpdateMinimapStatus(state);
        }

        private void UpdateMinimapStatus(DungeonLayeredMinimapViewStateV2 state)
        {
            if (state == null || minimapLayer == null || minimapState == null) return;
            minimapLayer.text = "RUIN MAP - " + state.SelectedStratum.ToString().ToUpperInvariant();
            string waterState = dungeonEnvironment?.CaptureSnapshot().FluidNetworkStates
                .FirstOrDefault()?.CommittedConfigurationId;
            minimapState.text = (string.IsNullOrWhiteSpace(waterState) ? "FACTORY" : FormatWaterState(waterState))
                + "  |  " + state.KnownLandmarkIds.Count + " LANDMARKS"
                + "  |  " + state.Basins.Count(value => value.IsFilled) + "/" + state.Basins.Count + " BASINS FILLED"
                + "  |  [ , / . ] LAYER";
        }

        private static string ResolveMapMarkerGlyph(DungeonLayeredMapMarkerKindV2 kind)
        {
            return kind switch
            {
                DungeonLayeredMapMarkerKindV2.Console => "C",
                DungeonLayeredMapMarkerKindV2.Valve => "V",
                DungeonLayeredMapMarkerKindV2.Lift => "L",
                DungeonLayeredMapMarkerKindV2.Gate => "G",
                DungeonLayeredMapMarkerKindV2.Shortcut => "S",
                DungeonLayeredMapMarkerKindV2.Landmark => "!",
                _ => "?"
            };
        }

        private static Color ResolveMapMarkerColor(DungeonLayeredMapMarkerKindV2 kind)
        {
            return kind switch
            {
                DungeonLayeredMapMarkerKindV2.Valve => new Color(0.2f, 0.7f, 1f, 0.96f),
                DungeonLayeredMapMarkerKindV2.Gate => new Color(1f, 0.58f, 0.16f, 0.96f),
                DungeonLayeredMapMarkerKindV2.Shortcut => new Color(0.42f, 1f, 0.72f, 0.96f),
                DungeonLayeredMapMarkerKindV2.Landmark => new Color(0.92f, 0.42f, 1f, 0.96f),
                DungeonLayeredMapMarkerKindV2.Lift => new Color(0.78f, 0.78f, 0.9f, 0.96f),
                _ => new Color(0.18f, 0.46f, 0.62f, 0.96f)
            };
        }

        private static Color ResolveDistrictMapColor(string districtId)
        {
            if (districtId?.IndexOf("water", StringComparison.OrdinalIgnoreCase) >= 0)
                return new Color(0.18f, 0.68f, 1f, 1f);
            if (districtId?.IndexOf("hazard", StringComparison.OrdinalIgnoreCase) >= 0)
                return new Color(1f, 0.34f, 0.12f, 1f);
            return new Color(0.48f, 0.96f, 0.78f, 1f);
        }

        private static string FormatWaterState(string value)
        {
            return value switch
            {
                "FreightSumpFilled" => "FREIGHT SUMP FILLED",
                "StoredInReservoir" => "WATER STORED IN RESERVOIR",
                "GantrySumpFilled" => "GANTRY SUMP FILLED",
                _ => value.ToUpperInvariant()
            };
        }

        private void UpdateBoss()
        {
            if (bossEncounter == null)
            {
                bossSearchRemaining = Mathf.Max(0f, bossSearchRemaining - Time.unscaledDeltaTime);
                if (bossSearchRemaining <= 0f)
                {
                    bossEncounter = FindAnyObjectByType<BossHuntRuntimeController>();
                    bossSearchRemaining = 0.5f;
                }
            }

            bool visible = bossEncounter != null
                && bossEncounter.Product?.Health != null
                && bossEncounter.Phase != BossPhaseState.Cleaned;
            bossPanel.style.display = visible ? DisplayStyle.Flex : DisplayStyle.None;
            if (!visible)
            {
                return;
            }

            HealthSnapshot health = bossEncounter.Product.Health.Snapshot;
            bossName.text = (bossEncounter.Plan?.Profile?.Title ?? "BOSS").ToUpperInvariant();
            bossFill.style.width = new Length(
                Mathf.Clamp01((float)health.Normalized) * 100f,
                LengthUnit.Percent);
            bossValue.text = $"{Mathf.CeilToInt((float)health.Current)} / {Mathf.CeilToInt((float)health.Maximum)}";
            bossPhase.text = FormatBossPhase(bossEncounter.Phase);
        }

        private static string FormatBossPhase(BossPhaseState phase)
        {
            return phase switch
            {
                BossPhaseState.PhaseOne => "PHASE ONE",
                BossPhaseState.PhaseTransition => "PHASE SHIFT",
                BossPhaseState.PhaseTwo => "PHASE TWO",
                BossPhaseState.Defeated => "DEFEATED",
                BossPhaseState.Resolved => "RECOVERY SECURED",
                _ => phase.ToString().ToUpperInvariant()
            };
        }

        private static VisualElement CreatePanel(float left, float top, float width, float height)
        {
            var panel = new VisualElement();
            panel.style.position = Position.Absolute;
            panel.style.left = left;
            panel.style.top = top;
            panel.style.width = width;
            panel.style.minHeight = height;
            panel.style.paddingLeft = 12f;
            panel.style.paddingRight = 12f;
            panel.style.paddingTop = 8f;
            panel.style.paddingBottom = 8f;
            panel.style.backgroundColor = Panel;
            RuinCrawlerUiTheme.StyleMechanicalFrame(panel);
            RuinCrawlerUiTheme.AddMechanicalSurface(panel, false, 0.055f);
            panel.pickingMode = PickingMode.Ignore;
            return panel;
        }

        private static Label CreateHeading(string text)
        {
            var label = new Label(text);
            RuinCrawlerUiTheme.StyleHeading(label, 16);
            return label;
        }

        private static Label CreateSmallLabel(string text)
        {
            var label = new Label(text);
            RuinCrawlerUiTheme.StyleBodyText(label, 11);
            label.style.marginTop = 2f;
            return label;
        }

        private static (VisualElement Fill, Label Value) CreateMeter(VisualElement parent, string caption, Color color)
        {
            var row = new VisualElement();
            row.style.flexDirection = FlexDirection.Row;
            row.style.alignItems = Align.Center;
            row.style.height = 24f;
            parent.Add(row);

            var name = new Label(caption);
            name.style.width = 34f;
            name.style.color = Color.white;
            name.style.unityFontStyleAndWeight = FontStyle.Bold;
            row.Add(name);

            var track = new VisualElement();
            track.style.flexGrow = 1f;
            track.style.height = 12f;
            track.style.backgroundColor = new Color(0.06f, 0.09f, 0.12f, 1f);
            track.style.borderTopWidth = 1f;
            track.style.borderRightWidth = 1f;
            track.style.borderBottomWidth = 1f;
            track.style.borderLeftWidth = 1f;
            track.style.borderTopColor = RuinCrawlerUiTheme.PaleCyan;
            track.style.borderRightColor = RuinCrawlerUiTheme.PaleCyan;
            track.style.borderBottomColor = RuinCrawlerUiTheme.PaleCyan;
            track.style.borderLeftColor = RuinCrawlerUiTheme.PaleCyan;
            row.Add(track);

            var fill = new VisualElement();
            fill.style.height = Length.Percent(100f);
            fill.style.width = Length.Percent(100f);
            fill.style.backgroundColor = color;
            track.Add(fill);

            var value = new Label("0 / 0");
            value.style.width = 124f;
            value.style.marginLeft = 8f;
            value.style.color = Color.white;
            value.style.unityTextAlign = TextAnchor.MiddleRight;
            row.Add(value);
            return (fill, value);
        }
    }
}
