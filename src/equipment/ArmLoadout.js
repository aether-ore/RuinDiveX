import {
  FIXED_ARM_IDS,
  canEquipFixedArmInSlot,
  createFixedArmDescriptor,
  getFixedArmDefinition,
} from './ArmCatalog.js';

export const ARM_LOADOUT_SLOTS = Object.freeze([
  'megaBuster',
  'special1',
  'special2',
  'utility',
]);

export const SPECIAL_ARM_SLOTS = Object.freeze(['special1', 'special2']);

const DEFAULT_OWNED_ARM_IDS = Object.freeze(['laserBeamBlade', 'liftArm']);
const DEFAULT_SLOTS = Object.freeze({
  megaBuster: Object.freeze({ kind: 'megaBuster' }),
  special1: Object.freeze({ kind: 'fixedArm', armId: 'laserBeamBlade' }),
  special2: Object.freeze({ kind: 'customBuster', buildId: 'build-a' }),
  utility: Object.freeze({ kind: 'fixedArm', armId: 'liftArm' }),
});

function cloneSelection(selection) {
  return selection && typeof selection === 'object' ? { ...selection } : null;
}

function cloneState(state) {
  return {
    ownedArmIds: [...state.ownedArmIds],
    slots: Object.fromEntries(ARM_LOADOUT_SLOTS.map((slot) => [slot, cloneSelection(state.slots[slot])])),
  };
}

function selectionKey(selection) {
  if (selection?.kind === 'fixedArm') return `fixed:${selection.armId}`;
  if (selection?.kind === 'customBuster') return `custom:${selection.buildId}`;
  if (selection?.kind === 'megaBuster') return 'megaBuster';
  return null;
}

function normalizeSelectionInput(selection) {
  if (selection === null || selection === undefined) return null;
  if (typeof selection === 'string') return { kind: 'fixedArm', armId: selection };
  if (!selection || typeof selection !== 'object') return null;
  if (selection.kind === 'megaBuster') return { kind: 'megaBuster' };
  if (selection.kind === 'fixedArm' && typeof selection.armId === 'string') {
    return { kind: 'fixedArm', armId: selection.armId };
  }
  if (selection.kind === 'customBuster' && typeof selection.buildId === 'string') {
    const buildId = selection.buildId.trim();
    return buildId ? { kind: 'customBuster', buildId } : null;
  }
  return null;
}

function isCustomBuildKnown(buildId, options = {}) {
  if (typeof options.isCustomBuildKnown === 'function') return options.isCustomBuildKnown(buildId);
  if (options.knownCustomBuildIds instanceof Set) return options.knownCustomBuildIds.has(buildId);
  if (Array.isArray(options.knownCustomBuildIds)) return options.knownCustomBuildIds.includes(buildId);
  return true;
}

export function createDefaultArmLoadout() {
  return {
    ownedArmIds: [...DEFAULT_OWNED_ARM_IDS],
    slots: Object.fromEntries(ARM_LOADOUT_SLOTS.map((slot) => [slot, cloneSelection(DEFAULT_SLOTS[slot])])),
  };
}

export const createDefaultArmLoadoutState = createDefaultArmLoadout;

export function sanitizeArmLoadout(rawState = null) {
  const defaults = createDefaultArmLoadout();
  const source = rawState && typeof rawState === 'object' ? rawState : defaults;
  const ownedSource = Array.isArray(source.ownedArmIds) ? source.ownedArmIds : defaults.ownedArmIds;
  // Starter Arms are permanent campaign entitlements. A partial/corrupt save
  // may omit their ownership records, but there is no supported transition
  // that revokes them, so repair those records while preserving slot choices.
  const ownedSet = new Set([
    ...DEFAULT_OWNED_ARM_IDS,
    ...ownedSource.filter((armId) => (
      armId !== 'megaBuster' && getFixedArmDefinition(armId)
    )),
  ]);
  const ownedArmIds = FIXED_ARM_IDS.filter((armId) => armId !== 'megaBuster' && ownedSet.has(armId));
  const slotSource = source.slots && typeof source.slots === 'object' ? source.slots : defaults.slots;
  const slots = { megaBuster: { kind: 'megaBuster' } };
  const assigned = new Set(['megaBuster']);

  for (const slot of ['special1', 'special2', 'utility']) {
    const rawSelection = Object.prototype.hasOwnProperty.call(slotSource, slot)
      ? slotSource[slot]
      : defaults.slots[slot];
    const selection = normalizeSelectionInput(rawSelection);
    if (!selection) {
      slots[slot] = null;
      continue;
    }

    if (selection.kind === 'fixedArm') {
      const valid = ownedSet.has(selection.armId)
        && canEquipFixedArmInSlot(selection.armId, slot);
      const key = selectionKey(selection);
      if (!valid || assigned.has(key)) {
        slots[slot] = null;
        continue;
      }
      assigned.add(key);
      slots[slot] = selection;
      continue;
    }

    if (selection.kind === 'customBuster' && SPECIAL_ARM_SLOTS.includes(slot)) {
      const key = selectionKey(selection);
      if (assigned.has(key)) {
        slots[slot] = null;
        continue;
      }
      assigned.add(key);
      slots[slot] = selection;
      continue;
    }

    slots[slot] = null;
  }

  return { ownedArmIds, slots };
}

