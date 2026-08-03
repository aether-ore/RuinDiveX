import {
  LEVEL_EDITOR_PROJECT_SCHEMA,
  migrateLevelEditorProject,
  migrateLevelEditorProjectWithReport,
} from './contracts.js';
import { assertJsonSafe, canonicalStringify, cloneJsonValue } from './canonical.js';
import { createLevelDiagnostic, validateLevelEditorProject } from './validation.js';
import { hashBlobSha256, normalizeSha256Hash } from './persistence.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function stablePrettyJson(value, space = 2) {
  const canonical = canonicalStringify(value);
  return space === 0 ? canonical : JSON.stringify(JSON.parse(canonical), null, space);
}

export function serializeLevelDocument(value, options = {}) {
  assertJsonSafe(value);
  const space = options.pretty === false ? 0 : Number(options.space ?? options.pretty ?? 2);
  const text = stablePrettyJson(value, Number.isFinite(space) ? Math.max(0, Math.min(10, space)) : 2);
  return options.trailingNewline === false ? text : `${text}\n`;
}

export function deserializeLevelDocument(text) {
  if (typeof text !== 'string') throw new TypeError('Level JSON must be a string.');
  const value = JSON.parse(text.replace(/^\uFEFF/, ''));
  assertJsonSafe(value);
  return value;
}

export function serializeLevelEditorProject(input, options = {}) {
  const project = options.migrate === false ? cloneJsonValue(input) : migrateLevelEditorProject(input, options);
  return serializeLevelDocument(project, options);
}

export function parseLevelEditorProject(text, options = {}) {
  const value = deserializeLevelDocument(text);
  return options.migrate === false ? value : migrateLevelEditorProject(value, options);
}

export const serializeProject = serializeLevelEditorProject;
export const deserializeProject = parseLevelEditorProject;
export const exportProjectJson = serializeLevelEditorProject;
export const exportProjectJSON = serializeLevelEditorProject;
export const exportProjectToJson = serializeLevelEditorProject;
export const exportProjectToJSON = serializeLevelEditorProject;

function validBindingIdentifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

/**
 * Emit an ES module whose only payload syntax is a JSON literal. Importers can
 * safely parse it without eval/import() and without granting the file code
 * execution privileges.
 */
export function serializePureDataModule(value, options = {}) {
  assertJsonSafe(value);
  const exportName = String(options.exportName ?? 'levelProject');
  if (!validBindingIdentifier(exportName)) throw new TypeError(`Invalid export binding ${exportName}.`);
  const json = stablePrettyJson(value, options.pretty === false ? 0 : Number(options.space ?? 2));
  return `export const ${exportName} = ${json};\nexport default ${exportName};\n`;
}

function parseModuleJsonLiteral(text) {
  const source = String(text).replace(/^\uFEFF/, '').trim();
  const defaultOnly = source.match(/^export\s+default\s+([\s\S]+?)\s*;?$/);
  if (defaultOnly) return defaultOnly[1].replace(/;\s*$/, '');
  const named = source.match(
    /^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]+?)\s*;\s*export\s+default\s+\1\s*;?$/,
  );
  if (named) return named[2];
  throw new SyntaxError(
    'Only `export default <JSON>` or `export const name = <JSON>; export default name;` data modules are accepted.',
  );
}

export function parsePureDataModule(text) {
  const literal = parseModuleJsonLiteral(text);
  const value = JSON.parse(literal);
  assertJsonSafe(value);
  return value;
}

export function serializeProjectDataModule(input, options = {}) {
  const project = options.migrate === false ? cloneJsonValue(input) : migrateLevelEditorProject(input, options);
  return serializePureDataModule(project, options);
}

export function parseProjectDataModule(text, options = {}) {
  const value = parsePureDataModule(text);
  return options.migrate === false ? value : migrateLevelEditorProject(value, options);
}

export const exportProjectModule = serializeProjectDataModule;
export const exportProjectESModule = serializeProjectDataModule;
export const exportProjectToESModule = serializeProjectDataModule;
export const importProjectModule = parseProjectDataModule;
export const importProjectFromESModule = importProjectDataModule;

