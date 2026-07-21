export const DEFAULT_OVERWORLD_URL = '/';

export const directDungeonUrl = ({
  seed = null,
  room = null,
  bossProfileId = null,
  extra = {},
} = {}) => {
  const params = new URLSearchParams({ startupWorld: 'dungeon' });
  if (seed) params.set('dungeonSeed', String(seed));
  if (room) params.set('roomPreview', String(room));
  if (bossProfileId) params.set('bossProfile', String(bossProfileId));
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined) params.set(key, String(value));
  }
  return `/?${params.toString()}`;
};

export const DIRECT_DUNGEON_URL = directDungeonUrl();
