# Unity Port and Unity MCP Setup

Status: **production gameplay systems implemented; parity, presentation, and release integration in progress**

Last verified: **2026-07-17**

The browser game remains the behavioral and data source of truth. The Unity
project is a parallel port at `unity/RuinCrawler`; it is playable as a
development build, but it is not yet a distribution-ready replacement for the
Three.js build.

## Current checkpoint

The Unity project now has five enabled scenes in stable build order:

| Scene | Responsibility |
| --- | --- |
| `Boot` | Creates the persistent campaign, contract-catalog, and expedition-flow services, then routes to Camp. |
| `Camp` | Player, Roll, her eight workshop animations, the themed UI Toolkit workshop, workbench, Support Car, HUD, pause-status menu, and safe-area expedition flow. |
| `Expedition` | Sole `DungeonPlanV2` environmental-district construction through `DungeonSceneBuilderV2`, procedural Reaverbot encounters, durable discoveries, Large Refractor/extraction flow, selected Boss Hunts, player, camera, layered minimap/HUD, and pause-status menu. |
| `TestRange` | Three fixed Sharukurusu diagnostics using the production player, compiled weapon, lock-on, damage, HUD, and pause-status paths without expedition rewards. |
| `PortingSandbox` | Disposable asset/animation regression scene retained for rebuilding and visual checks; it is not the production composition root. |

The current production checkpoint includes:

- pure `RuinCrawler.Core` assemblies for coordinate conversion, health and
  damage, targeting, Custom Buster compilation/runtime, Reaverbot generation,
  dungeon plans, campaign state, and Roll transactions;
- scene-bound runtime assemblies for player control, the custom follow camera,
  typed combat, pooled projectiles, procedural Reaverbots, generated dungeons,
  Unity-only persistence, Roll, expeditions, and Boss Hunts;
- themed UI Toolkit HUD, workshop, and pause/status presenters; the prototype
  `OnGUI` panel is not used by the production scenes;
- the Unity Input System with separate `Gameplay` and `UI` maps and
  keyboard/mouse plus gamepad bindings;
- explicit Player, Enemy, PlayerProjectile, EnemyProjectile, Targetable,
  Hazard, Pickup, Interactable, and WorldGeometry layers with an asymmetric
  projectile collision matrix;
- a versioned, array-based JSON contract pack exported from the live
  JavaScript catalogs at
  `assets/contracts/ruin-crawler-contracts.v1.json`;
- a centralized handedness boundary:
  `Unity = (-ThreeX, ThreeY, ThreeZ)` and `unityYaw = -threeYaw`.

### Combat and HUD

Production combat uses `DamagePacket`, `DamageResult`, `HealthState`,
stable target/owner IDs, and one central `CombatWorld`. The source armor
formula is preserved:

```text
resolved damage = damage * 100 / (100 + effectiveArmor)
```

The player has an authoritative maximum of 160 HP. The HUD displays current and
maximum health, the low-health warning, damage pulse, lock acquisition/locked
marker, owner health panel, weak-point label, compiled Buster energy, remaining
shots, and `READY`, `CYCLE`, `ENERGY`, or `RECOVERY` state. Selected
Boss Hunts add boss name, health, phase, defeat, and reward-resolution state.

Lock-on is sticky rather than rescored every frame. Acquisition is range
limited, but a completed lock survives range excursions, dodge, recovery, and
compiled-plan replacement. Covered weak points retain the lock, broken or
invalid weak points transfer to their owner body, and death, disposal, explicit
release, or an invalid fallback clears it. Unlocked locomotion uses the source
tank-control contract: `W`/`S` (or vertical left stick) move only along body
facing, while `A`/`D` (or horizontal left stick) turn the body at 2.7 radians
per second without producing lateral movement. The camera continuously settles
behind MegaMan's back; entering manual aim accelerates that settle for the
source-parity 0.42-second window instead of reopening horizontal free orbit.
Vertical look remains available for elevation aiming, and center-screen aim
ignores the player's own colliders. An established movement lock deliberately
retains the source target-facing strafe contract.

Aiming, firing, lock-on, and dodge feed the existing combat-animation hook.
MegaMan remains in Action Idle while combat-ready and returns to the
foot-planted Breathing Idle only after 20 seconds without combat activity. The
authored left Mega Buster replaces the left hand while equipped, queues the
captured projectile direction and applies one non-accumulating pose solve
after animation. The shoulder-to-forearm line is straight along that gameplay
vector, then the imported Buster barrel is corrected independently so the arm,
muzzle, and projectile remain collinear for forward and elevated lock targets.
Damage and
enemy-awareness producers still need to call the same public activity hook.

