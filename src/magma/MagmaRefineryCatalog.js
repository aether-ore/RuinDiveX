export const MAGMA_REFINERY_FAMILY_ID = 'magma-refinery-v1';
export const INDUSTRIAL_DUNGEON_FAMILY_ID = 'industrial-v1';

export const MAGMA_CONNECTOR_CATALOG = Object.freeze([
  { id: 'excavation-cage-descent', label: 'Excavation Cage Descent', socketKind: 'vertical', model: 'excavation-cage-descent.glb' },
  { id: 'basalt-bore-gallery', label: 'Basalt Bore Gallery', socketKind: 'level', model: 'basalt-bore-gallery.glb' },
  { id: 'slag-trough-service-walk', label: 'Slag-Trough Service Walk', socketKind: 'level', model: 'slag-trough-service-walk.glb' },
  { id: 'broken-ore-tram-span', label: 'Broken Ore-Tram Span', socketKind: 'level', model: 'broken-ore-tram-span.glb' },
  { id: 'chain-hoist-lift-shaft', label: 'Chain-Hoist Lift Shaft', socketKind: 'vertical', model: 'chain-hoist-lift-shaft.glb' },
  { id: 'furnace-draft-stair', label: 'Furnace Draft Stair', socketKind: 'vertical', model: 'furnace-draft-stair.glb' },
  { id: 'collapsed-conduit-gallery', label: 'Collapsed Conduit Gallery', socketKind: 'level', model: 'collapsed-conduit-gallery.glb' },
]);

const moduleDefinition = (definition) => Object.freeze({
  required: false,
  optional: false,
  dimensions: Object.freeze({ width: 19.6, depth: 19.6, height: 12.6 }),
  socketBayMeters: 2.8,
  lodTriangles: Object.freeze({ lod0: 75000, lod1: 30000, lod2: 8000 }),
  ...definition,
});

export const MAGMA_REFINERY_MODULES = Object.freeze([
  moduleDefinition({ id: 'caldera-excavation-lift', label: 'Caldera Excavation Lift', district: 'entrance', role: 'entrance', model: 'caldera-excavation-lift.glb' }),
  moduleDefinition({ id: 'breached-freight-adit', label: 'Breached Freight Adit', district: 'entrance', role: 'entrance', model: 'breached-freight-adit.glb' }),
  moduleDefinition({ id: 'ore-receiving-chasm', label: 'Ore Receiving Chasm', district: 'upper-excavation', role: 'traversal', optional: true, model: 'ore-receiving-chasm.glb' }),
  moduleDefinition({ id: 'basalt-crusher-gallery', label: 'Basalt Crusher Gallery', district: 'upper-excavation', role: 'puzzle', optional: true, model: 'basalt-crusher-gallery.glb' }),
  moduleDefinition({ id: 'refractor-assay-lab', label: 'Refractor Assay Lab', district: 'upper-excavation', role: 'credential', required: true, model: 'refractor-assay-lab.glb' }),
  moduleDefinition({ id: 'broken-ore-tram-depot', label: 'Broken Ore-Tram Depot', district: 'upper-excavation', role: 'puzzle', optional: true, model: 'broken-ore-tram-depot.glb' }),
  moduleDefinition({ id: 'ember-crown-shrine-concourse', label: 'Ember Crown Shrine Concourse', district: 'shrine-concourse', role: 'hub-and-shrine', required: true, model: 'ember-crown-shrine-concourse.glb' }),
  moduleDefinition({ id: 'slag-separation-basin', label: 'Slag Separation Basin', district: 'slagworks', role: 'puzzle', model: 'slag-separation-basin.glb' }),
  moduleDefinition({ id: 'crucible-pumpworks', label: 'Crucible Pumpworks', district: 'slagworks', role: 'traversal', model: 'crucible-pumpworks.glb' }),
  moduleDefinition({ id: 'magma-siphon-cistern', label: 'Magma Siphon Cistern', district: 'slagworks', role: 'puzzle', model: 'magma-siphon-cistern.glb' }),
  moduleDefinition({ id: 'pressure-regulator-nexus', label: 'Pressure Regulator Nexus', district: 'slagworks', role: 'terminus', required: true, model: 'pressure-regulator-nexus.glb' }),
  moduleDefinition({ id: 'chain-hoist-storehouse', label: 'Chain-Hoist Storehouse', district: 'slagworks', role: 'branch', optional: true, model: 'chain-hoist-storehouse.glb' }),
  moduleDefinition({ id: 'furnace-draft-stack', label: 'Furnace Draft Stack', district: 'furnaceworks', role: 'draft-objective', required: true, model: 'furnace-draft-stack.glb' }),
  moduleDefinition({ id: 'rotary-kiln-crossing', label: 'Rotary Kiln Crossing', district: 'furnaceworks', role: 'traversal', model: 'rotary-kiln-crossing.glb' }),
  moduleDefinition({ id: 'mold-casting-floor', label: 'Mold-Casting Floor', district: 'furnaceworks', role: 'combat', model: 'mold-casting-floor.glb' }),
  moduleDefinition({ id: 'quenchworks-exchange', label: 'Quenchworks Exchange', district: 'furnaceworks', role: 'terminus', required: true, model: 'quenchworks-exchange.glb' }),
  moduleDefinition({ id: 'ashfall-maintenance-catacombs', label: 'Ashfall Maintenance Catacombs', district: 'furnaceworks', role: 'branch', optional: true, model: 'ashfall-maintenance-catacombs.glb' }),
  moduleDefinition({ id: 'crucible-warden-foundry', label: 'Crucible Warden Foundry', district: 'boss', role: 'boss', required: true, model: 'crucible-warden-foundry.glb' }),
]);

