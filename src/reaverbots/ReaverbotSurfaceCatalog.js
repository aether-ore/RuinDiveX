const ATLAS_COLUMNS = 4;
const ATLAS_ROWS = 4;
const ATLAS_REFERENCE_SIZE = 256;
const ATLAS_GUTTER_PIXELS = 3;
const PAD_U = ATLAS_GUTTER_PIXELS / ATLAS_REFERENCE_SIZE;
const PAD_V = ATLAS_GUTTER_PIXELS / ATLAS_REFERENCE_SIZE;

function freezeRect(rect) {
  return Object.freeze(rect.map((value) => Number(value)));
}

function paddedRect(column, row, width = 1, height = 1) {
  const u0 = column / ATLAS_COLUMNS + PAD_U;
  const v0 = row / ATLAS_ROWS + PAD_V;
  const u1 = (column + width) / ATLAS_COLUMNS - PAD_U;
  const v1 = (row + height) / ATLAS_ROWS - PAD_V;
  return freezeRect([u0, v0, u1, v1]);
}

function freezeRegion(id, rect, options = {}) {
  return Object.freeze({
    id,
    rect,
    padded: options.padded ?? true,
    orientation: options.orientation ?? 'omnidirectional',
    workingEnd: options.workingEnd ?? null,
  });
}

/**
 * Normalized semantic views shared by every generated Reaverbot atlas.
 *
 * The layout deliberately reserves the lower half for long weapon/housing
 * strips and the upper half for compact panel details.  Source art can change
 * independently per module while retaining these stable UV contracts.
 */
export const REAVERBOT_SEMANTIC_UV_REGIONS = Object.freeze({
  workingLongA: freezeRegion('workingLongA', paddedRect(0, 0, 1, 2), {
    orientation: 'longitudinal',
    workingEnd: 'vMax',
  }),
  workingLongB: freezeRegion('workingLongB', paddedRect(1, 0, 1, 2), {
    orientation: 'longitudinal',
    workingEnd: 'vMax',
  }),
  housingLongA: freezeRegion('housingLongA', paddedRect(2, 0, 1, 2), {
    orientation: 'longitudinal',
  }),
  housingLongB: freezeRegion('housingLongB', paddedRect(3, 0, 1, 2), {
    orientation: 'longitudinal',
  }),
  armorPanelA: freezeRegion('armorPanelA', paddedRect(0, 2)),
  armorPanelB: freezeRegion('armorPanelB', paddedRect(1, 2)),
  circuitPanelA: freezeRegion('circuitPanelA', paddedRect(2, 2)),
  circuitPanelB: freezeRegion('circuitPanelB', paddedRect(3, 2)),
  jointPanelA: freezeRegion('jointPanelA', paddedRect(0, 3)),
  jointPanelB: freezeRegion('jointPanelB', paddedRect(1, 3)),
  trimPanelA: freezeRegion('trimPanelA', paddedRect(2, 3)),
  trimPanelB: freezeRegion('trimPanelB', paddedRect(3, 3)),
  // Centered eye and field assets are intentionally full-map exceptions. The
  // ruby eye must retain its existing sampling and appearance exactly.
  fullMap: freezeRegion('fullMap', freezeRect([0, 0, 1, 1]), {
    padded: false,
    orientation: 'preserve',
  }),
});

function freezeRole(id, valueClass, mappingMode, regionIds, options = {}) {
  return Object.freeze({
    id,
    valueClass,
    mappingMode,
    regionIds: Object.freeze([...regionIds]),
    workingEnd: options.workingEnd ?? null,
  });
}

/** Value hierarchy and eligible atlas views for every semantic surface role. */
export const REAVERBOT_SURFACE_ROLE_LAYOUTS = Object.freeze({
  armor: freezeRole('armor', 'armor-mid', 'grouped-regions', ['armorPanelA', 'armorPanelB']),
  circuit: freezeRole('circuit', 'circuit-contrast', 'grouped-regions', ['circuitPanelA', 'circuitPanelB']),
  housing: freezeRole('housing', 'housing-mid', 'longitudinal-housing', ['housingLongA', 'housingLongB']),
  joint: freezeRole('joint', 'mechanical-dark', 'grouped-regions', ['jointPanelA', 'jointPanelB']),
  trim: freezeRole('trim', 'trim-light', 'grouped-regions', ['trimPanelA', 'trimPanelB']),
  workingEdge: freezeRole(
    'workingEdge',
    'working-edge',
    'longitudinal-working-end',
    ['workingLongA', 'workingLongB'],
    { workingEnd: 'vMax' },
  ),
  emissive: freezeRole('emissive', 'emissive-bright', 'grouped-regions', ['circuitPanelA', 'circuitPanelB']),
  energy: freezeRole('energy', 'energy-bright', 'full-map-preserve', ['fullMap']),
  eye: freezeRole('eye', 'ruby-eye', 'full-map-preserve', ['fullMap']),
});

