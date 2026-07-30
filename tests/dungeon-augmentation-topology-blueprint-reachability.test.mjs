import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUNGEON_AUGMENTATION_PROFILES,
  GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
  resolveRouteNetworkGrammarAssignments,
} from '../src/dungeon-augmentation/index.js';

const profile = DUNGEON_AUGMENTATION_PROFILES['industrial-supplement-preview-v4'];

function resolveTopology(topologyTemplateId, {
  routeNetworkKind = 'objective-route-coverage',
  junctionKinds = ['through-t', 'crossroads', 'through-t'],
  contentRoles = ['junction', 'challenge', 'connector'],
  moduleKinds = ['connector-module', 'room', 'connector-module'],
  junctionModuleIndex = 0,
} = {}) {
  return resolveRouteNetworkGrammarAssignments({
    profile,
    grammars: GENERIC_DUNGEON_SUPPLEMENT_GRAMMARS,
    routeNetworkKind,
    topologyTemplateId,
    junctionKinds,
    contentRoles,
    moduleKinds,
    junctionModuleIndex,
    operationOrdinal: 0,
    searchVariant: 0,
    elevationMode: 'split-level-platform',
  });
}

test('fork-merge topology selects the authored paired-T H loop through the planner assignment path', () => {
  const assignment = resolveTopology('fork-merge-h-loop');

  assert.equal(assignment.topologyKitDeferred, false);
  assert.equal(assignment.topologyKitModuleIndex, 1);
  assert.equal(
    assignment.selectedGrammars[1].blueprintId,
    'ind-loop-paired-t-h-01',
  );
  assert.equal(assignment.junctionKinds[1], 'fork-merge');
  assert.deepEqual(
    assignment.selectedGrammars[1].selectionConstraints.routeNetworkSpineSocketIds,
    ['entry', 'exit'],
  );
});

test('stacked-interchange topology replaces the qualifying junction with its authored four-socket kit', () => {
  const assignment = resolveTopology('stacked-interchange');

  assert.equal(assignment.topologyKitDeferred, false);
  assert.equal(assignment.topologyKitModuleIndex, 0);
  assert.equal(
    assignment.selectedGrammars[0].blueprintId,
    'ind-interchange-stacked-01',
  );
  assert.equal(assignment.junctionKinds[0], 'stacked-interchange');
  assert.deepEqual(
    assignment.selectedGrammars[0].selectionConstraints.routeNetworkTopologySocketIds,
    ['left', 'right'],
  );
});

test('over-under topology uses a separate infrastructure slot and preserves a promotable junction', () => {
  const assignment = resolveTopology('over-under-loop');

  assert.equal(assignment.topologyKitDeferred, false);
  assert.equal(assignment.topologyKitModuleIndex, 2);
  assert.equal(
    assignment.selectedGrammars[2].blueprintId,
    'ind-crossover-over-under-01',
  );
  assert.equal(assignment.junctionKinds[2], 'over-under-crossover');
  assert.equal(
    assignment.selectedGrammars[2].selectionConstraints.supportsJunctionPromotion,
    false,
  );
  assert.equal(
    assignment.selectedGrammars[0].blueprintId,
    'ind-junction-through-t-01',
    'the crossover must not consume the qualifying physical junction',
  );
  assert.equal(
    assignment.selectedGrammars[0].selectionConstraints.supportsJunctionPromotion,
    true,
  );
});

test('topology kit selection defers when a grant has no legal dedicated slot', () => {
  const crossover = resolveTopology('over-under-loop', {
    moduleKinds: ['connector-module', 'room', 'room'],
    contentRoles: ['junction', 'challenge', 'reward'],
    junctionKinds: ['through-t', 'crossroads', 'staggered-cross'],
  });
  assert.equal(crossover.topologyKitDeferred, true);
  assert.equal(crossover.topologyKitModuleIndex, null);
  assert.equal(crossover.selectedGrammars[0].blueprintId, 'ind-junction-through-t-01');

  const pyramid = resolveTopology('fork-merge-h-loop', {
    routeNetworkKind: 'landmark-perimeter-loop',
    moduleKinds: ['connector-module', 'room', 'room'],
    contentRoles: ['junction', 'challenge', 'reward'],
    junctionKinds: ['through-t', 'crossroads', 'staggered-cross'],
  });
  assert.equal(pyramid.topologyKitDeferred, true);
  assert.equal(pyramid.topologyKitModuleIndex, null);
  assert.notEqual(pyramid.selectedGrammars[1].blueprintId, 'ind-loop-paired-t-h-01');
});
