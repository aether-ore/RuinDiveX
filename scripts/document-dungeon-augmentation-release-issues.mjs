import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as THREE from 'three';

import { DungeonGenerator } from '../src/DungeonGenerator.js';
import { hashSeed, SeededRandom } from '../src/reaverbots/SeededRandom.js';

const REPORT_PATH = new URL('../docs/DUNGEON_AUGMENTATION_V4_RELEASE_ISSUES.md', import.meta.url);
const REPORT_DATE = '2026-07-30';
const SEED = 'layout:augmentation-realized-v4-000';
const PROFILE_ID = 'industrial-supplement-preview-v4';
const CLOSURE_START = '<!-- V4_RELEASE_CLOSURE_START -->';
const CLOSURE_END = '<!-- V4_RELEASE_CLOSURE_END -->';

const CATEGORY_DEFINITIONS = [
  {
    id: 'ARCH',
    title: 'Legacy V1 decorative-arch coverage',
    matches: error => /decorative V1 arches/.test(error),
    interpretation: 'The release validator still requires complete-gallery V1 arch decoration on authored and supplemental routes. This is presentation coverage, not a playable-alpha connectivity failure.',
    remediation: 'Decide whether V4 inherits the V1 arch contract. If it does, emit arch coverage from the authoritative wall-run records; otherwise version-gate this validator rule.',
  },
  {
    id: 'APPROACH',
    title: 'Socket threshold and two-tile approach contracts',
    matches: error => /clear two-tile bidirectional approach|walkable floor at its room threshold|walkable connector approach outside its room|room threshold is unreachable|connector approach is unreachable/.test(error),
    interpretation: 'Exact parent and supplemental sockets lack one or more threshold/outside floor witnesses, or their approach lanes are unreachable. Several messages describe the two sides of the same physical seam.',
    remediation: 'Realize and reserve the complete three-lane threshold footprint before walls and route floors, then validate the exact floor keys on both sides of every socket.',
  },
  {
    id: 'RAMP',
    title: 'Shared movement-envelope ramp violations',
    matches: error => /^Ramp .* exceeds the shared movement envelope/.test(error),
    interpretation: 'Short authored ramps change elevation too quickly for the common player/navigation step envelope even though their endpoints are correctly aligned.',
    remediation: 'Lengthen the affected ramp runs or revise their sampled collision surfaces so every adjacent rise stays within the shared movement envelope.',
  },
  {
    id: 'SOCKET',
    title: 'Socket ownership and room-local reachability',
    matches: error => /cannot be reached locally|not reachable from its room approach|represented only by a floor owned by another room or connector|no realized floor at its contracted elevation/.test(error),
    interpretation: 'The exact contracted socket floor is absent, owned by the wrong physical record, or cannot be reached within its owner without traversing the connection being tested.',
    remediation: 'Keep socket floors owner-scoped, restore exact contracted elevations, and build a room-local path from each approach to its socket before joining the inter-room segment.',
  },
  {
    id: 'SEGMENT',
    title: 'Connector segment floor and spine integrity',
    matches: error => /realized traversal floor|traversable spine|return spine|source-side connector component|cannot return to its source entrance|orphaned realized centerline/.test(error),
    interpretation: 'A physical connector segment is missing a centerline floor or is split into components. Return-spine and orphan reports are usually consequences of the same break.',
    remediation: 'Stamp segment floors from the ordered authoritative path, reject overwritten centerline cells, and require forward and reverse graph traversal before presentation.',
  },
  {
    id: 'ROOM',
    title: 'Supplemental room footprint and local-component integrity',
    matches: error => /does not physically realize its complete .*declared base-floor footprint|unexpectedly blocked room-owned floor|orphaned walkable floor|room-owned floor.*cannot return to the dungeon start|does not provide one locally clear, bidirectional component/.test(error),
    interpretation: 'A curated module has blocked, locally disconnected, orphaned, or non-returnable owned floors. One module can emit several assertions against the same disconnected component.',
    remediation: 'Run collision-derived local connectivity against exact floor masks, remove structure/cover conflicts from clear routes, and reject any module whose owned floor set is not returnable.',
  },
  {
    id: 'JUNCTION',
    title: 'Connector-module component and approach-count contracts',
    matches: error => /connector module is not one exact-elevation, bidirectionally walkable component/.test(error),
    interpretation: 'A route station or junction proxy does not physically join all declared approaches at one exact elevation.',
    remediation: 'Build each compact junction from one reserved floor component and verify every declared arm against that component before accepting the network.',
  },
  {
    id: 'ASSEMBLY',
    title: 'Aggregate supplemental-assembly failures',
    matches: error => /^Supplement assembly contains/.test(error),
    interpretation: 'These are aggregate counts over blocked, orphaned, or non-returnable owned floors and therefore summarize lower-level room and segment failures.',
    remediation: 'Treat these as release gates and close the underlying room, segment, and socket records rather than suppressing the aggregate assertions.',
  },
  {
    id: 'OPERATION',
    title: 'Route-network elevation-layer integration',
    matches: error => /does not form one realized operation graph with every declared elevation layer/.test(error),
    interpretation: 'At least one route network does not join all of its declared elevation layers through a recognized physical transfer in the release graph.',
    remediation: 'Ensure transfer links use the same authoritative floor identities as the operation graph and prove bidirectional layer traversal before accepting the operation.',
  },
  {
    id: 'SPAWN',
    title: 'Encounter spawn-floor validity',
    matches: error => /encounter spawn .* is not placed on a reachable floor owned by/.test(error),
    interpretation: 'An encounter recipe resolved a spawn onto a blocked, unreachable, wrong-owner, or wrong-elevation floor.',
    remediation: 'Select spawns only from the post-collision reachable owned-floor set for the recipe tier, then revalidate after structures and hazards are committed.',
  },
  {
    id: 'OTHER',
    title: 'Unclassified validator records',
    matches: () => true,
    interpretation: 'These records did not match a known release-issue family and must be classified manually.',
    remediation: 'Add a classifier only after identifying the responsible contract; never discard an unclassified record.',
  },
];

