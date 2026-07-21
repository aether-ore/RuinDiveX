import * as THREE from 'three';
import {
  createLegacyCampAssetAdapter,
  validateLegacyCampAssetAdapter,
} from './LegacyCampAssetAdapter.js';

export const SHARED_CAMP_OBJECT_NAMES = Object.freeze({
  roll: 'rollCaskettNpc',
  supportCar: 'expeditionSupportCar',
  workbench: 'rollWorkshopWorkbench',
});

const SUPPORT_CAR_HEIGHT = 3.6;
const SUPPORT_CAR_SOURCE_HEIGHT = 143.5;
const SUPPORT_CAR_HALF_WIDTH = (56.2 / SUPPORT_CAR_SOURCE_HEIGHT) * SUPPORT_CAR_HEIGHT;
const SUPPORT_CAR_FRONT_DOOR_LOCAL = Object.freeze({
  x: SUPPORT_CAR_HALF_WIDTH,
  y: 1.45,
  z: -1.32,
});

function findLandmark(plan, id) {
  const landmark = plan?.landmarks?.find?.((candidate) => candidate.id === id);
  if (!landmark) throw new Error(`OverworldPlan is missing the ${id} camp landmark.`);
  return landmark;
}

function applyLandmarkTransform(object, landmark) {
  object.position.set(landmark.x, landmark.y ?? 0, landmark.z);
  object.rotation.y = landmark.yaw ?? 0;
}

function isAttachedToScene(object) {
  let root = object;
  while (root?.parent) root = root.parent;
  return root?.isScene === true;
}

/**
 * Builds the overworld's camp props with the same authored construction and
 * asset-loading paths used by Dungeon Generation V1. The public adapter is the
 * only module allowed to bridge to the frozen generator's legacy constructors.
 */
export function createSharedCampAssets(plan, {
  assetAdapter = createLegacyCampAssetAdapter(),
} = {}) {
  const adapterValidation = validateLegacyCampAssetAdapter(assetAdapter);
  if (!adapterValidation.accepted) {
    throw new TypeError(`Invalid legacy camp asset adapter: ${adapterValidation.errors.join(', ')}`);
  }
  const supportCarLandmark = findLandmark(plan, SHARED_CAMP_OBJECT_NAMES.supportCar);
  const rollLandmark = findLandmark(plan, SHARED_CAMP_OBJECT_NAMES.roll);
  const workbenchLandmark = findLandmark(plan, SHARED_CAMP_OBJECT_NAMES.workbench);

  const supportCar = new THREE.Group();
  supportCar.name = SHARED_CAMP_OBJECT_NAMES.supportCar;
  applyLandmarkTransform(supportCar, supportCarLandmark);
  supportCar.userData.targetModelHeight = SUPPORT_CAR_HEIGHT;
  supportCar.userData.frontAxis = '-Z';
  supportCar.userData.frontDoorSide = '+X';
  supportCar.userData.usingFallback = true;
  supportCar.userData.sharedCampAsset = true;
  supportCar.add(assetAdapter.createSupportCarFallback());

  const frontDoorMarker = new THREE.Object3D();
  frontDoorMarker.name = 'supportCarFrontDoorMarker';
  frontDoorMarker.position.set(
    SUPPORT_CAR_FRONT_DOOR_LOCAL.x,
    SUPPORT_CAR_FRONT_DOOR_LOCAL.y,
    SUPPORT_CAR_FRONT_DOOR_LOCAL.z,
  );
  supportCar.add(frontDoorMarker);

  const roll = new THREE.Group();
  roll.name = SHARED_CAMP_OBJECT_NAMES.roll;
  applyLandmarkTransform(roll, rollLandmark);
  roll.userData.overworldNpcAnchor = true;
  roll.userData.sharedCampAsset = true;

  const workbench = assetAdapter.createRollWorkshopWorkbench();
  workbench.name = SHARED_CAMP_OBJECT_NAMES.workbench;
  applyLandmarkTransform(workbench, workbenchLandmark);
  workbench.userData.sharedCampAsset = true;

  const root = new THREE.Group();
  root.name = 'overworldSharedCampAssets';
  root.add(supportCar, roll, workbench);

  const npcAnimationMixers = [];
  const npcAnimators = [];
  let disposed = false;

  const activateNpcAssets = () => {
    if (disposed || !isAttachedToScene(root)) return false;

    if (
      !roll.userData.modelLoading
      && !roll.userData.modelLoaded
      && !roll.userData.modelLoadError
    ) {
      assetAdapter.loadRollNpc(roll, npcAnimationMixers, npcAnimators);
    }
    if (
      !supportCar.userData.modelLoading
      && !supportCar.userData.modelLoaded
      && !supportCar.userData.modelLoadError
    ) {
      assetAdapter.loadSupportCar(supportCar);
    }
    if (
      !workbench.userData.textureLoading
      && !workbench.userData.textureAssetsSettled
    ) {
      assetAdapter.loadRollWorkshopTextures(workbench);
    }
    return true;
  };

  const disposeNpcAssets = () => {
    if (disposed) return;
    disposed = true;
    for (const animator of npcAnimators) animator?.dispose?.();
    npcAnimationMixers.length = 0;
    npcAnimators.length = 0;
    roll.userData.sharedCampAssetDisposed = true;
    supportCar.userData.sharedCampAssetDisposed = true;
    workbench.userData.sharedCampAssetDisposed = true;
  };

  return Object.freeze({
    root,
    roll,
    supportCar,
    workbench,
    npcAnimationMixers,
    npcAnimators,
    activateNpcAssets,
    disposeNpcAssets,
  });
}
