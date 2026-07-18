using System;
using System.Collections.Generic;
using RuinCrawler.Core.Reaverbots;
using RuinCrawler.Runtime.Combat;
using RuinCrawler.Runtime.Contracts;
using UnityEngine;

namespace RuinCrawler.Runtime.Reaverbots
{
    [DefaultExecutionOrder(-300)]
    public sealed class ReaverbotSpawner : MonoBehaviour
    {
        private const int MaximumPooledInstances = 32;
        private const int MaximumPooledInstancesPerVisual = 2;
        private const int MaximumPooledPickups = 16;

        [SerializeField] private TextAsset contractPack;
        [SerializeField] private ProductionProjectilePool enemyProjectilePool;
        [SerializeField] private Transform defaultCombatTarget;
        [SerializeField] private bool spawnRecoveryPickups = true;

        private readonly Dictionary<string, ReaverbotRuntimeController> activeById =
            new Dictionary<string, ReaverbotRuntimeController>(StringComparer.Ordinal);
        private readonly Dictionary<string, Stack<ReaverbotRuntimeController>> pooledByVisual =
            new Dictionary<string, Stack<ReaverbotRuntimeController>>(StringComparer.Ordinal);
        private readonly Stack<ReaverbotSalvagePickup> pickupPool = new Stack<ReaverbotSalvagePickup>();
        private readonly HashSet<ReaverbotSalvagePickup> activePickups = new HashSet<ReaverbotSalvagePickup>();

        private ReaverbotCatalog catalog;
        private ReaverbotGenerator generator;
        private ReaverbotMaterialLibrary materialLibrary;
        private Transform activeRoot;
        private Transform inactiveRoot;
        private Transform pickupRoot;
        private int pooledInstanceCount;

        public event Action<ReaverbotRuntimeController> Spawned;
        public event Action<ReaverbotRuntimeController, UnidentifiedReaverbotRecovery> EnemyDefeated;
        public event Action<ReaverbotSalvagePickup, UnidentifiedReaverbotRecovery> RecoverySpawned;
        public event Func<UnidentifiedReaverbotRecovery, bool> RecoveryCollectionRequested;
        public event Action<UnidentifiedReaverbotRecovery> RecoveryCollected;

        public ReaverbotCatalog Catalog => catalog;
        public int ActiveCount => activeById.Count;
        public int PooledCount => pooledInstanceCount;
        public int ActiveRecoveryCount => activePickups.Count;

        public void Configure(
            TextAsset sourceContractPack,
            ProductionProjectilePool projectilePool = null,
            Transform combatTarget = null)
        {
            contractPack = sourceContractPack;
            enemyProjectilePool = projectilePool;
            defaultCombatTarget = combatTarget;
            catalog = ReaverbotContractLoader.Load(contractPack);
            generator = new ReaverbotGenerator(catalog);
        }

        public void ConfigureCatalog(
            ReaverbotCatalog sourceCatalog,
            ProductionProjectilePool projectilePool = null,
            Transform combatTarget = null)
        {
            catalog = sourceCatalog ?? throw new ArgumentNullException(nameof(sourceCatalog));
            generator = new ReaverbotGenerator(catalog);
            enemyProjectilePool = projectilePool;
            defaultCombatTarget = combatTarget;
        }

        public ReaverbotRuntimeController SpawnEncounterSlot(
            ReaverbotSpawnRequest request,
            Vector3 position,
            Quaternion rotation)
        {
            if (request == null) throw new ArgumentNullException(nameof(request));
            EnsureRoots();
            EnsureCatalog();
            if (activeById.ContainsKey(request.StableSpawnId))
            {
                throw new InvalidOperationException("Reaverbot spawn id is already active: " + request.StableSpawnId);
            }

            ReaverbotGenome genome = generator.Generate(request.CreateGenerationOptions());
            materialLibrary ??= new ReaverbotMaterialLibrary();
            EnsureProjectilePool(genome);
            string visualKey = ReaverbotVisualFactory.CreateVisualKey(genome);
            ReaverbotRuntimeController instance = LeaseInstance(visualKey, genome);

            instance.transform.SetParent(activeRoot, false);
            instance.transform.SetPositionAndRotation(position, rotation);
            string displayName = string.IsNullOrWhiteSpace(request.displayNameOverride)
                ? genome.Name
                : request.displayNameOverride.Trim();
            instance.gameObject.name = "Reaverbot_" + displayName.Replace(' ', '_') + "_" + request.slotIndex;
            instance.Initialize(
                genome,
                request.StableSpawnId,
                displayName,
                instance.GetComponent<ReaverbotRuntimeBindings>().Rig,
                instance.GetComponent<CharacterController>(),
                instance.GetComponent<HealthComponent>(),
                instance.GetComponent<CombatTargetComponent>(),
                instance.GetComponent<ReaverbotRuntimeBindings>().WeakPointTarget,
                instance.GetComponent<ReaverbotRuntimeBindings>().WeakPointCollider,
                enemyProjectilePool,
                catalog.Salvage,
                defaultCombatTarget);
            activeById.Add(request.StableSpawnId, instance);
            instance.gameObject.SetActive(true);
            Spawned?.Invoke(instance);
            return instance;
        }