function markdownEscape(value) {
  return String(value).replaceAll('|', '\\|');
}

function classifyErrors(errors) {
  const groups = new Map(CATEGORY_DEFINITIONS.map(category => [category.id, []]));
  errors.forEach((message, index) => {
    const category = CATEGORY_DEFINITIONS.find(candidate => candidate.matches(message));
    groups.get(category.id).push({ index: index + 1, message });
  });
  return groups;
}

function buildReport({ dungeon, errors }) {
  const groups = classifyErrors(errors);
  const digest = createHash('sha256').update(JSON.stringify(errors)).digest('hex');
  const lines = [
    '# Dungeon Augmentation V4 Release-Issue Register',
    '',
    `Generated ${REPORT_DATE} from profile \`${PROFILE_ID}\` and deterministic seed \`${SEED}\`.`,
    '',
    '## Status and scope',
    '',
    `- Playable-alpha acceptance: **${dungeon.augmentationPlayableAlpha?.accepted === true ? 'passed' : 'failed'}**.`,
    `- Release validation: **${dungeon.progression?.validation?.accepted === true ? 'passed' : 'failed'}**.`,
    `- Raw release-validator issue records: **${errors.length}**.`,
    `- Ordered error-array SHA-256: \`${digest}\`.`,
    '',
    'These are validator issue records, not 175 independent root causes. A single missing threshold floor can produce approach, spine, room-component, connector-module, and assembly-level failures. Every raw record is retained below with its original order and a stable `ISSUE-NNN` label.',
    '',
    'The playable-alpha gate is intentionally narrower than release validation. It confirms that the overlay applies and exposes generated rooms, encounters, rewards, mechanisms, transfers, and a connected gameplay floor graph. It does not waive the release contracts listed here.',
    '',
    '## Category summary',
    '',
    '| ID | Category | Count |',
    '| --- | --- | ---: |',
  ];
  for (const category of CATEGORY_DEFINITIONS) {
    const records = groups.get(category.id);
    if (records.length === 0) continue;
    lines.push(`| ${category.id} | ${markdownEscape(category.title)} | ${records.length} |`);
  }
  lines.push(
    `| **Total** |  | **${[...groups.values()].reduce((sum, records) => sum + records.length, 0)}** |`,
    '',
    '## Category diagnosis and remediation',
    '',
  );
  for (const category of CATEGORY_DEFINITIONS) {
    const count = groups.get(category.id).length;
    if (count === 0) continue;
    lines.push(
      `### ${category.id} — ${category.title} (${count})`,
      '',
      category.interpretation,
      '',
      `Recommended closure: ${category.remediation}`,
      '',
    );
  }
  lines.push('## Exhaustive issue register', '');
  for (const category of CATEGORY_DEFINITIONS) {
    const records = groups.get(category.id);
    if (records.length === 0) continue;
    lines.push(`### ${category.id} — ${category.title}`, '');
    for (const record of records) {
      const issueId = `ISSUE-${String(record.index).padStart(3, '0')}`;
      lines.push(`${record.index}. **${issueId}** — ${record.message}`);
    }
    lines.push('');
  }
  lines.push(
    '## Completion rule',
    '',
    'This register is closed only when the same profile and seed produce zero release-validation errors, the 10/100/1,000-seed release sweeps satisfy their gates, and no issue is removed merely by suppressing or weakening a validator without a versioned contract decision.',
    '',
  );
  return lines.join('\n');
}

