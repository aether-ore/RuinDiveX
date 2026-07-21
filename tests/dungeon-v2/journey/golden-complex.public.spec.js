import { test, expect } from '@playwright/test';
import {
  PUBLIC_INPUT_JOURNEY,
  defeatEncounterPublicly,
  getPublicActionApproachPoints,
  holdPublicInput,
  operateActionPublicly,
  readV2Diagnostics,
  resolvePublicGateApproachLink,
  rideAutomaticSurfacePublicly,
  steerToWorldPointPublicly,
  steerThroughPortalPublicly,
  traverseAuthoredFallPublicly,
  traverseAuthoredLinkPublicly,
  waitForV2Runtime,
} from '../helpers/journey-runtime.mjs';

void PUBLIC_INPUT_JOURNEY;
test.setTimeout(15 * 60_000);

const variants = ['magma', 'electrical'];
const nativeV1SourceRoomByDescriptorId = new Map(Object.entries({
  'v1-room.security-entrance': 'entrance',
  'v1-room.enemy-nest': 'enemyNest',
  'v1-room.credential-pyramid': 'keycardRoom',
  'v1-room.server-crypt': 'alienServerRoom',
  'v1-room.machine-factory': 'machineFactoryRoom',
  'v1-room.conveyor-gantry': 'conveyorRoom',
  'v1-room.parts-vault': 'bonusVault',
  'v1-room.machine-core': 'bossRoom',
  'v1-room.refractor-shrine': 'shrineRoom',
  'v1-room.coolant-relay': 'coolantRelayRoom',
  'v1-room.hazard-processing': 'trapRoom',
}));
const expectedNativeV1DescriptorIds = [...nativeV1SourceRoomByDescriptorId.keys()].sort();
const expectedNativeV1SourceRoomIds = [
  'entrance',
  'enemyNest',
  'keycardRoom',
  'alienServerRoom',
  'machineFactoryRoom',
  'conveyorRoom',
  'bonusVault',
  'bossRoom',
  'shrineRoom',
  'coolantRelayRoom',
  'trapRoom',
].sort();
const expectedRoomPackRoomIdsByVariant = Object.freeze({
  magma: Object.freeze([
    'rdx_factory_corkscrew_exchange',
    'rdx_waterworks_freight_sump',
    'rdx_magma_foundry_undercroft',
  ].sort()),
  electrical: Object.freeze([
    'rdx_factory_corkscrew_exchange',
    'rdx_waterworks_freight_sump',
    'rdx_electric_transformer_undercroft',
  ].sort()),
});
const expectedRegionIds = [
  'security', 'assembly', 'server', 'freight', 'sorting', 'credential', 'parts',
  'nest', 'corkscrew', 'machine-core', 'extraction', 'freight-sump', 'reservoir',
  'gantry-sump', 'salvage-tunnel', 'hazard-intake', 'hazard-core',
].sort();
const expectedPortalEndpoints = Object.freeze({
  'portal.security-assembly': Object.freeze(['security', 'assembly']),
  'portal.assembly-server': Object.freeze(['assembly', 'server']),
  'portal.server-freight': Object.freeze(['server', 'freight']),
  'portal.freight-security-shortcut': Object.freeze(['freight', 'security']),
  'portal.security-sorting-alpha': Object.freeze(['security', 'sorting']),
  'portal.sorting-freight-sump': Object.freeze(['sorting', 'freight-sump']),
  'portal.freight-sump-reservoir': Object.freeze(['freight-sump', 'reservoir']),
  'portal.reservoir-gantry-sump': Object.freeze(['reservoir', 'gantry-sump']),
  'portal.gantry-sump-salvage': Object.freeze(['gantry-sump', 'salvage-tunnel']),
  'portal.salvage-sorting-shortcut': Object.freeze(['salvage-tunnel', 'sorting']),
  'portal.sorting-credential-beta': Object.freeze(['sorting', 'credential']),
  'portal.credential-parts': Object.freeze(['credential', 'parts']),
  'portal.parts-corkscrew-service': Object.freeze(['parts', 'corkscrew']),
  'portal.parts-nest': Object.freeze(['parts', 'nest']),
  'portal.corkscrew-credential-loop': Object.freeze(['corkscrew', 'credential']),
  'portal.corkscrew-hazard-intake': Object.freeze(['corkscrew', 'hazard-intake']),
  'portal.hazard-intake-core': Object.freeze(['hazard-intake', 'hazard-core']),
  'portal.hazard-core-credential-return': Object.freeze(['hazard-core', 'credential']),
  'portal.corkscrew-machine-core-gamma': Object.freeze(['corkscrew', 'machine-core']),
  'portal.machine-core-extraction-shrine': Object.freeze(['machine-core', 'extraction']),
  'portal.assembly-freight-drop': Object.freeze(['assembly', 'freight']),
});
const expectedEncounterIds = [
  'encounter.assembly', 'encounter.sorting', 'encounter.nest', 'encounter.machine-core',
];
const expectedRewardIds = [
  'reward.key-seeker', 'reward.keycard-alpha', 'reward.keycard-beta',
  'reward.keycard-gamma', 'reward.cache.alpha', 'reward.cache.water',
  'reward.cache.nest', 'reward.cache.undercroft', 'reward.shrine-key',
  'reward.large-refractor',
];
const expectedObjectiveIds = [
  'objective.alpha-expedition',
  'objective.waterworks-expedition',
  'objective.undercroft-expedition',
  'objective.final-elite',
  'objective.large-refractor',
  'objective.extraction',
  'objective.discovery.flooded',
  'objective.discovery.drained',
];
const expectedPublicActionIds = [
  'action.activate.key-seeker',
  'action.pickup.keycard-alpha',
  'action.open.cache-alpha',
  'action.open.shortcut-alpha',
  'action.open.door-alpha',
  'action.water.reservoir',
  'action.water.gantry-sump',
  'action.water.freight-sump',
  'action.discover.flooded',
  'action.open.cache-water',
  'action.discover.drained',
  'action.pickup.keycard-beta',
  'action.open.shortcut-beta',
  'action.cargo-lift.recall-lower',
  'action.cargo-lift.recall-upper',
  'action.open.door-beta',
  'action.open.cache-nest',
  'action.gear.align-low',
  'action.gear.align-bridge',
  'action.gear.align-high',
  'action.open.cache-undercroft',
  'action.pickup.keycard-gamma',
  'action.open.credential-loop',
  'action.gamma-lift.recall-lower',
  'action.open.shortcut-gamma',
  'action.gamma-lift.recall-upper',
  'action.open.door-gamma',
  'action.collect.shrine-key',
  'action.open.door-shrine',
  'action.collect.large-refractor',
  'action.extract',
];

