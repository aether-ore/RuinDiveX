# Pose Debug Gameplay Test Log

Date: 2026-07-08
Build tested: local static dev server at `http://127.0.0.1:5174/`

## Scope

Tested the live debug pose mode against the external Mega Man Volnutt segmented rig. The pass focused on using sliders, camera orbit, part dragging, keyframe reset behavior, and local Euler axis behavior in preparation for a more natural animation overhaul.

## What Worked

- Backquote opened and closed Pose Debug reliably.
- The game simulation paused while Pose Debug was open; the HUD timer stayed fixed during the test.
- The external rig loaded and Pose Debug reported ready with all 15 joints and 45 axis sliders.
- Slider edits updated the model and the prompt output immediately.
- Camera orbit worked by dragging empty space, and mouse wheel zoom remained responsive.
- Dragging a large mesh, such as the torso, selected the expected joint and updated sliders. A torso drag of roughly 60 px left and 55 px up produced about `spine.pitch +19.5` and `spine.yaw -21`, matching the `0.35 deg/px` drag mapping.
- Shift-dragging a large mesh updated roll only. A roughly 120 px Shift-drag produced `spine.roll +42`.

## Inconsistencies And Usability Issues

- The UI labels `Pitch`, `Yaw`, and `Roll` are technically local Euler `x/y/z`, but they do not always match animator expectations for body-part motion. This is most noticeable on arms.
- `rightShoulder.pitch +45` mostly twists the buster-side shoulder/arm instead of moving the arm forward, back, up, or down.
- Elbow `pitch/x` is especially misleading on the external rig. `rightElbow.pitch +45` produced little visible elbow bend, while `rightElbow.roll +45` produced the obvious in-plane elbow bend.
- Side signs are mirrored for shoulder and elbow roll:
  - `leftShoulder.roll +45` raises the left arm.
  - `rightShoulder.roll +45` lowers the buster arm.
  - `leftElbow.roll +45` bends the left forearm upward from T-pose.
  - `rightElbow.roll +45` bends the buster forearm downward from T-pose.
- Small part dragging is easy to miss. A drag starting around a visible hand/forearm missed the rig and orbited the camera instead. Larger torso dragging worked.
- The Reset button zeroes the currently selected keyframe in the in-session animation payload. There is no visible way to restore the original preset keyframe other than reloading the page.
- The status text says "Right-drag empty space to orbit," but the implementation orbits on any non-selected drag, including left-drag on empty space.

## Axis Findings

### Stable Or Mostly Stable

- Hips and knees use `x/pitch` in an animator-friendly way.
- `leftHip.pitch +45` and `rightHip.pitch +45` both lifted the matching thigh forward/up from the front view.
- `leftKnee.pitch +90` and `rightKnee.pitch +90` both folded the matching lower leg.

### Needs Side-Aware Mapping

- Shoulder and elbow roll need mirrored signs by side for natural symmetric poses.
- For a natural T-pose arm drop:
  - Left shoulder uses negative roll.
  - Right shoulder uses positive roll.
- For a natural elbow bend downward from T-pose:
  - Left elbow uses negative roll.
  - Right elbow uses positive roll.

### Likely Misleading Or Inverted For Authoring

- Arm `x/pitch` behaves closer to twist than bend on this rig, because the arm hierarchy is laid out side-to-side in local space.
- Existing animation code that uses `leftElbow.x` or `rightElbow.x` as the main elbow bend is probably not driving a natural visible bend on the external model.
- For arms, an overhaul should use an authoring-space semantic layer instead of writing raw Euler values directly:
  - `armRaise` should map mostly to local `z/roll`, with mirrored signs.
  - `armForwardBack` should map mostly to local `y/yaw`.
  - `armTwist` should map mostly to local `x/pitch`.
  - `elbowBend` should map mostly to local `z/roll`, with mirrored signs, plus optional `y/yaw` for depth.

## Recommendations For Animation Overhaul

- Add a small pose-authoring mapper for semantic joints rather than hand-authoring raw `x/y/z` everywhere.
- Keep leg pitch values largely as-is, then tune yaw and roll second.
- Replace walk-cycle elbow `x` swing with side-aware elbow roll or a blended roll/yaw bend.
- Update Pose Debug labels or add per-joint helper labels so arm axes do not imply anatomical pitch when the local axis is actually twist.
- Make Reset restore the selected preset keyframe, or split it into "Zero Pose" and "Restore Keyframe" actions.
- Make direct manipulation easier to hit by increasing handle size, adding hover feedback, or preferring handles over mesh picking for small limbs.
- Update the status copy to match behavior: empty-space drag orbits; Shift-drag on a selected part/handle edits roll.