`SourceGameplayContract.cs` keeps the first player-facing parity values in
one place:

| Contract | Value |
| --- | ---: |
| Player height / radius | `2.85` / `0.42` |
| Walk / jog / sprint speed | `6.2` / `10.416` / `13.95` |
| Tank turn rate | `2.7` radians per second |
| Jump height / time to apex / fall multiplier | `1.65` / `0.33` / `1.22` |
| Combat-ready idle hold | `20` seconds |
| Camera FOV / near / far | `48` / `0.1` / `120` |
| Camera distance / height / look height / look-ahead | `6.8` / `3.25` / `1.35` / `1.7` |
| Mega Buster damage / range / speed / radius | `8` / `6.9` / `9.5` / `0.17` |
| Mega Buster cadence / aim lock | `4.2` shots per second / `0.44` seconds |
| Sharukurusu height / radius / health | `2.42` / `0.78` / `68` |

### Custom Buster

`RuinCrawler.Core.Buster` ports schema 1 and ruleset
`custom-buster-v0.2`, including:

- immutable build normalization, graph/ownership/compatibility validation,
  structured errors, ratings, ledgers, descriptions, and preview data;
- Mega Buster compilation through the same plan boundary;
- independent weapon batteries, inactive half-rate recharge, the 0.65-second
  recharge gate, 1.8-second full recharge, recovery lock, and atomic
  24-projectile reservation cap;
- deterministic trajectory, guidance, ballistic, trigger, impact, delay,
  splitter, cluster, explosion, stagger, collision, and chronological event
  kernels in double precision;
- immutable projectile events carrying build ID, weapon key, revision,
  execution ID, and reservation token;
- packet conservation and 30/60/120 Hz plus large-step parity coverage.

The production Mega Buster is a real compiled plan and its runtime battery is
the HUD's only energy source. `MegaBusterWeaponController.EquipPlan` accepts a
materialized compiled Custom Buster plan, reserves pooled projectiles
atomically, retains the captured build revision, and routes impacts through the
central damage service.

The remaining scene-adapter gap is listed below: the pure chronological kernel
supports the complete module vocabulary, while the current visible projectile
adapter presents the root/child packet and split direction but does not yet
instantiate every delayed, apex, ballistic, guidance, cluster, and explosion
event as its own pooled Unity presentation.

### Procedural Reaverbots

The schema-3 catalogs, eight-candidate deterministic generator, compatibility
validator, encounter-slot seed derivation, and salvage-profile derivation are
ported to pure C#. Equal inputs reproduce the same genome and stable identity,
and invalid/unknown catalog references fail visibly.

The runtime adapter builds every current body plan from low-poly semantic
parts, including stable body, eye, weapon, defense, muzzle, and weak-point
anchors. It creates colliders and target ownership, exposes weak points during
authored windows, uses the shared player/enemy projectile and damage paths,
executes melee or ranged attacks, emits one unidentified recovery on typed
death, and pools complete hierarchies and materials. A recovery pickup remains
live until the campaign transaction accepts the durable reward.

This is a functional shared Reaverbot runtime, not yet a one-for-one port of
every elaborate Three.js archetype move set. Per-archetype locomotion,
multi-stage attacks, breakable-defense consequences, special aerial/tractor
reasoning, and final semantic texture treatment remain presentation/runtime
parity work.

### Procedural dungeons

`industrial-factory-v2` is the only Unity dungeon profile and is immediately
available from the Camp departure interaction. There is no profile selector,
fallback generator, feature flag, or staged-access gate. The Expedition scene
contains only `DungeonSceneBuilderV2`, which consumes a pure, immutable,
deterministic plan with exactly seven macro roles, 12-18 playable regions, and
exactly three
districts: Factory, cross-room Waterworks, and either Magma Processing or
Electrical Distribution. Its `VoidPolicyV2` is `Prohibited`; the technical
fallback plane is diagnostic recovery outside accepted fall envelopes, not an
authored traversal destination.

V2 adds stable records for modules, regions, districts, typed predicates,
routes and authorized exits, discoveries, shortcuts, surfaces, fluid zones
and networks, environment controllers, catchments, and conservative fall
exposures. The pure solver enumerates stable route-affecting state, checks
key-before-gate authorization, models final-guardian defeat, Large Refractor
security, and extraction readiness as separate transitions, and rejects
protected-boundary bypasses discovered from certified geometry. Static fall
checks construct the complete swept terminal footprint, erode both the
catchment and safe landing geometry by the player capsule plus landing margin,
subtract the exact union of valid surfaces, and reject any uncovered polygon.
The registered reaction envelope, water cushioning depth, moving-platform
sweeps, crumble states, and structural-bottom clearance are part of the same
proof.

