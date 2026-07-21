import test from 'node:test';
import {
  assertAcceptanceFailure,
  assertTopologyAndConnectorRules,
} from '../helpers/accepted-fixture.mjs';

function topologyPlan() {
  const districtIds = ['factory', 'waterworks', 'undercroft'];
  const regions = Array.from({ length: 17 }, (_, index) => ({
    id: `region-${index}`,
    districtId: districtIds[Math.min(2, Math.floor(index / 6))],
    topologySignature: `d4-signature-${index}`,
  }));
  const forms = ['arched-bulkhead', 'stair-gallery', 'pipe-tunnel', 'ladder-shaft'];
  const portals = Array.from({ length: 17 }, (_, index) => {
    const next = (index + 1) % regions.length;
    const y = index % 2 === 0 ? 0 : 4;
    return {
      id: `portal-${index}`,
      from: { regionId: regions[index].id, center: { x: index, y, z: 0 } },
      to: { regionId: regions[next].id, center: { x: index + 1, y: y + (index % 3 === 0 ? 4 : 0), z: 0 } },
      connectorForm: forms[index % forms.length],
      placementBucket: index % 2 === 0 ? 'left-low' : 'right-high',
    };
  });
  return {
    acceptanceProfile: 'golden',
    districts: districtIds.map((id) => ({ id })),
    regions,
    modulePlacements: regions.map((region, index) => ({ id: `placement-${index}`, descriptorId: `descriptor-${index}`, revision: 1 })),
    portals,
    connectionOrder: portals.map((portal) => portal.id),
    keycardZones: [
      { id: 'alpha', regionIds: regions.slice(0, 5).map((region) => region.id) },
      { id: 'beta', regionIds: regions.slice(5, 11).map((region) => region.id) },
      { id: 'gamma', regionIds: regions.slice(11).map((region) => region.id) },
    ],
  };
}

test('golden topology contract accepts unique rooms and varied ordered connectors', () => {
  assertTopologyAndConnectorRules(topologyPlan(), 'golden');
});

const topologyFailures = [
  ['topology-signature-reused', (plan) => { plan.regions[1].topologySignature = plan.regions[0].topologySignature; }],
  ['module-descriptor-reused', (plan) => { plan.modulePlacements[1].descriptorId = plan.modulePlacements[0].descriptorId; }],
  ['scope-exit-elevation-flat', (plan) => {
    for (const portal of plan.portals) {
      if (Number(portal.from.regionId.slice(7)) < 6) portal.from.center.y = 0;
      if (Number(portal.to.regionId.slice(7)) < 6) portal.to.center.y = 0;
    }
  }],
  ['scope-exit-placement-uniform', (plan) => {
    for (const portal of plan.portals) {
      if (Number(portal.from.regionId.slice(7)) < 6 || Number(portal.to.regionId.slice(7)) < 6) portal.placementBucket = 'center';
    }
  }],
  ['scope-connector-form-uniform', (plan) => {
    for (const portal of plan.portals) {
      if (Number(portal.from.regionId.slice(7)) < 6 || Number(portal.to.regionId.slice(7)) < 6) portal.connectorForm = 'arched-bulkhead';
    }
  }],
  ['connector-form-consecutive', (plan) => { plan.portals[1].connectorForm = plan.portals[0].connectorForm; }],
  ['connector-form-excessive', (plan) => {
    for (let index = 0; index < plan.portals.length; index += 2) plan.portals[index].connectorForm = 'arched-bulkhead';
  }],
];

for (const [code, mutate] of topologyFailures) {
  test(`golden topology rejects ${code}`, () => {
    const plan = topologyPlan();
    mutate(plan);
    assertAcceptanceFailure(code, () => assertTopologyAndConnectorRules(plan, 'golden'));
  });
}

