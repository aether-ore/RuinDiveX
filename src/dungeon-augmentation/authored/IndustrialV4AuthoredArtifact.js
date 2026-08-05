import {
  assertIndustrialV4AuthoredArtifact,
  compileIndustrialV4AuthoredArtifact,
  createDungeonAugmentationAbortError,
  DungeonAugmentationAuthoredArtifactError,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  INDUSTRIAL_V4_AUTHORED_COMPOSITION,
  INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
  INDUSTRIAL_V4_AUTHORED_TRUSTED_PAYLOAD_VERIFICATION_MODE,
  verifyIndustrialV4AuthoredArtifact,
} from './AuthoredArtifactCompiler.js';
import { deepFreezeDungeonAugmentationValue } from '../canonical.js';

let bundledArtifactPromise = null;

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw createDungeonAugmentationAbortError();
}

const BUILD_RECEIPT_FIELDS = Object.freeze([
  'artifactId',
  'artifactRevision',
  'generationMode',
  'profileId',
  'profileRevision',
  'artifactHash',
  'sourceContentHash',
  'baseGeometryHash',
  'baseDraftDescriptorHash',
  'canonicalBaseRandomTapeHash',
  'overlayPlanHash',
  'effectiveLayoutHash',
  'materializedLayoutHash',
  'materializedLayoutDescriptorHash',
  'renderBatchManifestHash',
  'runtimeStateManifestHash',
  'assetManifestHash',
]);

function assertBundledBuildReceipt(artifact, receipt) {
  const errors = [];
  if (receipt?.schema !== 'ruindivex-dungeon-augmentation-authored-build-receipt/v1') {
    errors.push({ field: 'schema', actual: receipt?.schema ?? null });
  }
  for (const field of BUILD_RECEIPT_FIELDS) {
    if (artifact?.[field] !== receipt?.[field]) {
      errors.push({
        field,
        expected: receipt?.[field] ?? null,
        actual: artifact?.[field] ?? null,
      });
    }
  }
  if (errors.length > 0) {
    throw new DungeonAugmentationAuthoredArtifactError(
      'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_BUILD_RECEIPT_MISMATCH',
      'The bundled Industrial V4 artifact does not match its compiler build receipt.',
      { errors },
    );
  }
  return receipt;
}

async function loadBundledArtifact() {
  const bundled = await import('./IndustrialV4AuthoredArtifact.generated.js');
  const artifact = await bundled.loadIndustrialV4AuthoredArtifactPayload();
  const receipt = assertBundledBuildReceipt(
    artifact,
    bundled.INDUSTRIAL_V4_AUTHORED_ARTIFACT_BUILD_RECEIPT,
  );
  const verifiedArtifact = assertIndustrialV4AuthoredArtifact(
    artifact,
    {
      profileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
      verifyArtifactHash: false,
      expectedArtifactHash: receipt.artifactHash,
      verificationMode: INDUSTRIAL_V4_AUTHORED_TRUSTED_PAYLOAD_VERIFICATION_MODE,
    },
  );
  return deepFreezeDungeonAugmentationValue(verifiedArtifact);
}

/**
 * Loads the sealed Industrial V4 artifact without creating a worker or
 * invoking the procedural planner. Integrity failures are synchronous to the
 * returned promise and never fall back to an unaugmented dungeon.
 */
export async function loadIndustrialV4AuthoredArtifact({
  profileId = INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  signal = null,
  artifact = null,
  source = null,
} = {}) {
  throwIfAborted(signal);
  if (profileId !== INDUSTRIAL_V4_AUTHORED_PROFILE_ID) {
    throw new DungeonAugmentationAuthoredArtifactError(
      'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_PROFILE_MISMATCH',
      `Industrial V4 artifact cannot satisfy profile ${String(profileId)}.`,
      { expectedProfileId: INDUSTRIAL_V4_AUTHORED_PROFILE_ID, actualProfileId: profileId },
    );
  }

  let resolved = artifact;
  if (!resolved && source) resolved = compileIndustrialV4AuthoredArtifact(source);
  const usesBundledArtifact = !resolved;
  if (usesBundledArtifact) {
    bundledArtifactPromise ??= loadBundledArtifact().catch((error) => {
      bundledArtifactPromise = null;
      throw error;
    });
    resolved = await bundledArtifactPromise;
  }
  throwIfAborted(signal);
  if (usesBundledArtifact) return resolved;
  return assertIndustrialV4AuthoredArtifact(resolved, { profileId });
}

export {
  assertIndustrialV4AuthoredArtifact,
  compileIndustrialV4AuthoredArtifact,
  DungeonAugmentationAuthoredArtifactError,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_ID,
  INDUSTRIAL_V4_AUTHORED_ARTIFACT_REVISION,
  INDUSTRIAL_V4_AUTHORED_COMPOSITION,
  INDUSTRIAL_V4_AUTHORED_GAMEPLAY_TUNING_REVISION,
  INDUSTRIAL_V4_AUTHORED_GENERATION_MODE,
  INDUSTRIAL_V4_AUTHORED_LAYOUT_SEED,
  INDUSTRIAL_V4_AUTHORED_PROFILE_ID,
  INDUSTRIAL_V4_AUTHORED_PROFILE_REVISION,
  verifyIndustrialV4AuthoredArtifact,
};