## Follow-up Verification After Semantic Animation Pass

- Added a semantic rig mapper and confirmed the right-side debug export maps raw `rightShoulder.roll +45` to semantic `armRaise: 45`, and raw `rightElbow.roll +30` to semantic `elbowBend: 30`.
- Pose Debug now labels controls as local X/Y/Z, includes joint-specific helper notes for arm inversions, and exports both `semanticPoseDegrees` and `rawLocalPoseDegrees`.
- Split the previous reset behavior into `Zero Pose` and `Restore Key`; verified on the Beam Blade Slash chamber keyframe that zeroing clears controls and restore returns preset values such as `rightShoulder.yaw 78`, `rightShoulder.roll -5`.
- Confirmed Pose Debug still pauses the simulation; the HUD timer held at `00:33` during a 1.8 second open-panel wait.
- Confirmed closing Pose Debug resumes the simulation and returns to normal gameplay view.
- Desktop and mobile screenshot-pixel checks were nonblank and visually varied. The mobile Pose Debug panel fit within a `390 x 844` viewport with controls still reachable.
- Browser console still shows a repeated generic Chromium `UnknownError` message, but no app-specific module or stack trace errors appeared during the pass.

## Follow-up Implementation Pass: Full-body Action States

- Extended `AnimationController` with explicit full-body action states for `dodgeRoll`, `neutralJump`, `forwardJump`, `knockbackFall`, `downed`, and `getUp`, including action progress reporting for the external rig.
- Added gameplay triggers: `Space` starts a neutral or forward jump based on movement input, and `Q` starts a directional dodge roll.
- Added heavy-hit routing so large unguarded damage can trigger knockback into fall-down, a short downed hold, and get-up.
- Added player root-motion-like displacement for dodge rolls, forward jumps, and knockback slides, while leaving normal locomotion blocked during full-body actions.
- Added semantic external-rig poses for dodge tuck/roll, jump crouch-air-land phases, knockback fall/downed, and get-up recovery.
- Blocked primary/secondary combat actions and manual aim holds while full-body action states lock control.
- Documented `Shift`, `Space`, and `Q` in `README.md`.
- Verification completed: `node --check` passed for `AnimationController.js`, `Player.js`, `ExternalModelRig.js`, `Game.js`, and `CombatSystem.js`; `git diff --check` passed.
- Runtime browser verification was attempted, but the in-app browser bridge timed out on navigation and even current-tab URL/title reads after reconnects. The local static server still returned HTTP `200`, so this pass remains command-line verified but not visually re-captured in browser.

## Follow-up Browser Retest: Pose Debug Labels And Action Smoke Test

- Reconnected to the in-app browser at `http://127.0.0.1:5174/`, reloaded the local page, and confirmed the app loaded one WebGL canvas with the HUD active.
- Opened Pose Debug with backquote and confirmed the panel now shows local-axis labels plus semantic arm labels such as `Local X / Arm Twist`, `Local Y / Arm Forward/Back`, `Local Z / Arm Raise`, `Local X / Forearm Twist`, and `Local Z / Elbow Bend`.
- Confirmed helper notes call out the side-aware local-Z arm mapping: left arm semantic raise/bend maps to negative local Z, and right arm semantic raise/bend maps to positive local Z.
- Confirmed Pose Debug still pauses the simulation; the HUD timer stayed at `00:43` across a 1.4 second wait while the panel was open.
- Confirmed the pose prompt export includes both `semanticPoseDegrees` and `rawLocalPoseDegrees`. Moving `rightShoulder` local Z/roll to `45` exported `semanticPoseDegrees.rightArm.armRaise: 45`.
- Retested the Zero/Restore split on the Beam Blade Slash chamber keyframe. `Zero Pose` cleared `rightShoulder.yaw`, `rightShoulder.roll`, and `rightElbow.roll` to `0`; `Restore Key` brought them back to `78`, `-5`, and `-31`.
- Closed Pose Debug and verified the timer resumed from `00:43` to `00:45` after gameplay input.
- Pressed `Q` in gameplay and captured a visible dodge-roll frame with the external model in a full-body sideways roll pose.
- Pressed `Space` in gameplay and captured a crouched/lift preparation frame, confirming the jump key path reaches a non-idle action pose.
- Added a combat control-lock suspension path so held laser, drill, lift, cone spray, lock-on, grenade preview, and pending melee effects stop during full-body action states instead of competing with dodge/jump/knockdown poses.
- Verification completed after the control-lock update: `node --check` passed for `CombatSystem.js`, `AnimationController.js`, `Player.js`, `ExternalModelRig.js`, `UIManager.js`, `SemanticRigMapper.js`, and `Game.js`; `git diff --check` passed.
- Remaining browser noise: the in-app browser reported repeated generic Chromium `UnknownError` logs and `WrongDocumentError` pointer-lock logs during automated clicks. No app-specific module stack trace or visible gameplay failure appeared during this retest.

