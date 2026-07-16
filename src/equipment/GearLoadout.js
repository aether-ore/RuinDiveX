import {
  GEAR_LIST,
  GEAR_SLOTS,
  canEquipGearInSlot,
  getGearDefinition,
} from './GearCatalog.js';
import { resolveGearEffects } from './GearEffects.js';

const DEFAULT_UNLOCKED_GEAR_IDS = Object.freeze([
  'reinforcedArmorFrame',
  'gyroStabilizerHelmet',
]);

const DEFAULT_UNLOCKED_SLOTS = Object.freeze([
  'armor',
  'helmet',
  'mobility',
  'utility1',
  'utility2',
]);

const DEFAULT_GEAR_SLOTS = Object.freeze({
  armor: 'reinforcedArmorFrame',
  helmet: 'gyroStabilizerHelmet',
  mobility: null,
  defense: null,
  utility1: null,
  utility2: null,
});

function cloneState(state) {
  return {
    records: state.records.map((record) => ({ ...record })),
    unlockedSlots: [...state.unlockedSlots],
    slots: Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, state.slots[slot] ?? null])),
  };
}

function getRecord(state, gearId) {
  return state.records.find((record) => record.gearId === gearId) ?? null;
}

function transitionResult(state, { ok, changed = false, reason = null, ...extra }) {
  return { ok, changed, reason, state: cloneState(state), ...extra };
}

export function createDefaultGearLoadout() {
  const unlocked = new Set(DEFAULT_UNLOCKED_GEAR_IDS);
  return {
    records: GEAR_LIST.map((gear) => ({
      gearId: gear.id,
      unlocked: unlocked.has(gear.id),
    })),
    unlockedSlots: [...DEFAULT_UNLOCKED_SLOTS],
    slots: { ...DEFAULT_GEAR_SLOTS },
  };
}

export const createDefaultGearLoadoutState = createDefaultGearLoadout;

export function sanitizeGearLoadout(rawState = null) {
  const defaults = createDefaultGearLoadout();
  const source = rawState && typeof rawState === 'object' ? rawState : defaults;
  const recordSource = Array.isArray(source.records) ? source.records : defaults.records;
  const permanentStarterUnlocks = new Set(DEFAULT_UNLOCKED_GEAR_IDS);
  const sourceById = new Map(recordSource
    .filter((record) => record && typeof record === 'object' && typeof record.gearId === 'string')
    .map((record) => [record.gearId, record]));
  const records = GEAR_LIST.map((gear) => {
    const record = sourceById.get(gear.id);
    return {
      gearId: gear.id,
      // Starter Gear cannot be revoked by normal play. Repair missing or false
      // records without granting any fabricated Gear such as Jump Springs.
      unlocked: permanentStarterUnlocks.has(gear.id) || Boolean(record?.unlocked),
    };
  });
  const unlockedGearIds = new Set(records
    .filter((record) => record.unlocked)
    .map((record) => record.gearId));

  const unlockedSlotSource = Array.isArray(source.unlockedSlots)
    ? source.unlockedSlots
    : defaults.unlockedSlots;
  const unlockedSlotSet = new Set(unlockedSlotSource);
  const unlockedSlots = GEAR_SLOTS.filter((slot) => unlockedSlotSet.has(slot));
  const sourceSlots = source.slots && typeof source.slots === 'object'
    ? source.slots
    : defaults.slots;
  const slots = Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, null]));
  const assigned = new Set();
  const exclusiveGroups = new Set();

  for (const slot of GEAR_SLOTS) {
    if (!unlockedSlotSet.has(slot)) continue;
    const gearId = Object.prototype.hasOwnProperty.call(sourceSlots, slot)
      ? sourceSlots[slot]
      : defaults.slots[slot];
    if (typeof gearId !== 'string'
      || !unlockedGearIds.has(gearId)
      || !canEquipGearInSlot(gearId, slot)
      || assigned.has(gearId)) {
      continue;
    }
    const gear = getGearDefinition(gearId);
    if (gear.exclusiveGroup && exclusiveGroups.has(gear.exclusiveGroup)) continue;
    slots[slot] = gearId;
    assigned.add(gearId);
    if (gear.exclusiveGroup) exclusiveGroups.add(gear.exclusiveGroup);
  }

  return { records, unlockedSlots, slots };
}