function expectExactIds(actual, expected) {
  expect([...new Set(actual)].sort()).toEqual([...expected].sort());
}

function expectLiveNativeV1Assembly(diagnostics) {
  const native = diagnostics.nativeFixedRoomAssembly;
  expect(native, 'Runtime diagnostics omitted the live native-room assembly preflight.').toBeTruthy();
  expect(native.requiredPlacementCount).toBe(11);
  expect(native.activePlacementCount).toBe(11);
  expect(native.incompleteDescriptorCount).toBe(0);
  expect(native.allRequiredPlacementsActive).toBe(true);
  expect(native.presentationActive).toBe(true);
  expect(native.presentationPlacementCount).toBe(11);
  expect(native.genericFallbackGeometry).toBe(false);
  expect(new Set(native.activePlacementIds).size).toBe(11);
  expect([...native.activeDescriptorIds].sort()).toEqual(expectedNativeV1DescriptorIds);
  expect(native.activeDescriptorIds.map((descriptorId) => (
    nativeV1SourceRoomByDescriptorId.get(descriptorId)
  )).sort()).toEqual(expectedNativeV1SourceRoomIds);
  expect(native.incompleteDescriptorIds).toEqual([]);
  expect(native.placements).toHaveLength(11);
  expect([...native.placements.map(({ placementId }) => placementId)].sort())
    .toEqual([...native.activePlacementIds].sort());
  expect([...native.placements.map(({ descriptorId }) => descriptorId)].sort())
    .toEqual(expectedNativeV1DescriptorIds);

  for (const placement of native.placements) {
    const room = `${placement.placementId} (${placement.descriptorId})`;
    expect(placement.renderGroupAttached, `${room} render group is detached.`).toBe(true);
    expect(placement.renderGroupVisible, `${room} render group is hidden.`).toBe(true);
    expect(placement.renderedObjectCount, `${room} has no attached rendered object.`).toBeGreaterThan(0);
    expect(placement.visibleRenderedObjectCount, `${room} has no visible rendered object.`).toBeGreaterThan(0);
    expect(placement.visualMappingCount, `${room} has no plan-to-render mappings.`).toBeGreaterThan(0);
    expect(placement.registeredMappedVisualCount, `${room} has no registered visual.`).toBeGreaterThan(0);
    expect(placement.attachedMappedVisualCount, `${room} has detached registered visuals.`)
      .toBe(placement.registeredMappedVisualCount);
    expect(placement.visibleMappedVisualCount, `${room} has hidden registered visuals.`)
      .toBe(placement.registeredMappedVisualCount);
    expect(placement.planSurfaceCount, `${room} has no accepted walkable surface.`).toBeGreaterThan(0);
    expect(placement.registeredSurfaceCount, `${room} lacks registered surface collision.`)
      .toBe(placement.planSurfaceCount);
    expect(placement.registeredColliderCount, `${room} has no registered collision.`).toBeGreaterThan(0);
  }
}

function expectLiveSemanticRoomPackAssembly(diagnostics, undercroftType) {
  const pack = diagnostics.semanticRoomPackPresentation;
  expect(pack,
    'Runtime diagnostics omitted the live three-macro room-pack presentation preflight.')
    .toBeTruthy();
  expect(pack.accepted).toBe(true);
  expect(pack.active).toBe(true);
  expect(pack.placementCount).toBe(3);
  expect(pack.placements).toHaveLength(3);
  expect(pack.genericFallbackGeometry).toBe(false);
  expect(pack.collisionDerivedFromMeshBounds).toBe(false);
  expect(pack.collisionAuthority).toBe('accepted-plan-semantic-room-pack-records');
  expect(new Set(pack.placements.map(({ placementId }) => placementId)).size).toBe(3);
  expect(pack.placements.map(({ roomId }) => roomId).sort())
    .toEqual(expectedRoomPackRoomIdsByVariant[undercroftType]);
  for (const placement of pack.placements) {
    const label = `${placement.placementId} (${placement.roomId})`;
    expect(placement.mappedPhysicalRecordCount,
      `${label} has no real authored physical mapping.`).toBeGreaterThan(0);
    expect(placement.boundaryCount, `${label} has no mapped enclosure.`).toBeGreaterThan(0);
    expect(placement.surfaceCount, `${label} has no mapped walkable surface.`).toBeGreaterThan(0);
    expect(placement.fixtureCount, `${label} has no mapped authored fixture.`).toBeGreaterThan(0);
  }
}

function expectGoldenSemanticPortalGraph(diagnostics) {
  const portals = diagnostics.navigation?.portals ?? [];
  expectExactIds(portals.map(({ id }) => id), Object.keys(expectedPortalEndpoints));
  for (const portal of portals) {
    expect([portal.from.regionId, portal.to.regionId],
      `${portal.id} was physically rebound to the wrong semantic regions.`)
      .toEqual(expectedPortalEndpoints[portal.id]);
  }
}

function expectPlayerOnAuthoredActivationSide(action, diagnostics) {
  const activationSide = action.activationSide;
  expect(activationSide, `${action.actionId} omitted its activation-side contract.`).toBeTruthy();
  expect(activationSide, `${action.actionId} cannot be a system-only gate action.`).not.toBe('system');
  if (activationSide === 'either' || activationSide === 'any') return;
  const facing = typeof activationSide === 'object' && activationSide !== null
    ? activationSide
    : action.forward;
  expect(facing, `${action.actionId} has no authored activation facing.`).toBeTruthy();
  const forwardLength = Math.hypot(Number(facing.x) || 0, Number(facing.z) || 0);
  const approachX = diagnostics.playerPosition.x - action.position.x;
  const approachZ = diagnostics.playerPosition.z - action.position.z;
  const approachLength = Math.hypot(approachX, approachZ);
  expect(forwardLength, `${action.actionId} has a zero-length activation facing.`)
    .toBeGreaterThan(0.05);
  expect(approachLength, `${action.actionId} has an ambiguous activation approach.`)
    .toBeGreaterThan(0.05);
  const dot = (
    (facing.x / forwardLength) * (approachX / approachLength)
    + (facing.z / forwardLength) * (approachZ / approachLength)
  );
  if (activationSide === 'back') {
    expect(dot, `${action.actionId} was approached from the wrong physical side.`)
      .toBeLessThanOrEqual(-0.1);
  } else {
    expect(dot, `${action.actionId} was approached from the wrong physical side.`)
      .toBeGreaterThanOrEqual(0.1);
  }
}