## Follow-up Implementation Pass: Semantic Locomotion Clips

- Added `src/animation/LocomotionAnimator.js` as the first reusable animator module outside the rig. It builds `PoseClip` data from semantic walk and jog keyframes, then samples those clips through `PoseMixer`.
- Converted the walk/jog source of truth from inline sine-wave gait math to authored semantic keyframes: left contact, down, passing, right contact, down, and passing.
- The authored gait data uses semantic arms (`armForwardBack`, `armRaise`, `elbowBend`) so arm swing no longer depends on misleading raw elbow pitch or shoulder pitch.
- The external rig now owns a `LocomotionAnimator` and applies sampled walk/jog clips before aim, firing, slash, hurt, and full-body action overlays.
- Jogging now has a distinct semantic clip with a faster loop, stronger forward lean, higher knee lift, larger stride, and stronger arm swing than walking.
- Removed the obsolete inline natural-leg helper from `ExternalModelRig.js` so there is one locomotion authoring path to tune.
- Updated `README.md` to list the semantic mapper and locomotion animator module.
- Verification completed: `node --check` passed for `LocomotionAnimator.js`, `ExternalModelRig.js`, `SemanticRigMapper.js`, `Game.js`, `AnimationController.js`, and `Player.js`; `git diff --check` passed.
- Browser smoke verification: reloaded `http://127.0.0.1:5174/`, confirmed one WebGL canvas and active HUD, and saw no new app-specific console errors after the module change.
- Browser limitation: automated repeated keypresses did not hold movement long enough to capture trustworthy walk/jog gait frames. The captured frames prove the page remained alive, but they are not strong visual evidence for gait quality.

## Follow-up Implementation Pass: Aim And Combat Animation Layers

- Added `src/animation/UpperBodyAimLayer.js` to own the additive upper-body Buster aim pose, lock-on strafe twist, backpedal bracing, and firing recoil.
- Added `src/animation/CombatAnimator.js` to own semantic melee and beam-blade slash poses, including chamber, release, active slash, follow-through, and recovery pose phases.
- `ExternalModelRig.js` now composes locomotion, upper-body aim/recoil, and combat layers through separate animator modules instead of keeping those recipes as rig-local helpers.
- The extracted aim and combat layers still use semantic arm controls, so the buster arm aim and beam-blade chamber avoid raw shoulder/elbow pitch assumptions.
- Updated `README.md` to list the aim and combat animation modules.
- Verification completed: `node --check` passed for `UpperBodyAimLayer.js`, `CombatAnimator.js`, `LocomotionAnimator.js`, `ExternalModelRig.js`, `SemanticRigMapper.js`, `Game.js`, and `Player.js`; `git diff --check` passed.
- Browser smoke verification: reloaded `http://127.0.0.1:5174/`, confirmed one WebGL canvas and active HUD after the module split, and saw no new app-specific module-load errors.

## Follow-up Implementation Pass: Damage, Dodge, And Jump Animators

- Added `src/animation/DamageAnimator.js` to own standing flinch, knockback fall/downed, and get-up semantic poses.
- Added `src/animation/DodgeRollAnimator.js` to own the full-body dodge tuck/spin/brace pose.
- Added `src/animation/JumpAnimator.js` to own neutral jump, forward jump, falling, and landing semantic poses.
- `ExternalModelRig.js` now dispatches full-body action poses through these modules instead of embedding dodge/jump/damage/get-up recipes directly in the rig.
- `Player.takeDamage` now captures the hit source direction relative to player facing and passes it as `damageHitLocal` to the external rig. Standing flinch can now pitch back/forward or bend away from side hits instead of always using the same recoil direction.
- Updated `README.md` to list the damage, dodge, and jump animation modules.
- Verification completed: `node --check` passed for `DamageAnimator.js`, `DodgeRollAnimator.js`, `JumpAnimator.js`, `ExternalModelRig.js`, and `Player.js`.
- Browser smoke verification: reloaded `http://127.0.0.1:5174/`, confirmed one WebGL canvas, active HUD text, and no new browser log entries after reload.
- Pose Debug retest: opened the panel with the backquote key path, confirmed the panel displayed, and confirmed it still exposes semantic labels such as `Local X / Arm Twist`, `Local Y / Arm Forward/Back`, `Local Z / Arm Raise`, `Local Z / Elbow Bend`, `Local X / Hip Pitch`, and `Local X / Knee Bend`.
- Pose Debug export retest: the prompt output still includes both `semanticPoseDegrees` and `rawLocalPoseDegrees`, including arm semantic keys such as `armRaise`.
- Automation limitation: the browser wrapper did not expose direct Playwright keyboard presses in this session, so the retest used the browser plugin's DOM key helper. This is a test-harness limitation rather than a game regression.

