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