function importProjectReport(value, options, format) {
  try {
    const migration = migrateLevelEditorProjectWithReport(value, options);
    const validation = validateLevelEditorProject(migration.project, {
      ...options,
      requireSpawn: options.requireSpawn ?? false,
    });
    const diagnostics = [...migration.diagnostics, ...validation.diagnostics];
    const errors = diagnostics.filter(({ severity }) => severity === 'error');
    const warnings = diagnostics.filter(({ severity }) => severity === 'warning');
    return {
      ok: errors.length === 0,
      format,
      value: migration.project,
      project: migration.project,
      migrated: migration.migrated,
      diagnostics,
      errors,
      warnings,
    };
  } catch (caught) {
    const diagnostic = createLevelDiagnostic(
      'error',
      'project-import-failed',
      '$',
      caught?.message ?? 'Could not import project.',
      { format },
    );
    return {
      ok: false,
      format,
      value: null,
      project: null,
      migrated: false,
      diagnostics: [diagnostic],
      errors: [diagnostic],
      warnings: [],
    };
  }
}

export function importProjectJson(text, options = {}) {
  try {
    return importProjectReport(deserializeLevelDocument(text), options, 'json');
  } catch (caught) {
    return importProjectReport({ schema: `invalid:${caught?.message}` }, options, 'json');
  }
}

export const importProjectJSON = importProjectJson;
export const importProjectFromJson = importProjectJson;
export const importProjectFromJSON = importProjectJson;

export function importProjectDataModule(text, options = {}) {
  try {
    return importProjectReport(parsePureDataModule(text), options, 'es-module');
  } catch (caught) {
    const diagnostic = createLevelDiagnostic(
      'error',
      'project-module-import-failed',
      '$',
      caught?.message ?? 'Could not parse pure-data ES module.',
      { format: 'es-module' },
    );
    return {
      ok: false,
      format: 'es-module',
      value: null,
      project: null,
      migrated: false,
      diagnostics: [diagnostic],
      errors: [diagnostic],
      warnings: [],
    };
  }
}

function encodeText(text, fflate) {
  return fflate?.strToU8 ? fflate.strToU8(text) : textEncoder.encode(text);
}

function decodeText(bytes, fflate) {
  return fflate?.strFromU8 ? fflate.strFromU8(bytes) : textDecoder.decode(bytes);
}

async function binaryBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value && typeof value.arrayBuffer === 'function') return new Uint8Array(await value.arrayBuffer());
  throw new TypeError('ZIP or asset value must be a Blob, ArrayBuffer, or typed array.');
}

function zipSyncOrAsync(fflate, files, options) {
  if (typeof fflate?.zipSync === 'function') return Promise.resolve(fflate.zipSync(files, options));
  if (typeof fflate?.zip === 'function') {
    return new Promise((resolve, reject) => {
      fflate.zip(files, options, (caught, data) => caught ? reject(caught) : resolve(data));
    });
  }
  throw new TypeError('Injected ZIP API must provide zipSync(files, options) or zip(files, options, callback).');
}

function unzipSyncOrAsync(fflate, bytes) {
  if (typeof fflate?.unzipSync === 'function') return Promise.resolve(fflate.unzipSync(bytes));
  if (typeof fflate?.unzip === 'function') {
    return new Promise((resolve, reject) => {
      fflate.unzip(bytes, (caught, files) => caught ? reject(caught) : resolve(files));
    });
  }
  throw new TypeError('Injected ZIP API must provide unzipSync(bytes) or unzip(bytes, callback).');
}

function safeAssetFilename(hash, index) {
  const normalized = String(hash ?? `asset-${index + 1}`).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return `assets/${normalized}`;
}

function assetEntries(assets) {
  if (!assets) return [];
  if (assets instanceof Map) return [...assets.entries()].map(([hash, value]) => ({ hash, value }));
  if (Array.isArray(assets)) return assets.map((entry) => ({
    hash: entry.hash ?? entry.id,
    value: entry.blob ?? entry.bytes ?? entry.value,
    name: entry.name,
    mimeType: entry.mimeType ?? entry.type,
    metadata: entry.metadata,
  }));
  if (typeof assets === 'object') return Object.entries(assets).map(([hash, value]) => ({ hash, value }));
  throw new TypeError('assets must be a Map, array, or hash-to-binary object.');
}