## Follow-up Implementation Pass: Impact Hitstop Timing

- Added game-level hitstop timing so confirmed impact frames briefly slow gameplay simulation while HUD, particles, damage numbers, timed effects, camera, and rendering continue to update.
- Wired the existing projectile `hitStopDuration` metadata into `Game.damageEnemy`, so buster/projectile hits now request a real impact pause instead of only setting enemy-local hit reaction timers.
- Added hitstop requests for rail shots, beam-blade and melee arc hits, explosions against enemies, explosions against the player, enemy melee hits on the player, and player-projectile hits on the player.
- Tuned beam-blade impacts to request a stronger pause than light melee so the chamber/release/active slash animation has a clearer contact beat.
- Updated `README.md` to note hitstop timing as part of the main game loop responsibilities.
- Verification completed: `node --check` passed for `Game.js`, `CombatSystem.js`, `ProjectileSystem.js`, and `Enemy.js`; `git diff --check` passed.
- Browser smoke verification: reloaded `http://127.0.0.1:5174/`, confirmed one WebGL canvas, active HUD text, the Pose Debug panel still present, and no new browser log entries after reload.

## Follow-up Implementation Pass: Animation Preview Hook And Locomotion Verification

- Added a deterministic animation preview path for locomotion and aim-overlay testing. It can be started with URL parameters such as `?animationPreview=walk`, `?animationPreview=jog`, `?animationPreview=aimWalk`, `?animationPreview=aimJog`, `?animationPreview=strafeLeft`, `?animationPreview=strafeRight`, and `?animationPreview=backpedal`.
- Exposed console helpers `window.setAnimationPreviewMode(mode)` and `window.getAnimationPreviewState()` for manual tuning in the browser.
- Preview mode routes through `Player.previewExternalAnimation`, the existing `AnimationController`, and the external segmented rig update path, but it bypasses dungeon/enemy/combat simulation so gait frames can be observed without unreliable held-key automation.
- Added hidden body dataset flags for automated checks: preview mode, moving/running/aiming state, strafe amount, backpedaling state, external-rig readiness, and gait phase.
- Browser verification: `walk` preview reported external rig `ready`, moving `true`, running `false`, aiming `false`, and phase advanced from `4.621` to `18.518` with one WebGL canvas active and no new browser logs.
- Browser verification: `aimJog` preview reported external rig `ready`, moving `true`, running `true`, aiming `true`, and phase advanced from `5.828` to `24.552` with no new browser logs.
- Browser verification: `strafeLeft` preview reported external rig `ready`, moving `true`, aiming `true`, strafe `-1.00`, and advancing phase with no new browser logs.
- Restored the browser to normal `http://127.0.0.1:5174/` afterward and confirmed preview mode returned to `off`, one WebGL canvas was active, and no new browser logs appeared.

## Follow-up Gameplay Test: Walk Axis Inversion Review

- Added fixed animation-preview camera angles with `animationPreviewCamera` / `animCamera` URL parameters so walk and jog cycles can be reviewed from side, front, rear, diagonal, and top views.
- Added hidden preview leg telemetry on `document.body.dataset.animationPreviewLegs` to record hip, knee, and ankle positions in player-local space. Local `+Z` is the player's forward direction.
- Pre-fix walk review from side, front, rear, and diagonal views confirmed the reported inversion. The neutral feet start around `-0.149` behind the hips, but the walk cycle pushed swing ankles as far back as roughly `-0.72`, and jog pushed them to about `-0.97`.
- Investigation found two separate signs, not one shared sagittal sign. Hip and ankle stride pitch need the local-forward correction because positive local `X` moves child segments toward local `-Z`, but the knee hinge needs to keep the natural bend sign.
- Localized the correction inside `src/animation/LocomotionAnimator.js`: `LEG_STRIDE_AXIS_SIGN = -1` drives authored hip/ankle pitch and stride offsets into player-local `+Z` forward, while `LEG_KNEE_BEND_SIGN = 1` keeps the knee hinge from bending backward. The shared semantic mapper was left unchanged so jump, dodge, hit, and debug-pose exports are not globally retargeted.
- Follow-up review after separating the signs confirmed the user's second report: the previous all-axis flip kept the step direction readable but left the knee hinge inverted. The corrected split keeps the stepping motion and flips only the knee hinge behavior.
- Post-fix walk review from right, left, front, and front-right angles showed alternating forward/back leg travel. Clean right-side samples had one ankle ahead around `0.22` to `0.24` while the opposite leg trailed around `-0.39` to `-0.64`, with the knee folding on the natural side of the thigh/shin line.
- Jog spot-check used the same corrected split and showed the leading ankle traveling forward while the knee hinge no longer used the inverted stride sign.
- Preview mode now parks the player at the ruin entrance and faces the model consistently, avoiding the briefing console/pedestal obstruction during gait review.
- Browser console still showed repeated generic Chromium `UnknownError` entries. No app-specific module errors, stack traces, or blank-canvas failures appeared during the reviewed walk/jog preview pass.