function expectDifficultyOneStarterLoadout(configuration) {
  expect(configuration).toEqual({
    difficulty: 1,
    sandboxActive: false,
    testRangeActive: false,
    activeArmIndex: 0,
    activeArm: {
      id: 'megaBuster',
      kind: 'megaBuster',
      weaponKind: 'projectile',
    },
    arms: {
      ownedArmIds: ['laserBeamBlade', 'liftArm'],
      slots: {
        megaBuster: { kind: 'megaBuster' },
        special1: { kind: 'fixedArm', armId: 'laserBeamBlade' },
        special2: { kind: 'customBuster', buildId: 'build-a' },
        utility: { kind: 'fixedArm', armId: 'liftArm' },
      },
    },
    gear: {
      unlockedGearIds: ['reinforcedArmorFrame'],
      unlockedSlots: ['armor', 'helmet', 'mobility', 'utility1', 'utility2'],
      slots: {
        armor: 'reinforcedArmorFrame',
        helmet: null,
        mobility: null,
        defense: null,
        utility1: null,
        utility2: null,
      },
    },
  });
}

async function selectAndVerifyStarterLoadoutPublicly(page) {
  const before = await readV2Diagnostics(page, 'runtime');
  expectDifficultyOneStarterLoadout(before.expeditionConfiguration);

  // Explicitly select slot 1 through the same public hotbar input used by a
  // player. The post-input snapshot proves that the active weapon is the
  // invariant starter Mega Buster and that selection did not mutate loadout.
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'runtime')
  )?.expeditionConfiguration?.activeArm?.id, {
    message: 'Public Digit1 input did not select the starter Mega Buster',
    timeout: 5_000,
  }).toBe('megaBuster');
  const after = await readV2Diagnostics(page, 'runtime');
  expectDifficultyOneStarterLoadout(after.expeditionConfiguration);
}

async function waitForWaterConfiguration(page, configurationId) {
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'runtime')
  )?.waterConfigurationId, {
    message: `Waterworks never committed ${configurationId}`,
    timeout: 12_000,
  }).toBe(configurationId);
}

async function waitForMechanismState(page, mechanismId, stateId) {
  await expect.poll(async () => (
    await readV2Diagnostics(page, 'runtime')
  )?.mechanisms?.find(({ id }) => id === mechanismId)?.stateId, {
    message: `${mechanismId} never reached ${stateId}`,
    timeout: 12_000,
  }).toBe(stateId);
}

function horizontalDirection(from, to) {
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;
  const length = Math.hypot(deltaX, deltaZ);
  expect(length, 'A gate portal requires a non-zero horizontal route.').toBeGreaterThan(0.05);
  return { x: deltaX / length, z: deltaZ / length };
}

function firstPortalDeparture(portal) {
  const origin = portal.from.center;
  return (portal.routePoints ?? []).find((point) => (
    Math.hypot(point.x - origin.x, point.z - origin.z) > 0.05
  )) ?? portal.to.center;
}

function expectPhysicalGateState(diagnostics, barrierId, { open }) {
  const audit = diagnostics.structuralRegistry;
  expect(audit, `${barrierId} has no assembled structural audit.`).toBeTruthy();
  const visualEntries = audit.visualEntries.filter(({ planId }) => planId === barrierId);
  const colliderEntries = audit.colliderEntries.filter(({ planId }) => planId === barrierId);
  expect(visualEntries.length, `${barrierId} has no registered physical visual.`).toBeGreaterThan(0);
  expect(colliderEntries.length, `${barrierId} has no registered physical collider.`).toBeGreaterThan(0);
  expect(visualEntries.every(({ visible, bounds }) => visible === true && Boolean(bounds))).toBe(true);
  expect(colliderEntries.every(({ bounds }) => Boolean(bounds))).toBe(true);
  expect(colliderEntries.every(({ active }) => active === !open),
    `${barrierId} collider state did not match ${open ? 'open' : 'closed'}.`).toBe(true);
  return Object.freeze({
    visualIds: Object.freeze(visualEntries.map(({ visualId }) => visualId).sort()),
    colliderIds: Object.freeze(colliderEntries.map(({ colliderId }) => colliderId).sort()),
  });
}

function expectVisibleKeycardPickup(diagnostics, {
  action,
  actionId,
  rewardId,
  regionId,
  keycardId,
  requirePhysicalApproach = false,
}) {
  const pickup = diagnostics.keycardPickups?.find((entry) => entry.rewardId === rewardId);
  expect(pickup, `${rewardId} has no physical keycard pickup in the actual seeded runtime.`)
    .toBeTruthy();
  expect(pickup).toMatchObject({
    keycardId,
    actionId,
    regionId,
    collected: false,
    renderAttached: true,
    renderVisible: true,
    pedestalAttached: true,
  });
  expect(diagnostics.ownedKeycardIds).not.toContain(keycardId);
  expect(pickup.visualPosition.y).toBeGreaterThan(pickup.pedestalTopY);
  expect(Math.abs(pickup.visualPosition.y - pickup.visualRestY)).toBeLessThanOrEqual(0.081);

  if (requirePhysicalApproach) {
    expect(diagnostics.currentPrompt?.actionId,
      `${actionId} was not the public interaction in front of the player.`).toBe(actionId);
    const horizontalDistance = Math.hypot(
      diagnostics.playerPosition.x - action.position.x,
      diagnostics.playerPosition.z - action.position.z,
    );
    expect(horizontalDistance,
      `${actionId} pickup was attempted without physically reaching its pedestal.`)
      .toBeLessThanOrEqual(action.radius + 0.08);
    expect(Math.abs(diagnostics.playerPosition.y - action.position.y),
      `${actionId} pickup was attempted from the wrong elevation.`).toBeLessThanOrEqual(0.9);
    const visualDistanceFromCamera = Math.hypot(
      pickup.visualPosition.x - diagnostics.cameraPosition.x,
      pickup.visualPosition.y - diagnostics.cameraPosition.y,
      pickup.visualPosition.z - diagnostics.cameraPosition.z,
    );
    expect(visualDistanceFromCamera,
      `${rewardId} was not inside the real 120m journey-camera range before pickup.`)
      .toBeLessThan(120);
    const toCardX = pickup.visualPosition.x - diagnostics.playerPosition.x;
    const toCardZ = pickup.visualPosition.z - diagnostics.playerPosition.z;
    const toCardLength = Math.hypot(toCardX, toCardZ);
    const facingDot = toCardLength > 0.001
      ? (toCardX * diagnostics.playerFacing.x + toCardZ * diagnostics.playerFacing.z) / toCardLength
      : 1;
    expect(facingDot, `${rewardId} was rendered behind the player at its public pickup prompt.`)
      .toBeGreaterThan(0.5);
  }
  return pickup;
}

