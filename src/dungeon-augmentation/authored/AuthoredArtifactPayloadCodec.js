export const DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_CODEC_SCHEMA =
  'ruindivex-dungeon-augmentation-authored-payload-codec/v1';

function createPayloadError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'DungeonAugmentationAuthoredPayloadError';
  error.code = code;
  error.details = details;
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted !== true) return;
  const error = new Error('Dungeon augmentation artifact loading was aborted.');
  error.name = 'AbortError';
  error.code = 'DUNGEON_AUGMENTATION_AUTHORED_ARTIFACT_ABORTED';
  throw error;
}

function decodeBase64(value) {
  if (typeof globalThis.atob !== 'function') {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_BASE64_UNAVAILABLE',
      'This runtime cannot decode the authored artifact payload.',
    );
  }
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_DIGEST_UNAVAILABLE',
      'This runtime cannot authenticate the authored artifact payload.',
    );
  }
  return `sha256-${hex(new Uint8Array(await subtle.digest('SHA-256', bytes)))}`;
}

async function gunzip(bytes) {
  if (typeof globalThis.DecompressionStream !== 'function'
    || typeof globalThis.Blob !== 'function'
    || typeof globalThis.Response !== 'function') {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_DECOMPRESSION_UNAVAILABLE',
      'This runtime cannot decompress the authored artifact payload.',
    );
  }
  const stream = new globalThis.Blob([bytes])
    .stream()
    .pipeThrough(new globalThis.DecompressionStream('gzip'));
  return new Uint8Array(await new globalThis.Response(stream).arrayBuffer());
}

/**
 * Authenticates and expands the compiler's deterministic gzip payload. The
 * SHA-256 covers the exact compressed bytes before any parser or verifier sees
 * them, so the bundled loader can use bounded structural verification without
 * repeatedly canonicalizing the 15+ MB hydrated runtime records.
 */
export async function decodeIndustrialV4AuthoredArtifactPayload({
  base64,
  receipt,
  signal = null,
} = {}) {
  throwIfAborted(signal);
  if (receipt?.payloadCodecSchema !== DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_CODEC_SCHEMA
    || receipt?.payloadEncoding !== 'base64'
    || receipt?.payloadCompression !== 'gzip') {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_CODEC_MISMATCH',
      'The authored artifact payload codec receipt is unsupported.',
    );
  }
  const compressed = decodeBase64(String(base64 ?? ''));
  if (compressed.byteLength !== Number(receipt.payloadCompressedByteLength)) {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_LENGTH_MISMATCH',
      'The compressed authored artifact payload length does not match its receipt.',
      {
        expected: Number(receipt.payloadCompressedByteLength),
        actual: compressed.byteLength,
      },
    );
  }
  throwIfAborted(signal);
  const compressedHash = await sha256(compressed);
  if (compressedHash !== receipt.payloadCompressedSha256) {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_HASH_MISMATCH',
      'The compressed authored artifact payload failed SHA-256 verification.',
      { expected: receipt.payloadCompressedSha256, actual: compressedHash },
    );
  }
  throwIfAborted(signal);
  let uncompressed;
  try {
    uncompressed = await gunzip(compressed);
  } catch (cause) {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_DECOMPRESSION_FAILED',
      'The authored artifact payload could not be decompressed.',
      { cause: String(cause?.message ?? cause) },
    );
  }
  if (uncompressed.byteLength !== Number(receipt.payloadUncompressedByteLength)) {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_LENGTH_MISMATCH',
      'The expanded authored artifact payload length does not match its receipt.',
      {
        expected: Number(receipt.payloadUncompressedByteLength),
        actual: uncompressed.byteLength,
      },
    );
  }
  throwIfAborted(signal);
  try {
    return JSON.parse(new TextDecoder().decode(uncompressed));
  } catch (cause) {
    throw createPayloadError(
      'DUNGEON_AUGMENTATION_AUTHORED_PAYLOAD_PARSE_FAILED',
      'The authored artifact payload is not valid JSON.',
      { cause: String(cause?.message ?? cause) },
    );
  }
}