export const sanitizeArmLoadoutState = sanitizeArmLoadout;

export function validateArmLoadout(rawState, options = {}) {
  const errors = [];
  const source = rawState && typeof rawState === 'object' ? rawState : null;
  if (!source) {
    errors.push({ code: 'invalid-state', path: 'arms', message: 'Arm loadout must be an object.' });
    return { valid: false, errors, state: sanitizeArmLoadout(rawState) };
  }

  const owned = Array.isArray(source.ownedArmIds) ? source.ownedArmIds : [];
  if (!Array.isArray(source.ownedArmIds)) {
    errors.push({ code: 'invalid-owned-arms', path: 'ownedArmIds', message: 'ownedArmIds must be an array.' });
  }
  const ownedSet = new Set();
  for (const armId of owned) {
    if (armId === 'megaBuster') {
      errors.push({ code: 'invariant-owned', path: 'ownedArmIds', armId, message: 'Mega Buster is invariant and is not an owned-arm record.' });
    } else if (!getFixedArmDefinition(armId)) {
      errors.push({ code: 'unknown-arm', path: 'ownedArmIds', armId, message: `Unknown fixed arm "${armId}".` });
    } else if (ownedSet.has(armId)) {
      errors.push({ code: 'duplicate-owned-arm', path: 'ownedArmIds', armId, message: `Duplicate owned arm "${armId}".` });
    }
    ownedSet.add(armId);
  }

  const slots = source.slots && typeof source.slots === 'object' ? source.slots : {};
  if (!source.slots || typeof source.slots !== 'object') {
    errors.push({ code: 'invalid-slots', path: 'slots', message: 'Arm slots must be an object.' });
  }
  if (slots.megaBuster?.kind !== 'megaBuster') {
    errors.push({ code: 'missing-invariant', path: 'slots.megaBuster', message: 'Mega Buster must occupy its invariant slot.' });
  }

  const assigned = new Set(['megaBuster']);
  for (const slot of ['special1', 'special2', 'utility']) {
    const rawSelection = slots[slot];
    if (rawSelection === null) continue;
    const selection = normalizeSelectionInput(rawSelection);
    if (!selection || selection.kind === 'megaBuster') {
      errors.push({ code: 'invalid-selection', path: `slots.${slot}`, message: `Invalid arm selection in ${slot}.` });
      continue;
    }
    if (selection.kind === 'fixedArm') {
      if (!getFixedArmDefinition(selection.armId)) {
        errors.push({ code: 'unknown-arm', path: `slots.${slot}`, armId: selection.armId, message: `Unknown fixed arm "${selection.armId}".` });
      } else if (!ownedSet.has(selection.armId)) {
        errors.push({ code: 'arm-not-owned', path: `slots.${slot}`, armId: selection.armId, message: `${selection.armId} is not owned.` });
      } else if (!canEquipFixedArmInSlot(selection.armId, slot)) {
        errors.push({ code: 'incompatible-slot', path: `slots.${slot}`, armId: selection.armId, message: `${selection.armId} cannot equip in ${slot}.` });
      }
    } else if (!SPECIAL_ARM_SLOTS.includes(slot)) {
      errors.push({ code: 'incompatible-slot', path: `slots.${slot}`, buildId: selection.buildId, message: 'Custom Busters equip only in special arm slots.' });
    } else if (!isCustomBuildKnown(selection.buildId, options)) {
      errors.push({ code: 'unknown-custom-build', path: `slots.${slot}`, buildId: selection.buildId, message: `Unknown Custom Buster build "${selection.buildId}".` });
    }

    const key = selectionKey(selection);
    if (key && assigned.has(key)) {
      errors.push({ code: 'duplicate-assignment', path: `slots.${slot}`, message: `${key} is assigned more than once.` });
    }
    if (key) assigned.add(key);
  }

  return { valid: errors.length === 0, errors, state: sanitizeArmLoadout(source) };
}

