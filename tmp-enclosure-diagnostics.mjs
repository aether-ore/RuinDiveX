import * as THREE from 'three';

import { DungeonGenerator } from './src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from './src/reaverbots/SeededRandom.js';
import {
  createIndustrialAugmentationHost,
  createIndustrialBaseDraft,
} from './src/dungeon-augmentation/IndustrialDraftAdapter.js';

const specifications = [
  {
    seed: 'layout:augmentation-runtime-check',
    profile: 'industrial-supplement-preview-v4',
    hash: 'v1:layout:augmentation-runtime-check:depth:1:revolvingFusillade',
  },
];

for (const specification of specifications) {
  const seededRandom = new SeededRandom(hashSeed(specification.seed));
  const generator = new DungeonGenerator({
    random: () => seededRandom.next(),
    difficulty: 1,
    augmentationProfileId: specification.profile,
    augmentationSeed: specification.seed,
    basePlanHash: specification.hash,
  });
  const texture = new THREE.Texture();
  generator._loadRuinTexture = () => texture;
  const planAugmentation = generator._planIndustrialDungeonAugmentation.bind(generator);
  generator._planIndustrialDungeonAugmentation = (planningInput) => {
    console.log(JSON.stringify(planningInput.rooms.map((room) => ({
      id: room.id,
      x: room.x,
      z: room.z,
      width: room.width,
      depth: room.depth,
    })), null, 2));
    const baseDraft = createIndustrialBaseDraft({
      ...planningInput,
      basePlanHash: specification.hash,
      tileSize: generator.tileSize,
      difficulty: 1,
    });
    const host = createIndustrialAugmentationHost({
      baseDraft,
      ...planningInput,
      tileSize: generator.tileSize,
    });
    console.log(JSON.stringify(host.extensionRegions[0].routeNetworkGrants.map((grant) => ({
      id: grant.id,
      kind: grant.kind,
      endpointSockets: grant.endpointSockets.map((socket) => ({
        id: socket.id,
        position: socket.position,
        facing: socket.facing,
        distanceMeters: socket.distanceMeters,
      })),
      sideDiagnostics: grant.planningStationSideDiagnostics?.map((diagnostic) => ({
        sampleIndex: diagnostic.sampleIndex,
        selectedSideSign: diagnostic.selectedSideSign,
        selected: diagnostic.candidates.find(({ sideSign }) => (
          sideSign === diagnostic.selectedSideSign
        )),
      })) ?? null,
    })), null, 2));
    return planAugmentation(planningInput);
  };
  try {
    const dungeon = generator._generateOnce();
    console.log(JSON.stringify({
      seed: specification.seed,
      status: dungeon.augmentationStatus,
      diagnostics: dungeon.augmentationDiagnostics,
      replay: dungeon.augmentationReplayDiagnostics,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      seed: specification.seed,
      error: error.message,
      code: error.code,
      diagnostics: error.augmentationDiagnostics,
      stack: error.stack,
    }, null, 2));
  }
}
