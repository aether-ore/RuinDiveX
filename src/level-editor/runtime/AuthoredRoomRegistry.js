import { asArray, cloneData, normalizeId } from './utils.js';

function registryEntries(source) {
  if (source instanceof Map) return [...source.entries()];
  if (Array.isArray(source)) {
    return source.map((entry, index) => [
      normalizeId(entry?.id ?? entry?.moduleId ?? entry?.templateId, `room-${index + 1}`),
      entry,
    ]);
  }
  return Object.entries(source ?? {});
}

function candidateIds(reference) {
  if (typeof reference === 'string') return [reference];
  if (!reference || typeof reference !== 'object') return [];
  return [
    reference.definitionId,
    reference.templateId,
    reference.moduleId,
    reference.roomType,
    reference.archetypeId,
    reference.roomId,
    reference.id,
  ].map((value) => normalizeId(value)).filter(Boolean);
}

function mergeDefinition(definition, instance) {
  const inline = instance?.definition && typeof instance.definition === 'object'
    ? instance.definition
    : {};
  const properties = instance?.properties && typeof instance.properties === 'object'
    ? instance.properties
    : {};
  const overrides = properties.definitionOverrides && typeof properties.definitionOverrides === 'object'
    ? properties.definitionOverrides
    : {};
  return {
    ...(cloneData(definition) ?? {}),
    ...cloneData(inline),
    ...cloneData(overrides),
    id: normalizeId(instance?.roomId ?? instance?.id ?? inline.id ?? definition?.id),
    instanceId: normalizeId(instance?.id ?? instance?.roomId),
    moduleId: normalizeId(instance?.moduleId ?? inline.moduleId ?? definition?.moduleId),
    templateId: normalizeId(instance?.templateId ?? inline.templateId ?? definition?.templateId),
    sockets: cloneData(instance?.sockets ?? inline.sockets ?? definition?.sockets ?? []),
    instanceProperties: cloneData(properties),
  };
}

/** A dependency-injected catalog for JSON room modules and async factories. */
export class AuthoredRoomRegistry {
  constructor(entries = null, { fallback = null } = {}) {
    this.entries = new Map();
    this.aliases = new Map();
    this.fallback = fallback;
    if (entries) this.registerAll(entries);
  }

  register(idOrDefinition, definitionOrOptions = null, maybeOptions = {}) {
    const objectForm = idOrDefinition && typeof idOrDefinition === 'object'
      && typeof idOrDefinition !== 'function';
    const id = normalizeId(
      objectForm
        ? idOrDefinition.id ?? idOrDefinition.moduleId ?? idOrDefinition.templateId
        : idOrDefinition,
    );
    const definition = objectForm ? idOrDefinition : definitionOrOptions;
    const options = objectForm ? definitionOrOptions ?? {} : maybeOptions ?? {};
    if (!id) throw new TypeError('Authored room registrations require an id.');
    if (!definition || (typeof definition !== 'object' && typeof definition !== 'function')) {
      throw new TypeError(`Authored room ${id} must be a definition or factory.`);
    }
    if (this.entries.has(id) && options.replace !== true) {
      throw new Error(`Authored room ${id} is already registered.`);
    }
    this.entries.set(id, definition);
    const aliases = [
      ...(Array.isArray(options.aliases) ? options.aliases : []),
      ...(Array.isArray(definition.aliases) ? definition.aliases : []),
      definition.moduleId,
      definition.templateId,
    ];
    for (const alias of aliases.map(normalizeId).filter(Boolean)) this.aliases.set(alias, id);
    return this;
  }

  registerAll(source, options = {}) {
    for (const [id, definition] of registryEntries(source)) {
      this.register(id, definition, options);
    }
    return this;
  }

  unregister(id) {
    const canonical = this.canonicalId(id);
    const removed = this.entries.delete(canonical);
    for (const [alias, target] of this.aliases) {
      if (target === canonical) this.aliases.delete(alias);
    }
    return removed;
  }

  canonicalId(id) {
    const normalized = normalizeId(id);
    return this.aliases.get(normalized) ?? normalized;
  }

  has(id) {
    return this.entries.has(this.canonicalId(id));
  }

  get(id) {
    return this.entries.get(this.canonicalId(id)) ?? null;
  }

  list() {
    return [...this.entries.entries()].map(([id, definition]) => ({
      id,
      factory: typeof definition === 'function',
      aliases: [...this.aliases.entries()].filter(([, target]) => target === id).map(([alias]) => alias),
      definition: typeof definition === 'function' ? null : cloneData(definition),
    }));
  }