export const MAGMA_REFINERY_MODULE_BY_ID = new Map(
  MAGMA_REFINERY_MODULES.map((module) => [module.id, module]),
);

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function chooseCountAllocation(targetRoomCount, random) {
  const allocations = [];
  for (const upperCount of [2, 3]) {
    for (const slagCount of [3, 4]) {
      for (const furnaceCount of [3, 4]) {
        if (3 + upperCount + slagCount + furnaceCount === targetRoomCount) {
          allocations.push({ upperCount, slagCount, furnaceCount });
        }
      }
    }
  }
  return allocations[Math.floor(random() * allocations.length)] ?? {
    upperCount: 2,
    slagCount: 3,
    furnaceCount: 3,
  };
}

export function selectMagmaRefineryModules(random = Math.random) {
  const targetRoomCount = 11 + Math.floor(random() * 3);
  const counts = chooseCountAllocation(targetRoomCount, random);
  const entrance = random() < 0.5 ? 'caldera-excavation-lift' : 'breached-freight-adit';
  const upperOptions = shuffled(
    ['ore-receiving-chasm', 'basalt-crusher-gallery', 'broken-ore-tram-depot'],
    random,
  ).slice(0, counts.upperCount - 1);
  const slagOptions = shuffled(
    ['slag-separation-basin', 'crucible-pumpworks', 'magma-siphon-cistern', 'chain-hoist-storehouse'],
    random,
  ).slice(0, counts.slagCount - 1);
  const furnaceOptions = shuffled(
    ['rotary-kiln-crossing', 'mold-casting-floor', 'ashfall-maintenance-catacombs'],
    random,
  ).slice(0, counts.furnaceCount - 2);

  return Object.freeze({
    targetRoomCount,
    entrance,
    upper: Object.freeze([...upperOptions, 'refractor-assay-lab']),
    hub: 'ember-crown-shrine-concourse',
    slag: Object.freeze([...slagOptions, 'pressure-regulator-nexus']),
    furnace: Object.freeze(['furnace-draft-stack', ...furnaceOptions, 'quenchworks-exchange']),
    boss: 'crucible-warden-foundry',
  });
}

export function validateMagmaModuleSelection(selection) {
  const all = [
    selection?.entrance,
    ...(selection?.upper ?? []),
    selection?.hub,
    ...(selection?.slag ?? []),
    ...(selection?.furnace ?? []),
    selection?.boss,
  ].filter(Boolean);
  const errors = [];
  if (all.length < 11 || all.length > 13) errors.push(`room-count:${all.length}`);
  if (new Set(all).size !== all.length) errors.push('duplicate-modules');
  if (!selection?.upper?.includes('refractor-assay-lab')) errors.push('missing-assay-lab');
  if (selection?.slag?.at(-1) !== 'pressure-regulator-nexus') errors.push('missing-slag-terminus');
  if (!selection?.furnace?.includes('furnace-draft-stack')) errors.push('missing-draft-stack');
  if (selection?.furnace?.at(-1) !== 'quenchworks-exchange') errors.push('missing-quench-terminus');
  if (selection?.hub !== 'ember-crown-shrine-concourse') errors.push('missing-shrine-concourse');
  if (selection?.boss !== 'crucible-warden-foundry') errors.push('missing-boss-foundry');
  for (const moduleId of all) {
    if (!MAGMA_REFINERY_MODULE_BY_ID.has(moduleId)) errors.push(`unknown-module:${moduleId}`);
  }
  return Object.freeze({ accepted: errors.length === 0, errors: Object.freeze(errors), roomModuleIds: Object.freeze(all) });
}