export const sanitizeGearLoadoutState = sanitizeGearLoadout;

export function validateGearLoadout(rawState) {
  const errors = [];
  const source = rawState && typeof rawState === 'object' ? rawState : null;
  if (!source) {
    errors.push({ code: 'invalid-state', path: 'gear', message: 'Gear loadout must be an object.' });
    return { valid: false, errors, state: sanitizeGearLoadout(rawState) };
  }

  const records = Array.isArray(source.records) ? source.records : [];
  if (!Array.isArray(source.records)) {
    errors.push({ code: 'invalid-records', path: 'records', message: 'Gear records must be an array.' });
  }
  const recordById = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const path = `records.${index}`;
    if (!record || typeof record !== 'object' || typeof record.gearId !== 'string') {
      errors.push({ code: 'invalid-record', path, message: 'Gear record must name a gearId.' });
      continue;
    }
    const gear = getGearDefinition(record.gearId);
    if (!gear) {
      errors.push({ code: 'unknown-gear', path, gearId: record.gearId, message: `Unknown gear "${record.gearId}".` });
    }
    if (recordById.has(record.gearId)) {
      errors.push({ code: 'duplicate-gear-record', path, gearId: record.gearId, message: `Duplicate gear record "${record.gearId}".` });
    }
    if (typeof record.unlocked !== 'boolean') {
      errors.push({ code: 'invalid-unlocked', path: `${path}.unlocked`, message: 'unlocked must be boolean.' });
    }
    if (Object.prototype.hasOwnProperty.call(record, 'upgradeRank')) {
      errors.push({
        code: 'forbidden-upgrade-rank',
        path: `${path}.upgradeRank`,
        message: 'Fixed-function gear cannot carry an upgrade rank.',
      });
    }
    recordById.set(record.gearId, record);
  }

  for (const gear of GEAR_LIST) {
    if (!recordById.has(gear.id)) {
      errors.push({ code: 'missing-gear-record', path: 'records', gearId: gear.id, message: `Missing gear record "${gear.id}".` });
    }
  }

  const unlockedSlots = Array.isArray(source.unlockedSlots) ? source.unlockedSlots : [];
  if (!Array.isArray(source.unlockedSlots)) {
    errors.push({ code: 'invalid-unlocked-slots', path: 'unlockedSlots', message: 'unlockedSlots must be an array.' });
  }
  const unlockedSlotSet = new Set();
  for (const slot of unlockedSlots) {
    if (!GEAR_SLOTS.includes(slot)) {
      errors.push({ code: 'unknown-slot', path: 'unlockedSlots', slot, message: `Unknown gear slot "${slot}".` });
    } else if (unlockedSlotSet.has(slot)) {
      errors.push({ code: 'duplicate-unlocked-slot', path: 'unlockedSlots', slot, message: `Duplicate unlocked slot "${slot}".` });
    }
    unlockedSlotSet.add(slot);
  }

  const slots = source.slots && typeof source.slots === 'object' ? source.slots : {};
  if (!source.slots || typeof source.slots !== 'object') {
    errors.push({ code: 'invalid-slots', path: 'slots', message: 'Gear slots must be an object.' });
  }
  const assigned = new Set();
  const exclusiveGroups = new Map();
  for (const slot of GEAR_SLOTS) {
    const gearId = slots[slot];
    if (gearId === null) continue;
    if (typeof gearId !== 'string') {
      errors.push({ code: 'invalid-slot-value', path: `slots.${slot}`, message: `${slot} must contain a gear id or null.` });
      continue;
    }
    const gear = getGearDefinition(gearId);
    if (!gear) {
      errors.push({ code: 'unknown-gear', path: `slots.${slot}`, gearId, message: `Unknown gear "${gearId}".` });
      continue;
    }
    if (!unlockedSlotSet.has(slot)) {
      errors.push({ code: 'slot-locked', path: `slots.${slot}`, gearId, message: `${slot} is locked.` });
    }
    if (!recordById.get(gearId)?.unlocked) {
      errors.push({ code: 'gear-locked', path: `slots.${slot}`, gearId, message: `${gearId} is not unlocked.` });
    }
    if (!canEquipGearInSlot(gearId, slot)) {
      errors.push({ code: 'incompatible-slot', path: `slots.${slot}`, gearId, message: `${gearId} cannot equip in ${slot}.` });
    }
    if (assigned.has(gearId)) {
      errors.push({ code: 'duplicate-assignment', path: `slots.${slot}`, gearId, message: `${gearId} is assigned more than once.` });
    }
    assigned.add(gearId);
    if (gear.exclusiveGroup) {
      if (exclusiveGroups.has(gear.exclusiveGroup)) {
        errors.push({
          code: 'exclusive-group-conflict',
          path: `slots.${slot}`,
          gearId,
          exclusiveGroup: gear.exclusiveGroup,
          message: `${gear.exclusiveGroup} gear is assigned more than once.`,
        });
      }
      exclusiveGroups.set(gear.exclusiveGroup, gearId);
    }
  }

  return { valid: errors.length === 0, errors, state: sanitizeGearLoadout(source) };
}

