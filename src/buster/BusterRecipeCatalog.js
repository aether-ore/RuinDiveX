const DISCOVERY_LEVELS = Object.freeze({
  unknown: 'unknown',
  hinted: 'hinted',
  full: 'full',
});

function freezeRecipe({
  id,
  moduleId,
  kind,
  name,
  silhouette,
  rollClue,
  scrapCost,
  parts,
}) {
  const frozenParts = Object.freeze({ ...parts });
  const partIds = Object.freeze(Object.keys(frozenParts));
  const requirements = Object.freeze({
    identifiedScrap: scrapCost,
    scrap: scrapCost,
    parts: frozenParts,
  });

  return Object.freeze({
    id,
    recipeId: id,
    moduleId,
    kind,
    name,
    outputName: name,
    silhouette,
    rollClue,
    clue: rollClue,
    hint: rollClue,
    rollLine: rollClue,
    scrapCost,
    identifiedScrapCost: scrapCost,
    parts: frozenParts,
    partRequirements: frozenParts,
    requiredPartIds: partIds,
    requirements,
  });
}

/**
 * Roll's complete Custom Buster fabrication table.
 *
 * Recipe ids are deliberately short and stable for saves. `moduleId` is the
 * corresponding compiler vocabulary. Named-part quantities are one unless a
 * future recipe explicitly says otherwise; the numeric cost is identified
 * scrap owned by Roll, never Zenny or Mega Man inventory currency.
 */
export const BUSTER_RECIPES = Object.freeze({
  pulse: freezeRecipe({
    id: 'pulse',
    moduleId: 'pulseBolt',
    kind: 'module',
    name: 'Pulse Bolt',
    silhouette: 'compact-barrel',
    rollClue: 'This barrel still remembers a steady firing rhythm. I think I can give it a cleaner pulse.',
    scrapCost: 6,
    parts: { revolvingPulseBarrel: 1 },
  }),
  mortar: freezeRecipe({
    id: 'mortar',
    moduleId: 'mortarShell',
    kind: 'module',
    name: 'Mortar Shell',
    silhouette: 'arched-launch-tube',
    rollClue: 'The tube was made to throw something high instead of straight. Let me preserve that arc.',
    scrapCost: 8,
    parts: { highAngleLaunchTube: 1 },
  }),
  pursuit: freezeRecipe({
    id: 'pursuit',
    moduleId: 'pursuitGuidance',
    kind: 'module',
    name: 'Pursuit Guidance',
    silhouette: 'lensed-guidance-block',
    rollClue: 'This routine keeps looking for motion, but it needs an eye precise enough to follow what it finds.',
    scrapCost: 12,
    parts: { behaviorChipPursuit: 1, rubyOpticLens: 1 },
  }),
  apex: freezeRecipe({
    id: 'apex',
    moduleId: 'atApex',
    kind: 'function',
    name: 'At Apex',
    silhouette: 'trajectory-crest-switch',
    rollClue: 'There is a tiny pause in these firing calculations—the instant a climbing shot runs out of sky.',
    scrapCost: 8,
    parts: { ballisticsLogicChip: 1 },
  }),
  afterDelay: freezeRecipe({
    id: 'afterDelay',
    moduleId: 'afterDelay',
    kind: 'function',
    name: 'After Delay',
    silhouette: 'timed-sequencer',
    rollClue: 'This sequencer waits before it divides a payload. I can turn that hesitation into a useful signal.',
    scrapCost: 8,
    parts: { clusterBurstSequencer: 1 },
  }),
  spread3: freezeRecipe({
    id: 'spread3',
    moduleId: 'spread3',
    kind: 'function',
    name: 'Spread 3',
    silhouette: 'three-way-feed',
    rollClue: 'The feed and barrel can share one firing beat. With both patterns, I could split it three ways.',
    scrapCost: 10,
    parts: { ammunitionFeedDrum: 1, revolvingPulseBarrel: 1 },
  }),
  cluster5: freezeRecipe({
    id: 'cluster5',
    moduleId: 'cluster5',
    kind: 'function',
    name: 'Cluster 5',
    silhouette: 'five-way-burst-ring',
    rollClue: 'There are five clean release marks in this sequencer. They were meant to separate all at once.',
    scrapCost: 12,
    parts: { clusterBurstSequencer: 1 },
  }),
  explosion: freezeRecipe({
    id: 'explosion',
    moduleId: 'explosion',
    kind: 'function',
    name: 'Explosion',
    silhouette: 'contained-burst-cell',
    rollClue: 'This cell is unstable, but the failure pattern is repeatable. I can make the burst happen on purpose.',
    scrapCost: 10,
    parts: { volatileOverloadCell: 1 },
  }),
});