function buildClosureRecord({ dungeon, errors }) {
  const digest = createHash('sha256').update(JSON.stringify(errors)).digest('hex');
  return [
    CLOSURE_START,
    '## Release recovery closure',
    '',
    `Verified ${REPORT_DATE} against profile \`${PROFILE_ID}\` revision 5 and deterministic seed \`${SEED}\`.`,
    '',
    `- Augmentation status: **${dungeon.augmentationStatus === 'applied' ? 'applied' : dungeon.augmentationStatus ?? 'unknown'}**.`,
    `- First-realization acceptance: **${dungeon.augmentationReplayDiagnostics?.realizationAttempts === 1 ? 'passed' : 'failed'}**.`,
    `- Release validation: **${dungeon.progression?.validation?.accepted === true ? 'passed' : 'failed'}**.`,
    `- Invalid-alpha bypass used: **${dungeon.augmentationReplayDiagnostics?.acceptedAsPlayableAlpha === true ? 'yes' : 'no'}**.`,
    `- Current release-validator issue records: **${errors.length}**.`,
    `- Ordered current error-array SHA-256: \`${digest}\`.`,
    '',
    'All historical `ISSUE-001` through `ISSUE-175` records below are closed for the canonical release witness because their underlying physical conditions are absent. The original register is retained unchanged as historical evidence; it is not the current validator output.',
    '',
    '### Inconsistencies and decisions requiring confirmation',
    '',
    '| Contract tension | Current implementation/interpretation | Decision required |',
    '| --- | --- | --- |',
    '| Variety is stated as a 100-seed threshold, while the smoke verifier also required at least three topology and elevation families inside every single dungeon. | Per-dungeon verification requires at least one real topology, junction, and elevation family; exact family coverage and frequency limits remain enforced by the 100-seed corpus gate. | Confirm that diversity is a corpus property, or specify explicit per-dungeon minimums and the module budget they may consume. |',
    '| The outer eight-seed realization retry must remain as defensive fallback, while release-corpus layouts are required to apply on their first derived seed. | The retry remains in runtime code, but the realized release verifier rejects any corpus result whose `realizationAttempts` is not 1. | Confirm whether first-realization acceptance applies to all 10/100/1,000 release seeds or only the named canonical witness. |',
    '| The 175-record register can be zero for the canonical witness before the required 10/100/1,000 sweeps and browser journeys all pass. | This document calls the historical records closed only for the canonical witness; release authorization remains a separate, stricter milestone. | Confirm whether “close all 175” means canonical root-cause closure or full release authorization. |',
    '| The public ID contains `preview-v4`, but ordinary requests are now release-authoritative and alpha bypass requires a second explicit flag. | The ID and revision remain unchanged for save/hash compatibility; authority is determined by validation, not the word “preview.” | Confirm whether a future non-preview alias should be introduced after the release gates pass. |',
    '| V1 authored connectors retain arches, while supplemental V4 routes use structural frames. Older validation treated the V1 arch cadence as universal. | Presentation validation is versioned: V1 arches remain immutable; V4 requires theme-bound entrance, bend, junction, and interval frame coverage. | No code decision is currently blocked; retain this row as the resolved presentation-policy record. |',
    '| Alpha may expose invalid geometry, but alpha diagnostics must use the same collision-derived graph as release validation. | Alpha changes acceptance only; it does not substitute a weaker graph or rewrite validation results. Invulnerability is separately controlled. | No code decision is currently blocked; confirm this remains the intended debugging policy. |',
    '| The release plan requires a three-lane threshold plus two clear approach tiles on both sides, while the pre-recovery host and validator encoded only one tile per side. | V4 host grants and validation now use an exact 3 x 5 tile envelope: two inside cells, the threshold cell, and two outside cells. | Resolved in favor of the written release plan; confirm that no legacy one-tile V4 development grant must remain accepted. |',
    '| An exact base floor mask can be read as every room-owned floor at the base elevation, but authored ramp and transfer cells can begin at that same elevation. | Base-mask checks compare authoritative base-tier cell identities; transfer cells are validated separately through their transfer IDs and endpoint identities. | Confirm that “base mask” means the named base tier, not every physical cell whose numeric elevation equals the base tier. |',
    '| Junction kits have named footprint dimensions such as 7 x 7 Crossroads, but their substantive floor masks are non-rectangular. | Width/depth describe the planning and clearance envelope; physical floor coverage is the exact authored tier-cell mask. | Confirm that footprint dimensions are bounding envelopes and must not require rectangle-stamped floors. |',
    '| Exact seam ownership forbids cross-owner overlap outside the socket seam, but the current bounded solver grants an endpoint module core to its incident segment and can select a one-tile dogleg that re-enters that core. | The canonical dungeon remains playable and release-valid, but the realized sweep detects at least one connector-spine ownership witness outside the 3 x 5 seam. Enforcing exact ownership in candidate selection exhausts the current 121-candidate search budget and can exceed three minutes for one seed. | Decision required: enlarge/redesign the solver search and accept a much higher generation cost, constrain/re-author endpoint module sockets, or explicitly permit an incident connector to traverse its endpoint module floor without taking ownership. |',
    '| The acceptance plan requires 10/100/1,000 realized sweeps, while one canonical fully realized seed currently takes roughly 90-105 seconds even before strict seam backtracking. | At current throughput, serial 100- and 1,000-seed runs are multi-hour release jobs, not practical interactive checks; strict seam search is slower still. | Decide whether release sweeps run as parallel/offline CI jobs, or establish a performance budget and require planner/materializer optimization before those gates are actionable. |',
    '',
    CLOSURE_END,
    '',
  ].join('\n');
}