  ids() {
    return [...this.entries.keys()];
  }

  async resolve(reference, context = {}) {
    if (reference?.definition && typeof reference.definition === 'object') {
      const preferred = candidateIds(reference).find((id) => this.has(id));
      if (!preferred) return mergeDefinition({}, reference);
    }
    let id = candidateIds(reference).find((candidate) => this.has(candidate)) ?? '';
    let entry = id ? this.get(id) : null;
    if (!entry && this.fallback) {
      entry = await this.fallback(reference, context, this);
      id = normalizeId(entry?.id ?? reference?.moduleId ?? reference?.templateId);
    }
    if (!entry) {
      const label = candidateIds(reference)[0] ?? '<anonymous>';
      throw new Error(`Unknown authored room module ${label}.`);
    }
    const definition = typeof entry === 'function'
      ? await entry(cloneData(reference), context, this)
      : entry;
    if (!definition || typeof definition !== 'object') {
      throw new TypeError(`Authored room factory ${id} did not return a definition.`);
    }
    return mergeDefinition(definition, reference);
  }

  instantiate(reference, context = {}) {
    return this.resolve(reference, context);
  }

  clear() {
    this.entries.clear();
    this.aliases.clear();
  }

  static from(source, options = {}) {
    if (source instanceof AuthoredRoomRegistry) return source;
    if (source?.entries instanceof Map && typeof source.resolve === 'function') return source;
    if (source?.rooms || source?.modules || source?.templates || source?.definitions || source?.entries) {
      return new AuthoredRoomRegistry(
        source.rooms ?? source.modules ?? source.templates ?? source.definitions ?? source.entries,
        options,
      );
    }
    return new AuthoredRoomRegistry(source ?? {}, options);
  }

  static async load(source, {
    fetch: explicitFetch = null,
    fetcher = explicitFetch ?? globalThis.fetch,
    fallback = null,
    validateSchema = true,
    allowCrossOrigin = false,
  } = {}) {
    let document = source;
    if (typeof source === 'string' || (typeof URL !== 'undefined' && source instanceof URL)) {
      if (typeof fetcher !== 'function') {
        throw new TypeError('Loading a room registry URL requires an injected fetcher.');
      }
      let requestUrl = String(source);
      if (typeof location !== 'undefined') {
        const resolved = new URL(requestUrl, globalThis.document?.baseURI ?? location.href);
        if (!allowCrossOrigin && !explicitFetch && resolved.origin !== location.origin) {
          throw new Error(`Cross-origin room registry URL ${resolved.origin} requires an explicit fetch function or allowCrossOrigin.`);
        }
        requestUrl = resolved.toString();
      }
      const response = await fetcher(requestUrl);
      if (!response?.ok) {
        throw new Error(`Unable to load authored room registry ${source}: HTTP ${response?.status ?? 'error'}.`);
      }
      document = await response.json();
    } else if (typeof Response !== 'undefined' && source instanceof Response) {
      document = await source.json();
    } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
      document = JSON.parse(await source.text());
    }
    document = document?.default ?? document;
    if (!document || typeof document !== 'object') {
      throw new TypeError('Authored room registry documents must be objects, JSON responses, Blobs, or URLs.');
    }
    if (validateSchema && document.schema && document.schema !== 'ruindivex-room-registry/v1') {
      throw new Error(`Unsupported authored room registry schema ${document.schema}.`);
    }
    const modules = document.modules
      ?? document.rooms
      ?? document.templates
      ?? document.definitions
      ?? document.entries
      ?? document;
    const registry = new AuthoredRoomRegistry(modules, { fallback });
    registry.schema = document.schema ?? 'ruindivex-room-registry/v1';
    registry.registryId = document.registryId ?? document.id ?? null;
    registry.revision = document.revision ?? null;
    registry.metadata = cloneData(document.metadata ?? {});
    return registry;
  }

  async load(source, options = {}) {
    const loaded = await AuthoredRoomRegistry.load(source, {
      fallback: this.fallback,
      ...options,
    });
    this.registerAll(loaded.entries, { replace: options.replace === true });
    this.schema = loaded.schema;
    this.registryId = loaded.registryId;
    this.revision = loaded.revision;
    this.metadata = loaded.metadata;
    return this;
  }
}

export function createAuthoredRoomRegistry(entries = {}, options = {}) {
  return AuthoredRoomRegistry.from(entries, options);
}

export function listRoomRegistryDefinitions(registry) {
  return asArray(registry?.list?.() ?? []);
}