/**
 * Challenges a still-locked progression barrier with the same forward and
 * jump input a player would use to climb or vault it. Read-only diagnostics
 * prove that no region transition, portal traversal, action, safeguard, or
 * ledge animation occurred. The helper first walks the authored approach and
 * returns through it afterward; it never places the player at the gate.
 */
async function expectClosedGateRejectsPublicBypass(page, {
  portalId,
  actionId,
  keyRewardId,
  sourceRegionId,
  targetRegionId,
}) {
  const before = await readV2Diagnostics(page, 'full');
  const portal = before.navigation?.portals?.find(({ id }) => id === portalId);
  const action = before.navigation?.actionAnchors?.find((entry) => entry.actionId === actionId);
  expect(portal, `${portalId} is absent from the actual seeded runtime.`).toBeTruthy();
  expect(action, `${actionId} is absent from the actual seeded runtime.`).toBeTruthy();
  expect(portal.from.regionId).toBe(sourceRegionId);
  expect(portal.to.regionId).toBe(targetRegionId);
  expect(action.regionId).toBe(sourceRegionId);
  expect(portal.barrierId).toBeTruthy();
  expect(before.currentRegionId).toBe(sourceRegionId);
  expect(before.collectedRewardIds).not.toContain(keyRewardId);
  expect(before.operatedActionIds).not.toContain(actionId);
  expect(before.traversedPortalIds).not.toContain(portalId);
  const closedPhysicalGate = expectPhysicalGateState(before, portal.barrierId, { open: false });
  const approach = resolvePublicGateApproachLink(
    before.navigation,
    portal,
    sourceRegionId,
  );
  expect(approach,
    `${portalId} has no unique plan-owned room-side approach to its closed barrier.`)
    .toBeTruthy();

  await traverseAuthoredLinkPublicly(page, approach.linkId, {
    direction: approach.direction,
    timeout: 35_000,
    // The authored gate stairs overlap their room floor across a wide seam.
    // Requiring the capsule centre to hit the mathematical path centre within
    // 0.42m can orbit at the edge despite already standing on that overlap.
    // This remains well inside the 4.8m usable stair width and does not relax
    // the separate 0.05m closed-barrier-plane assertion below.
    horizontalTolerance: 1.3,
    verticalTolerance: 0.45,
    forbidJump: true,
    forbidLedgeClimb: true,
  });

  const groundY = portal.from.groundY ?? portal.from.center.y;
  const origin = { ...portal.from.center, y: groundY };
  const direction = horizontalDirection(origin, firstPortalDeparture(portal));
  const blockedTarget = {
    x: origin.x + direction.x * 2.4,
    y: groundY,
    z: origin.z + direction.z * 2.4,
  };
  const staged = await readV2Diagnostics(page, 'movement');
  const stagedPosition = staged.playerPosition;
  const stagedGateProgress = (
    (stagedPosition.x - origin.x) * direction.x
    + (stagedPosition.z - origin.z) * direction.z
  );
  const stagedLateralOffset = Math.abs(
    (stagedPosition.x - origin.x) * -direction.z
    + (stagedPosition.z - origin.z) * direction.x
  );
  const usableHalfWidth = portal.from.dimensions.width * 0.5 - 0.45;
  expect(staged.currentRegionId).toBe(sourceRegionId);
  expect(stagedGateProgress,
    `${portalId} approach did not finish on the source side of its barrier.`)
    .toBeLessThanOrEqual(-0.35);
  expect(stagedGateProgress,
    `${portalId} approach stopped too far away to constitute a physical gate challenge.`)
    .toBeGreaterThanOrEqual(-4);
  expect(stagedLateralOffset,
    `${portalId} approach finished outside the player-sized portal aperture.`)
    .toBeLessThanOrEqual(usableHalfWidth);
  expect(Math.abs(stagedPosition.y - groundY),
    `${portalId} approach did not finish on its authored source landing.`)
    .toBeLessThanOrEqual(0.45);

  // First apply ordinary forward pressure so the following jump attempts are
  // aligned squarely with the real closed barrier. Reaching the target here is
  // itself an acceptance failure, but retain the explicit state assertions
  // below so a metadata-only region transition cannot masquerade as blocking.
  let ordinaryWalkCrossed = false;
  try {
    await steerToWorldPointPublicly(page, blockedTarget, {
      horizontalTolerance: 0.42,
      verticalTolerance: 0.3,
      timeout: 2_200,
      forbidJump: true,
      forbidLedgeClimb: true,
    });
    ordinaryWalkCrossed = true;
  } catch (error) {
    expect(String(error?.message ?? error)).toContain('timed out');
  }
  expect(ordinaryWalkCrossed, `${portalId} was walkable while its gate was closed.`).toBe(false);

  let sawLedgeTraversal = false;
  const observedRegions = new Set();
  await page.keyboard.down('KeyW');
  try {
    for (let sample = 0; sample < 24; sample += 1) {
      if (sample % 8 === 0) await page.keyboard.press('Space');
      await page.waitForTimeout(100);
      const diagnostics = await readV2Diagnostics(page, 'movement');
      if (diagnostics.currentRegionId) observedRegions.add(diagnostics.currentRegionId);
      sawLedgeTraversal ||= Boolean(
        diagnostics.ledgeCling
        || String(diagnostics.animationState ?? '').toLowerCase().includes('ledge'),
      );
    }
  } finally {
    await page.keyboard.up('KeyW');
  }

  await expect.poll(async () => (
    await readV2Diagnostics(page, 'movement')
  )?.jumpState, {
    message: `${portalId} did not return to grounded state after its closed-gate jump challenge`,
    timeout: 5_000,
  }).toBe('Grounded');

  const after = await readV2Diagnostics(page, 'full');
  const signedGateProgress = (
    (after.playerPosition.x - origin.x) * direction.x
    + (after.playerPosition.z - origin.z) * direction.z
  );
  expect(after.currentRegionId).toBe(sourceRegionId);
  expect([...observedRegions]).not.toContain(targetRegionId);
  expect(after.traversedPortalIds).not.toContain(portalId);
  expect(after.operatedActionIds).not.toContain(actionId);
  expect(after.collectedRewardIds).not.toContain(keyRewardId);
  expect(after.safeguardActivations).toBe(before.safeguardActivations);
  expect(sawLedgeTraversal, `${portalId} exposed a ledge climb on its closed barrier.`).toBe(false);
  expect(signedGateProgress, `${portalId} allowed the player centre beyond its closed barrier plane.`)
    .toBeLessThanOrEqual(0.05);
  expect(expectPhysicalGateState(after, portal.barrierId, { open: false }))
    .toEqual(closedPhysicalGate);

  await traverseAuthoredLinkPublicly(page, approach.linkId, {
    direction: approach.direction === 'reverse' ? 'forward' : 'reverse',
    timeout: 35_000,
    horizontalTolerance: 1.3,
    verticalTolerance: 0.45,
    forbidJump: true,
    forbidLedgeClimb: true,
  });
  expect((await readV2Diagnostics(page, 'movement')).currentRegionId).toBe(sourceRegionId);
  const returned = await readV2Diagnostics(page, 'full');
  expect(expectPhysicalGateState(returned, portal.barrierId, { open: false }))
    .toEqual(closedPhysicalGate);
  return Object.freeze({
    portalId,
    actionId,
    keyRewardId,
    barrierId: portal.barrierId,
    sourceRegionId,
    targetRegionId,
    approachLinkId: approach.linkId,
    physicalGate: closedPhysicalGate,
  });
}

