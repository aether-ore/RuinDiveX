const RESERVED_WORLD_ID_DELIMITERS = /[:/]/;

export function toLegacyFixedRoomWorldIdV2(placementId, localId) {
  const owner = String(placementId ?? '').trim();
  const local = String(localId ?? '').trim();
  if (!owner || !local) {
    throw new TypeError('Legacy fixed-room world IDs require non-empty placement and local IDs.');
  }
  if (RESERVED_WORLD_ID_DELIMITERS.test(owner) || RESERVED_WORLD_ID_DELIMITERS.test(local)) {
    throw new TypeError('Legacy fixed-room world ID components cannot contain reserved ":" or "/" delimiters.');
  }
  return `${owner}:${local}`;
}

export default toLegacyFixedRoomWorldIdV2;