const seeded = new SeededRandom(hashSeed(SEED));
const generator = new DungeonGenerator({
  random: () => seeded.next(),
  difficulty: 1,
  augmentationProfileId: PROFILE_ID,
  augmentationSeed: SEED,
  basePlanHash: `v1:${SEED}:depth:1:revolvingFusillade`,
});
const texture = new THREE.Texture();
generator.textureCache.set('document-augmentation-release-issues', texture);
generator._loadRuinTexture = () => texture;

const dungeon = generator.generate();
const errors = dungeon.progression?.validation?.errors ?? [];
if (
  dungeon.augmentationStatus !== 'applied'
  || dungeon.progression?.validation?.accepted !== true
  || dungeon.augmentationReplayDiagnostics?.realizationAttempts !== 1
  || dungeon.augmentationReplayDiagnostics?.acceptedAsPlayableAlpha === true
  || errors.length !== 0
) {
  generator._disposeGeneratedDungeonCandidate(dungeon);
  texture.dispose();
  throw new Error(
    `Release witness is not closed: status=${dungeon.augmentationStatus}, attempts=${dungeon.augmentationReplayDiagnostics?.realizationAttempts ?? 'unknown'}, alpha=${dungeon.augmentationReplayDiagnostics?.acceptedAsPlayableAlpha === true}, errors=${errors.length}.`,
  );
}

const historicalReport = await readFile(REPORT_PATH, 'utf8');
if (!historicalReport.includes('ISSUE-001') || !historicalReport.includes('ISSUE-175')) {
  generator._disposeGeneratedDungeonCandidate(dungeon);
  texture.dispose();
  throw new Error('The historical 175-entry register is missing or incomplete.');
}
const withoutPriorClosure = historicalReport.replace(
  new RegExp(`${CLOSURE_START}[\\s\\S]*?${CLOSURE_END}\\s*`, 'u'),
  '',
);
const heading = '# Dungeon Augmentation V4 Release-Issue Register\n\n';
const reportBody = withoutPriorClosure.startsWith(heading)
  ? withoutPriorClosure.slice(heading.length)
  : withoutPriorClosure;
const historicalHeading = '## Historical pre-recovery register\n\n';
const historicalBody = reportBody.startsWith(historicalHeading)
  ? reportBody.slice(historicalHeading.length)
  : reportBody;
await writeFile(
  REPORT_PATH,
  `${heading}${buildClosureRecord({ dungeon, errors })}${historicalHeading}${historicalBody}`,
  'utf8',
);
console.log(JSON.stringify({
  reportPath: REPORT_PATH.pathname,
  errorCount: errors.length,
  releaseAccepted: dungeon.progression?.validation?.accepted === true,
  realizationAttempts: dungeon.augmentationReplayDiagnostics?.realizationAttempts ?? null,
  categoryCounts: Object.fromEntries(
    [...classifyErrors(errors)].map(([id, records]) => [id, records.length]),
  ),
}, null, 2));

generator._disposeGeneratedDungeonCandidate(dungeon);
texture.dispose();