async function collectCredentialPublicly(page, {
  actionId,
  rewardId,
  regionId,
  keycardId = null,
  priorGateProof = null,
}) {
  const before = await readV2Diagnostics(page, 'full');
  const action = before.navigation?.actionAnchors?.find((entry) => entry.actionId === actionId);
  expect(action, `${actionId} is absent from the actual seeded runtime.`).toBeTruthy();
  expect(action.regionId).toBe(regionId);
  expect(before.currentRegionId).toBe(regionId);
  expect(before.collectedRewardIds).not.toContain(rewardId);
  expect(before.operatedActionIds).not.toContain(actionId);
  if (keycardId) {
    expect(priorGateProof, `${rewardId} requires an earlier physical closed-gate proof.`).toBeTruthy();
  }
  if (priorGateProof) {
    expect(priorGateProof.keyRewardId).toBe(rewardId);
    expect(before.operatedActionIds).not.toContain(priorGateProof.actionId);
    expect(expectPhysicalGateState(before, priorGateProof.barrierId, { open: false }))
      .toEqual(priorGateProof.physicalGate);
  }
  if (keycardId) {
    expectVisibleKeycardPickup(before, {
      action,
      actionId,
      rewardId,
      regionId,
      keycardId,
    });
  }

  let physicallyObservedBeforePickup = false;
  if (keycardId) {
    const { approach, staging } = getPublicActionApproachPoints(action, before.playerPosition);
    // Stop outside the 1.45m walk-over radius first. This proves the V1-style
    // credential is physically rendered from a real journey camera before the
    // same public movement input carries the player to its pedestal.
    await steerToWorldPointPublicly(page, staging, {
      horizontalTolerance: 0.16,
      verticalTolerance: 0.9,
      timeout: 20_000,
      forbidJump: true,
      forbidLedgeClimb: true,
    });
    const observed = await readV2Diagnostics(page, 'full');
    expectVisibleKeycardPickup(observed, {
      action,
      actionId,
      rewardId,
      regionId,
      keycardId,
      requirePhysicalApproach: true,
    });
    if (priorGateProof) {
      expect(expectPhysicalGateState(
        observed,
        priorGateProof.barrierId,
        { open: false },
      )).toEqual(priorGateProof.physicalGate);
    }
    physicallyObservedBeforePickup = true;
    await steerToWorldPointPublicly(page, approach, {
      horizontalTolerance: 0.22,
      verticalTolerance: 0.9,
      timeout: 20_000,
      forbidJump: true,
      forbidLedgeClimb: true,
    });
    await expect.poll(async () => (
      await readV2Diagnostics(page, 'runtime')
    )?.actionOperationCounts?.[actionId] ?? 0, {
      message: `${actionId} did not auto-collect after physically reaching its pedestal`,
      timeout: 5_000,
    }).toBe(1);
  } else {
    await operateActionPublicly(page, actionId);
  }

  const after = await readV2Diagnostics(page, 'full');
  expect(after.currentRegionId).toBe(regionId);
  expect(after.collectedRewardIds).toContain(rewardId);
  expect(after.operatedActionIds).toContain(actionId);
  expect(after.eventLog.some((event) => (
    event.type === 'action-operated' && event.actionId === actionId
  ))).toBe(true);
  if (keycardId) {
    expect(physicallyObservedBeforePickup,
      `${rewardId} was collected without observing it from the physical pedestal approach.`)
      .toBe(true);
    const newlyOwned = after.ownedKeycardIds.filter((id) => (
      !before.ownedKeycardIds.includes(id)
    ));
    expect(newlyOwned).toEqual([keycardId]);
    expect(after.keycardPickups?.find((entry) => entry.rewardId === rewardId)).toMatchObject({
      keycardId,
      actionId,
      collected: true,
      renderAttached: true,
      renderVisible: false,
      pedestalAttached: true,
    });
  }
  if (priorGateProof) {
    expect(expectPhysicalGateState(after, priorGateProof.barrierId, { open: false }))
      .toEqual(priorGateProof.physicalGate);
  }
}