## Follow-up Implementation Pass: Free Locomotion Upper Body

- Improved non-aiming locomotion arm articulation in `src/animation/LocomotionAnimator.js` with stronger opposing shoulder swing, more elbow carry, subtle elbow depth, forearm twist, and wrist roll for both walk and jog clips.
- Added small authored elbow/wrist position offsets to the walk and jog keyframes so arm swing reads clearly in side silhouette on the segmented rig instead of relying only on shoulder yaw.
- Updated the external rig compositor so the right arm is no longer damped just because the buster replacement is active. Free movement now gets full right-arm swing; aim, lock-on, and projectile shooting still damp or override the arm through the aim layer.
- Browser verification: `walk` and `jog` animation previews from side and front-right cameras showed visible opposing arm travel with the player parked at the clear ruin entrance preview spot.
- Browser verification: `aimWalk` still reported aiming `true` and held the braced buster upper-body pose instead of inheriting the free locomotion arm swing.
- Remaining browser noise: repeated generic Chromium `UnknownError` entries persisted, but no app-specific module errors or blank-canvas failures appeared during this pass.

## Follow-up Documentation Pass: Rig Idiosyncrasies To Preserve

- The external model's raw local Euler axes are not anatomical controls. Continue using `SemanticRigMapper` and the animator modules for authored gameplay animation instead of hand-writing raw `x/y/z` joint values.
- Pose Debug exports `semanticPoseDegrees` in degrees for prompt readability, but runtime semantic poses are radians. `semanticPoseDegreesToRadians` now recursively converts pasted nested semantic payloads so future keyframe imports do not need scattered manual `degrees(...)` calls.
- Arm local-Z signs are intentionally side-aware: positive semantic `armRaise` and `elbowBend` map to left-arm negative local Z and right-arm positive local Z. Local arm X is mostly twist, not visible raise or elbow bend.
- Locomotion has its own local adapter signs in `LocomotionAnimator.js`. `LEG_STRIDE_AXIS_SIGN = -1` is required for hip/ankle stride pitch and joint Z offsets to travel in player-local `+Z`; `LEG_KNEE_BEND_SIGN = 1` must stay separate so knees do not fold backward.
- Locomotion arm swing also uses deliberate adapter signs: shoulder forward/back is mirrored per side, elbow depth is mirrored per side, and the arm-raise offset is scaled around the rig's `74` degree neutral carriage. These constants are compensating for the segmented model's arm rest pose, not generic humanoid math.
- Beam-blade slash direction has two contributors: `CombatAnimator.applyBeamBladeSlash` drives the shoulder/elbow/wrist pose, while `ExternalModelRig._updateBusterArmLocalPose` drives the attached buster/beam-blade mount. If the blade looks wrist-down again, inspect both layers. The active slash mount should stay neutral; only the chamber keeps a small mount tilt.
- Animation preview is now the preferred visual test path for pose fixes. Useful URLs include `?animationPreview=beamBladeSlash&animationPreviewCamera=right&animationPreviewAttackProgress=0` for chamber and `...attackProgress=0.62` for the flat active slash.
- Pose composition order matters: idle/locomotion is applied first, aim/recoil can overlay upper body, combat/full-body actions then override or blend, damage flinch can add on top, arm carriage position offsets broaden shoulders, and Pose Debug rotation overrides are applied near the end.
- Fixes made in this pass: added recursive semantic degree conversion, added mapper helpers for blending core and leg semantic poses, refactored the Beam Blade Slash chamber to use the pasted semantic keyframe payload as a single converted constant, and removed the stale unused slash-sweep variable from the buster mount update.
- Remaining idiosyncrasies are mostly source-rig behavior rather than bugs. Fix them by authoring through semantic controls and preview URLs, not by globally flipping raw local axes.