export const validateGearLoadoutState = validateGearLoadout;

export function unlockGear(rawState, gearId) {
  const state = sanitizeGearLoadout(rawState);
  const gear = getGearDefinition(gearId);
  if (!gear) return transitionResult(state, { ok: false, reason: 'unknown-gear', gearId });
  const record = getRecord(state, gearId);
  const changed = !record.unlocked;
  record.unlocked = true;
  return transitionResult(state, {
    ok: true,
    changed,
    reason: changed ? null : 'already-unlocked',
    gearId,
  });
}

export function unlockGearSlot(rawState, slot) {
  const state = sanitizeGearLoadout(rawState);
  if (!GEAR_SLOTS.includes(slot)) return transitionResult(state, { ok: false, reason: 'unknown-slot', slot });
  if (state.unlockedSlots.includes(slot)) {
    return transitionResult(state, { ok: true, changed: false, reason: 'already-unlocked', slot });
  }
  const unlocked = new Set([...state.unlockedSlots, slot]);
  state.unlockedSlots = GEAR_SLOTS.filter((gearSlot) => unlocked.has(gearSlot));
  return transitionResult(state, { ok: true, changed: true, slot });
}

export function lockGearSlot(rawState, slot) {
  const state = sanitizeGearLoadout(rawState);
  if (!GEAR_SLOTS.includes(slot)) return transitionResult(state, { ok: false, reason: 'unknown-slot', slot });
  const wasUnlocked = state.unlockedSlots.includes(slot);
  const previousGearId = state.slots[slot];
  state.unlockedSlots = state.unlockedSlots.filter((gearSlot) => gearSlot !== slot);
  state.slots[slot] = null;
  return transitionResult(state, {
    ok: true,
    changed: wasUnlocked || previousGearId !== null,
    reason: !wasUnlocked && previousGearId === null ? 'already-locked' : null,
    slot,
    previousGearId,
  });
}

