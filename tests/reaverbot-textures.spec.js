import { expect, test } from '@playwright/test';

const EXPECTED_IDS = Object.freeze({
  body: [
    'biped',
    'lowBiped',
    'quadruped',
    'tripod',
    'crawler',
    'hopper',
    'hoverBell',
    'flyer',
  ],
  weapon: [
    'rocketLance',
    'crusherJaw',
    'clawArm',
    'pounceActuator',
    'launchLeg',
    'shockPiston',
    'pulseCannon',
    'mortarPod',
    'clusterMortar',
    'arcEmitter',
    'flameNozzle',
    'beamPrism',
    'mineDispenser',
    'rotorBlade',
    'tractorMagnet',
    'overloadCore',
  ],
  defense: [
    'directionalShield',
    'armoredSkull',
    'sidePlates',
    'armoredBack',
    'armoredCarapace',
    'guardArms',
    'armorShutters',
    'rotatingPlates',
    'energyMembrane',
    'phaseShell',
    'reactivePlate',
  ],
  weakPoint: [
    'rearBattery',
    'bellyCore',
    'eyeLens',
    'shieldHinge',
    'ammoDrum',
    'coolingVents',
    'emitterCore',
    'overloadCore',
    'legJoint',
    'counterweightCore',
    'clawPalm',
  ],
});

const TEXTURE_URL_FRAGMENT = '/assets/textures/reaverbots/';
const EYE_TEXTURE_KEY = 'eyeRedLens';
const EYE_TEXTURE_SHA256 = 'c02c6989943283794b3a25ea8c32b7f869346ef83f2161097409102528049392';