async function openGateFromValidSideAndCrossPublicly(page, {
  actionId,
  portalId,
  barrierId,
  keyRewardId,
  sourceRegionId,
  targetRegionId,
  closedGateProof = null,
  timeout = 35_000,
}) {
  const before = await readV2Diagnostics(page, 'full');
  const portal = before.navigation?.portals?.find(({ id }) => id === portalId);
  const action = before.navigation?.actionAnchors?.find((entry) => entry.actionId === actionId);
  expect(portal, `${portalId} is absent from the actual seeded runtime.`).toBeTruthy();
  expect(action, `${actionId} is absent from the actual seeded runtime.`).toBeTruthy();
  expect(portal.from.regionId).toBe(sourceRegionId);
  expect(portal.to.regionId).toBe(targetRegionId);
  expect(portal.barrierId).toBe(barrierId);
  expect(action.regionId).toBe(sourceRegionId);
  expect(action.activationSide).not.toBe('system');
  expect(before.currentRegionId).toBe(sourceRegionId);
  expect(before.collectedRewardIds).toContain(keyRewardId);
  expect(before.operatedActionIds).not.toContain(actionId);
  expect(before.traversedPortalIds).not.toContain(portalId);
  expect(closedGateProof, `${portalId} requires its earlier physical closed-gate proof.`).toBeTruthy();
  expect(closedGateProof).toMatchObject({
    portalId,
    actionId,
    keyRewardId,
    barrierId,
    sourceRegionId,
    targetRegionId,
  });
  expect(expectPhysicalGateState(before, barrierId, { open: false }))
    .toEqual(closedGateProof.physicalGate);

  await operateActionPublicly(page, actionId, {
    timeout,
    beforeInteract: ({ action: interactionAction, diagnostics }) => {
      expectPlayerOnAuthoredActivationSide(interactionAction, diagnostics);
    },
  });

  const opened = await readV2Diagnostics(page, 'full');
  const operationEvent = [...opened.eventLog].reverse().find((event) => (
    event.type === 'action-operated' && event.actionId === actionId
  ));
  expect(opened.currentRegionId).toBe(sourceRegionId);
  expect(opened.operatedActionIds).toContain(actionId);
  expect(opened.traversedPortalIds).not.toContain(portalId);
  expect(operationEvent).toBeTruthy();
  expect(expectPhysicalGateState(opened, barrierId, { open: true }).colliderIds)
    .toEqual(closedGateProof.physicalGate.colliderIds);

  await steerThroughPortalPublicly(page, portalId, {
    direction: 'forward',
    timeout,
  });

  const crossed = await readV2Diagnostics(page, 'full');
  const traversalEvent = [...crossed.eventLog].reverse().find((event) => (
    event.type === 'portal-traversed' && event.portalId === portalId
  ));
  expect(crossed.currentRegionId).toBe(targetRegionId);
  expect(crossed.traversedPortalIds).toContain(portalId);
  expect(traversalEvent).toMatchObject({
    fromRegionId: sourceRegionId,
    toRegionId: targetRegionId,
  });
  expect(traversalEvent.sequence).toBeGreaterThan(operationEvent.sequence);
  expect(expectPhysicalGateState(crossed, barrierId, { open: true }).colliderIds)
    .toEqual(closedGateProof.physicalGate.colliderIds);
}