Thirty generated Unity module prefabs cover A/B spatial variants for all
Factory, Waterworks, Magma, Electrical, and optional-pocket templates. Each
prefab has a Core-readable certified geometry asset and SHA-256 content hash.
Placed module records are translated directly from those baked prisms,
connectors, and anchors and retain explicit `CertifiedModule` provenance;
gameplay-only additions are labeled separately. The registry, placement
validator, and build gate reject missing, shifted, removed, unknown, stale, or
mismatched module records before V2 assembly. The runtime extrudes the accepted
plan's certified convex surfaces so collision and authoritative traversal
geometry share the same plan-level source.

This placement contract is version `2` in content pack
`industrial-factory-v2-contracts-v3-certified-placement`; older generated
registries intentionally fail freshness/identity checks rather than being
silently reused.

The player uses the shared double-precision V2 ballistic kernel. It integrates
exact kinematics, splits at the apex, and captures the flooded profile at
takeoff. Dry and flooded derived values, water-entry cushioning, horizontal
caps, no-airborne-dodge rule, and large-step/substep behavior are covered by
focused tests.

Waterworks starts `FreightSumpFilled`. A one-time valve operation unlocks the
dry routing console, whose 2.5-second transfers preserve the old state and a
named player-control lock until an atomic commit; cancellation restores the
old state. Ordinary console interaction follows the explicit critical-first
cycle `FreightSumpFilled -> StoredInReservoir -> GantrySumpFilled ->
FreightSumpFilled`, while the runtime also exposes exact target-state selection
for a future UI Toolkit presenter. `StoredInReservoir` therefore opens the dry
service route on the first deliberate transfer; optional `GantrySumpFilled`
then enables the upper-flank route, cache, and shortcut. Magma
uses seam-stable 0.5-second grace and 0.25-second damage pulses. Electricity
uses one district clock with safe, visible charging, and energized phases.
Hazard packets carry deterministic execution IDs and pass through the central
deduplicating damage/mitigation path; `heatResistChip` suppresses matching
environmental heat before armor without becoming a progression key.

`DungeonSceneBuilderV2` creates matching geometry/colliders, state-dependent
bulkheads and water, consoles, lifts, shortcuts, safe anchors, region-based
encounter activation, landmarks, readable hazard cues, procedural ambient
audio, and deterministic teardown. Its V2-only minimap tracks hidden, seen,
visited, and explored regions across lower/entry/upper strata. Positioned
console, valve, lift, gate, shortcut, landmark, and per-basin water records
keep stable IDs and coordinates while their committed state changes. Gate and
shortcut markers derive their Locked/Open and Inactive/Active state from the
same environment predicates as gameplay. Key Seeker reveals only the currently
authorized route to the next required key or controller, never optional
treasure.

The V2 objective loop is connected end to end: the credential precedes its
gate, the final guardian records a durable defeat fact, that fact enables a
separate Large Refractor pickup, securing the Refractor commits exactly once,
and a distinct extraction interaction returns to Camp. Reload/re-entry after
each step reconstructs the same plan and restores only the discrete durable
state.

### Persistence and Roll

Unity uses a separate schema-2 campaign envelope under
`Application.persistentDataPath/RuinCrawler/Saves`. It does not read, import,
or overwrite browser saves. Writes use a flushed temporary file, atomic
replacement, backup recovery, revision/write IDs, corrupt-file quarantine,
stale-revision rejection, and replay-safe transactions.

V2 expedition identity stores profile/ruleset/content-pack versions, seed,
ruin ID, and canonical plan signature. Its active progress stores checkpoint,
required
items/facts, permanent controller facts, activated shortcuts, claimed
discoveries, layered map knowledge, and Refractor resolution. `KnownRuin`
stores durable discoveries and retained structural knowledge for deterministic
return visits. Exact canonical identity is required on resume. An active
dungeon record with an incompatible profile or incomplete V2 identity is reset
instead of being dispatched to another generator; owned equipment, salvage,
recipes, Buster sources, Boss Hunt history, and other campaign ownership remain
intact so the Camp entrance can immediately start a fresh V2 expedition.
Unknown plan-local controller, shortcut, region, connection, landmark,
mechanism, and discovery
IDs are removed from active progress into the visible campaign quarantine
before restoration. Water level, hazard phase, lift/crumble positions, enemy
health, projectiles, and generated objects are intentionally reconstructed
rather than saved.