test('procedural Reaverbot modules load, share, assign, and render their authored textures', async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  const pageErrors = [];
  const failedTextureRequests = [];
  const textureResponses = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    if (request.url().includes(TEXTURE_URL_FRAGMENT)) {
      failedTextureRequests.push({
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown request failure',
      });
    }
  });
  page.on('response', (response) => {
    if (response.url().includes(TEXTURE_URL_FRAGMENT)) {
      textureResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?startupWorld=dungeon&reaverbotSeed=texture-runtime-browser-proof');
  await page.waitForFunction(() => Boolean(window.game && window.spawnReaverbot));

  const structural = await page.evaluate(async (expectedIds) => {
    const THREE = await import('three');
    const catalog = await import('/src/reaverbots/ReaverbotCatalog.js');
    const bossCatalog = await import('/src/reaverbots/ReaverbotBossCatalog.js');
    const textureCatalog = await import('/src/reaverbots/ReaverbotTextureCatalog.js');
    const textureLibrary = await import('/src/reaverbots/ReaverbotTextureLibrary.js');
    const { generateReaverbotGenome } = await import('/src/reaverbots/ReaverbotGenerator.js');
    const {
      animateReaverbotVisual,
      createReaverbotVisual,
    } = await import('/src/reaverbots/ReaverbotVisualFactory.js');

    const game = window.game;
    game.stop();

    const collections = {
      body: catalog.REAVERBOT_BODY_PLANS,
      weapon: catalog.REAVERBOT_WEAPONS,
      defense: catalog.REAVERBOT_DEFENSES,
      weakPoint: catalog.REAVERBOT_WEAK_POINTS,
    };
    const profileCollections = {
      body: textureCatalog.REAVERBOT_BODY_TEXTURE_PROFILES,
      weapon: textureCatalog.REAVERBOT_WEAPON_TEXTURE_PROFILES,
      defense: textureCatalog.REAVERBOT_DEFENSE_TEXTURE_PROFILES,
      weakPoint: textureCatalog.REAVERBOT_WEAK_POINT_TEXTURE_PROFILES,
    };
    const scopeNames = {
      body: 'body',
      weapon: 'weapon',
      defense: 'defense',
      weakPoint: 'weakPoint',
    };
    const cloneDefinition = (definition) => structuredClone(definition);
    const baseGenome = generateReaverbotGenome({
      seed: 'texture-runtime-fixture-base',
      threatTier: 3,
      archetypeId: 'shieldSentinel',
      encounterSize: 2,
    });

    let fixtureIndex = 0;
    const setBody = (genome, id) => {
      const definition = collections.body[id];
      genome.body = {
        ...genome.body,
        planId: definition.id,
        label: definition.label,
        navigationMode: definition.tags.includes('aerial') ? 'air' : 'ground',
        hoverHeight: definition.hoverHeight ?? 0,
        tags: [...definition.tags],
      };
    };
    const setWeapon = (genome, id) => {
      genome.modules.weapon = cloneDefinition(collections.weapon[id]);
    };
    const setDefense = (genome, id) => {
      genome.modules.defense = id ? cloneDefinition(collections.defense[id]) : null;
    };
    const setWeakPoint = (genome, id) => {
      genome.modules.weakPoint = cloneDefinition(collections.weakPoint[id]);
    };
    const makeGenericGenome = (label) => {
      const genome = structuredClone(baseGenome);
      fixtureIndex += 1;
      genome.seed = `texture-fixture-${fixtureIndex}`;
      genome.seedLabel = label;
      genome.name = label;
      setBody(genome, 'biped');
      setWeapon(genome, 'pulseCannon');
      setDefense(genome, 'reactivePlate');
      setWeakPoint(genome, 'rearBattery');
      return genome;
    };
    const configureWeaponFixture = (genome, id) => {
      setWeapon(genome, id);
      if (id === 'crusherJaw') {
        setBody(genome, 'quadruped');
        setDefense(genome, 'armorShutters');
        setWeakPoint(genome, 'eyeLens');
      } else if (id === 'pounceActuator') {
        setBody(genome, 'hopper');
        genome.body.mobilityId = 'pairedSprings';
        genome.body.mobilityLabel = 'Paired Spring Legs';
        genome.body.movementModel = 'springBounce';
        genome.body.mobilityLegCount = 2;
        genome.modules.weapon.mountRole = 'locomotion';
        genome.modules.weapon.integratedIntoMobility = true;
      } else if (id === 'launchLeg') {
        setBody(genome, 'hopper');
        genome.body.mobilityId = 'launchLeg';
        genome.body.mobilityLabel = 'Launch Leg';
        genome.body.movementModel = 'springBounce';
        genome.body.mobilityLegCount = 1;
        genome.body.tags = [...new Set([...genome.body.tags, 'springLoaded', 'singleLegged', 'rocketAssisted'])];
        genome.modules.weapon.mountRole = 'locomotion';
        genome.modules.weapon.integratedIntoMobility = true;
        genome.modules.weapon.mountSide = 1;
        setDefense(genome, 'sidePlates');
        setWeakPoint(genome, 'legJoint');
      } else if (id === 'clawArm') {
        setDefense(genome, null);
        setWeakPoint(genome, 'clawPalm');
        genome.modules.weapon.mountSide = 1;
      } else if (id === 'rotorBlade') {
        setBody(genome, 'hoverBell');
        setDefense(genome, 'rotatingPlates');
        setWeakPoint(genome, 'counterweightCore');
      } else if (id === 'tractorMagnet') {
        setBody(genome, 'flyer');
        setDefense(genome, 'phaseShell');
        setWeakPoint(genome, 'emitterCore');
      } else if (id === 'overloadCore') {
        setBody(genome, 'flyer');
        setDefense(genome, 'energyMembrane');
        setWeakPoint(genome, 'overloadCore');
      }
    };
    const configureWeakPointFixture = (genome, id) => {
      if (id === 'clawPalm') {
        configureWeaponFixture(genome, 'clawArm');
      } else {
        setWeakPoint(genome, id);
      }
    };

    const familyFixtures = [];
    for (const [family, ids] of Object.entries(expectedIds)) {
      for (const id of ids) {
        const genome = makeGenericGenome(`${family}-${id}`);
        if (family === 'body') setBody(genome, id);
        if (family === 'weapon') configureWeaponFixture(genome, id);
        if (family === 'defense') {
          setDefense(genome, id);
          if (id === 'phaseShell') setBody(genome, 'flyer');
        }
        if (family === 'weakPoint') configureWeakPointFixture(genome, id);
        familyFixtures.push({ family, id, genome, visual: createReaverbotVisual(genome) });
      }
    }

    const materialSet = (root) => {
      const result = new Set();
      root.traverse((object) => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (material?.isMaterial) result.add(material);
        }
      });
      return result;
    };
    const registryMaterialSet = (value, result = new Set(), visited = new Set()) => {
      if (!value || typeof value !== 'object' || visited.has(value)) return result;
      visited.add(value);
      if (value.isMaterial) {
        result.add(value);
        return result;
      }
      for (const child of Object.values(value)) registryMaterialSet(child, result, visited);
      return result;
    };
    const effectiveVisible = (object, boundary) => {
      for (let current = object; current; current = current.parent) {
        if (!current.visible) return false;
        if (current === boundary) return true;
      }
      return false;
    };
    const textureChannels = ['map', 'emissiveMap', 'alphaMap'];
    const visibleMaterialViolations = [];
    const unmappedFxViolations = [];
    const uvViolations = [];
    const semanticSurfaceViolations = [];
    const semanticUvViolations = [];
    const textureMetadataViolations = [];
    const exemptionReasons = new Set();
    const semanticSurfaces = [];
    let visibleMeshCount = 0;
    let mappedVisibleMaterialCount = 0;

    const flattenRegionIds = (value) => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(flattenRegionIds);
      if (value && typeof value === 'object') return Object.values(value).flatMap(flattenRegionIds);
      return [];
    };
    const flattenUvRects = (value) => {
      if (Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)) return [value];
      if (Array.isArray(value)) return value.flatMap(flattenUvRects);
      if (value && typeof value === 'object') return Object.values(value).flatMap(flattenUvRects);
      return [];
    };
    const uvGroupsFor = (object) => {
      const geometry = object.geometry;
      const uv = object.geometry?.getAttribute?.('uv');
      if (!uv || uv.count === 0) return null;
      const index = geometry.getIndex?.();
      const groups = Array.isArray(geometry.groups) && geometry.groups.length > 0
        ? geometry.groups
        : [{ start: 0, count: index?.count ?? uv.count, materialIndex: 0 }];
      return groups.map((group, groupIndex) => {
        const referenced = new Set();
        const end = group.start + group.count;
        for (let cursor = group.start; cursor < end; cursor += 1) {
          referenced.add(index ? index.getX(cursor) : cursor);
        }
        const bounds = {
          groupIndex,
          materialIndex: group.materialIndex ?? 0,
          vertexCount: referenced.size,
          minU: Infinity,
          maxU: -Infinity,
          minV: Infinity,
          maxV: -Infinity,
          nonFinite: false,
        };
        for (const vertexIndex of referenced) {
          const u = uv.getX(vertexIndex);
          const v = uv.getY(vertexIndex);
          if (!Number.isFinite(u) || !Number.isFinite(v)) {
            bounds.nonFinite = true;
            continue;
          }
          bounds.minU = Math.min(bounds.minU, u);
          bounds.maxU = Math.max(bounds.maxU, u);
          bounds.minV = Math.min(bounds.minV, v);
          bounds.maxV = Math.max(bounds.maxV, v);
        }
        return bounds;
      });
    };
    const expectedModuleForScope = (genome, scope) => ({
      body: genome.body.planId,
      weapon: genome.modules.weapon.id,
      defense: genome.modules.defense?.id ?? 'integratedClawGuard',
      weakPoint: genome.modules.weakPoint.id,
      eye: genome.modules.eye.id,
      decor: genome.body.planId,
    }[scope] ?? null);

    for (const fixture of familyFixtures) {
      fixture.visual.root.traverse((object) => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        const mappedMaterials = materials.filter((material) => (
          textureChannels.some((channel) => Boolean(material?.[channel]))
        ));
        const mappedNonExemptMaterials = mappedMaterials.filter((material) => !(
          typeof material?.userData?.reaverbotTextureExempt === 'string'
          && material.userData.reaverbotTextureExempt.trim()
        ));
        for (const material of materials) {
          const exemption = material?.userData?.reaverbotTextureExempt;
          if (exemption) exemptionReasons.add(exemption);
          const hasAuthoredMap = textureChannels.some((channel) => Boolean(material?.[channel]));
          if (!hasAuthoredMap && !(typeof exemption === 'string' && exemption.trim())) {
            unmappedFxViolations.push(`${fixture.family}/${fixture.id}:${object.name}:${material?.name}`);
          }
        }

        const uvGroups = uvGroupsFor(object);
        if (mappedNonExemptMaterials.length > 0) {
          const surface = object.userData?.reaverbotSurface;
          const label = `${fixture.family}/${fixture.id}:${object.name}`;
          if (!surface || typeof surface !== 'object') {
            semanticSurfaceViolations.push(`${label}:missing-semantic-surface`);
          } else {
            const requiredStrings = ['scope', 'moduleId', 'partName', 'role', 'valueClass', 'mappingMode'];
            for (const field of requiredStrings) {
              if (typeof surface[field] !== 'string' || !surface[field].trim()) {
                semanticSurfaceViolations.push(`${label}:missing-${field}`);
              }
            }
            const expectedModuleId = expectedModuleForScope(fixture.genome, surface.scope);
            if (expectedModuleId && surface.moduleId !== expectedModuleId) {
              semanticSurfaceViolations.push(
                `${label}:module-${surface.moduleId}-does-not-match-${surface.scope}-${expectedModuleId}`,
              );
            }

            const regionIds = flattenRegionIds(surface.regionIds);
            const uvRects = flattenUvRects(surface.uvRects);
            const assetKeys = [...new Set(mappedNonExemptMaterials.flatMap((material) => (
              textureChannels
                .map((channel) => material?.[channel]?.userData?.reaverbotTexture?.assetKey)
                .filter(Boolean)
            )))];
            const fullMapRole = surface.scope === 'eye'
              || assetKeys.includes('energyFieldMask')
              || /eye|energy|field/i.test(`${surface.role} ${surface.partName}`);
            if (surface.mappingMode === 'fullMap') {
              if (!fullMapRole) semanticSurfaceViolations.push(`${label}:unapproved-full-map-${surface.role}`);
              if (regionIds.length === 0 || regionIds.some((regionId) => regionId !== 'fullMap')) {
                semanticSurfaceViolations.push(`${label}:full-map-missing-full-map-region`);
              }
              if (uvRects.length === 0 || uvRects.some((rect) => (
                rect.length !== 4
                || rect.some((value, index) => Math.abs(value - [0, 0, 1, 1][index]) > 1e-6)
              ))) {
                semanticUvViolations.push(`${label}:full-map-rect-changed`);
              }
              if (uvGroups && (regionIds.length !== uvGroups.length || uvRects.length !== uvGroups.length)) {
                semanticUvViolations.push(
                  `${label}:full-map-group-alignment-${uvGroups.length}-${regionIds.length}-${uvRects.length}`,
                );
              }
            } else if (surface.mappingMode !== 'region') {
              semanticSurfaceViolations.push(`${label}:unknown-mapping-mode-${surface.mappingMode}`);
            } else {
              if (regionIds.length === 0) semanticSurfaceViolations.push(`${label}:missing-region-id`);
              if (uvRects.length === 0) semanticSurfaceViolations.push(`${label}:missing-uv-rect`);
              for (const rect of uvRects) {
                const [u0, v0, u1, v1] = rect;
                if (![u0, v0, u1, v1].every(Number.isFinite)
                  || !(u1 > u0) || !(v1 > v0)
                  || !(u0 > 0) || !(v0 > 0) || !(u1 < 1) || !(v1 < 1)) {
                  semanticUvViolations.push(`${label}:invalid-or-unpadded-rect-${JSON.stringify(rect)}`);
                }
              }
              if (uvGroups && (regionIds.length !== uvGroups.length || uvRects.length !== uvGroups.length)) {
                semanticUvViolations.push(
                  `${label}:group-region-alignment-${uvGroups.length}-${regionIds.length}-${uvRects.length}`,
                );
              }
              const epsilon = 1e-5;
              for (const groupBounds of uvGroups ?? []) {
                const rect = uvRects[groupBounds.groupIndex];
                if (!rect || groupBounds.nonFinite) continue;
                const [u0, v0, u1, v1] = rect;
                const contained = groupBounds.minU >= u0 - epsilon
                  && groupBounds.maxU <= u1 + epsilon
                  && groupBounds.minV >= v0 - epsilon
                  && groupBounds.maxV <= v1 + epsilon;
                if (!contained) {
                  semanticUvViolations.push(
                    `${label}:group-${groupBounds.groupIndex}-bounds-${JSON.stringify(groupBounds)}-outside-${JSON.stringify(rect)}`,
                  );
                }
                if (groupBounds.minU <= epsilon && groupBounds.minV <= epsilon
                  && groupBounds.maxU >= 1 - epsilon && groupBounds.maxV >= 1 - epsilon) {
                  semanticUvViolations.push(`${label}:group-${groupBounds.groupIndex}-still-samples-full-map`);
                }
              }
            }

            semanticSurfaces.push({
              fixtureFamily: fixture.family,
              fixtureId: fixture.id,
              name: object.name,
              visible: effectiveVisible(object, fixture.visual.root),
              scope: surface.scope,
              moduleId: surface.moduleId,
              partName: surface.partName,
              role: surface.role,
              valueClass: surface.valueClass,
              mappingMode: surface.mappingMode,
              regionIds,
              uvRects,
              assetKeys,
            });
          }
        }

        if (!effectiveVisible(object, fixture.visual.root)) return;
        visibleMeshCount += 1;
        for (const material of materials) {
          const mappedChannels = textureChannels.filter((channel) => Boolean(material?.[channel]));
          const exemption = material?.userData?.reaverbotTextureExempt;
          if (mappedChannels.length === 0 && !(typeof exemption === 'string' && exemption.trim())) {
            visibleMaterialViolations.push(`${fixture.family}/${fixture.id}:${object.name}:${material?.name}`);
          }
          if (mappedChannels.length === 0) continue;
          mappedVisibleMaterialCount += 1;

          if (!uvGroups) {
            uvViolations.push(`${fixture.family}/${fixture.id}:${object.name}:missing-uv`);
          } else {
            for (const groupBounds of uvGroups) {
              if (groupBounds.nonFinite) {
                uvViolations.push(`${fixture.family}/${fixture.id}:${object.name}:group-${groupBounds.groupIndex}-non-finite-uv`);
              } else if (groupBounds.vertexCount === 0
                || !(groupBounds.maxU > groupBounds.minU)
                || !(groupBounds.maxV > groupBounds.minV)) {
                uvViolations.push(`${fixture.family}/${fixture.id}:${object.name}:group-${groupBounds.groupIndex}-degenerate-uv`);
              }
            }
          }

          const assignment = material.userData?.reaverbotTexture;
          if (!assignment) {
            textureMetadataViolations.push(`${fixture.family}/${fixture.id}:${material.name}:missing-assignment`);
          }
          for (const channel of mappedChannels) {
            const texture = material[channel];
            const metadata = texture.userData?.reaverbotTexture;
            if (!metadata?.assetKey || metadata.shared !== true) {
              textureMetadataViolations.push(`${fixture.family}/${fixture.id}:${material.name}.${channel}:missing-shared-metadata`);
              continue;
            }
            if (texture !== textureLibrary.getReaverbotTexture(metadata.assetKey)) {
              textureMetadataViolations.push(`${fixture.family}/${fixture.id}:${material.name}.${channel}:not-cache-instance`);
            }
            if (assignment && assignment.assetPaths?.[metadata.assetKey] !== metadata.assetPath) {
              textureMetadataViolations.push(`${fixture.family}/${fixture.id}:${material.name}.${channel}:path-mismatch`);
            }
          }
        }
      });
    }

    const assignmentViolations = [];
    const coverage = {};
    const declaredAssetKeys = (value) => {
      if (typeof value === 'string') return textureCatalog.REAVERBOT_TEXTURE_ASSETS[value] ? [value] : [];
      if (Array.isArray(value)) return value.flatMap(declaredAssetKeys);
      if (value && typeof value === 'object') return Object.values(value).flatMap(declaredAssetKeys);
      return [];
    };
    for (const [family, ids] of Object.entries(expectedIds)) {
      coverage[family] = familyFixtures
        .filter((fixture) => fixture.family === family)
        .map((fixture) => fixture.id)
        .sort();
      for (const id of ids) {
        const fixture = familyFixtures.find((candidate) => candidate.family === family && candidate.id === id);
        const scope = scopeNames[family];
        const scopedMaterials = registryMaterialSet(fixture.visual.materials.scopes[scope]);
        const assignments = [...scopedMaterials]
          .map((material) => material.userData?.reaverbotTexture)
          .filter((assignment) => assignment?.scope === scope && assignment.moduleId === id);
        if (assignments.length === 0) assignmentViolations.push(`${family}/${id}:no-scoped-material-assignment`);

        const resolved = fixture.visual.materials.textureProfile[family];
        const declared = profileCollections[family][id];
        if (!resolved || JSON.stringify(resolved) !== JSON.stringify(declared)) {
          assignmentViolations.push(`${family}/${id}:resolved-profile-mismatch`);
        }
        if (declaredAssetKeys(declared).length === 0) {
          assignmentViolations.push(`${family}/${id}:profile-references-no-texture-asset`);
        }
      }
    }

    const moduleSemanticViolations = [];
    const moduleSemanticCoverage = {};
    const moduleSemanticSignatures = {};
    for (const [family, ids] of Object.entries(expectedIds)) {
      const scope = scopeNames[family];
      moduleSemanticCoverage[family] = {};
      moduleSemanticSignatures[family] = {};
      for (const id of ids) {
        let surfaces = semanticSurfaces.filter((surface) => (
          surface.fixtureFamily === family
          && surface.fixtureId === id
          && surface.scope === scope
          && surface.moduleId === id
        ));
        if (family === 'weakPoint' && id === 'eyeLens' && surfaces.length === 0) {
          const fixture = familyFixtures.find((candidate) => (
            candidate.family === 'weakPoint' && candidate.id === 'eyeLens'
          ));
          const sharedEyeIsValid = fixture?.visual?.weakPoint?.sharedWithEye === true
            && fixture.visual.weakPoint.core === fixture.visual.eye.lens
            && fixture.visual.eye.lens.userData?.weakPointId === 'eyeLens';
          if (sharedEyeIsValid) {
            surfaces = semanticSurfaces.filter((surface) => (
              surface.fixtureFamily === 'weakPoint'
              && surface.fixtureId === 'eyeLens'
              && surface.scope === 'eye'
              && surface.role === 'eye'
            ));
          } else {
            moduleSemanticViolations.push('weakPoint/eyeLens:shared-eye-contract-broken');
          }
        }
        const roles = [...new Set(surfaces.map((surface) => surface.role))].sort();
        const regionSignatures = [...new Set(surfaces.flatMap((surface) => (
          surface.regionIds.map((regionId) => `${surface.assetKeys.join('+')}:${regionId}`)
        )))].sort();
        moduleSemanticCoverage[family][id] = {
          surfaceCount: surfaces.length,
          roles,
          regionCount: regionSignatures.length,
        };
        moduleSemanticSignatures[family][id] = JSON.stringify(
          surfaces
            .flatMap((surface) => surface.regionIds.map((regionId) => (
              `${surface.role}:${surface.valueClass}:${surface.assetKeys.join('+')}:${regionId}`
            )))
            .sort(),
        );
        if (surfaces.length === 0) moduleSemanticViolations.push(`${family}/${id}:no-semantic-surfaces`);
        if (roles.length >= 2 && regionSignatures.length < 2) {
          moduleSemanticViolations.push(`${family}/${id}:distinct-roles-alias-one-region`);
        }
      }
      const signatures = Object.values(moduleSemanticSignatures[family]);
      if (new Set(signatures).size !== signatures.length) {
        moduleSemanticViolations.push(`${family}:module-layout-signatures-are-not-unique`);
      }
    }

    const requiredBodyRoles = ['armorFace', 'circuitPanel', 'bearing'];
    for (const id of expectedIds.body) {
      const roles = moduleSemanticCoverage.body[id]?.roles ?? [];
      for (const role of requiredBodyRoles) {
        if (!roles.includes(role)) moduleSemanticViolations.push(`body/${id}:missing-${role}`);
      }
    }

    const groundedBodyIds = ['biped', 'lowBiped', 'quadruped', 'tripod', 'crawler', 'hopper'];
    const groundedWorkingEndProof = {};
    for (const id of groundedBodyIds) {
      const workingEnds = semanticSurfaces.filter((surface) => (
        surface.fixtureFamily === 'body'
        && surface.fixtureId === id
        && surface.scope === 'body'
        && surface.moduleId === id
        && surface.visible
        && surface.role === 'workingEnd'
        && /foot|paw|talon|skid|ground/i.test(surface.partName)
      ));
      groundedWorkingEndProof[id] = workingEnds.map((surface) => ({
        partName: surface.partName,
        valueClass: surface.valueClass,
        regionIds: surface.regionIds,
      }));
      if (workingEnds.length === 0) moduleSemanticViolations.push(`body/${id}:missing-visible-foot-working-end`);
      if (workingEnds.some((surface) => surface.valueClass !== 'dark')) {
        moduleSemanticViolations.push(`body/${id}:working-end-is-not-dark`);
      }
    }

    const clawSurfaces = semanticSurfaces.filter((surface) => (
      surface.fixtureFamily === 'weapon'
      && surface.fixtureId === 'clawArm'
      && surface.scope === 'weapon'
      && surface.moduleId === 'clawArm'
      && surface.visible
    ));
    const clawRoleCounts = Object.fromEntries(
      ['bearing', 'hinge', 'circuitPanel', 'workingEnd'].map((role) => [
        role,
        clawSurfaces.filter((surface) => surface.role === role).length,
      ]),
    );
    if (clawRoleCounts.bearing < 1) moduleSemanticViolations.push('weapon/clawArm:missing-visible-bearing');
    if (clawRoleCounts.hinge < 1) moduleSemanticViolations.push('weapon/clawArm:missing-visible-hinge');
    if (clawRoleCounts.circuitPanel < 1) moduleSemanticViolations.push('weapon/clawArm:missing-deliberate-circuit-panel');
    if (clawRoleCounts.workingEnd < 3) moduleSemanticViolations.push('weapon/clawArm:needs-three-visible-working-ends');
    if (clawSurfaces.some((surface) => surface.role === 'workingEnd' && surface.valueClass !== 'dark')) {
      moduleSemanticViolations.push('weapon/clawArm:working-end-is-not-dark');
    }

    const eyeViolations = [];
    const eyeProofs = [];
    for (const fixture of familyFixtures) {
      const eyes = [];
      fixture.visual.root.traverse((object) => {
        if (object.isMesh && object.userData?.reaverbotEye) eyes.push(object);
      });
      const dominantEyes = eyes.filter((object) => object.userData?.dominantFocalPoint === true);
      const { lens, socket, glint, group: eyeGroup } = fixture.visual.eye;
      const assignment = lens.material?.userData?.reaverbotTexture;
      const surface = lens.userData?.reaverbotSurface;
      const label = `${fixture.family}/${fixture.id}`;
      if (dominantEyes.length !== 1 || dominantEyes[0] !== lens) eyeViolations.push(`${label}:dominant-eye-count`);
      if (eyeGroup.name !== 'generatedReaverbotEyeMotif') eyeViolations.push(`${label}:eye-group-name`);
      if (lens.name !== 'generatedReaverbotRedEye') eyeViolations.push(`${label}:lens-name`);
      if (socket.name !== 'generatedReaverbotEyeSocket') eyeViolations.push(`${label}:socket-name`);
      if (glint.name !== 'generatedReaverbotEyeGlint') eyeViolations.push(`${label}:glint-name`);
      if (lens.geometry?.type !== 'SphereGeometry'
        || lens.geometry?.parameters?.widthSegments !== 12
        || lens.geometry?.parameters?.heightSegments !== 7) eyeViolations.push(`${label}:lens-geometry`);
      if (socket.geometry?.type !== 'CylinderGeometry'
        || socket.geometry?.parameters?.radialSegments !== 12) eyeViolations.push(`${label}:socket-geometry`);
      if (Math.abs(lens.scale.x - 1) > 1e-6
        || Math.abs(lens.scale.y - 1) > 1e-6
        || Math.abs(lens.scale.z - 0.38) > 1e-6
        || Math.abs(lens.position.z - 0.055) > 1e-6) eyeViolations.push(`${label}:lens-transform`);
      if (lens.material?.color?.getHex() !== 0xff254f
        || lens.material?.emissive?.getHex() !== 0xff254f
        || Math.abs(lens.material?.emissiveIntensity - 1.8) > 1e-6) eyeViolations.push(`${label}:eye-material`);
      if (assignment?.mapKey !== 'eyeRedLens'
        || lens.material?.map !== textureLibrary.getReaverbotTexture('eyeRedLens')) {
        eyeViolations.push(`${label}:eye-map`);
      }
      if (surface?.mappingMode !== 'fullMap' || surface?.scope !== 'eye') {
        eyeViolations.push(`${label}:eye-full-map-semantic`);
      }
      eyeProofs.push({
        fixture: label,
        eyeCount: eyes.length,
        dominantEyeCount: dominantEyes.length,
        mapKey: assignment?.mapKey ?? null,
        mappingMode: surface?.mappingMode ?? null,
      });
    }

    for (const assetKey of Object.keys(textureCatalog.REAVERBOT_TEXTURE_ASSETS)) {
      textureLibrary.getReaverbotTexture(assetKey);
    }
    const cacheIdentity = Object.fromEntries(
      Object.keys(textureCatalog.REAVERBOT_TEXTURE_ASSETS).map((assetKey) => [
        assetKey,
        textureLibrary.getReaverbotTexture(assetKey) === textureLibrary.getReaverbotTexture(assetKey),
      ]),
    );

    const twinGenome = makeGenericGenome('independent-material-twin');
    const twinA = createReaverbotVisual(twinGenome);
    const twinB = createReaverbotVisual(structuredClone(twinGenome));
    const twinAMaterials = registryMaterialSet(twinA.materials);
    const twinBMaterials = registryMaterialSet(twinB.materials);
    const twinBSet = new Set(twinBMaterials);
    const sharedMaterialCount = [...twinAMaterials].filter((material) => twinBSet.has(material)).length;
    const twinATextures = new Map();
    const twinBTextures = new Map();
    for (const [materials, textures] of [[twinAMaterials, twinATextures], [twinBMaterials, twinBTextures]]) {
      for (const material of materials) {
        for (const channel of textureChannels) {
          const texture = material[channel];
          const assetKey = texture?.userData?.reaverbotTexture?.assetKey;
          if (assetKey) textures.set(assetKey, texture);
        }
      }
    }
    const twinTextureIdentity = Object.fromEntries(
      [...twinATextures.keys()].map((assetKey) => [
        assetKey,
        twinATextures.get(assetKey) === twinBTextures.get(assetKey)
          && twinATextures.get(assetKey) === textureLibrary.getReaverbotTexture(assetKey),
      ]),
    );

    const makeGalleryGenome = (body, weapon, defense, weakPoint, index) => {
      const genome = makeGenericGenome(`texture-gallery-${index}-${body}-${weapon}`);
      const paletteEntries = Object.entries(catalog.REAVERBOT_PALETTES);
      const [paletteId, palette] = paletteEntries[index % paletteEntries.length];
      genome.paletteId = paletteId;
      genome.palette = structuredClone(palette);
      setBody(genome, body);
      configureWeaponFixture(genome, weapon);
      setBody(genome, body);
      setDefense(genome, defense);
      setWeakPoint(genome, weakPoint);
      if (weapon === 'clawArm') {
        setDefense(genome, null);
        setWeakPoint(genome, 'clawPalm');
        genome.modules.weapon.mountSide = index % 2 ? -1 : 1;
      }
      return genome;
    };
    const galleryDefinitions = [
      ['biped', 'pulseCannon', 'directionalShield', 'rearBattery'],
      ['lowBiped', 'clawArm', null, 'clawPalm'],
      ['quadruped', 'crusherJaw', 'armorShutters', 'eyeLens'],
      ['tripod', 'mortarPod', 'armoredCarapace', 'ammoDrum'],
      ['crawler', 'clusterMortar', 'armoredBack', 'bellyCore'],
      ['hopper', 'pounceActuator', 'sidePlates', 'legJoint'],
      ['hoverBell', 'rotorBlade', 'rotatingPlates', 'counterweightCore'],
      ['flyer', 'tractorMagnet', 'phaseShell', 'emitterCore'],
    ];
    const galleryVisuals = galleryDefinitions.map((definition, index) => (
      createReaverbotVisual(makeGalleryGenome(...definition, index))
    ));
    animateReaverbotVisual(galleryVisuals[1], {
      time: 1.2,
      dt: 1,
      state: 'telegraph',
      stateProgress: 0.82,
      attackKind: 'clawMoveset',
      clawAttackVariant: 'horizontalSwipe',
      clawExtension: 0.72,
      weakPointExposed: true,
    });
    const galleryRoots = galleryVisuals.map((visual) => visual.root);
    const xPositions = [-4.8, -1.6, 1.6, 4.8];
    galleryVisuals.forEach((visual, index) => {
      visual.root.position.x = xPositions[index % 4];
      visual.root.position.z = index < 4 ? 0.7 : -3.2;
      visual.root.rotation.y = index < 4 ? -0.18 : 0.18;
      visual.root.scale.multiplyScalar(index < 4 ? 0.82 : 0.88);
      visual.root.userData.reaverbotTextureGallery = true;
      game.scene.add(visual.root);
    });
    const belongsToGallery = (object) => galleryRoots.some((root) => {
      for (let current = object; current; current = current.parent) {
        if (current === root) return true;
      }
      return false;
    });
    game.scene.traverse((object) => {
      if (object.isMesh && !belongsToGallery(object)) object.visible = false;
    });
    game.player.root.visible = false;
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) uiRoot.style.display = 'none';
    game.scene.fog = null;
    game.scene.background?.set?.(0x111720);
    const galleryHemisphere = new THREE.HemisphereLight(0xd8ecff, 0x25231d, 2.2);
    const galleryKey = new THREE.DirectionalLight(0xffefce, 2.8);
    galleryKey.position.set(-5, 10, 8);
    game.scene.add(galleryHemisphere, galleryKey);
    game.camera.position.set(0, 6.5, 13.8);
    game.camera.lookAt(new THREE.Vector3(0, 1.25, -1.15));
    game.camera.updateMatrixWorld(true);
    for (const root of galleryRoots) root.updateMatrixWorld(true);
    game.renderer.setAnimationLoop(() => game.renderer.render(game.scene, game.camera));

    const allProofRoots = [
      ...galleryRoots,
      ...familyFixtures.map((fixture) => fixture.visual.root),
    ];
    for (const root of allProofRoots) {
      root.userData.textureProofBaseScale ??= root.scale.clone();
    }
    const showOnly = (roots) => {
      const visible = new Set(roots);
      for (const root of allProofRoots) root.visible = visible.has(root);
    };
    const showFamily = (family) => {
      const fixtures = familyFixtures.filter((fixture) => fixture.family === family);
      const columns = family === 'weapon' ? 5 : 4;
      const spacingX = 3.05;
      const spacingZ = 3.15;
      const rows = Math.ceil(fixtures.length / columns);
      const roots = fixtures.map((fixture) => fixture.visual.root);
      showOnly(roots);
      fixtures.forEach((fixture, index) => {
        const root = fixture.visual.root;
        if (!root.parent) game.scene.add(root);
        const column = index % columns;
        const row = Math.floor(index / columns);
        root.position.set(
          (column - (Math.min(columns, fixtures.length) - 1) * 0.5) * spacingX,
          fixture.genome.body.hoverHeight ?? 0,
          (row - (rows - 1) * 0.5) * -spacingZ,
        );
        root.rotation.set(0, index % 2 ? -0.2 : 0.2, 0);
        root.scale.copy(root.userData.textureProofBaseScale).multiplyScalar(family === 'weapon' ? 0.64 : 0.72);
        root.updateMatrixWorld(true);
      });
      game.camera.position.set(0, 6.8 + rows * 0.6, 12.5 + rows * 2.15);
      game.camera.lookAt(new THREE.Vector3(0, 1.15, -0.55));
      game.camera.updateMatrixWorld(true);
      return fixtures.length;
    };
    const showClawDetail = () => {
      const visual = galleryVisuals[1];
      showOnly([visual.root]);
      visual.root.visible = true;
      const bounds = new THREE.Box3().setFromObject(visual.weapon.group);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      game.camera.position.set(
        center.x + Math.max(2.4, size.x * 0.85),
        center.y + Math.max(1.2, size.y * 0.45),
        center.z + Math.max(3.2, size.z * 0.9),
      );
      game.camera.lookAt(center);
      game.camera.updateMatrixWorld(true);
    };
    const showGroundedWorkingEnds = () => {
      const grounded = familyFixtures.filter((fixture) => (
        fixture.family === 'body' && groundedBodyIds.includes(fixture.id)
      ));
      const roots = grounded.map((fixture) => fixture.visual.root);
      showOnly(roots);
      grounded.forEach((fixture, index) => {
        const root = fixture.visual.root;
        if (!root.parent) game.scene.add(root);
        root.position.set((index - (grounded.length - 1) * 0.5) * 2.08, 0, 0);
        root.rotation.set(0, index % 2 ? -0.18 : 0.18, 0);
        root.scale.copy(root.userData.textureProofBaseScale).multiplyScalar(0.76);
        root.updateMatrixWorld(true);
      });
      game.camera.position.set(0, 1.35, 10.8);
      game.camera.lookAt(new THREE.Vector3(0, 0.45, 0));
      game.camera.updateMatrixWorld(true);
    };
    const showEyeDetail = () => {
      const visual = galleryVisuals[0];
      showOnly([visual.root]);
      visual.root.visible = true;
      visual.eye.lens.updateWorldMatrix(true, false);
      const center = visual.eye.lens.getWorldPosition(new THREE.Vector3());
      game.camera.position.set(center.x + 0.35, center.y + 0.18, center.z + 1.35);
      game.camera.lookAt(center);
      game.camera.updateMatrixWorld(true);
    };

    window.__reaverbotTextureRuntimeProof = {
      fixtureCount: familyFixtures.length,
      familyFixtures,
      galleryVisuals,
      galleryHemisphere,
      galleryKey,
      twinA,
      twinB,
      showFamily,
      showClawDetail,
      showGroundedWorkingEnds,
      showEyeDetail,
    };

    return {
      catalogKeys: Object.fromEntries(
        Object.entries(collections).map(([family, collection]) => [family, Object.keys(collection).sort()]),
      ),
      profileKeys: Object.fromEntries(
        Object.entries(profileCollections).map(([family, collection]) => [family, Object.keys(collection).sort()]),
      ),
      coverage,
      fixtureCount: familyFixtures.length,
      visibleMeshCount,
      mappedVisibleMaterialCount,
      visibleMaterialViolations,
      unmappedFxViolations,
      uvViolations,
      semanticSurfaceViolations,
      semanticUvViolations,
      textureMetadataViolations,
      assignmentViolations,
      moduleSemanticViolations,
      moduleSemanticCoverage,
      moduleSemanticSignatures,
      groundedWorkingEndProof,
      clawRoleCounts,
      eyeViolations,
      eyeProofs,
      exemptionReasons: [...exemptionReasons].sort(),
      textureAssetKeys: Object.keys(textureCatalog.REAVERBOT_TEXTURE_ASSETS).sort(),
      bossPortraitPaths: bossCatalog.REAVERBOT_BOSS_PROFILE_IDS
        .map((profileId) => `/assets/textures/reaverbots/bosses/${profileId}/hunt-portrait.png`)
        .sort(),
      cacheIdentity,
      sharedMaterialCount,
      twinMaterialCounts: [twinAMaterials.size, twinBMaterials.size],
      twinTextureIdentity,
      galleryCount: galleryVisuals.length,
      unusedMeshMaterialCounts: [materialSet(twinA.root).size, materialSet(twinB.root).size],
    };
  }, EXPECTED_IDS);

  const sortedExpected = Object.fromEntries(
    Object.entries(EXPECTED_IDS).map(([family, ids]) => [family, [...ids].sort()]),
  );
  expect(structural.catalogKeys).toEqual(sortedExpected);
  expect(structural.profileKeys).toEqual(sortedExpected);
  expect(structural.coverage).toEqual(sortedExpected);
  expect(structural.fixtureCount).toBe(46);
  expect(structural.visibleMeshCount).toBeGreaterThan(800);
  expect(structural.mappedVisibleMaterialCount).toBeGreaterThan(800);
  expect(structural.visibleMaterialViolations).toEqual([]);
  expect(structural.unmappedFxViolations).toEqual([]);
  expect(structural.uvViolations).toEqual([]);
  expect(structural.semanticSurfaceViolations).toEqual([]);
  expect(structural.semanticUvViolations).toEqual([]);
  expect(structural.textureMetadataViolations).toEqual([]);
  expect(structural.assignmentViolations).toEqual([]);
  expect(structural.moduleSemanticViolations).toEqual([]);
  expect(structural.eyeViolations).toEqual([]);
  expect(structural.clawRoleCounts).toMatchObject({
    bearing: expect.any(Number),
    hinge: expect.any(Number),
    circuitPanel: expect.any(Number),
    workingEnd: expect.any(Number),
  });
  expect(structural.clawRoleCounts.bearing).toBeGreaterThanOrEqual(1);
  expect(structural.clawRoleCounts.hinge).toBeGreaterThanOrEqual(1);
  expect(structural.clawRoleCounts.circuitPanel).toBeGreaterThanOrEqual(1);
  expect(structural.clawRoleCounts.workingEnd).toBeGreaterThanOrEqual(3);
  for (const bodyId of ['biped', 'lowBiped', 'quadruped', 'tripod', 'crawler', 'hopper']) {
    expect(structural.groundedWorkingEndProof[bodyId]?.length, `${bodyId} dark foot working ends`).toBeGreaterThan(0);
    expect(structural.groundedWorkingEndProof[bodyId].every((entry) => entry.valueClass === 'dark')).toBe(true);
  }
  expect(structural.eyeProofs).toHaveLength(46);
  expect(structural.eyeProofs.every((proof) => (
    proof.dominantEyeCount === 1
    && proof.mapKey === EYE_TEXTURE_KEY
    && proof.mappingMode === 'fullMap'
  ))).toBe(true);
  expect(structural.exemptionReasons).toContain('tiny procedural eye highlight');
  expect(structural.exemptionReasons).toContain('animated additive tractor field');
  expect(structural.cacheIdentity).toEqual(
    Object.fromEntries(structural.textureAssetKeys.map((assetKey) => [assetKey, true])),
  );
  expect(structural.sharedMaterialCount).toBe(0);
  expect(structural.twinMaterialCounts[0]).toBeGreaterThan(15);
  expect(structural.twinMaterialCounts[1]).toBe(structural.twinMaterialCounts[0]);
  expect(Object.values(structural.twinTextureIdentity)).not.toHaveLength(0);
  expect(Object.values(structural.twinTextureIdentity).every(Boolean)).toBe(true);
  expect(structural.galleryCount).toBe(8);

  await expect.poll(async () => page.evaluate(async () => {
    const { getReaverbotTextureDiagnostics } = await import('/src/reaverbots/ReaverbotTextureLibrary.js');
    return Object.entries(getReaverbotTextureDiagnostics())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => entry.loadState);
  }), {
    message: 'all cached Reaverbot atlas and focal-map images should finish loading',
    timeout: 15_000,
  }).toEqual(structural.textureAssetKeys.map(() => 'loaded'));

  const browserTextures = await page.evaluate(async () => {
    const THREE = await import('three');
    const { REAVERBOT_TEXTURE_ASSETS } = await import('/src/reaverbots/ReaverbotTextureCatalog.js');
    const {
      getReaverbotTexture,
      getReaverbotTextureDiagnostics,
    } = await import('/src/reaverbots/ReaverbotTextureLibrary.js');
    const wraps = {
      repeat: THREE.RepeatWrapping,
      mirroredRepeat: THREE.MirroredRepeatWrapping,
      clampToEdge: THREE.ClampToEdgeWrapping,
    };
    const minFilters = {
      nearest: THREE.NearestFilter,
      nearestMipmapNearest: THREE.NearestMipmapNearestFilter,
      nearestMipmapLinear: THREE.NearestMipmapLinearFilter,
      linear: THREE.LinearFilter,
      linearMipmapNearest: THREE.LinearMipmapNearestFilter,
      linearMipmapLinear: THREE.LinearMipmapLinearFilter,
    };
    const magFilters = {
      nearest: THREE.NearestFilter,
      linear: THREE.LinearFilter,
    };
    const diagnostics = getReaverbotTextureDiagnostics();
    const samplerViolations = [];
    for (const [assetKey, asset] of Object.entries(REAVERBOT_TEXTURE_ASSETS)) {
      const texture = getReaverbotTexture(assetKey);
      const expectedColorSpace = asset.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      const checks = {
        colorSpace: texture.colorSpace === expectedColorSpace,
        wrapS: texture.wrapS === wraps[asset.wrapS],
        wrapT: texture.wrapT === wraps[asset.wrapT],
        declaredClampS: asset.wrapS === 'clampToEdge',
        declaredClampT: asset.wrapT === 'clampToEdge',
        runtimeClampS: texture.wrapS === THREE.ClampToEdgeWrapping,
        runtimeClampT: texture.wrapT === THREE.ClampToEdgeWrapping,
        minFilter: texture.minFilter === minFilters[asset.minFilter],
        magFilter: texture.magFilter === magFilters[asset.magFilter],
        repeatX: texture.repeat.x === asset.repeat[0],
        repeatY: texture.repeat.y === asset.repeat[1],
        declaredUnitRepeat: asset.repeat[0] === 1 && asset.repeat[1] === 1,
        runtimeUnitRepeat: texture.repeat.x === 1 && texture.repeat.y === 1,
        zeroOffset: texture.offset.x === 0 && texture.offset.y === 0,
        zeroRotation: texture.rotation === 0,
        anisotropy: texture.anisotropy === asset.anisotropy,
        generateMipmaps: texture.generateMipmaps === asset.generateMipmaps,
        shared: texture.userData?.reaverbotTexture?.shared === true,
        fallback: texture.userData?.reaverbotTexture?.fallbackUsed === false,
      };
      for (const [field, passed] of Object.entries(checks)) {
        if (!passed) samplerViolations.push(`${assetKey}:${field}`);
      }
    }
    const eyeAsset = REAVERBOT_TEXTURE_ASSETS.eyeRedLens;
    const eyeBytes = await fetch(eyeAsset.path).then((response) => response.arrayBuffer());
    const eyeDigest = await crypto.subtle.digest('SHA-256', eyeBytes);
    const eyeSha256 = [...new Uint8Array(eyeDigest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return { diagnostics, samplerViolations, eyeSha256 };
  });

  expect(Object.keys(browserTextures.diagnostics).sort()).toEqual(structural.textureAssetKeys);
  expect(browserTextures.samplerViolations).toEqual([]);
  expect(browserTextures.eyeSha256).toBe(EYE_TEXTURE_SHA256);
  for (const [assetKey, diagnostic] of Object.entries(browserTextures.diagnostics)) {
    expect(diagnostic.assetKey).toBe(assetKey);
    expect(diagnostic.assetPath).toContain(TEXTURE_URL_FRAGMENT);
    expect(diagnostic.loadState).toBe('loaded');
    expect(diagnostic.fallbackUsed).toBe(false);
    expect(diagnostic.shared).toBe(true);
    expect(diagnostic.naturalWidth).toBeGreaterThan(0);
    expect(diagnostic.naturalHeight).toBeGreaterThan(0);
    expect(diagnostic.imageWidth).toBe(diagnostic.naturalWidth);
    expect(diagnostic.imageHeight).toBe(diagnostic.naturalHeight);
    if (assetKey === EYE_TEXTURE_KEY) {
      expect(diagnostic.naturalWidth).toBe(256);
      expect(diagnostic.naturalHeight).toBe(256);
    }
  }

  await page.waitForTimeout(150);
  expect(failedTextureRequests).toEqual([]);
  expect(textureResponses.filter((response) => response.status >= 400)).toEqual([]);
  const successfulTexturePaths = [...new Set(textureResponses
    .filter((response) => response.status === 200)
    .map((response) => new URL(response.url).pathname))].sort();
  const successfulPortraitPaths = successfulTexturePaths
    .filter((path) => path.endsWith('/hunt-portrait.png'));
  const successfulSemanticTexturePaths = successfulTexturePaths
    .filter((path) => !path.endsWith('/hunt-portrait.png'));
  const diagnosticTexturePaths = Object.values(browserTextures.diagnostics)
    .map((diagnostic) => diagnostic.assetPath)
    .sort();
  expect(successfulSemanticTexturePaths).toEqual(diagnosticTexturePaths);
  expect(successfulPortraitPaths).toEqual(structural.bossPortraitPaths);
  expect(pageErrors).toEqual([]);

  const galleryScreenshot = await page.screenshot({ fullPage: false });
  await testInfo.attach('procedural-reaverbot-texture-gallery', {
    body: galleryScreenshot,
    contentType: 'image/png',
  });

  for (const family of ['body', 'weapon', 'defense', 'weakPoint']) {
    const fixtureCount = await page.evaluate((selectedFamily) => (
      window.__reaverbotTextureRuntimeProof.showFamily(selectedFamily)
    ), family);
    expect(fixtureCount).toBe(EXPECTED_IDS[family].length);
    await page.waitForTimeout(50);
    await testInfo.attach(`procedural-reaverbot-semantic-${family}-gallery`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
  }

  await page.evaluate(() => window.__reaverbotTextureRuntimeProof.showClawDetail());
  await page.waitForTimeout(50);
  await testInfo.attach('procedural-reaverbot-semantic-claw-detail', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });

  await page.evaluate(() => window.__reaverbotTextureRuntimeProof.showGroundedWorkingEnds());
  await page.waitForTimeout(50);
  await testInfo.attach('procedural-reaverbot-grounded-working-ends', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });

  await page.evaluate(() => window.__reaverbotTextureRuntimeProof.showEyeDetail());
  await page.waitForTimeout(50);
  await testInfo.attach('procedural-reaverbot-eye-regression-closeup', {
    body: await page.screenshot({ fullPage: false }),
    contentType: 'image/png',
  });
});