async function completeGoldenExpedition(page) {
  // Alpha expedition: explore away from the gate, survive the authored drop,
  // return through the Server Crypt, then unlock the shortcut back to Security.
  await operateActionPublicly(page, 'action.activate.key-seeker');
  const alphaGateProof = await expectClosedGateRejectsPublicBypass(page, {
    portalId: 'portal.security-sorting-alpha',
    actionId: 'action.open.door-alpha',
    keyRewardId: 'reward.keycard-alpha',
    sourceRegionId: 'security',
    targetRegionId: 'sorting',
  });
  await steerThroughPortalPublicly(page, 'portal.security-assembly', { timeout: 30_000 });
  let elevatedAssemblyEnemy = null;
  await expect.poll(async () => {
    const assemblyActivation = await readV2Diagnostics(page, 'runtime');
    elevatedAssemblyEnemy = assemblyActivation.activeEnemies.find((enemy) => (
      enemy.encounterId === 'encounter.assembly'
        && enemy.planOwnedSpawnPointIndex === 1
    )) ?? null;
    return elevatedAssemblyEnemy;
  }, {
    message: 'Actual seeded Assembly encounter did not spawn its plan-owned elevated slot',
    timeout: 5_000,
  }).not.toBeNull();
  expect(elevatedAssemblyEnemy).toMatchObject({
    attackKind: 'flamethrower',
    generationPolicy: {
      id: 'generation-policy.assembly.elevated-route-safe-v1',
      slotIndex: 1,
      verified: true,
      capabilities: {
        attackKind: 'flamethrower',
        maximumReactionTier: 0,
        powerfulKnockback: false,
        externalPlayerControl: false,
        routeEjecting: false,
        verified: true,
      },
    },
  });
  await defeatEncounterPublicly(page, 'encounter.assembly');
  await steerThroughPortalPublicly(page, 'portal.assembly-server', { timeout: 35_000 });
  await operateActionPublicly(page, 'action.open.cache-alpha');
  await collectCredentialPublicly(page, {
    actionId: 'action.pickup.keycard-alpha',
    rewardId: 'reward.keycard-alpha',
    regionId: 'server',
    keycardId: 'Keycard_Alpha',
    priorGateProof: alphaGateProof,
  });
  await steerThroughPortalPublicly(page, 'portal.assembly-server', {
    direction: 'reverse',
    timeout: 35_000,
  });
  await traverseAuthoredFallPublicly(page, 'fall.assembly-freight-drop', {
    timeout: 30_000,
    walkReturnRoute: true,
  });
  await operateActionPublicly(page, 'action.open.shortcut-alpha');
  await steerThroughPortalPublicly(page, 'portal.freight-security-shortcut', { timeout: 35_000 });
  await openGateFromValidSideAndCrossPublicly(page, {
    actionId: 'action.open.door-alpha',
    portalId: 'portal.security-sorting-alpha',
    barrierId: 'Door_Alpha',
    keyRewardId: 'reward.keycard-alpha',
    sourceRegionId: 'security',
    targetRegionId: 'sorting',
    closedGateProof: alphaGateProof,
  });

  // Beta expedition: clear Sorting, visit every conserved-water state, collect
  // the state-specific cache/discoveries, and physically ride the return lift.
  await defeatEncounterPublicly(page, 'encounter.sorting');
  const betaGateProof = await expectClosedGateRejectsPublicBypass(page, {
    portalId: 'portal.sorting-credential-beta',
    actionId: 'action.open.door-beta',
    keyRewardId: 'reward.keycard-beta',
    sourceRegionId: 'sorting',
    targetRegionId: 'credential',
  });
  await steerThroughPortalPublicly(page, 'portal.sorting-freight-sump', { timeout: 35_000 });
  await operateActionPublicly(page, 'action.discover.flooded');
  await steerThroughPortalPublicly(page, 'portal.freight-sump-reservoir', { timeout: 35_000 });
  await operateActionPublicly(page, 'action.water.reservoir');
  await waitForWaterConfiguration(page, 'StoredInReservoir');
  await operateActionPublicly(page, 'action.water.gantry-sump');
  await waitForWaterConfiguration(page, 'GantrySumpFilled');
  await operateActionPublicly(page, 'action.water.freight-sump');
  await waitForWaterConfiguration(page, 'FreightSumpFilled');
  await operateActionPublicly(page, 'action.water.gantry-sump');
  await waitForWaterConfiguration(page, 'GantrySumpFilled');
  await steerThroughPortalPublicly(page, 'portal.reservoir-gantry-sump', { timeout: 40_000 });
  await operateActionPublicly(page, 'action.open.cache-water');
  await steerThroughPortalPublicly(page, 'portal.reservoir-gantry-sump', {
    direction: 'reverse',
    timeout: 40_000,
  });
  await operateActionPublicly(page, 'action.water.reservoir');
  await waitForWaterConfiguration(page, 'StoredInReservoir');
  await steerThroughPortalPublicly(page, 'portal.reservoir-gantry-sump', { timeout: 40_000 });
  await steerThroughPortalPublicly(page, 'portal.gantry-sump-salvage', { timeout: 35_000 });
  await operateActionPublicly(page, 'action.discover.drained');
  await collectCredentialPublicly(page, {
    actionId: 'action.pickup.keycard-beta',
    rewardId: 'reward.keycard-beta',
    regionId: 'salvage-tunnel',
    keycardId: 'Keycard_Beta',
    priorGateProof: betaGateProof,
  });
  await operateActionPublicly(page, 'action.open.shortcut-beta');
  await operateActionPublicly(page, 'action.cargo-lift.recall-lower');
  await steerThroughPortalPublicly(page, 'portal.salvage-sorting-shortcut', { timeout: 45_000 });
  await operateActionPublicly(page, 'action.cargo-lift.recall-upper');
  await rideAutomaticSurfacePublicly(page, {
    mechanismId: 'mechanism.sorting-cargo',
    surfaceId: 'surface.sorting.moving-cargo',
    boardingStateId: 'CycleStart',
    destinationStateId: 'FarLanding',
  });
  await openGateFromValidSideAndCrossPublicly(page, {
    actionId: 'action.open.door-beta',
    portalId: 'portal.sorting-credential-beta',
    barrierId: 'Door_Beta',
    keyRewardId: 'reward.keycard-beta',
    sourceRegionId: 'sorting',
    targetRegionId: 'credential',
    closedGateProof: betaGateProof,
  });

  // Gamma expedition: take both warehouse routes, clear the optional nest,
  // operate every gear state, descend to the undercroft, and open its return.
  await steerThroughPortalPublicly(page, 'portal.credential-parts', { timeout: 35_000 });
  await steerThroughPortalPublicly(page, 'portal.parts-nest', { timeout: 35_000 });
  await defeatEncounterPublicly(page, 'encounter.nest');
  await operateActionPublicly(page, 'action.open.cache-nest');
  await steerThroughPortalPublicly(page, 'portal.parts-nest', {
    direction: 'reverse',
    timeout: 35_000,
  });
  await steerThroughPortalPublicly(page, 'portal.parts-corkscrew-service', { timeout: 45_000 });
  await operateActionPublicly(page, 'action.gear.align-low');
  await waitForMechanismState(page, 'mechanism.corkscrew-gear', 'LowLanding');
  await operateActionPublicly(page, 'action.gear.align-bridge');
  await waitForMechanismState(page, 'mechanism.corkscrew-gear', 'BridgeAligned');
  await operateActionPublicly(page, 'action.gear.align-high');
  await waitForMechanismState(page, 'mechanism.corkscrew-gear', 'HighLanding');
  const gammaGateProof = await expectClosedGateRejectsPublicBypass(page, {
    portalId: 'portal.corkscrew-machine-core-gamma',
    actionId: 'action.open.door-gamma',
    keyRewardId: 'reward.keycard-gamma',
    sourceRegionId: 'corkscrew',
    targetRegionId: 'machine-core',
  });
  await operateActionPublicly(page, 'action.open.credential-loop');
  // The physical Undercroft landing exists only in the low corkscrew state.
  // Returning the mechanism to LowLanding through its public control proves
  // the portal is not merely graph-reachable while its platform is elsewhere.
  await operateActionPublicly(page, 'action.gear.align-low');
  await waitForMechanismState(page, 'mechanism.corkscrew-gear', 'LowLanding');
  await steerThroughPortalPublicly(page, 'portal.corkscrew-hazard-intake', { timeout: 45_000 });
  await steerThroughPortalPublicly(page, 'portal.hazard-intake-core', { timeout: 40_000 });
  await operateActionPublicly(page, 'action.open.cache-undercroft');
  await collectCredentialPublicly(page, {
    actionId: 'action.pickup.keycard-gamma',
    rewardId: 'reward.keycard-gamma',
    regionId: 'hazard-core',
    keycardId: 'Keycard_Gamma',
    priorGateProof: gammaGateProof,
  });
  await operateActionPublicly(page, 'action.open.shortcut-gamma');
  await operateActionPublicly(page, 'action.gamma-lift.recall-lower');
  await steerThroughPortalPublicly(page, 'portal.hazard-core-credential-return', { timeout: 45_000 });
  await operateActionPublicly(page, 'action.gamma-lift.recall-upper');
  await steerThroughPortalPublicly(page, 'portal.corkscrew-credential-loop', {
    direction: 'reverse',
    timeout: 40_000,
  });
  await operateActionPublicly(page, 'action.gear.align-high');
  await waitForMechanismState(page, 'mechanism.corkscrew-gear', 'HighLanding');
  await openGateFromValidSideAndCrossPublicly(page, {
    actionId: 'action.open.door-gamma',
    portalId: 'portal.corkscrew-machine-core-gamma',
    barrierId: 'Door_Gamma',
    keyRewardId: 'reward.keycard-gamma',
    sourceRegionId: 'corkscrew',
    targetRegionId: 'machine-core',
    closedGateProof: gammaGateProof,
  });

  // Finale: the Shrine Key can only be collected after real final-elite combat.
  await defeatEncounterPublicly(page, 'encounter.machine-core', { timeout: 150_000 });
  const shrineGateProof = await expectClosedGateRejectsPublicBypass(page, {
    portalId: 'portal.machine-core-extraction-shrine',
    actionId: 'action.open.door-shrine',
    keyRewardId: 'reward.shrine-key',
    sourceRegionId: 'machine-core',
    targetRegionId: 'extraction',
  });
  await collectCredentialPublicly(page, {
    actionId: 'action.collect.shrine-key',
    rewardId: 'reward.shrine-key',
    regionId: 'machine-core',
    priorGateProof: shrineGateProof,
  });
  await openGateFromValidSideAndCrossPublicly(page, {
    actionId: 'action.open.door-shrine',
    portalId: 'portal.machine-core-extraction-shrine',
    barrierId: 'Door_Shrine',
    keyRewardId: 'reward.shrine-key',
    sourceRegionId: 'machine-core',
    targetRegionId: 'extraction',
    closedGateProof: shrineGateProof,
  });
  await operateActionPublicly(page, 'action.collect.large-refractor');
  await operateActionPublicly(page, 'action.extract');
}