export function equipGearSlot(rawState, slot, gearId) {
  const state = sanitizeGearLoadout(rawState);
  if (!GEAR_SLOTS.includes(slot)) return transitionResult(state, { ok: false, reason: 'unknown-slot', slot });
  if (gearId === null || gearId === undefined) {
    const previousGearId = state.slots[slot];
    state.slots[slot] = null;
    return transitionResult(state, {
      ok: true,
      changed: previousGearId !== null,
      slot,
      gearId: null,
      previousGearId,
    });
  }
  if (!state.unlockedSlots.includes(slot)) {
    return transitionResult(state, { ok: false, reason: 'slot-locked', slot, gearId });
  }
  const gear = getGearDefinition(gearId);
  if (!gear) return transitionResult(state, { ok: false, reason: 'unknown-gear', slot, gearId });
  if (!getRecord(state, gearId)?.unlocked) {
    return transitionResult(state, { ok: false, reason: 'gear-locked', slot, gearId });
  }
  if (!canEquipGearInSlot(gearId, slot)) {
    return transitionResult(state, { ok: false, reason: 'incompatible-slot', slot, gearId });
  }

  const displacedConflicts = [];
  if (gear.exclusiveGroup) {
    for (const otherSlot of GEAR_SLOTS) {
      if (otherSlot === slot) continue;
      const otherGearId = state.slots[otherSlot];
      if (getGearDefinition(otherGearId)?.exclusiveGroup === gear.exclusiveGroup) {
        displacedConflicts.push({ slot: otherSlot, gearId: otherGearId });
        state.slots[otherSlot] = null;
      }
    }
  } else {
    const duplicateSlot = GEAR_SLOTS.find((otherSlot) => (
      otherSlot !== slot && state.slots[otherSlot] === gearId
    ));
    if (duplicateSlot) {
      return transitionResult(state, { ok: false, reason: 'duplicate-assignment', slot, gearId, duplicateSlot });
    }
  }

  const previousGearId = state.slots[slot];
  state.slots[slot] = gearId;
  return transitionResult(state, {
    ok: true,
    changed: previousGearId !== gearId,
    reason: previousGearId === gearId ? 'already-equipped' : null,
    slot,
    gearId,
    previousGearId,
    displacedConflicts,
  });
}

export function unequipGearSlot(rawState, slot) {
  return equipGearSlot(rawState, slot, null);
}

export class GearLoadout {
  constructor(state = null) {
    this.state = sanitizeGearLoadout(state);
  }

  get(slot) {
    return getGearDefinition(this.getId(slot));
  }

  getId(slot) {
    return GEAR_SLOTS.includes(slot) ? this.state.slots[slot] ?? null : null;
  }

  isUnlocked(gearId) {
    return Boolean(getRecord(this.state, gearId)?.unlocked);
  }

  isSlotUnlocked(slot) {
    return this.state.unlockedSlots.includes(slot);
  }

  unlock(gearId) {
    const result = unlockGear(this.state, gearId);
    if (result.ok) this.state = result.state;
    return result;
  }

  unlockSlot(slot) {
    const result = unlockGearSlot(this.state, slot);
    if (result.ok) this.state = result.state;
    return result;
  }

  equip(gearId, preferredSlot = null) {
    const gear = getGearDefinition(gearId);
    if (!gear) return transitionResult(this.state, { ok: false, reason: 'unknown-gear', gearId });
    if (preferredSlot && !gear.allowedSlots.includes(preferredSlot)) {
      return transitionResult(this.state, { ok: false, reason: 'incompatible-slot', gearId, slot: preferredSlot });
    }
    const candidates = preferredSlot ? [preferredSlot] : gear.allowedSlots;
    const unlockedCandidates = candidates.filter((slot) => this.isSlotUnlocked(slot));
    if (unlockedCandidates.length === 0) {
      return transitionResult(this.state, { ok: false, reason: 'slot-locked', gearId, slot: preferredSlot });
    }
    const slot = unlockedCandidates.find((candidate) => !this.getId(candidate)) ?? unlockedCandidates[0];
    const result = equipGearSlot(this.state, slot, gearId);
    if (result.ok) this.state = result.state;
    return result;
  }

  unequip(slot) {
    const result = unequipGearSlot(this.state, slot);
    if (result.ok) this.state = result.state;
    return result;
  }

  setDefenseUnlocked(unlocked = true) {
    const result = unlocked
      ? unlockGearSlot(this.state, 'defense')
      : lockGearSlot(this.state, 'defense');
    if (result.ok) this.state = result.state;
    return result;
  }

  resolveEffects() {
    return resolveGearEffects(this.state);
  }

  getEffects() {
    return this.resolveEffects();
  }

  snapshot() {
    return cloneState(this.state);
  }
}