        public ReaverbotRuntimeController SpawnSharukurusuStyle(Vector3 position, Quaternion rotation)
        {
            return SpawnEncounterSlot(ReaverbotSpawnRequest.SharukurusuStyle(), position, rotation);
        }

        public bool Despawn(ReaverbotRuntimeController instance)
        {
            if (instance == null || string.IsNullOrEmpty(instance.StableSpawnId)) return false;
            if (!activeById.TryGetValue(instance.StableSpawnId, out ReaverbotRuntimeController current)
                || current != instance)
            {
                return false;
            }

            activeById.Remove(instance.StableSpawnId);
            instance.gameObject.SetActive(false);
            instance.transform.SetParent(inactiveRoot, false);
            string visualKey = instance.VisualKey ?? string.Empty;
            if (pooledInstanceCount < MaximumPooledInstances)
            {
                if (!pooledByVisual.TryGetValue(visualKey, out Stack<ReaverbotRuntimeController> pool))
                {
                    pool = new Stack<ReaverbotRuntimeController>();
                    pooledByVisual.Add(visualKey, pool);
                }

                if (pool.Count < MaximumPooledInstancesPerVisual)
                {
                    pool.Push(instance);
                    pooledInstanceCount += 1;
                    return true;
                }
            }

            Destroy(instance.gameObject);
            return true;
        }

        public void DespawnAll()
        {
            var snapshot = new List<ReaverbotRuntimeController>(activeById.Values);
            foreach (ReaverbotRuntimeController instance in snapshot) Despawn(instance);
        }

        /// <summary>
        /// Deterministic scene-transition seam. Active enemies are returned in
        /// stable spawn-id order, pickups are cancelled, and optional pool
        /// release removes every retained hierarchy owned by this spawner.
        /// </summary>
        public void Teardown(bool releasePooledObjects = true)
        {
            var activeIds = new List<string>(activeById.Keys);
            activeIds.Sort(StringComparer.Ordinal);
            foreach (string activeId in activeIds)
            {
                if (activeById.TryGetValue(activeId, out ReaverbotRuntimeController instance))
                {
                    Despawn(instance);
                }
            }

            var pickups = new List<ReaverbotSalvagePickup>(activePickups);
            pickups.Sort((left, right) => string.CompareOrdinal(
                left?.Recovery?.RecoveryId ?? string.Empty,
                right?.Recovery?.RecoveryId ?? string.Empty));
            foreach (ReaverbotSalvagePickup pickup in pickups)
            {
                if (pickup == null) continue;
                activePickups.Remove(pickup);
                pickup.ResetForPool();
                if (pickupPool.Count < MaximumPooledPickups) pickupPool.Push(pickup);
                else Destroy(pickup.gameObject);
            }

            if (!releasePooledObjects) return;
            foreach (Stack<ReaverbotRuntimeController> pool in pooledByVisual.Values)
            {
                while (pool.Count > 0)
                {
                    ReaverbotRuntimeController instance = pool.Pop();
                    if (instance != null) Destroy(instance.gameObject);
                }
            }
            pooledByVisual.Clear();
            pooledInstanceCount = 0;
            while (pickupPool.Count > 0)
            {
                ReaverbotSalvagePickup pickup = pickupPool.Pop();
                if (pickup != null) Destroy(pickup.gameObject);
            }
        }

        public bool TryGetActive(string stableSpawnId, out ReaverbotRuntimeController instance)
        {
            return activeById.TryGetValue(stableSpawnId ?? string.Empty, out instance) && instance != null;
        }