Shortcut persistence is intentionally split: discovering a shortcut is a
once-per-ruin durable fact, while opening it is an idempotent
once-per-expedition activation. A later visit retains map and discovery
knowledge but resets shortcut activation and all other mutable ruin
mechanisms.

Only source and ownership state is persisted: campaign identity, unidentified
recoveries, identified scrap and parts, discoveries, recipes, physical
equipment and Buster modules/chassis, Buster source revisions, assignments,
Mega calibrations, fabrication history, and Boss Hunt/expedition state.
Compiled plans, batteries, active projectiles, lock state, enemy health, and
generated scene objects are derived again at runtime.

Roll's Camp workshop implements:

- atomic Identify All with stable recovery-ID replay protection;
- named-part stockpile, discovery provenance, and identified scrap;
- fabrication preflight, one-time physical output, and no consumption on
  failure or idempotent replay;
- safe-area Arms/Gear assignment and ownership/exclusivity checks;
- Custom Buster draft validation, immutable materialized revisions,
  historical-revision replay, assignment, and Test Range launch;
- Boss Hunt selection, advertised recovery, clear history, selection lock
  during an expedition, Support Car departure/re-entry, and idempotent return;
- keyboard, mouse, and gamepad navigation with visible disabled reasons;
- complete gameplay-map suppression while the modal workshop is open.

Roll's logical NPC root remains at world scale so her collider and prompt do
not inherit the FBX import scale. A separately scaled 2.6-unit visual is
re-grounded from its animated renderer bounds each frame. The shared
`Gameplay/Interact` action opens her workshop with `F` or gamepad West/X. The
Support Car exposes the same in-world interaction for a normal procedural
expedition, so dungeon departure does not require selecting a Boss Hunt.

If a reload or player defeat returns to Camp with a committed expedition,
both the Support Car prompt and Roll's expedition controls offer `RE-ENTER`
and rebuild the same transient dungeon from the saved expedition ID, seed,
profile, and Boss Hunt without creating a save revision. Defeat returns to
Camp after the death-animation beat and preserves that source record. Roll
also offers an explicit `ABANDON ACTIVE EXPEDITION` transaction. It clears
only the active run/selection latch and transient expedition source,
preserves the selected hunt, collected salvage, and reward ledgers, and
unlocks selection without granting a victory reward. Incomplete expedition
source records fail visibly and remain abandonable rather than being silently
replaced.

Unknown IDs are quarantined visibly rather than substituted. Valid
`buster:<buildId>` assignments survive unrelated unknown-ID repair.

### Boss Hunts

The exported boss profiles now feed a deterministic Boss Hunt runtime:

- selection and expedition identity are read from the campaign envelope;
- profile constraints pin a reproducible Reaverbot genome and boss variant;
- generated bosses scale health and attacks through the shared combat runtime;
- typed phase-one, transition, phase-two, defeated, resolved, and cleaned
  states preserve damage across the phase threshold;
- authored-controller adapters can replace the generated graybox for profiles
  that require special pivots or mechanics;
- first-clear signature reward and deterministic 70% repeat-reward decisions
  commit exactly once per expedition before the runtime acknowledges victory;
- generic Reaverbot salvage is suppressed for Boss Hunt instances and
  source-owned projectiles are cancelled on cleanup.

The Boss Hunt HUD is integrated. Signature-part overload interactions, the
complete authored encounter mechanics for every profile, introductions,
checkpoints, audio/VFX, and final boss presentation remain parity work.

### UI presentation and pause/status menu

`RuinCrawlerUiTheme` applies the supplied menu direction without making a
reference bitmap authoritative gameplay data. It provides pale-cyan/navy
mechanical frames, corner rivets, low-opacity bitmap surface layers, readable
menu buttons, and a resolution-independent blue dialogue/message-box gradient
generated in code from a derived three-color palette. The production HUD and
Roll workshop both use this shared theme.

`PauseStatusMenuController` models the supplied Mega Man Legends 2 pause-menu
layout with a strong left navigation rail:

- `Map`, `Items`, `Equipment`, `Options`, and `Back` sections;
- current scene/location, identified scrap, session time, active expedition
  identity/run seed, unidentified recoveries, named-part totals, loadout, and
  player-health readouts;