export const BUSTER_RECIPE_CATALOG = BUSTER_RECIPES;
export const BUSTER_RECIPE_LIST = Object.freeze(Object.values(BUSTER_RECIPES));
export const BUSTER_DISCOVERY_LEVELS = DISCOVERY_LEVELS;

const RECIPES_BY_MODULE_ID = Object.freeze(Object.fromEntries(
  BUSTER_RECIPE_LIST.map((recipe) => [recipe.moduleId, recipe]),
));
export const BUSTER_RECIPES_BY_MODULE_ID = RECIPES_BY_MODULE_ID;

function readDiscoveredPartIds(discovery) {
  if (!discovery) return new Set();
  if (discovery instanceof Set) return new Set(discovery);
  if (Array.isArray(discovery)) return new Set(discovery);
  if (typeof discovery.getDiscoveredPartIds === 'function') {
    return new Set(discovery.getDiscoveredPartIds());
  }

  const values = discovery.salvageTypes
    ?? discovery.discoveredSalvageTypes
    ?? discovery.partIds
    ?? discovery.partsEverFound
    ?? discovery.discovery?.salvageTypes
    ?? [];
  if (values instanceof Set) return new Set(values);
  if (Array.isArray(values)) return new Set(values);
  if (values && typeof values === 'object') {
    return new Set(Object.entries(values).filter(([, found]) => Boolean(found)).map(([partId]) => partId));
  }
  return new Set();
}

export function getBusterRecipe(recipeOrId) {
  if (recipeOrId && typeof recipeOrId === 'object') {
    return BUSTER_RECIPES[recipeOrId.id ?? recipeOrId.recipeId]
      ?? RECIPES_BY_MODULE_ID[recipeOrId.moduleId]
      ?? null;
  }
  return BUSTER_RECIPES[recipeOrId] ?? RECIPES_BY_MODULE_ID[recipeOrId] ?? null;
}

/**
 * Returns the stable, UI-facing reveal state for one recipe.
 *
 * No matching named part: only the unknown silhouette is visible.
 * Some matching types: Roll can name the module/function and offers her vague
 * clue, but the exact bill of materials stays hidden.
 * Every matching type ever found: the exact recipe is permanently visible.
 * A one-part recipe therefore moves directly from unknown to full.
 */
export function getRecipeDiscoveryState(recipeOrId, discovery = []) {
  const recipe = getBusterRecipe(recipeOrId);
  if (!recipe) return null;

  const discovered = readDiscoveredPartIds(discovery);
  const foundPartIds = recipe.requiredPartIds.filter((partId) => discovered.has(partId));
  const allFound = foundPartIds.length === recipe.requiredPartIds.length;
  const anyFound = foundPartIds.length > 0;
  const level = allFound
    ? DISCOVERY_LEVELS.full
    : anyFound
      ? DISCOVERY_LEVELS.hinted
      : DISCOVERY_LEVELS.unknown;
  const nameVisible = level !== DISCOVERY_LEVELS.unknown;
  const exactVisible = level === DISCOVERY_LEVELS.full;

  const hiddenName = 'Unknown Buster Part';
  return {
    recipeId: recipe.id,
    moduleId: nameVisible ? recipe.moduleId : null,
    kind: nameVisible ? recipe.kind : null,
    name: nameVisible ? recipe.name : hiddenName,
    displayName: nameVisible ? recipe.name : hiddenName,
    silhouette: recipe.silhouette,
    level,
    state: level,
    discoveryState: level,
    discoveryLevel: level,
    visibility: exactVisible ? 'exact' : nameVisible ? 'clue' : 'silhouette',
    discovered: nameVisible,
    fullyDiscovered: exactVisible,
    exactVisible,
    clue: nameVisible ? recipe.rollClue : null,
    rollClue: nameVisible ? recipe.rollClue : null,
    foundPartIds: [...foundPartIds],
    missingPartIds: recipe.requiredPartIds.filter((partId) => !discovered.has(partId)),
    requirements: exactVisible
      ? { identifiedScrap: recipe.scrapCost, scrap: recipe.scrapCost, parts: { ...recipe.parts } }
      : null,
    recipe: exactVisible ? recipe : null,
  };
}

export const getBusterRecipeDiscoveryState = getRecipeDiscoveryState;

export function getAllRecipeDiscoveryStates(discovery = []) {
  return BUSTER_RECIPE_LIST.map((recipe) => getRecipeDiscoveryState(recipe, discovery));
}