export const validateArmLoadoutState = validateArmLoadout;

function transitionResult(state, { ok, changed = false, reason = null, ...extra }) {
  return { ok, changed, reason, state: cloneState(state), ...extra };
}

export function unlockArm(rawState, armId) {
  const state = sanitizeArmLoadout(rawState);
  const definition = getFixedArmDefinition(armId);
  if (!definition) return transitionResult(state, { ok: false, reason: 'unknown-arm', armId });
  if (definition.role === 'invariant') {
    return transitionResult(state, { ok: false, reason: 'invariant-arm', armId });
  }
  if (state.ownedArmIds.includes(armId)) {
    return transitionResult(state, { ok: true, changed: false, reason: 'already-unlocked', armId });
  }

  const owned = new Set([...state.ownedArmIds, armId]);
  state.ownedArmIds = FIXED_ARM_IDS.filter((id) => id !== 'megaBuster' && owned.has(id));
  return transitionResult(state, { ok: true, changed: true, armId });
}

export function equipArmSlot(rawState, slot, rawSelection) {
  const state = sanitizeArmLoadout(rawState);
  if (!ARM_LOADOUT_SLOTS.includes(slot)) {
    return transitionResult(state, { ok: false, reason: 'unknown-slot', slot });
  }
  if (slot === 'megaBuster') {
    return transitionResult(state, { ok: false, reason: 'invariant-slot', slot });
  }

  if (rawSelection === null || rawSelection === undefined) {
    const changed = state.slots[slot] !== null;
    state.slots[slot] = null;
    return transitionResult(state, { ok: true, changed, slot, selection: null });
  }

  const selection = normalizeSelectionInput(rawSelection);
  if (!selection || selection.kind === 'megaBuster') {
    return transitionResult(state, { ok: false, reason: 'invalid-selection', slot });
  }
  if (selection.kind === 'fixedArm') {
    const definition = getFixedArmDefinition(selection.armId);
    if (!definition) return transitionResult(state, { ok: false, reason: 'unknown-arm', slot, armId: selection.armId });
    if (!state.ownedArmIds.includes(selection.armId)) {
      return transitionResult(state, { ok: false, reason: 'arm-not-owned', slot, armId: selection.armId });
    }
    if (!canEquipFixedArmInSlot(selection.armId, slot)) {
      return transitionResult(state, { ok: false, reason: 'incompatible-slot', slot, armId: selection.armId });
    }
  } else if (!SPECIAL_ARM_SLOTS.includes(slot)) {
    return transitionResult(state, { ok: false, reason: 'incompatible-slot', slot, buildId: selection.buildId });
  }

  const key = selectionKey(selection);
  const duplicateSlot = ARM_LOADOUT_SLOTS.find((otherSlot) => (
    otherSlot !== slot && selectionKey(state.slots[otherSlot]) === key
  ));
  if (duplicateSlot) {
    return transitionResult(state, { ok: false, reason: 'duplicate-assignment', slot, duplicateSlot });
  }

  const previous = cloneSelection(state.slots[slot]);
  const changed = selectionKey(previous) !== key;
  state.slots[slot] = selection;
  return transitionResult(state, { ok: true, changed, slot, selection: cloneSelection(selection), previous });
}

export function unequipArmSlot(rawState, slot) {
  return equipArmSlot(rawState, slot, null);
}

export class ArmLoadout {
  constructor(state = null) {
    this.state = sanitizeArmLoadout(state);
  }

  get(slot) {
    return cloneSelection(this.state.slots[slot]);
  }

  getFixedArmDefinition(slot) {
    const selection = this.state.slots[slot];
    if (selection?.kind === 'megaBuster') return getFixedArmDefinition('megaBuster');
    return selection?.kind === 'fixedArm' ? getFixedArmDefinition(selection.armId) : null;
  }

  getDescriptor(slot) {
    const definition = this.getFixedArmDefinition(slot);
    return definition ? createFixedArmDescriptor(definition.id) : null;
  }

  isOwned(armId) {
    return armId === 'megaBuster' || this.state.ownedArmIds.includes(armId);
  }

  unlock(armId) {
    const result = unlockArm(this.state, armId);
    if (result.ok) this.state = result.state;
    return result;
  }

  equip(slot, selection) {
    const result = equipArmSlot(this.state, slot, selection);
    if (result.ok) this.state = result.state;
    return result;
  }

  unequip(slot) {
    const result = unequipArmSlot(this.state, slot);
    if (result.ok) this.state = result.state;
    return result;
  }

  snapshot() {
    return cloneState(this.state);
  }
}