## Follow-up Reference Note: Walk Arm Swing

- The Mega Man X running reference depends on the arm silhouette as much as the leg kick/plant. Arms should remain wide, elbows bent, and forearms carried at an angle through the whole gait.
- The arms should oppose each other deliberately: while one arm is forward, the other is back. Avoid same-direction arm travel and avoid transitional frames where both arms relax into a straight vertical drop.
- Rear view is the most useful camera for diagnosing arm inversion. Side view can hide forearms that are bending inward across the torso.
- The latest locomotion tuning keeps a minimum semantic shoulder forward/back swing, elbow bend, and elbow depth inside `LocomotionAnimator.armPose` so kick-out and foot-plant frames still hold a visible swagger instead of collapsing toward neutral.
- Follow-up rear-view testing showed the forced elbow-depth carry had the old inward sign. `FOREARM_CARRY_AXIS_SIGN = 1` is now the locomotion adapter sign.
- Do not move elbow or wrist joint positions outward to fake wider arm swing. That tears the segmented forearms away from the upper arms. Keep carriage position offsets shoulder-only, and tune lower-arm width through semantic rotations.
- Locomotion wrist/forearm twist channels should stay neutral. `forearmTwist`, `wristPitch`, and `wristRoll` read as inward corkscrew motion on the segmented rig.
- Rear-view axis testing showed that locomotion `elbowDepth` yaw cancels shoulder `armForwardBack` and makes the lower arms appear to twist inward even when wrist rotations are neutral. For free walk/jog swing, keep elbow-depth yaw neutral and drive the visible forward/back fist path from shoulder `armForwardBack` plus elbow `elbowBend`.
- Follow-up direct axis testing clarified that the raised walk-arm pose needs shoulder local X for the visible forward/back wrist path. Shoulder local Y reads more like side/inward yaw from the rear camera in this pose, so free locomotion routes authored forward/back swing through the shoulder-X semantic channel and leaves shoulder-Y neutral.
- Follow-up rigging inspection found the source `HandMesh_L/R` objects are not just hands. They include large lower-arm/forearm shell islands plus the distal hand/fist islands. Treating the whole source hand mesh as wrist-owned made wrist and elbow edits appear to control the same visible lower-arm pieces. The external rig builder now splits hand-mesh connected components: inner/proximal islands are assigned to the elbow-owned forearm bucket, while only distal islands are assigned to the wrist-owned hand bucket.

## Follow-up Implementation Pass: FBX Skeletal Model Swap

- Replaced the preferred player model load path with the rigged `Mega Man Volnutt.fbx` and kept the old OBJ segmented rig as a fallback.
- The FBX exposes a Mixamo-style skeleton and is now driven through `SkeletalModelRig`, which maps the existing semantic animation clips onto real bones instead of splitting OBJ mesh islands.
- The existing `Mega Man Volnutt.png` diffuse texture works on the FBX only with `flipY = true`; `flipY = false` made the legs sample incorrect brown/white texture regions.
- The old buster OBJ and the FBX source model use different scale assumptions. The skeletal rig now rescales the buster attachment against the live right elbow-to-wrist length before mounting it.
- Browser verification loaded `SkeletalModelRig` with 4 skinned meshes, 79 bones, all 15 expected Pose Debug joints, and a nonblank rear/profile walk preview. The only recurring loader warnings were Three.js FBX skin-weight truncation warnings for vertices with more than 4 weights, plus the previously observed generic Chromium `UnknownError` noise.

## Follow-up Implementation Pass: FBX Animation Library Ownership

- Copied the full Mixamo FBX animation library into `assets/models/animations/` and registered all clips on the live `SkeletalModelRig`.
- The skeletal FBX rig is now clip-driven through `THREE.AnimationMixer`. The old semantic locomotion/combat/damage translators are no longer imported or applied by `SkeletalModelRig`.
- The procedural `AnimationController` still owns gameplay timers and state transitions, but its pose output is disabled when the FBX clip rig is active. This keeps attack/jump/hurt state timing without double-posing the visible skeleton.
- Mixamo hip/root horizontal position tracks are flattened on import so walk/run clips animate the body in place while the game movement code moves the player root.
- Animation clip tracks are retargeted by normalized Mixamo bone name before binding, which protects against FBX files that spell the same skeleton path slightly differently.
- Direct clip preview is available with URL parameters such as `?animationPreview=idle&animationPreviewClip=walking` or `?animationPreview=Strut%20Walking&animationPreviewCamera=right`.

