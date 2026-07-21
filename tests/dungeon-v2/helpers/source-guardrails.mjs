import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const JOURNEY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'journey');
const JOURNEY_RUNTIME_HELPER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'journey-runtime.mjs',
);

const RULES = Object.freeze([
  ['journey-private-method', /\.\s*_[A-Za-z][A-Za-z0-9_]*\s*\(/g, 'private runtime methods are forbidden'],
  ['journey-position-write', /(?:player|camera)\s*\.\s*position\s*\.(?:set|copy|setX|setY|setZ)\s*\(/gi, 'player/camera position writes are forbidden'],
  ['journey-position-assignment', /(?:player|camera)\s*\.\s*position(?:\s*\.\s*[xyz])?\s*=/gi, 'player/camera position assignments are forbidden'],
  ['journey-state-injection', /\b(?:collectKeycard|activateDoor|activateShrine|activateExtraction|completeEncounter|clearEnemies|grantKey|setGate|setObjective|setMechanismState)\s*\(/gi, 'progression or encounter injection is forbidden'],
  ['journey-preview-teleport', /(?:roomPreview|v2RegionPreview|teleport|spawnAt)=/gi, 'preview and teleport URL controls are forbidden'],
  ['journey-live-game-access', /(?:window\s*(?:\.\s*|\[\s*['"])(?:game|__game|__RUINDIVEX_GAME__)|\bgame\s*\.)/gi, 'the live game object is forbidden'],
  ['journey-page-evaluate', /(?:\b(?:page|locator)\s*\.\s*(?:evaluate|evaluateHandle)\s*\(|\.\s*\$\$?eval\s*\()/g, 'journeys must use the audited readV2Diagnostics helper'],
  ['journey-direct-state-write', /\b(?:ownedKeys|openedGates|health|barrier|ammo|salvage|encounters|rewards|objectives|mechanisms)\s*(?:\[[^\]]+\]|\.[A-Za-z0-9_]+)?\s*=/gi, 'direct gameplay state writes are forbidden'],
  ['journey-storage-injection', /\b(?:localStorage|sessionStorage)\s*\./g, 'storage state injection is forbidden'],
  ['journey-script-injection', /\b(?:addScriptTag|exposeFunction|exposeBinding)\s*\(/g, 'browser script injection is forbidden'],
  ['journey-direct-generator', /(?:from\s+['\"][^'\"]*(?:DungeonGenerator|DungeonSceneAssembler|src\/dungeon-v2)|\bnew\s+DungeonGenerator|\bassembleDungeonPlanV2\s*\()/g, 'journeys may not bypass the public game entrypoint'],
  ['journey-init-script', /\baddInitScript\s*\(/g, 'browser state injection is forbidden'],
]);

export function auditJourneySource(source, filename = '<journey>') {
  assert.equal(typeof source, 'string');
  const violations = [];
  for (const [code, expression, message] of RULES) {
    expression.lastIndex = 0;
    let match;
    while ((match = expression.exec(source))) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      violations.push(Object.freeze({ code, filename, line, message, excerpt: match[0] }));
      if (match[0].length === 0) expression.lastIndex += 1;
    }
  }
  if (!source.includes('PUBLIC_INPUT_JOURNEY')) {
    violations.push(Object.freeze({
      code: 'journey-missing-public-input-marker',
      filename,
      line: 1,
      message: 'journey must declare PUBLIC_INPUT_JOURNEY',
      excerpt: '',
    }));
  }
  return Object.freeze(violations);
}

export function assertJourneySourceGuardrails(source, filename) {
  const violations = auditJourneySource(source, filename);
  assert.deepEqual(violations, [], violations.map((item) => `${item.filename}:${item.line} [${item.code}] ${item.message}`).join('\n'));
}

function functionRange(source, declaration, nextDeclaration) {
  const start = source.indexOf(declaration);
  if (start < 0) return null;
  const end = source.indexOf(nextDeclaration, start + declaration.length);
  if (end < 0) return null;
  return Object.freeze({ start, end, source: source.slice(start, end) });
}

/**
 * Audits the shared public-input driver separately from journey specs. The
 * driver is allowed exactly five audited browser evaluations: one deep-cloned
 * diagnostics read, a scoped key-event/heartbeat observer handle and result
 * read used to bound public key holds, and the isolated start/stop frame
 * probes. No other helper may evaluate live browser state.
 */
export function auditJourneyRuntimeHelperSource(source, filename = 'journey-runtime.mjs') {
  assert.equal(typeof source, 'string');
  const violations = auditJourneySource(source, filename)
    .filter(({ code }) => code !== 'journey-page-evaluate');
  const ranges = [
    functionRange(
      source,
      'export async function readV2Diagnostics',
      'export async function armV2PublicInputHeartbeat',
    ),
    functionRange(
      source,
      'export async function armV2PublicInputHeartbeat',
      'export async function waitForV2HeartbeatIncrement',
    ),
    functionRange(
      source,
      'export async function waitForV2HeartbeatIncrement',
      'export async function startV2PerformanceFrameProbe',
    ),
    functionRange(
      source,
      'export async function startV2PerformanceFrameProbe',
      'export async function stopV2PerformanceFrameProbe',
    ),
    functionRange(
      source,
      'export async function stopV2PerformanceFrameProbe',
      'async function readV2StartupFailure',
    ),
  ];
  if (ranges.some((range) => !range)) {
    violations.push(Object.freeze({
      code: 'journey-helper-evaluation-contract-missing',
      filename,
      line: 1,
      message: 'the diagnostics/frame-probe evaluation allowlist could not be reconstructed',
      excerpt: '',
    }));
    return Object.freeze(violations);
  }

  const pageEvaluationRanges = [ranges[0], ranges[1], ranges[3], ranges[4]];
  const evaluations = [...source.matchAll(/\bpage\s*\.\s*evaluate(?:Handle)?\s*\(/g)];
  for (const match of evaluations) {
    if (!pageEvaluationRanges.some(({ start, end }) => match.index >= start && match.index < end)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      violations.push(Object.freeze({
        code: 'journey-helper-unapproved-page-evaluate',
        filename,
        line,
        message: 'shared journey helpers may evaluate only the audited diagnostics/frame probes',
        excerpt: match[0],
      }));
    }
  }
  for (const [index, range] of ranges.entries()) {
    const count = [...range.source.matchAll(/\bpage\s*\.\s*evaluate(?:Handle)?\s*\(/g)].length;
    const expectedCount = index === 2 ? 0 : 1;
    if (count !== expectedCount) {
      violations.push(Object.freeze({
        code: 'journey-helper-evaluation-count',
        filename,
        line: source.slice(0, range.start).split(/\r?\n/).length,
        message: 'each explicitly allowed helper must contain exactly one page.evaluate call',
        excerpt: `${count}/${expectedCount}`,
      }));
    }
  }
  const observerEvaluations = [...source.matchAll(/\bobserver\s*\.\s*evaluate\s*\(/g)];
  if (observerEvaluations.length !== 1
    || !observerEvaluations.every((match) => (
      match.index >= ranges[2].start && match.index < ranges[2].end
    ))) {
    violations.push(Object.freeze({
      code: 'journey-helper-observer-evaluation-count',
      filename,
      line: source.slice(0, ranges[2].start).split(/\r?\n/).length,
      message: 'the scoped public-input observer must be read exactly once',
      excerpt: String(observerEvaluations.length),
    }));
  }

  const diagnosticsSource = ranges[0].source;
  if (!/const\s+bridge\s*=\s*window\[bridgeName\]/.test(diagnosticsSource)
    || !/return\s+bridge\.snapshot\(\{\s*profile:\s*requestedProfile\s*\}\)/.test(diagnosticsSource)
    || !/JSON\.parse\(JSON\.stringify\(snapshot\)\)/.test(diagnosticsSource)) {
    violations.push(Object.freeze({
      code: 'journey-helper-diagnostics-not-read-only',
      filename,
      line: source.slice(0, ranges[0].start).split(/\r?\n/).length,
      message: 'diagnostics evaluation must return and verify a JSON-cloned snapshot only',
      excerpt: 'readV2Diagnostics',
    }));
  }
  if (/\b(?:bridge|snapshot)\s*(?:\[[^\]]+\]|\.[A-Za-z0-9_]+)\s*=/.test(diagnosticsSource)) {
    violations.push(Object.freeze({
      code: 'journey-helper-diagnostics-write',
      filename,
      line: source.slice(0, ranges[0].start).split(/\r?\n/).length,
      message: 'the diagnostics helper may not write through its bridge or returned snapshot',
      excerpt: 'readV2Diagnostics',
    }));
  }

  const heartbeatSource = `${ranges[1].source}\n${ranges[2].source}`;
  if (!/window\.addEventListener\(['"]keydown['"],\s*observeKeydown,\s*true\)/.test(heartbeatSource)
    || !/bridge\?\.heartbeat\?\.\(\)/.test(heartbeatSource)
    || !/requestAnimationFrame\(observe\)/.test(heartbeatSource)
    || /\b(?:bridge|heartbeat)\s*(?:\[[^\]]+\]|\.[A-Za-z0-9_]+)\s*=/.test(heartbeatSource)) {
    violations.push(Object.freeze({
      code: 'journey-helper-heartbeat-not-read-only',
      filename,
      line: source.slice(0, ranges[1].start).split(/\r?\n/).length,
      message: 'heartbeat synchronization must only observe the diagnostics bridge scalar',
      excerpt: 'heartbeat synchronization',
    }));
  }

  const probeSource = `${ranges[3].source}\n${ranges[4].source}`;
  if (/RUINDIVEX_(?:GAME|V2_DIAGNOSTICS)|\b(?:game|player|camera|runtime|dungeonController)\b/i.test(probeSource)) {
    violations.push(Object.freeze({
      code: 'journey-helper-frame-probe-game-access',
      filename,
      line: source.slice(0, ranges[3].start).split(/\r?\n/).length,
      message: 'frame probes must remain isolated from game and diagnostics state',
      excerpt: 'performance frame probe',
    }));
  }
  return Object.freeze(violations);
}

export async function assertJourneyRuntimeHelperGuarded(filename = JOURNEY_RUNTIME_HELPER) {
  const violations = auditJourneyRuntimeHelperSource(await readFile(filename, 'utf8'), path.basename(filename));
  assert.deepEqual(
    violations,
    [],
    violations.map((item) => `${item.filename}:${item.line} [${item.code}] ${item.message}`).join('\n'),
  );
  return filename;
}

async function listJourneyFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listJourneyFiles(absolute));
    else if (/\.(?:spec|journey)\.[cm]?js$/i.test(entry.name)) files.push(absolute);
  }
  return files.sort();
}

export async function assertAllJourneySourcesGuarded(root = JOURNEY_ROOT) {
  const files = await listJourneyFiles(root);
  assert.ok(files.length > 0, 'at least one V2 public-input journey source is required');
  for (const filename of files) {
    assertJourneySourceGuardrails(await readFile(filename, 'utf8'), path.relative(root, filename));
  }
  return files;
}