- `Escape` or gamepad Start to open/close, arrow keys or D-pad to navigate,
  `Enter`/A to confirm, and B to cancel;
- full production gameplay-map suppression while open, optional world freeze,
  restored time scale and player controls on close, and refusal to open over
  Roll's modal workshop.

The two supplied Doni Arts mechanical bitmaps are runtime Resources used only
at low opacity. The HD mockup is stored as a local layout/style reference, not
as a runtime screen. Attribution and provenance are recorded in
`Assets/RuinCrawler/UI/References/README.md`. No separate redistribution
license was supplied, so all three source images remain
**development/reference-only** until shipping rights are confirmed.

## Open and run the Unity project

1. Clone the **whole repository**. Do not copy only `unity/RuinCrawler`;
   the project resolves the shared source package at `../../../assets`.
2. If JavaScript catalogs changed, run:

   ```powershell
   npm run export:unity-contracts
   npm run check:unity-contracts
   ```

3. In Unity Hub, add `unity/RuinCrawler` and open it with Unity
   `6000.5.4f1`.
4. Allow Unity Package Manager to resolve the pinned dependencies.
5. Use **Ruin Crawler > Porting > Rebuild Production Scenes** when the
   generated production scenes or controlled imports need rebuilding.
6. Open `Assets/RuinCrawler/Scenes/Boot.unity` and press Play.

The production rebuild is an authoring command. It first rebuilds the
disposable first slice, then recreates Boot, Camp, Expedition, and TestRange,
configures the physics matrix, and replaces Build Settings with the five
scenes listed above. Preserve unrelated scene work outside those generated
targets.

Use **Ruin Crawler > Porting > Rebuild First Slice** only for the disposable
`PortingSandbox` asset/animation regression scene, and **Ruin Crawler >
Porting > Rebuild Player Animations** when regenerating the exact-skeleton
Volnutt animation controller.

## Production controls

| Action | Keyboard and mouse | Gamepad |
| --- | --- | --- |
| Drive forward / reverse | `W` / `S` | Left-stick vertical |
| Turn Mega Man left / right | `A` / `D` | Left-stick horizontal |
| Camera pitch | Mouse vertical | Right-stick vertical |
| Jump | `Space` | South / A |
| Dodge | Left `Ctrl` | East / B |
| Sprint | Hold left `Shift` while moving forward | Not yet separately bound |
| Fire | Left mouse | Right trigger |
| Manual aim | Right mouse | Left trigger |
| Toggle lock | `Tab` | Right-stick press |
| Cycle locked target | `Q` / `E` | D-pad left/right |
| Previous / next arm action (switching consumer pending) | `1` / `2` | Left/right shoulder |
| Roll interaction | `F` near Roll | West / X |
| Enter or re-enter dungeon at Support Car | `F` at the departure point | West / X |
| Interact with V2 valve, routing console, shortcut, Refractor, or extraction | `F` nearby | West / X |
| Cycle V2 minimap stratum | `,` / `.` | UI layer controls pending a dedicated gamepad binding |
| Pause/status menu | `Escape` | Start |

Inside Roll's workshop, `Tab` or the arrow keys move keyboard focus,
`Page Up`/`Page Down` change tabs, `Enter`/`Space` submit, and
`Escape` closes. On gamepad, the D-pad navigates or adjusts values, the
shoulders change tabs, South/A submits, and East/B closes.

Inside the pause/status menu, Up/Down changes the left-rail selection,
`Enter`/`Space` or South/A confirms, and `Escape` or East/B closes.

Roll and the Support Car use the shared `Gameplay/Interact` action on
`F`/West-X. `Q` and `E` remain dedicated to lock-target cycling.

## Contract export and tests

Use the root `package.json` as the browser/source command authority:

```powershell
npm run check
npm run export:unity-contracts
npm run check:unity-contracts
npm run test:buster
npm run test:reaverbots
npm run test:reaverbots:runtime
npm run test:bosses
```

The frozen Custom Buster role/balance verdict is a separate design gate:

```powershell
npm run verify:buster-balance
```

The current source catalog is known to have three role/balance failures despite
zero hard-correctness failures. Do not change constants or weaken tests solely
to manufacture a green verdict.

Run Unity suites through **Window > General > Test Runner**, Unity MCP, or the
root headless commands. Close the interactive Unity Editor before using the
headless commands because Unity does not allow two Editors to own the same
project:

```powershell
npm run test:unity:edit
npm run test:unity:play
npm run test:unity
npm run verify:unity-port
```