        public int CancelProjectilesBySource(string sourceId)
        {
            return enemyProjectilePool != null ? enemyProjectilePool.CancelBySource(sourceId) : 0;
        }

        private void Awake()
        {
            EnsureRoots();
        }

        private void OnDestroy()
        {
            Teardown(true);
            activeById.Clear();
            pooledByVisual.Clear();
            pickupPool.Clear();
            activePickups.Clear();
            materialLibrary?.Dispose();
            materialLibrary = null;
        }

        private void EnsureRoots()
        {
            if (activeRoot == null) activeRoot = CreateRoot("ActiveReaverbots", true);
            if (inactiveRoot == null) inactiveRoot = CreateRoot("PooledReaverbots", false);
            if (pickupRoot == null) pickupRoot = CreateRoot("ReaverbotRecoveries", true);
        }

        private Transform CreateRoot(string rootName, bool active)
        {
            var rootObject = new GameObject(rootName);
            rootObject.transform.SetParent(transform, false);
            rootObject.SetActive(active);
            return rootObject.transform;
        }

        private void EnsureCatalog()
        {
            if (catalog != null && generator != null) return;
            TextAsset source = contractPack != null
                ? contractPack
                : UnityContractCatalogProvider.Instance != null
                    ? UnityContractCatalogProvider.Instance.ContractPack
                    : null;
            if (source == null)
            {
                throw new InvalidOperationException(
                    "ReaverbotSpawner requires the version-1 Unity contract TextAsset or a configured catalog.");
            }

            catalog = ReaverbotContractLoader.Load(source);
            generator = new ReaverbotGenerator(catalog);
        }

        private void EnsureProjectilePool(ReaverbotGenome genome)
        {
            if (enemyProjectilePool != null) return;
            int mask = LayerMask.GetMask("Player", "WorldGeometry");
            if (mask == 0) mask = Physics.DefaultRaycastLayers;
            var poolObject = new GameObject("EnemyProjectilePool");
            poolObject.SetActive(false);
            poolObject.transform.SetParent(transform, false);
            enemyProjectilePool = poolObject.AddComponent<ProductionProjectilePool>();
            enemyProjectilePool.Configure(
                materialLibrary.Get(genome.Palette, ReaverbotSemanticRole.Emissive),
                mask,
                24);
            poolObject.SetActive(true);
        }

        private ReaverbotRuntimeController LeaseInstance(string visualKey, ReaverbotGenome genome)
        {
            if (pooledByVisual.TryGetValue(visualKey, out Stack<ReaverbotRuntimeController> pool))
            {
                while (pool.Count > 0)
                {
                    ReaverbotRuntimeController result = pool.Pop();
                    pooledInstanceCount -= 1;
                    if (result != null) return result;
                }
            }

            return CreateInstance(genome);
        }

        private ReaverbotRuntimeController CreateInstance(ReaverbotGenome genome)
        {
            int enemyLayer = LayerMask.NameToLayer("Enemy");
            int targetableLayer = LayerMask.NameToLayer("Targetable");
            var root = new GameObject("Reaverbot_PooledInstance");
            root.SetActive(false);
            root.transform.SetParent(inactiveRoot, false);
            if (enemyLayer >= 0) root.layer = enemyLayer;

            CharacterController character = root.AddComponent<CharacterController>();
            ReaverbotVisualRig rig = ReaverbotVisualFactory.Build(root.transform, genome, materialLibrary);
            SetLayerRecursively(rig.VisualRoot.gameObject, enemyLayer);
            if (targetableLayer >= 0) SetLayerRecursively(rig.WeakPoint.gameObject, targetableLayer);
            SphereCollider weakCollider = rig.WeakPoint.gameObject.AddComponent<SphereCollider>();
            weakCollider.radius = Mathf.Max(0.08f, (float)genome.Modules.WeakPoint.Radius);
            weakCollider.isTrigger = false;

            HealthComponent health = root.AddComponent<HealthComponent>();
            CombatTargetComponent bodyTarget = root.AddComponent<CombatTargetComponent>();
            CombatTargetComponent weakTarget = rig.WeakPoint.gameObject.AddComponent<CombatTargetComponent>();
            var bindings = root.AddComponent<ReaverbotRuntimeBindings>();
            bindings.Configure(rig, weakTarget, weakCollider);
            ReaverbotRuntimeController runtime = root.AddComponent<ReaverbotRuntimeController>();
            runtime.Died += HandleEnemyDied;
            runtime.DespawnRequested += HandleDespawnRequested;
            return runtime;
        }

