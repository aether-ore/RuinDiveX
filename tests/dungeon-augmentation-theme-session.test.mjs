import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDungeonRegionThemeBinding,
} from '../src/dungeon-augmentation/contracts.js';
import {
  DUNGEON_THEME_RESOURCE_OWNERSHIP,
  DungeonThemeCapabilityError,
  createDungeonThemeResourceLedger,
  createDungeonThemeResourceReference,
  createDungeonThemeSession,
  validateDungeonThemeSession,
} from '../src/dungeon-augmentation/ThemeSession.js';
import {
  INDUSTRIAL_THEME_MATERIAL_ROLE_MAP,
  MAGMA_THEME_MATERIAL_ROLE_MAP,
  createIndustrialThemeAdapter,
  createIndustrialThemeCapabilityManifest,
  createMagmaThemeAdapter,
  createMagmaThemeCapabilityManifest,
  validateMagmaTextureContract,
} from '../src/dungeon-augmentation/ThemeAdapters.js';

function themeBinding(themeId = 'test-theme') {
  return createDungeonRegionThemeBinding({
    parentMapId: `${themeId}-map`,
    parentMapRevision: 'map-r1',
    parentRegionId: `${themeId}-region`,
    themeRef: {
      id: themeId,
      revision: 'theme-r1',
      contentHash: `${themeId}-content-hash`,
    },
    presentationVariantId: `${themeId}-default`,
    localLightingProfileId: `${themeId}-lights`,
    soundscapeProfileId: `${themeId}-ambience`,
  });
}

function disposableResource(id) {
  return {
    id,
    disposeCalls: 0,
    dispose() {
      this.disposeCalls += 1;
    },
  };
}

function materialCollection(roleMap, prefix) {
  return Object.fromEntries([...new Set(Object.values(roleMap))]
    .map((key) => [key, disposableResource(`${prefix}:${key}`)]));
}

function magmaTextureContract(overrides = {}) {
  const sets = Object.fromEntries([...new Set(Object.values(MAGMA_THEME_MATERIAL_ROLE_MAP))]
    .map((key) => [key, `magma-${key}`]));
  return {
    root: '/assets/textures/magma-test/',
    metersPerRepeat: 2.8,
    wrapS: 'RepeatWrapping',
    wrapT: 'RepeatWrapping',
    sets,
    ...overrides,
  };
}

test('Industrial adapter borrows exact parent materials and accepts grammar aliases', () => {
  const materials = materialCollection(INDUSTRIAL_THEME_MATERIAL_ROLE_MAP, 'industrial');
  const floorTexture = disposableResource('industrial:floor-texture');
  floorTexture.isTexture = true;
  materials.floor.map = floorTexture;
  let lightFactoryCalls = 0;
  let skinFactoryCalls = 0;

  const capabilityManifest = createIndustrialThemeCapabilityManifest({
    materials,
    assetFactories: {
      'light-fixture': () => {
        lightFactoryCalls += 1;
        return disposableResource('industrial:light');
      },
    },
    connectorSkinFactories: {
      'service-gallery': () => {
        skinFactoryCalls += 1;
        return disposableResource('industrial:gallery-skin');
      },
    },
  });
  assert.equal(lightFactoryCalls, 0, 'capability inspection must not instantiate an asset');
  assert.equal(skinFactoryCalls, 0, 'capability inspection must not instantiate a connector skin');
  assert.ok(capabilityManifest.materials.includes('primaryFloor'));
  assert.ok(capabilityManifest.assets.includes('lightFixture'));
  assert.ok(capabilityManifest.connectors.includes('serviceGallery'));

  const session = createIndustrialThemeAdapter({
    themeBinding: themeBinding('industrial-v1'),
    materials,
    assetFactories: {
      'light-fixture': () => {
        lightFactoryCalls += 1;
        return disposableResource('industrial:light');
      },
    },
    connectorSkinFactories: {
      'service-gallery': () => {
        skinFactoryCalls += 1;
        return disposableResource('industrial:gallery-skin');
      },
    },
  });

  assert.equal(session.materials.has('primary-floor'), true);
  assert.equal(session.materials.resolve('primary-floor'), materials.floor);
  assert.equal(session.materials.resolve('locked-door'), materials.lockedDoor);
  assert.equal(session.materials.resolve('emissive-accent'), materials.glowBlue);
  assert.equal(session.resources.isBorrowed(materials.floor), true);
  assert.equal(session.resources.isBorrowed(floorTexture), true);
  assert.equal(session.resources.isOwned(materials.floor), false);

  const light = session.assets.create('light-fixture', { anchorId: 'light-1' });
  const skin = session.connectors.createSkin('service-gallery', { edgeId: 'edge-1' });
  assert.equal(lightFactoryCalls, 1);
  assert.equal(skinFactoryCalls, 1);
  assert.equal(session.resources.isOwned(light), true);
  assert.equal(session.resources.isOwned(skin), true);

  const disposal = session.resources.disposeOwned();
  assert.equal(disposal.errors.length, 0);
  assert.equal(light.disposeCalls, 1);
  assert.equal(skin.disposeCalls, 1);
  assert.equal(materials.floor.disposeCalls, 0, 'parent material must not be disposed');
  assert.equal(floorTexture.disposeCalls, 0, 'parent texture must not be disposed');
});

