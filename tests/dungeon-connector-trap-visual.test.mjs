import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import {
  DungeonConnectorTrapVisualFactory,
  prepareRotatingTrapTemplate,
  ROTATING_CEILING_TRACK_TRAP_ASSET,
} from '../src/DungeonConnectorTrapVisualFactory.js';

const ASSET_DIRECTORY = new URL('../assets/models/props/rotating-trap/', import.meta.url);
const AUTHORED_ASSET_SHA256 = Object.freeze({
  'Rotating_Trap.obj': '6280455357d176f308ad15d1b6f36f59fdbf14870e666e0a0fcaa0c1cc064f6a',
  'Rotating_Trap.dae': '87fd95245a8a03f42454fe7a7af2e147bbcf58f0bd359857ee3372655ca8b46b',
  'Rotating_Trap.mtl': 'beda3c958c76d0607417c744f2a342dbac18e6ebb759509bfca033423edd2b41',
  'Rotating_Trap.png': '7f93b69376730339bcc960b6f2360a3142192f948c908457519307289aac701f',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadAuthoredObject() {
  const source = await readFile(new URL('Rotating_Trap.obj', ASSET_DIRECTORY), 'utf8');
  return new OBJLoader().parse(source);
}

function createTexture() {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return texture;
}

test('runtime and preserved source assets are present with their original material reference', async () => {
  const [obj, dae, mtl, png] = await Promise.all([
    readFile(new URL('Rotating_Trap.obj', ASSET_DIRECTORY)),
    readFile(new URL('Rotating_Trap.dae', ASSET_DIRECTORY)),
    readFile(new URL('Rotating_Trap.mtl', ASSET_DIRECTORY), 'utf8'),
    readFile(new URL('Rotating_Trap.png', ASSET_DIRECTORY)),
  ]);
  assert.ok(obj.length > 0);
  assert.ok(dae.length > 0);
  assert.ok(png.length > 8);
  assert.match(mtl, /map_Kd\s+Rotating_Trap\.png/);
  assert.equal(sha256(obj), AUTHORED_ASSET_SHA256['Rotating_Trap.obj']);
  assert.equal(sha256(dae), AUTHORED_ASSET_SHA256['Rotating_Trap.dae']);
  assert.equal(sha256(Buffer.from(mtl)), AUTHORED_ASSET_SHA256['Rotating_Trap.mtl']);
  assert.equal(sha256(png), AUTHORED_ASSET_SHA256['Rotating_Trap.png']);
  assert.equal(png.readUInt32BE(16), 128, 'supplied PNG width must remain unchanged');
  assert.equal(png.readUInt32BE(20), 128, 'supplied PNG height must remain unchanged');
  assert.equal(png[24], 8, 'supplied PNG must remain eight-bit');
  assert.equal(png[25], 6, 'supplied PNG must retain its RGBA alpha channel');
  assert.equal(ROTATING_CEILING_TRACK_TRAP_ASSET.runtimeModel, 'Rotating_Trap.obj');
  assert.equal(ROTATING_CEILING_TRACK_TRAP_ASSET.runtimeTexture, 'Rotating_Trap.png');
  assert.equal(ROTATING_CEILING_TRACK_TRAP_ASSET.sourceModel, 'Rotating_Trap.dae');
  assert.equal(ROTATING_CEILING_TRACK_TRAP_ASSET.sourceMaterial, 'Rotating_Trap.mtl');
  assert.ok(ROTATING_CEILING_TRACK_TRAP_ASSET.contactOffsetMeters.y < -6);
});

test('authored OBJ is normalized to a 2.2 metre rotor and ceiling-mounted source maximum', async () => {
  const source = await loadAuthoredObject();
  const texture = createTexture();
  const prepared = prepareRotatingTrapTemplate(source, texture);
  prepared.rotor.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(prepared.rotor);
  const size = bounds.getSize(new THREE.Vector3());

  assert.ok(Math.abs(Math.max(size.x, size.z) - 2.2) < 1e-6);
  assert.ok(Math.abs(bounds.max.y) < 1e-6, 'source maximum Y must align to the mount origin');
  assert.equal(prepared.material.alphaTest, 0.5);
  assert.equal(prepared.material.transparent, false);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(texture.magFilter, THREE.NearestFilter);
  assert.equal(texture.minFilter, THREE.NearestMipmapNearestFilter);
  assert.equal(texture.generateMipmaps, true);
  assert.ok(prepared.rotor.userData.normalizedHeightMeters > 0);
  assert.ok(Math.abs(
    prepared.rotor.userData.contactOffsetMeters.y
      - ROTATING_CEILING_TRACK_TRAP_ASSET.contactOffsetMeters.y
  ) < 1e-8);

  const materials = new Set();
  prepared.rotor.traverse((object) => {
    if (object.isMesh) materials.add(object.material);
  });
  assert.deepEqual([...materials], [prepared.material]);
});

test('visual factory loads the shared template once and releases instance roots without per-instance disposal', async () => {
  const authored = await loadAuthoredObject();
  const texture = createTexture();
  let modelLoads = 0;
  let textureLoads = 0;
  const factory = new DungeonConnectorTrapVisualFactory({
    objLoader: {
      async loadAsync() {
        modelLoads += 1;
        return authored;
      },
    },
    textureLoader: {
      async loadAsync() {
        textureLoads += 1;
        return texture;
      },
    },
  });

  const first = await factory.createInstance({ id: 'trap-a' });
  const second = await factory.createInstance({ id: 'trap-b' });
  assert.equal(modelLoads, 1);
  assert.equal(textureLoads, 1);
  assert.equal(factory.getDiagnostics().loadCount, 1);
  assert.equal(factory.getDiagnostics().activeInstanceCount, 2);
  assert.equal(first.userData.rotorDiameterMeters, 2.2);
  assert.equal(second.userData.rotorDiameterMeters, 2.2);

  const firstMesh = first.getObjectByProperty('isMesh', true);
  const secondMesh = second.getObjectByProperty('isMesh', true);
  assert.equal(firstMesh.geometry, secondMesh.geometry, 'instances must share cached geometry');
  assert.equal(firstMesh.material, secondMesh.material, 'instances must share cached material');

  assert.equal(factory.releaseInstance(first), true);
  assert.equal(factory.getDiagnostics().activeInstanceCount, 1);
  assert.equal(factory.dispose(), true);
  assert.equal(factory.getDiagnostics().activeInstanceCount, 0);
  assert.equal(factory.getDiagnostics().resourcesDisposed, true);
  await assert.rejects(factory.createInstance({ id: 'late' }), /disposed/);
});

test('asymmetric OBJ or PNG loader failures dispose the successful peer resource', async () => {
  for (const failingKind of ['obj', 'png']) {
    const source = createAuthoredTrapSourceWithDisposalCounters();
    const texture = createTexture();
    let textureDisposeCount = 0;
    const disposeTexture = texture.dispose.bind(texture);
    texture.dispose = () => {
      textureDisposeCount += 1;
      disposeTexture();
    };
    const factory = new DungeonConnectorTrapVisualFactory({
      objLoader: {
        async loadAsync() {
          if (failingKind === 'obj') throw new Error('obj-load-failure');
          return source.root;
        },
      },
      textureLoader: {
        async loadAsync() {
          if (failingKind === 'png') throw new Error('png-load-failure');
          return texture;
        },
      },
    });

    await assert.rejects(
      factory.createInstance({ id: `asymmetric-${failingKind}` }),
      new RegExp(`rotating-trap-asset-load-failed:.*${failingKind}`),
    );
    if (failingKind === 'png') {
      assert.equal(source.getGeometryDisposeCount(), 1);
      assert.equal(source.getMaterialDisposeCount(), 1);
    } else {
      assert.equal(textureDisposeCount, 1);
    }
    assert.equal(factory.getDiagnostics().resourcesDisposed, true);
    factory.dispose();
  }
});

function createAuthoredTrapSourceWithDisposalCounters() {
  const geometry = new THREE.BoxGeometry(2, 1.4, 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  let geometryDisposeCount = 0;
  let materialDisposeCount = 0;
  const disposeGeometry = geometry.dispose.bind(geometry);
  const disposeMaterial = material.dispose.bind(material);
  geometry.dispose = () => {
    geometryDisposeCount += 1;
    disposeGeometry();
  };
  material.dispose = () => {
    materialDisposeCount += 1;
    disposeMaterial();
  };
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material));
  return {
    root,
    getGeometryDisposeCount: () => geometryDisposeCount,
    getMaterialDisposeCount: () => materialDisposeCount,
  };
}
