export const INDUSTRIAL_DUNGEON_FAMILY_ID = 'industrial-v1';

const RETIRED_MAGMA_REFINERY_FAMILY_ID = 'magma-refinery-v1';

export function resolveDungeonFamilyId(value) {
  const requestedDungeonFamilyId = typeof value === 'string' && value.trim()
    ? value.trim()
    : null;
  const dungeonFamilyId = INDUSTRIAL_DUNGEON_FAMILY_ID;
  const fallback = requestedDungeonFamilyId
    && requestedDungeonFamilyId !== INDUSTRIAL_DUNGEON_FAMILY_ID
    ? Object.freeze({
      requestedDungeonFamilyId,
      dungeonFamilyId,
      reason: requestedDungeonFamilyId === RETIRED_MAGMA_REFINERY_FAMILY_ID
        ? 'retired-dungeon-family'
        : 'unsupported-dungeon-family',
    })
    : null;
  return Object.freeze({ dungeonFamilyId, fallback });
}
