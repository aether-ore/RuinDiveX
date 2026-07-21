import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneObjectGraph } from 'three/addons/utils/SkeletonUtils.js';
import {
  createSemanticRoomPackPresentationRuntimeV1,
} from '../../../src/dungeon-v2/SemanticRoomPackPresentationV1.js';

const PACK_ASSET_ROOT = new URL(
  '../../../assets/models/rooms/ruindivex-room-pack-v1/',
  import.meta.url,
);

function roomIdFromAssetPath(assetPath) {
  const match = String(assetPath).match(/([^/\\]+)\.glb(?:[?#].*)?$/i);
  if (!match) throw new Error(`Cannot resolve a room-pack room ID from ${assetPath}.`);
  return match[1];
}

const RUNTIME_AUDITS = new WeakMap();

class NodeFileGLTFLoader extends GLTFLoader {
  constructor(audit) {
    super();
    this.audit = audit;
  }

  async loadAsync(assetPath) {
    const roomId = roomIdFromAssetPath(assetPath);
    const bytes = await readFile(new URL(`glb/${roomId}.glb`, PACK_ASSET_ROOT));
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await this.parseAsync(arrayBuffer, '');
    let nodeCount = 0;
    let meshCount = 0;
    gltf.scene?.traverse((object) => {
      nodeCount += 1;
      if (object.isMesh) meshCount += 1;
    });
    this.audit.loads.push({
      roomId,
      assetPath: String(assetPath),
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      nodeCount,
      meshCount,
      sceneParsed: Boolean(gltf.scene?.isObject3D),
    });
    return gltf;
  }
}

/**
 * Preloads the actual supplied GLBs for assembly acceptance. This deliberately
 * does not synthesize meshes from manifest metadata: the live assembler must
 * attach and map the authored object graphs that production loads.
 */
export async function createRealRoomPackRuntime(roomIds) {
  globalThis.self ??= globalThis;
  const requestedRoomIds = [...roomIds];
  if (requestedRoomIds.length === 0
    || new Set(requestedRoomIds).size !== requestedRoomIds.length) {
    throw new Error('Real room-pack acceptance requires a non-empty unique room inventory.');
  }
  const audit = {
    requestedRoomIds: requestedRoomIds.slice().sort(),
    loads: [],
    manifests: [],
  };
  const loader = new NodeFileGLTFLoader(audit);
  const runtime = createSemanticRoomPackPresentationRuntimeV1({
    runtimeModules: {
      three: THREE,
      GLTFLoader,
      mergeGeometries,
      cloneObjectGraph,
    },
    loader,
    manifestLoader: async (_manifestPath, { roomId }) => {
      const source = await readFile(new URL(`manifests/${roomId}.json`, PACK_ASSET_ROOT), 'utf8');
      audit.manifests.push({ roomId, byteLength: Buffer.byteLength(source), parsed: true });
      return JSON.parse(source);
    },
    mergeStaticVisuals: false,
  });
  await runtime.preload(requestedRoomIds);
  RUNTIME_AUDITS.set(runtime, { audit, loader });
  return runtime;
}

export function getRealRoomPackRuntimeDiagnostics(runtime) {
  const record = RUNTIME_AUDITS.get(runtime);
  if (!record) throw new Error('Runtime was not created by the real room-pack GLTF acceptance loader.');
  const { audit, loader } = record;
  return Object.freeze({
    schemaVersion: 'real-room-pack-node-gltf-audit/1',
    loaderClass: loader.constructor.name,
    loaderIsGLTFLoader: loader instanceof GLTFLoader,
    parser: 'three/addons/loaders/GLTFLoader.parseAsync',
    requestedRoomIds: Object.freeze(audit.requestedRoomIds.slice()),
    loadedRoomIds: Object.freeze(audit.loads.map(({ roomId }) => roomId).sort()),
    loads: Object.freeze(audit.loads.map((entry) => Object.freeze({ ...entry }))),
    manifests: Object.freeze(audit.manifests.map((entry) => Object.freeze({ ...entry }))),
    cache: runtime.getCacheDiagnostics(),
  });
}