`test:unity:edit` and `test:unity:play` write NUnit XML to
`artifacts/unity-tests/EditMode.xml` and `PlayMode.xml`. `test:unity` runs them
in that order. `verify:unity-port` first checks that the generated Unity
contract pack is current, then runs both platforms. The browser
`verify:release` command remains independent because its known Custom Buster
role verdict is a separate design gate.

The launcher reads the required Editor version from the selected project's
`ProjectSettings/ProjectVersion.txt`, then checks `--editor`,
`UNITY_EDITOR_PATH`, and conventional Unity Hub locations. Its supported
overrides are:

```powershell
node scripts/run-unity-tests.mjs --mode EditMode `
  --project unity/RuinCrawler `
  --editor "C:\Program Files\Unity\Hub\Editor\6000.5.4f1\Editor\Unity.exe" `
  --results artifacts/unity-tests/edit-ci.xml

npm run test:unity:edit -- --print-command
```

The launcher streams the Unity log, returns Unity's nonzero exit code, and
requires a fresh, non-empty NUnit `<test-run>` result after a successful Editor
exit. Missing Editors, invalid projects, and missing/stale results fail with an
actionable path. `--print-command` performs discovery and validation but does
not launch the Editor or create an artifact directory.

The main assemblies are:

- `RuinCrawler.Core.Foundation.EditorTests`
- `RuinCrawler.Core.Buster.EditorTests`
- `RuinCrawler.Core.Reaverbots.EditorTests`
- `RuinCrawler.Core.Dungeon.EditorTests`
- `RuinCrawler.Core.Campaign.EditorTests`
- `RuinCrawler.Runtime.Persistence.EditorTests`
- `RuinCrawler.Runtime.Reaverbots.EditorTests` and
  `RuinCrawler.Runtime.Reaverbots.PlayModeTests`
- `RuinCrawler.Runtime.Dungeon.EditorTests` and
  `RuinCrawler.Runtime.Dungeon.PlayModeTests`
- `RuinCrawler.Runtime.BossHunts.EditorTests` and
  `RuinCrawler.Runtime.BossHunts.PlayModeTests`
- `RuinCrawler.Production.EditorTests` and
  `RuinCrawler.Production.PlayModeTests`
- `RuinCrawler.Port.EditorTests` and
  `RuinCrawler.Port.PlayModeTests`

### Verification record

Green Unity runs recorded on 2026-07-18 include:

- V2-focused Edit Mode: **109/109** (job
  `a2bd2b4197e64939bf37d2f4af0457bd`);
- V2-focused Play Mode: **38/38** (job
  `75b2206ad58148a6bb265fcd4c6ece61`);
- Unity-wide Edit Mode: **279/279**, zero failures, in `TestResults.xml`
  written 2026-07-18 03:00:27 EDT (178.293 seconds). The MCP job ID was lost
  when its output was truncated, so no ID is asserted here;
- Unity-wide Play Mode: **71/71** (job
  `c535db1635974828aa416ebe5e7e3c11`).

Browser-side checks from the same checkpoint passed `npm run check`,
`npm run check:unity-contracts`, and `npm run test:reaverbots` (**62/62**).
The aggregate `npm test` command reached its 300-second runner timeout; before
that timeout, syntax checks, equipment unit tests (**42/42**), equipment
Playwright tests (**4/4**), Buster unit tests (**117/117**), and **18/21**
Buster Playwright cases had passed. The remaining three Buster Playwright
cases and subsequent aggregate stages did not finish, so this is recorded as
an incomplete release run rather than a failure or a pass.

These automated results prove the recorded contract and runtime checkpoint,
not the final operator timing, authored-art, performance, visual-overlap, or
combined release gates. Those remaining checks guide polish and release
readiness; they do not restrict Camp access to `industrial-factory-v2`.

## Installed and pinned versions

| Component | Version or pin |
| --- | --- |
| Unity Editor | `6000.5.4f1` (`d550df8bd089`) |
| Unity Hub used for setup | `3.19.5` |
| CoplayDev Unity MCP | package `10.1.0`, commit `c14de1e6dc01ab42d2bb358730cff954bce0ce6b` |
| MCP transport | HTTP, `http://127.0.0.1:8080/mcp` |
| uv / uvx | `0.11.29` |
| uv-managed Python | `3.12.13` |

The MCP package pin is recorded in `Packages/manifest.json` and
`Packages/packages-lock.json`.

## Unity MCP setup for Codex

