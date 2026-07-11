/**
 * Shared movement envelope used by player physics and procedural validation.
 * Keep generator tolerances derived from this profile so a route accepted by
 * the dungeon solver remains executable by the runtime controller.
 */
export const PLAYER_TRAVERSAL_CAPABILITIES = Object.freeze({
  collisionRadius: 0.42,
  standingHeight: 2.85,
  headClearance: 3.15,
  groundedStepDownHeight: 0.24,
  jumpHeight: 1.65,
  jumpTimeToApex: 0.33,
  fallGravityMultiplier: 1.22,
  forwardJumpSpeed: 4.35,
  ledgeGrabHeightRatio: 2.16,
  normalJumpReachRatio: 0.98,
  safeDropHeight: 6,
  maximumRampRisePerTile: 0.55,
  minimumLandingWidth: 1.2,
  minimumCatwalkWidth: 1.35,
});

export function getTraversalEnvelope(profile = PLAYER_TRAVERSAL_CAPABILITIES) {
  const riseTime = profile.jumpTimeToApex;
  const fallTime = riseTime / Math.sqrt(profile.fallGravityMultiplier);
  const airTime = riseTime + fallTime;

  return Object.freeze({
    ...profile,
    airTime,
    maximumHorizontalJumpDistance: profile.forwardJumpSpeed * airTime,
    maximumNormalJumpRise: profile.jumpHeight * profile.normalJumpReachRatio,
    maximumLedgeClimbRise: profile.jumpHeight * profile.ledgeGrabHeightRatio,
  });
}

export const PLAYER_TRAVERSAL_ENVELOPE = getTraversalEnvelope();
