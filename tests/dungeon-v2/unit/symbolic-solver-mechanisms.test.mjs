import test from 'node:test';
import assert from 'node:assert/strict';
import { solveDungeonPlanV2Symbolically } from '../../../src/dungeon-v2/DungeonPlanV2Solver.js';

function mechanismPlan({ mechanismAction = true, automaticTransition = false } = {}) {
  const actions = [];
  if (mechanismAction) {
    actions.push({
      id: 'action.lift.high',
      type: 'mechanism-control',
      anchorId: 'anchor.lift',
      conditions: [],
      effects: [{
        op: 'setMechanismState',
        mechanismId: 'mechanism.lift',
        stateId: 'High',
      }],
    });
  }
  actions.push({
    id: 'action.extract',
    type: 'extraction',
    anchorId: 'anchor.extraction',
    conditions: [],
    effects: [{ op: 'extract', extractionId: 'extraction.test' }],
  });
  return {
    compatibility: { entranceRoomId: 'start' },
    regions: [{ id: 'start' }],
    portals: [],
    encounters: [],
    rewards: [],
    objectives: [],
    environmentStates: [],
    anchors: [
      { id: 'anchor.lift', regionId: 'start' },
      { id: 'anchor.extraction', regionId: 'start' },
    ],
    actions,
    mechanisms: [{
      id: 'mechanism.lift',
      type: 'cargo-lift',
      regionId: 'start',
      initialStateId: 'Low',
      states: [
        { id: 'Low', stable: true },
        { id: 'High', stable: true },
      ],
      transitions: automaticTransition ? [{
        fromStateId: 'Low',
        toStateId: 'High',
        automatic: true,
      }] : mechanismAction ? [{
        fromStateId: 'Low',
        toStateId: 'High',
        actionId: 'action.lift.high',
      }] : [],
    }],
  };
}

test('symbolic acceptance visits every stable mechanism state before extraction', () => {
  const result = solveDungeonPlanV2Symbolically(mechanismPlan());
  assert.equal(result.solvable, true);
  assert.ok(result.mechanismCoverage.trace.some(({ type, id, actionId }) => (
    type === 'mechanism-action-coverage'
    && id === 'mechanism.lift'
    && actionId === 'action.lift.high'
  )));
  assert.equal(result.trace.at(-1)?.id, 'action.extract');
});

test('symbolic acceptance rejects an unobservable stable mechanism state', () => {
  const result = solveDungeonPlanV2Symbolically(mechanismPlan({
    mechanismAction: false,
    automaticTransition: false,
  }));
  assert.equal(result.solvable, false);
  assert.equal(result.exhaustedBudget, false);
});

test('symbolic acceptance explores authored automatic mechanism transitions', () => {
  const result = solveDungeonPlanV2Symbolically(mechanismPlan({
    mechanismAction: false,
    automaticTransition: true,
  }));
  assert.equal(result.solvable, true);
  assert.ok(result.mechanismCoverage.trace.some(({ type, id, toStateId }) => (
    type === 'mechanism-transition'
    && id === 'mechanism.lift'
    && toStateId === 'High'
  )));
});