for (const undercroftType of variants) {
  test(`PUBLIC_INPUT_REGRESSION: ${undercroftType} actual seed activates the Key Seeker once`, async ({ page }) => {
    const actionId = 'action.activate.key-seeker';
    await page.goto(`/?dungeonGen=v2&undercroft=${undercroftType}&seed=m1-golden-${undercroftType}`);
    await waitForV2Runtime(page);
    const snapshotStartedAt = Date.now();
    const initial = await readV2Diagnostics(page, 'runtime');
    const runtimeSnapshotMilliseconds = Date.now() - snapshotStartedAt;
    expect(initial.fixtureId).toBe(`golden-${undercroftType}`);
    expect(runtimeSnapshotMilliseconds).toBeLessThan(5_000);
    expect(JSON.stringify(initial).length).toBeLessThan(1_000_000);
    expect(initial).not.toHaveProperty('structuralRegistry');
    expect(initial).not.toHaveProperty('navigation');
    expectLiveNativeV1Assembly(initial);
    expectLiveSemanticRoomPackAssembly(initial, undercroftType);
    expectGoldenSemanticPortalGraph(await readV2Diagnostics(page, 'navigation'));
    expect(initial.actionOperationCounts?.[actionId] ?? 0).toBe(0);
    expect(initial.collectedRewardIds).not.toContain('reward.key-seeker');

    await operateActionPublicly(page, actionId);

    const activated = await readV2Diagnostics(page, 'runtime');
    expect(activated.actionOperationCounts[actionId]).toBe(1);
    expect(activated.operatedActionIds).toContain(actionId);
    expect(activated.collectedRewardIds).toContain('reward.key-seeker');
    expect(activated.currentPrompt?.actionId ?? null).not.toBe(actionId);

    await page.keyboard.press('KeyE');
    await page.waitForTimeout(100);
    expect((await readV2Diagnostics(page, 'runtime')).actionOperationCounts[actionId]).toBe(1);
  });
}

for (const undercroftType of variants) {
  test(`PUBLIC_INPUT_JOURNEY: ${undercroftType} actual seed explores 11 V1 rooms plus 3 macros and extracts`, async ({ page }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`/?dungeonGen=v2&undercroft=${undercroftType}&seed=m1-golden-${undercroftType}`);
    await waitForV2Runtime(page);
    const initial = await readV2Diagnostics(page, 'runtime');
    expect(initial.buildFingerprint).toBe(
      `dungeon-v2/restart-m1/schema-1/golden-complex/${undercroftType}/layout:m1-golden-${undercroftType}`,
    );
    expect(initial.fixtureId).toBe(`golden-${undercroftType}`);
    expectLiveNativeV1Assembly(initial);
    expectLiveSemanticRoomPackAssembly(initial, undercroftType);
    expectGoldenSemanticPortalGraph(await readV2Diagnostics(page, 'navigation'));
    await selectAndVerifyStarterLoadoutPublicly(page);

    await completeGoldenExpedition(page);

    const final = await readV2Diagnostics(page, 'full');
    expect(final.frameHeartbeat).toBeGreaterThan(initial.frameHeartbeat);
    expect(final.errors).toEqual([]);
    expect(final.safeguardActivations).toBe(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);

    expect(final.extracted).toBe(true);
    expectExactIds(final.visitedRegionIds, expectedRegionIds);
    expectExactIds(final.completedEncounterIds, expectedEncounterIds);
    expectExactIds(final.collectedRewardIds, expectedRewardIds);
    expectExactIds(final.completedObjectiveIds, expectedObjectiveIds);
    expect(final.operatedActionIds).toEqual(expect.arrayContaining(expectedPublicActionIds));
    expect(new Set(final.eventLog
      .filter(({ type }) => type.startsWith('mechanism-') || type.startsWith('crumble-'))
      .map(({ mechanismId }) => mechanismId)))
      .toEqual(new Set([
        'mechanism.cargo-lift', 'mechanism.sorting-cargo',
        'mechanism.corkscrew-gear', 'mechanism.freight-crumble',
        'mechanism.gamma-return-lift',
      ]));
    expect(new Set(final.eventLog
      .filter(({ type }) => type === 'water-configuration-committed')
      .map(({ toConfigurationId }) => toConfigurationId)))
      .toEqual(new Set(['FreightSumpFilled', 'StoredInReservoir', 'GantrySumpFilled']));
  });
}