### Repository-owned configuration

- The Unity package is pinned to a specific CoplayDev commit.
- `RuinCrawlerMcpSetup.cs` configures Codex-only HTTP loopback transport,
  port `8080`, the local `uvx.exe`, and server autostart.
- Unity-generated package state is committed; Unity caches are ignored.

### Machine-local configuration

The following are not reproduced solely by cloning the repository:

- `uvx.exe` at `C:\Users\<user>\.local\bin\uvx.exe`;
- the Codex entry in `C:\Users\<user>\.codex\config.toml`;
- the operator skill under
  `C:\Users\<user>\.codex\skills\unity-mcp-skill`;
- Unity `EditorPrefs` used for MCP autostart and the uvx override.

On a new Windows machine:

1. Install `uv`/`uvx` from Astral.
2. Open the Unity project and use **Ruin Crawler > Porting > Configure Unity
   MCP for Codex**.
3. Confirm **Window > MCP for Unity** reports the local HTTP server as
   connected.
4. Restart Codex so it reloads the MCP server and installed skill.

The resulting Codex configuration is:

```toml
[mcp_servers.unityMCP]
url = "http://127.0.0.1:8080/mcp"
```

Keep the server bound to `127.0.0.1`. It can edit assets, run tests, control
Play Mode, and execute C# in the local editor. CoplayDev telemetry is enabled
by default in the pinned server; set `UNITY_MCP_DISABLE_TELEMETRY=1` before
launch and restart the server to opt out.

## Shared assets and GUID policy

The root `assets` directory is exposed as local UPM package
`com.ruincrawler.source-assets`:

```json
"com.ruincrawler.source-assets": "file:../../../assets"
```

This avoids duplicating source art. The generated `assets/**/*.meta` files
are part of the port and must remain beside their assets so Unity GUID
references stay stable.

Initial texture translation remains semantic:

| Asset class | Color space | Wrap | Filter | Mips | Aniso |
| --- | --- | --- | --- | --- | ---: |
| Ruin color maps | sRGB | Repeat | Trilinear | Yes | 4 |
| Procedural Reaverbot color maps | sRGB | Clamp | Point | Yes | 4 |
| Reaverbot luminance/emissive masks | Linear | Clamp | Trilinear | Yes | 4 |
| Sharukurusu diffuse | sRGB | Clamp | Point | Yes | 1 |
| Volnutt diffuse | sRGB | Clamp | Trilinear | Yes | 1 |
| Portraits | sRGB | Clamp | Point | No | 1 |

The user-supplied UI references are kept under
`Assets/RuinCrawler/UI/References`, with runtime copies of the wide and
diagonal mechanical surfaces under
`Assets/RuinCrawler/UI/Resources/Art`. Their filenames retain the Doni Arts
attribution. They are development/reference assets, not cleared distribution
assets; do not include them in a shipping build without a separate provenance
and redistribution-rights decision.

The six user-supplied Dungeon V2 tilesheets and room concepts are preserved as
source masters under `Assets/RuinCrawler/Art/SourceMasters/DungeonV2`. The
industrial, Waterworks, magma, and electrical sheets provide semantic material
and mechanism references; the flooded-factory and corkscrew-gear concepts guide
future certified module silhouettes, landmarks, and vertical traversal. They
are not applied as whole runtime textures and never define collision,
reachability, or fall safety. Runtime use requires purpose-cropped or baked
role-specific maps with gameplay-distance QA, while certified plan geometry
remains authoritative. Their provenance and shipping rights are not yet
cleared, so they remain development/reference-only assets.

Imported GLB files still use `DefaultImporter` and are not directly usable as
Unity models. Add a pinned glTF importer or a documented deterministic
conversion pipeline before relying on authored GLB rooms or the Ruby Optic
Oracle. Authored room GLBs may decorate a validated plan, but they must never
become the authoritative traversal or collision source.

## Port manifest and visual evidence

`Assets/RuinCrawler/Porting/PortingManifest.asset` still tracks the original
asset-oriented checkpoint: Volnutt, the core animation set, Mega Buster,
Sharukurusu target, two ruin textures, and seeded RNG. The production
subsystems above are enforced by assemblies, generated contracts, scene
composition tests, and acceptance tests; the manifest has not yet been
expanded into a complete runtime-feature inventory.

Existing animation and Buster captures remain under
`Assets/RuinCrawler/Porting/Captures`:

- `volnutt-action-idle.png`
- `volnutt-action-idle-buster.png`
- `volnutt-breathing-idle.png`
- `volnutt-jog.png`
- `volnutt-mega-buster-equipped.png`
- `volnutt-mega-buster-aim-forward.png`
- `volnutt-mega-buster-aim-forward-side.png`
- `porting-sandbox-final-v2.png`

Current game-view UI acceptance captures are under `Assets/Screenshots`:

- `RuinCrawler_Camp_Pause_Style_Accepted.png`
- `RuinCrawler_Camp_Roll_Workshop_Style_Accepted_Final.png`
- `RuinCrawler_Camp_Roll_Interaction_Fixed-1.png`
- `RuinCrawler_Camp_Dungeon_Departure_Fixed-1.png`
- `RuinCrawler_TestRange_StraightArm_TankCamera.png`

The older porting captures remain sandbox animation/pose evidence rather than
current Expedition acceptance captures.

## Known limitations and distribution status

- Full scene presentation of every Custom Buster chronological event remains
  to be connected to the already-ported pure kernel.
- Previous/next arm bindings and independent battery state exist at the input
  and pure-runtime boundaries, but production player arm switching is not yet
  connected.
- Procedural Reaverbots have deterministic genomes, readable semantic
  grayboxes, shared combat, weak-point windows, salvage, and cleanup, but not
  every source archetype's full locomotion, attack, defense-break, audio, and
  VFX behavior.
- `industrial-factory-v2` now has the playable key/controller, reversible
  Waterworks, hazard district, reward, final guardian, Refractor, extraction,
  persistence, and re-entry loop. Its current 30 module variants are deliberate
  gameplay grayboxes; broader authored room silhouettes, moving/crumbling
  platform variety, encounter ecology, and final texture dressing remain art
  and content expansion rather than missing V2 contracts. The dungeon remains
  immediately playable while operator timing, visual, performance, and release
  checks continue.
- Boss Hunts have deterministic selection, generated/adapted boss seams,
  phases, HUD, rewards, persistence, and cleanup. Signature-part overload and
  the complete authored mechanics/presentation for each boss remain.
- The Support Car and Test Range flows exist. The campaign transaction pieces
  for camp-to-dungeon-to-discovery/Refractor-to-re-entry are connected, but the
  complete long-form real-save loop and the 12-18 / 18-25 / 25-35 minute
  representative playtest budgets still need a final operator acceptance pass.
- HUD, workshop, and pause/status UI share the implemented mechanical theme and
  code-derived dialogue gradient. Accessibility review, narrow-viewport
  behavior, and gameplay-distance visual QA are still in progress. The pause
  Options section is currently a read-only controls/presentation summary;
  versioned persistent settings are not implemented.
- V2 has generated district ambience and first-pass water, magma, electricity,
  landmark, and safe-pad cues. Final authored audio, impact/trail VFX,
  overlapping-effect readability, long-session profiling, and the complete
  release capture suite remain.
- The Unity save is schema 2. Atomicity, backup recovery, conflicts, repair,
  incompatible-active-dungeon reset, and unknown-ID quarantine are covered by
  focused tests.
- Authored GLB assets still need an importer/conversion decision.
- Rights and provenance for Mega Man-derived models, animations, and curated
  assets remain unresolved. Treat this Unity project as
  **development-only** until distribution clearance is complete.
- The supplied Doni Arts menu surfaces and HD mockup have attribution but no
  separate redistribution grant. They must remain development/reference-only
  until their shipping rights are confirmed.

## Remaining integration order

1. Complete representative V2 critical/curious/thorough timing playtests,
   bright/dark and overlapping-combat capture review, and repeated
   Camp/Expedition long-session profiling.
2. Expand the certified V2 module catalog with more authored platforming,
   moving/crumbling surface patterns, traversal landmarks, and encounter
   compositions without weakening the pure validators.
3. Drive all Custom Buster delayed/triggered projectile events through pooled
   Unity presentation while retaining the pure kernel as the only math source.
4. Complete source-specific Reaverbot behavior, defense breaking, semantic
   textures, and special locomotion.
5. Complete authored Boss Hunt mechanics, signature-part tradeoffs,
   checkpoints, Roll/Support Car presentation, audio, and VFX.
6. Run the end-to-end real-save loop, repeat scene/pool/performance audits,
   then run the independent browser and Unity port release gates together.

The Three.js catalogs and tests remain authoritative until each Unity subsystem
passes parity. Persist source and ownership state; derive compiled plans,
batteries, projectiles, locks, generated enemies, and dungeon scene objects.