export const REAVERBOT_SEMANTIC_UV_LAYOUT = Object.freeze({
  version: 1,
  columns: ATLAS_COLUMNS,
  rows: ATLAS_ROWS,
  referenceSize: ATLAS_REFERENCE_SIZE,
  gutterPixels: ATLAS_GUTTER_PIXELS,
  gutterUv: Object.freeze([PAD_U, PAD_V]),
  regions: REAVERBOT_SEMANTIC_UV_REGIONS,
  roles: REAVERBOT_SURFACE_ROLE_LAYOUTS,
});

function normalizedPartName(partName) {
  return String(partName ?? 'unnamed-part')
    .replace(/left|right/gi, 'side')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function deterministicHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Infer a stable semantic role from an authored mesh name and material slot.
 * Explicit roles passed to applyReaverbotSemanticUv always take precedence.
 */
export function inferReaverbotSurfaceRole(partName, slot = '') {
  const name = String(partName ?? '').toLowerCase();
  const materialSlot = String(slot ?? '').toLowerCase();

  if (/eyelid|shutter/.test(name)) return 'armor';
  if (/eyesocket|hinge|joint|bearing|socket|hydraulic|piston|spine|tube|breech|mouth/.test(name)) return 'joint';
  if (/redeye|eyelens|palmeye|rubylens|lens/.test(name) || materialSlot === 'eye') return 'eye';
  if (/energy|membrane|phaseshell|tractorbeam|field/.test(name) || materialSlot.includes('energy')) return 'energy';
  if (/talon|tooth|blade|horn|spike|razor|shard|clawtip/.test(name)
    || /workingsurface|spike|blade/.test(materialSlot)) return 'workingEdge';
  if (/circuit|inlay|trace|vent|glyph/.test(name) || materialSlot === 'secondary') return 'circuit';
  if (/emissive|glow|core|coil|node|battery|storedmine/.test(name)
    || /emissive|weakpoint/.test(materialSlot)) return 'emissive';
  if (/trim|rim|rail|brace|band|pole|ring|edge/.test(name)
    || /trim|ring/.test(materialSlot)) return 'trim';
  if (/weapon|cannon|mortar|emitter|nozzle|dispenser|magnet|actuator|boom|forearm|palm/.test(name)
    || /weapon|housing/.test(materialSlot)) return 'housing';
  if (/joint|dark|socket/.test(materialSlot)) return 'joint';
  return 'armor';
}

function requireRole(role) {
  const definition = REAVERBOT_SURFACE_ROLE_LAYOUTS[role];
  if (!definition) throw new Error(`Unknown Reaverbot semantic surface role: ${String(role)}`);
  return definition;
}

function chooseRegionId({ scope, moduleId, partName, role, groupIndex }) {
  const roleLayout = requireRole(role);
  if (roleLayout.regionIds.length === 1) return roleLayout.regionIds[0];
  const stablePart = normalizedPartName(partName);
  const base = deterministicHash(`${scope}|${moduleId}|${stablePart}|${role}`);
  return roleLayout.regionIds[(base + groupIndex) % roleLayout.regionIds.length];
}

function getGeometryGroups(geometry, uvCount) {
  if (Array.isArray(geometry.groups) && geometry.groups.length > 0) {
    return geometry.groups.map((group, groupIndex) => ({
      start: group.start,
      count: group.count,
      materialIndex: group.materialIndex,
      groupIndex,
    }));
  }
  const indexCount = geometry.getIndex?.()?.count ?? 0;
  return [{
    start: 0,
    count: indexCount || uvCount,
    materialIndex: 0,
    groupIndex: 0,
    allVertices: true,
  }];
}

function vertexIndicesForGroup(geometry, group) {
  if (group.allVertices) {
    const uvCount = geometry.getAttribute('uv')?.count ?? 0;
    return Array.from({ length: uvCount }, (_, index) => index);
  }
  const index = geometry.getIndex?.();
  const result = [];
  const end = group.start + group.count;
  if (index) {
    for (let cursor = group.start; cursor < end; cursor += 1) result.push(index.getX(cursor));
  } else {
    for (let cursor = group.start; cursor < end; cursor += 1) result.push(cursor);
  }
  return [...new Set(result)];
}

function groupsShareVertices(geometry, groups) {
  if (!geometry.getIndex?.() || groups.length < 2) return false;
  const owners = new Map();
  for (const group of groups) {
    for (const vertexIndex of vertexIndicesForGroup(geometry, group)) {
      const owner = owners.get(vertexIndex);
      if (owner !== undefined && owner !== group.groupIndex) return true;
      owners.set(vertexIndex, group.groupIndex);
    }
  }
  return false;
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function remapGroupUv(geometry, group, rect, mirror, reverseWorkingEnd) {
  const uv = geometry.getAttribute('uv');
  const [u0, v0, u1, v1] = rect;
  for (const vertexIndex of vertexIndicesForGroup(geometry, group)) {
    const sourceU = clampUnit(uv.getX(vertexIndex));
    const sourceV = clampUnit(uv.getY(vertexIndex));
    const normalizedU = mirror ? 1 - sourceU : sourceU;
    const normalizedV = reverseWorkingEnd ? 1 - sourceV : sourceV;
    uv.setXY(
      vertexIndex,
      u0 + normalizedU * (u1 - u0),
      v0 + normalizedV * (v1 - v0),
    );
  }
  uv.needsUpdate = true;
}

/**
 * Remap one freshly-created primitive to deterministic semantic atlas regions.
 * The shared THREE.Texture is never cloned or mutated; variation lives solely
 * in the geometry UV attribute.  If indexed material groups share vertices,
 * a non-indexed replacement is returned so each group remains independent.
 */
export function applyReaverbotSemanticUv(geometry, {
  scope,
  moduleId,
  partName,
  role = null,
  slot = '',
  mirror = false,
  workingEnd = 'vMax',
} = {}) {
  if (!geometry?.isBufferGeometry) {
    throw new Error('applyReaverbotSemanticUv requires a THREE.BufferGeometry');
  }
  if (!geometry.getAttribute?.('uv')) {
    throw new Error(`Reaverbot part ${String(partName)} has no UV attribute`);
  }
  if (!scope || !moduleId || !partName) {
    throw new Error('Reaverbot semantic UV mapping requires scope, moduleId, and partName');
  }

  const resolvedRole = role ?? inferReaverbotSurfaceRole(partName, slot);
  const roleLayout = requireRole(resolvedRole);
  const mappingKey = [scope, moduleId, normalizedPartName(partName), resolvedRole, Boolean(mirror), workingEnd].join('|');
  const existing = geometry.userData?.reaverbotSemanticUv;
  if (existing) {
    if (existing.mappingKey !== mappingKey) {
      throw new Error(`Reaverbot geometry ${String(partName)} already has a different semantic UV mapping`);
    }
    return {
      geometry,
      regionIds: [...existing.regionIds],
      uvRects: existing.uvRects.map((rect) => [...rect]),
      valueClass: existing.valueClass,
      mappingMode: existing.mappingMode,
    };
  }

  let targetGeometry = geometry;
  let uv = targetGeometry.getAttribute('uv');
  let groups = getGeometryGroups(targetGeometry, uv.count);
  if (groupsShareVertices(targetGeometry, groups)) {
    targetGeometry = targetGeometry.toNonIndexed();
    uv = targetGeometry.getAttribute('uv');
    groups = getGeometryGroups(targetGeometry, uv.count);
  }

  const regionIds = [];
  const uvRects = [];
  for (const group of groups) {
    const regionId = chooseRegionId({
      scope,
      moduleId,
      partName,
      role: resolvedRole,
      groupIndex: group.groupIndex,
    });
    const region = REAVERBOT_SEMANTIC_UV_REGIONS[regionId];
    regionIds.push(regionId);
    uvRects.push([...region.rect]);
    remapGroupUv(
      targetGeometry,
      group,
      region.rect,
      Boolean(mirror),
      roleLayout.workingEnd !== null && workingEnd === 'vMin',
    );
  }

  const metadata = {
    version: REAVERBOT_SEMANTIC_UV_LAYOUT.version,
    mappingKey,
    scope,
    moduleId,
    partName,
    role: resolvedRole,
    mirror: Boolean(mirror),
    workingEnd: roleLayout.workingEnd ? workingEnd : null,
    valueClass: roleLayout.valueClass,
    mappingMode: roleLayout.mappingMode,
    regionIds: [...regionIds],
    uvRects: uvRects.map((rect) => [...rect]),
  };
  targetGeometry.userData = targetGeometry.userData ?? {};
  targetGeometry.userData.reaverbotSemanticUv = metadata;

  return {
    geometry: targetGeometry,
    regionIds,
    uvRects,
    valueClass: roleLayout.valueClass,
    mappingMode: roleLayout.mappingMode,
  };
}