/** Bundle project JSON, a code-free ES module, and optional binary assets. */
export async function exportProjectZip(input, options = {}) {
  const fflate = options.fflate;
  const project = migrateLevelEditorProject(input, options);
  const files = {
    'project.json': encodeText(serializeLevelEditorProject(project, options), fflate),
    'project.mjs': encodeText(serializeProjectDataModule(project, options), fflate),
  };
  let documentPath = null;
  let documentModulePath = null;
  if (options.document) {
    assertJsonSafe(options.document);
    const documentKind = options.documentKind
      ?? (options.document.schema === 'ruindivex-room-module/v1' ? 'room' : 'dungeon');
    const safeKind = String(documentKind).replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'level';
    documentPath = `${safeKind}.json`;
    documentModulePath = `${safeKind}.mjs`;
    files[documentPath] = encodeText(serializeLevelDocument(options.document, options), fflate);
    files[documentModulePath] = encodeText(serializePureDataModule(options.document, {
      ...options,
      exportName: options.documentExportName ?? (safeKind === 'room' ? 'roomModule' : 'authoredDungeon'),
    }), fflate);
  }
  const manifestAssets = [];
  for (const [index, asset] of assetEntries(options.assets).entries()) {
    const path = safeAssetFilename(asset.hash, index);
    const bytes = await binaryBytes(asset.value);
    files[path] = bytes;
    manifestAssets.push({
      hash: String(asset.hash ?? ''),
      path,
      size: bytes.byteLength,
      name: String(asset.name ?? asset.hash ?? `asset-${index + 1}`),
      mimeType: String(asset.mimeType ?? 'application/octet-stream'),
      metadata: cloneJsonValue(asset.metadata ?? {}),
    });
  }
  const manifest = {
    schema: 'ruindivex-level-editor-bundle/v1',
    projectSchema: LEVEL_EDITOR_PROJECT_SCHEMA,
    projectId: project.projectId,
    projectPath: 'project.json',
    modulePath: 'project.mjs',
    documentPath,
    documentModulePath,
    documentSchema: options.document?.schema ?? null,
    assets: manifestAssets,
  };
  files['bundle-manifest.json'] = encodeText(serializeLevelDocument(manifest, options), fflate);
  return zipSyncOrAsync(fflate, files, { level: options.level ?? 6 });
}

function validateZipPaths(files) {
  for (const path of Object.keys(files)) {
    if (path.includes('\\') || path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`Unsafe ZIP entry path: ${path}`);
    }
  }
}