        private void HandleEnemyDied(
            ReaverbotRuntimeController instance,
            UnidentifiedReaverbotRecovery recovery)
        {
            EnemyDefeated?.Invoke(instance, recovery);
            if (!spawnRecoveryPickups || recovery == null || recovery.Candidates.Count == 0) return;
            ReaverbotSalvagePickup pickup = LeasePickup();
            Vector3 position = instance.transform.position + Vector3.up * 0.35f;
            pickup.Configure(
                recovery,
                position,
                materialLibrary.Get(instance.Genome.Palette, ReaverbotSemanticRole.Emissive),
                HandlePickupCollected);
            activePickups.Add(pickup);
            RecoverySpawned?.Invoke(pickup, recovery);
        }

        private void HandleDespawnRequested(ReaverbotRuntimeController instance)
        {
            Despawn(instance);
        }

        private ReaverbotSalvagePickup LeasePickup()
        {
            while (pickupPool.Count > 0)
            {
                ReaverbotSalvagePickup result = pickupPool.Pop();
                if (result != null) return result;
            }

            GameObject pickupObject = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            pickupObject.name = "UnidentifiedReaverbotRecovery";
            pickupObject.transform.SetParent(pickupRoot, false);
            pickupObject.transform.localScale = Vector3.one * 0.24f;
            int pickupLayer = LayerMask.NameToLayer("Pickup");
            if (pickupLayer >= 0) pickupObject.layer = pickupLayer;
            Collider collider = pickupObject.GetComponent<Collider>();
            if (collider != null) collider.isTrigger = true;
            Rigidbody rigidbody = pickupObject.AddComponent<Rigidbody>();
            rigidbody.isKinematic = true;
            rigidbody.useGravity = false;
            return pickupObject.AddComponent<ReaverbotSalvagePickup>();
        }

        private bool HandlePickupCollected(
            ReaverbotSalvagePickup pickup,
            UnidentifiedReaverbotRecovery recovery)
        {
            if (!TryCommitRecovery(recovery))
            {
                return false;
            }

            activePickups.Remove(pickup);
            RecoveryCollected?.Invoke(recovery);
            if (pickupPool.Count < MaximumPooledPickups)
            {
                pickup.ResetForPool();
                pickup.transform.SetParent(pickupRoot, false);
                pickupPool.Push(pickup);
            }
            else
            {
                Destroy(pickup.gameObject);
            }

            return true;
        }

        private bool TryCommitRecovery(UnidentifiedReaverbotRecovery recovery)
        {
            Delegate[] handlers = RecoveryCollectionRequested?.GetInvocationList();
            if (handlers == null || handlers.Length == 0)
            {
                return true;
            }

            foreach (Delegate handler in handlers)
            {
                try
                {
                    if (!((Func<UnidentifiedReaverbotRecovery, bool>)handler)(recovery))
                    {
                        return false;
                    }
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception, this);
                    return false;
                }
            }

            return true;
        }

        private static void SetLayerRecursively(GameObject target, int layer)
        {
            if (target == null || layer < 0) return;
            target.layer = layer;
            foreach (Transform child in target.transform) SetLayerRecursively(child.gameObject, layer);
        }
    }

    /// <summary>
    /// Non-serialized references for a pooled generated hierarchy. Keeping
    /// these bindings on the root avoids scene searches and material copies.
    /// </summary>
    public sealed class ReaverbotRuntimeBindings : MonoBehaviour
    {
        public ReaverbotVisualRig Rig { get; private set; }
        public CombatTargetComponent WeakPointTarget { get; private set; }
        public Collider WeakPointCollider { get; private set; }

        public void Configure(
            ReaverbotVisualRig rig,
            CombatTargetComponent weakPointTarget,
            Collider weakPointCollider)
        {
            Rig = rig ?? throw new ArgumentNullException(nameof(rig));
            WeakPointTarget = weakPointTarget ?? throw new ArgumentNullException(nameof(weakPointTarget));
            WeakPointCollider = weakPointCollider ?? throw new ArgumentNullException(nameof(weakPointCollider));
        }
    }
}