test('capability validation rejects missing requested presentation without invoking factories', () => {
  const materials = materialCollection(INDUSTRIAL_THEME_MATERIAL_ROLE_MAP, 'industrial');
  let materialLoaderCalls = 0;
  const session = createIndustrialThemeAdapter({
    themeBinding: themeBinding('industrial-v1'),
    materials,
    materialLoaders: {
      primaryFloor: () => {
        materialLoaderCalls += 1;
        return materials.floor;
      },
    },
  });
  const validation = validateDungeonThemeSession(session, {
    materials: ['primary-floor', 'wall', 'ceiling', 'support', 'cap'],
    assets: ['light-fixture'],
    connectors: ['service-gallery'],
  });
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.missing.assetRoles, ['lightFixture']);
  assert.deepEqual(validation.missing.connectorFamilies, ['serviceGallery']);
  assert.equal(materialLoaderCalls, 0, 'preflight must not resolve a material');
  assert.throws(
    () => session.assets.create('light-fixture'),
    (error) => error instanceof DungeonThemeCapabilityError
      && error.code === 'missing-theme-capability',
  );
});

test('Industrial adapter rejects an incomplete existing material cache without fallback', () => {
  const materials = materialCollection(INDUSTRIAL_THEME_MATERIAL_ROLE_MAP, 'industrial');
  delete materials.wallTrim;
  assert.throws(
    () => createIndustrialThemeAdapter({
      themeBinding: themeBinding('industrial-v1'),
      materials,
    }),
    (error) => error instanceof DungeonThemeCapabilityError
      && error.code === 'dungeon-theme-session-rejected'
      && error.validation.missing.materialRoles.includes('cap'),
  );
});

test('resource ledger never disposes borrowed values and disposes owned values once', () => {
  const borrowed = disposableResource('borrowed');
  const owned = disposableResource('owned');
  const custom = disposableResource('custom');
  let customDisposals = 0;
  const ledger = createDungeonThemeResourceLedger();
  ledger.borrow(borrowed, { label: 'borrowed-parent-material' });
  ledger.own(owned, { label: 'owned-supplement-geometry' });
  ledger.own(custom, {
    label: 'custom-owned-runtime',
    dispose: () => { customDisposals += 1; },
  });

  const first = ledger.disposeOwned();
  const second = ledger.disposeOwned();
  assert.equal(first.disposed, true);
  assert.equal(second.disposed, false);
  assert.equal(borrowed.disposeCalls, 0);
  assert.equal(owned.disposeCalls, 1);
  assert.equal(custom.disposeCalls, 0);
  assert.equal(customDisposals, 1);
  assert.throws(
    () => ledger.own(disposableResource('late')),
    (error) => error.code === 'theme-resource-ledger-disposed',
  );
});

test('owned material references preserve one custom disposer for single and array values', () => {
  const single = disposableResource('owned-single-material');
  const first = disposableResource('owned-array-material-a');
  const second = disposableResource('owned-array-material-b');
  const materialSet = [first, second];
  const disposedValues = [];
  const session = createDungeonThemeSession({
    themeBinding: themeBinding('custom-material-disposal'),
    materialProviders: {
      primaryFloor: () => createDungeonThemeResourceReference(single, {
        ownership: DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED,
        dispose: (value) => disposedValues.push(value),
      }),
      corridorFloor: () => createDungeonThemeResourceReference(materialSet, {
        ownership: DUNGEON_THEME_RESOURCE_OWNERSHIP.OWNED,
        dispose: (value) => disposedValues.push(value),
      }),
    },
  });

  assert.equal(session.materials.resolve('primary-floor'), single);
  assert.equal(session.materials.resolve('corridor-floor'), materialSet);
  assert.equal(session.resources.isOwned(single), true);
  assert.equal(session.resources.isOwned(materialSet), true);

  const result = session.resources.disposeOwned();
  assert.equal(result.errors.length, 0);
  assert.equal(result.disposedCount, 2);
  assert.equal(disposedValues.filter((value) => value === single).length, 1);
  assert.equal(disposedValues.filter((value) => value === materialSet).length, 1);
  assert.equal(single.disposeCalls, 0);
  assert.equal(first.disposeCalls, 0);
  assert.equal(second.disposeCalls, 0);
});