export async function importProjectZip(input, options = {}) {
  try {
    const bytes = await binaryBytes(input);
    const files = await unzipSyncOrAsync(options.fflate, bytes);
    validateZipPaths(files);
    const manifest = files['bundle-manifest.json']
      ? deserializeLevelDocument(decodeText(files['bundle-manifest.json'], options.fflate))
      : { projectPath: 'project.json', assets: [] };
    if (manifest.schema && manifest.schema !== 'ruindivex-level-editor-bundle/v1') {
      throw new Error(`Unsupported level-editor bundle schema ${manifest.schema}.`);
    }
    if (manifest.projectSchema && manifest.projectSchema !== LEVEL_EDITOR_PROJECT_SCHEMA) {
      throw new Error(`Unsupported bundled project schema ${manifest.projectSchema}.`);
    }
    if (!Array.isArray(manifest.assets ?? [])) throw new Error('Bundle manifest assets must be an array.');
    const manifestPaths = new Set();
    const manifestHashes = new Set();
    for (const asset of manifest.assets ?? []) {
      if (!asset?.path || typeof asset.path !== 'string') throw new Error('Every bundled asset requires a path.');
      if (asset.path.includes('\\') || asset.path.startsWith('/') || asset.path.split('/').includes('..')) {
        throw new Error(`Unsafe bundled asset path: ${asset.path}`);
      }
      if (manifestPaths.has(asset.path)) throw new Error(`Duplicate bundled asset path: ${asset.path}`);
      manifestPaths.add(asset.path);
      const normalizedHash = normalizeSha256Hash(asset.hash);
      if (normalizedHash && manifestHashes.has(normalizedHash)) throw new Error(`Duplicate bundled asset hash: ${normalizedHash}`);
      if (normalizedHash) manifestHashes.add(normalizedHash);
    }
    const projectPath = manifest.projectPath ?? 'project.json';
    if (!files[projectPath]) throw new Error(`ZIP is missing ${projectPath}.`);
    const report = importProjectJson(decodeText(files[projectPath], options.fflate), options);
    let document = null;
    if (manifest.documentPath) {
      if (!files[manifest.documentPath]) throw new Error(`ZIP is missing ${manifest.documentPath}.`);
      document = deserializeLevelDocument(decodeText(files[manifest.documentPath], options.fflate));
      const supportedDocuments = new Set(['ruindivex-room-module/v1', 'ruindivex-authored-dungeon/v1']);
      if (!supportedDocuments.has(document?.schema)) throw new Error(`Unsupported bundled level schema ${document?.schema}.`);
      if (manifest.documentSchema && manifest.documentSchema !== document.schema) {
        throw new Error(`Bundled level schema mismatch: expected ${manifest.documentSchema}, received ${document.schema}.`);
      }
      if (manifest.documentModulePath) {
        if (!files[manifest.documentModulePath]) throw new Error(`ZIP is missing ${manifest.documentModulePath}.`);
        const moduleDocument = parsePureDataModule(decodeText(files[manifest.documentModulePath], options.fflate));
        if (canonicalStringify(moduleDocument) !== canonicalStringify(document)) {
          throw new Error('Bundled JSON and ES-module documents do not match.');
        }
      }
    }
    const assets = [];
    for (const asset of manifest.assets ?? []) {
      if (!files[asset.path]) throw new Error(`ZIP is missing asset ${asset.path}.`);
      const assetBytes = files[asset.path] instanceof Uint8Array
        ? files[asset.path]
        : new Uint8Array(files[asset.path]);
      if (asset.size != null && Number(asset.size) !== assetBytes.byteLength) {
        throw new Error(`Asset size mismatch for ${asset.path}.`);
      }
      let blob;
      if (typeof Blob === 'function') blob = new Blob([assetBytes], { type: asset.mimeType });
      else blob = assetBytes;
      if (options.verifyAssetHashes !== false && asset.hash && typeof blob.arrayBuffer === 'function') {
        const actual = await hashBlobSha256(blob, { crypto: options.crypto ?? globalThis.crypto });
        if (actual !== normalizeSha256Hash(asset.hash)) throw new Error(`Asset hash mismatch for ${asset.path}.`);
      }
      assets.push({ ...cloneJsonValue(asset), bytes: assetBytes, blob });
    }
    for (const asset of report.project?.assets ?? []) {
      const hash = normalizeSha256Hash(asset.hash ?? asset.assetHash ?? asset.id);
      if (hash && !manifestHashes.has(hash) && asset.external !== true) {
        throw new Error(`Portable bundle is missing project asset ${hash}.`);
      }
    }
    return { ...report, format: 'zip', manifest, document, assets };
  } catch (caught) {
    const diagnostic = createLevelDiagnostic(
      'error',
      'project-zip-import-failed',
      '$',
      caught?.message ?? 'Could not import project ZIP.',
      { format: 'zip' },
    );
    return {
      ok: false,
      format: 'zip',
      value: null,
      project: null,
      manifest: null,
      assets: [],
      diagnostics: [diagnostic],
      errors: [diagnostic],
      warnings: [],
    };
  }
}

export const exportProjectBundle = exportProjectZip;
export const importProjectBundle = importProjectZip;
export const createProjectZip = exportProjectZip;
export const exportProjectToZip = exportProjectZip;
export const importProjectFromZip = importProjectZip;
