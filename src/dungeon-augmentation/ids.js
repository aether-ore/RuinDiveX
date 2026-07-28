export function sanitizeDungeonAugmentationIdPart(value, fallback = 'unnamed') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

export function createDungeonSupplementId({
  parentRegionId,
  operationType,
  operationOrdinal = 0,
  kind,
  ordinal = 0,
  sourceId = null,
} = {}) {
  const parts = [
    'supplement',
    sanitizeDungeonAugmentationIdPart(parentRegionId, 'region'),
    sanitizeDungeonAugmentationIdPart(operationType, 'operation'),
    String(Math.max(0, Number(operationOrdinal) || 0)),
    sanitizeDungeonAugmentationIdPart(kind, 'item'),
    String(Math.max(0, Number(ordinal) || 0)),
  ];
  if (sourceId != null && String(sourceId).trim()) {
    parts.push(sanitizeDungeonAugmentationIdPart(sourceId, 'source'));
  }
  return parts.join(':');
}

export function isDungeonSupplementIdForRegion(id, parentRegionId) {
  return typeof id === 'string'
    && id.startsWith(`supplement:${sanitizeDungeonAugmentationIdPart(parentRegionId, 'region')}:`);
}