## Follow-up Implementation Pass: FBX Buster Neutral Mount

- The old segmented OBJ buster mount carried a hard-coded local `Y = -90deg` rotation. On the FBX skeleton this pointed the buster muzzle along elbow-local `-X`, while the real right forearm child direction is elbow-local `+Y`.
- The skeletal buster mount now computes its neutral quaternion from the live right elbow-to-wrist vector and aligns the buster asset's local `+Z` barrel axis to that bone direction.
- The beam-blade chamber tilt now layers as a small offset on top of that neutral quaternion instead of restoring the old OBJ-era `-90deg` Y flip every frame.

## Follow-up Implementation Pass: Breathing Default Idle

- Added `Breathing Idle.fbx` to the local Mixamo clip library and made it the preferred default idle for the FBX rig.
- The previous `idle.fbx` loop is now treated as a look-around/waiting idle. It is selected only after the player remains idle for several seconds, or directly through preview aliases such as `lookAround`, `lookAroundIdle`, and `waitingIdle`.
- Breathing/look-around idle clips preserve their authored root/hip position tracks. Locomotion clips still flatten horizontal root motion on import so gameplay movement remains authoritative, but stationary idles need the subtle authored body drift to keep the feet from sliding under a locked pelvis.
- Passive idle now starts with `20` seconds of `Side Idle.fbx`, plays one full look-around clip, then enters `Breathing Idle.fbx`.
- Once the breathing phase has held for `20` seconds, `Warrior Idle.fbx` plays once as an arm-stretch accent, then returns to breathing for another `20` seconds before repeating that breathing/stretch loop. Any non-passive state such as movement, aiming, lock-on, forced preview, or action changes the rig state key and resets the passive idle timer back to the opening side-idle phase when Mega Man returns to rest.
- Side Idle and look-around shoulder tracks are normalized to the same starting shoulder values; Breathing Idle and Warrior Idle shoulder tracks are normalized to a separate shared neutral shoulder baseline. This keeps phase handoffs from inheriting mismatched Mixamo shoulder defaults while preserving each clip's authored shoulder motion.

## Follow-up Implementation Pass: FBX Locomotion Clip Coverage

- Added the non-duplicate Mixamo locomotion FBX files for `jump`, `leftStrafeWalking`, `leftStrafe`, `leftTurn90`, `rightStrafeWalking`, `rightStrafe`, and `rightTurn90`.
- Existing duplicate `idle`, `walking`, `running`, `leftTurn`, and `rightTurn` clips were intentionally left unchanged so previously verified clip behavior stayed stable.
- Lock-on lateral movement now prefers the authored strafe-walking clips before falling back to older cover-sneak/turn clips. Jump state now prefers `jump.fbx` before the older `jumping up.fbx` fallback.

## Follow-up Implementation Pass: Right Buster And Pistol Aim Clips

- The active buster arm remains a right-arm replacement because the pistol aim clips are authored around the right arm being raised. The skeletal FBX rig mounts the buster on `rightElbow` toward `rightWrist` and hides `HandMesh_R` while either the buster or right-side drill/utility replacement is active.
- Added the pistol Mixamo clip set as authored buster-up animations. `pistolIdle` is the braced aim idle, `pistolWalk`/`pistolRun` cover forward aimed movement, `pistolWalkBackward`/`pistolRunBackward` cover aimed backpedal, and the two pistol strafe clips are used for lock-on lateral movement.
- Stationary buster-up state must use `pistolIdle` even though gameplay reports the state as an attack/aim state. Without the explicit stillness check, the selector treats sustained aiming as locomotion and plays `pistolWalk` in place.
- Pistol idle clips preserve authored root/hip position like other idles. Pistol locomotion clips still flatten horizontal root motion on import so gameplay movement controls the player root.
- All `pistol...` FBX clips now receive a small runtime buster-accommodation correction after the authored clip samples: `leftElbow` is held at `pitch -22.5`, `yaw 1.5`, `roll 111.5`, and `leftWrist` is held at `pitch 43`, `yaw -7.5`, `roll 4.5`. This is raw FBX local pose data, not old OBJ semantic pose data.

## Follow-up Implementation Pass: Pose Debug Current Pose Capture

- Pose Debug now captures the live FBX rig pose when opened and selects a temporary `Current Pose` keyframe, so opening the panel freezes Mega Man in the pose he was already holding instead of snapping to a preset.
- The generated pose prompt no longer exports or recommends `semanticPoseDegrees`. It now exports only `rawLocalPoseDegrees`, which are the editable local FBX joint rotations shown by the sliders.