test('an explicitly borrowed factory result remains parent-owned', () => {
  const materials = materialCollection(INDUSTRIAL_THEME_MATERIAL_ROLE_MAP, 'industrial');
  const sharedFixture = disposableResource('shared-parent-fixture');
  const session = createIndustrialThemeAdapter({
    themeBinding: themeBinding('industrial-v1'),
    materials,
    assetFactories: {
      lightFixture: () => createDungeonThemeResourceReference(
        sharedFixture,
        DUNGEON_THEME_RESOURCE_OWNERSHIP.BORROWED,
      ),
    },
  });
  assert.equal(session.assets.create('light-fixture'), sharedFixture);
  assert.equal(session.resources.isBorrowed(sharedFixture), true);
  session.resources.disposeOwned();
  assert.equal(sharedFixture.disposeCalls, 0);
});

test('Magma adapter preflights and borrows parent-created shared materials lazily', () => {
  const textureContract = magmaTextureContract();
  let materialFactoryCalls = 0;
  const createdMaterials = materialCollection(MAGMA_THEME_MATERIAL_ROLE_MAP, 'magma');
  const ceramicTexture = disposableResource('magma:ceramic-texture');
  ceramicTexture.isTexture = true;
  createdMaterials.ceramic.map = ceramicTexture;
  const extraResource = disposableResource('magma:factory-extra');
  const createSharedMaterials = (receivedContract) => {
    materialFactoryCalls += 1;
    assert.equal(receivedContract, textureContract);
    return {
      materials: createdMaterials,
      resources: [extraResource],
    };
  };

  const manifest = createMagmaThemeCapabilityManifest({
    textureContract,
    createSharedMaterials,
  });
  assert.equal(materialFactoryCalls, 0);
  assert.equal(manifest.materials.length, 14);

  const session = createMagmaThemeAdapter({
    themeBinding: themeBinding('magma-refinery-future'),
    textureContract,
    createSharedMaterials,
  });
  assert.equal(materialFactoryCalls, 0, 'session construction must remain renderer-free');
  assert.equal(session.materials.resolve('primary-floor'), createdMaterials.ceramic);
  assert.equal(materialFactoryCalls, 1);
  assert.equal(session.materials.resolve('ramp'), createdMaterials.ceramic);
  assert.equal(materialFactoryCalls, 1, 'shared material factory must run once');
  assert.equal(session.resources.isBorrowed(createdMaterials.ceramic), true);
  assert.equal(session.resources.isBorrowed(ceramicTexture), true);
  assert.equal(session.resources.isBorrowed(extraResource), true);

  session.resources.disposeOwned();
  assert.equal(createdMaterials.ceramic.disposeCalls, 0);
  assert.equal(ceramicTexture.disposeCalls, 0);
  assert.equal(extraResource.disposeCalls, 0);
});

test('Magma supplied materials are borrowed and never use an Industrial fallback', () => {
  const textureContract = magmaTextureContract();
  const materials = materialCollection(MAGMA_THEME_MATERIAL_ROLE_MAP, 'magma');
  const session = createMagmaThemeAdapter({
    themeBinding: themeBinding('magma-refinery-future'),
    textureContract,
    materials,
  });
  assert.equal(session.materials.resolve('corridor-floor'), materials.serviceGrate);
  assert.equal(session.materials.resolve('wall'), materials.basalt);
  assert.equal(session.resources.isBorrowed(materials.serviceGrate), true);
  session.resources.disposeOwned();
  assert.equal(materials.serviceGrate.disposeCalls, 0);

  const missingMagmaMaterial = { ...materials };
  delete missingMagmaMaterial.serviceGrate;
  assert.throws(
    () => createMagmaThemeAdapter({
      themeBinding: themeBinding('magma-refinery-future'),
      textureContract,
      materials: missingMagmaMaterial,
    }),
    (error) => error instanceof DungeonThemeCapabilityError
      && error.code === 'dungeon-theme-session-rejected'
      && error.validation.missing.materialRoles.includes('corridorFloor'),
  );
});

test('Magma adapter rejects missing texture sets instead of substituting another theme', () => {
  const textureContract = magmaTextureContract();
  delete textureContract.sets.basalt;
  const validation = validateMagmaTextureContract(textureContract, {
    requiredSetKeys: ['basalt'],
  });
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.errors, ['missing-magma-texture-set:basalt']);
  assert.throws(
    () => createMagmaThemeAdapter({
      themeBinding: themeBinding('magma-refinery-future'),
      textureContract,
      materials: materialCollection(MAGMA_THEME_MATERIAL_ROLE_MAP, 'magma'),
    }),
    (error) => error instanceof DungeonThemeCapabilityError
      && error.code === 'invalid-magma-texture-contract',
  );
});