## Follow-up Implementation Pass: Free-Turn Locomotion

- Normal, non-lock-on lateral input now feeds a separate FBX `turnAmount` instead of reusing the lock-on `strafeAmount`. This keeps buster/lock-on strafing on pistol strafe clips while free movement with left/right input uses turning locomotion.
- `leftTurn` and `rightTurn` are treated as looping locomotion clips. `leftTurn90` and `rightTurn90` remain one-shot fallbacks/preview clips.
- Browser verification: `turnLeft` selected `leftTurn`, `turnRight` selected `rightTurn`, ordinary `walk` still selected `walking`, and lock-on `strafeLeft` still selected `pistolStrafe`.

## Follow-up Implementation Pass: Tank Turn Controls And Camera Hold

- Normal A/D input now rotates Mega Man in place instead of moving his root laterally. W/S movement travels along the body-facing direction, while lock-on movement still uses `strafeAmount` for authored buster strafe clips.
- During normal A/D tank turning, the camera yaw holds steady. After turning stops, the camera waits briefly, then eases behind Mega Man at a lower recenter responsiveness to reduce sudden camera motion.
- Tank-turn yaw sign is intentionally inverted from the raw A/D input sign. This corrects the old OBJ-era screen-direction mismatch: A selects `leftTurn` and rotates Mega Man left; D selects `rightTurn` and rotates him right.
- Browser verification: holding A selected `leftTurn`, rotated Mega Man by about `+1.15` radians, produced `0` root-position delta, and produced `0` camera-yaw delta. Holding D selected `rightTurn`, rotated Mega Man by about `-1.15` radians, and also produced `0` root-position and camera-yaw delta.
- Forward/backward translation suppresses the FBX turn-clip request. W+A/W+D still rotate the body with tank-turn yaw, but the rig receives `turnAmount = 0` so it keeps the forward walk/run or backpedal clips instead of switching to `leftTurn`/`rightTurn`.
- Diagonal tank movement (`W+A`, `W+D`, `S+A`, `S+D`) is a camera-follow mode, not a camera-hold mode. The player exposes `tankTurnTranslating` so the camera locks behind the body while turning with the player; pure A/D still holds the camera and recenters after the turn ends.
- Browser verification: W+A, W+D, S+A, and S+D all set `tankTurnTranslating = true`, kept recenter timers at `0`, and held camera yaw within about `0.08` radians of body yaw while moving. A-only stayed `tankTurnTranslating = false`, kept root position fixed, selected `leftTurn`, and held camera yaw during the turn.
- Secondary aim pressed during pure A/D tank-turning must use Mega Man's current body-facing direction as the immediate aim/camera target. The camera swing is allowed to override the tank-turn hold, and `pointer.aimWorld` gets a short body-facing override so the first manual aim update does not read the stale camera ray.
- Browser verification: after holding A with body yaw about `1.62` radians while camera yaw stayed `0`, pressing secondary aim immediately set aim yaw equal to body yaw and enabled body-facing camera recenter. In a non-safe position, the first sustained aim frame kept `bracedFireDirection` equal to body yaw and selected `pistolIdle` instead of snapping the pose back toward the stale camera ray.

## Follow-up Implementation Pass: Sword Arm Slash Clip

- Added `Stable Sword Inward Slash.fbx` as the authored `swordInwardSlash` clip for sword-arm/beam-blade attacks.
- `attacking + beamBlade` now selects `swordInwardSlash` directly instead of falling through to generic locomotion while the old procedural beam-blade timing still drives the hit window and blade visual.
- The slash clip time is keyed to gameplay `attackProgress`, so the authored pose stays aligned with the existing sword-arm active frames even if the FBX duration differs from the attack duration.

## Follow-up Implementation Pass: Standing Dive Dodge Roll

- Added `Standing Dive Forward.fbx` as the authored `dodgeRoll` clip.
- Dodge roll gameplay displacement is still applied to the player root so collision and arena clamping remain authoritative, but the FBX clip time is keyed to gameplay `actionProgress` so the visual dive stays synced to the movement window.
- The dodge direction and yaw are latched when the roll starts. Inputs, camera movement, aiming, or turn systems should not pivot/angle the roll after it begins.
- The current roll distance is `8.4` world units, matching three dungeon floor tiles at the generator's `2.8` tile size.
- The visible model root gets a small action-progress air-lift arc during `dodgeRoll`, while the gameplay/collision root remains grounded. This makes the move read as a forward dive through the air before the authored floor recovery settles back to neutral.
