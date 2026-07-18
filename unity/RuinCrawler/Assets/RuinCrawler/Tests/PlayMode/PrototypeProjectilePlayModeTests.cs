using System.Collections;
using System.Linq;
using NUnit.Framework;
using RuinCrawler.Port.Porting;
using RuinCrawler.Port.Prototype;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace RuinCrawler.Port.Tests
{
    public sealed class PrototypeProjectilePlayModeTests
    {
        [UnityTest]
        public IEnumerator MegaBusterHitsTargetInsideSourceRange()
        {
            GameObject targetObject = GameObject.CreatePrimitive(PrimitiveType.Cube);
            targetObject.name = "InRangeTarget";
            targetObject.transform.position = new Vector3(0f, 0f, 5.5f);
            PrototypeDamageTarget target = targetObject.AddComponent<PrototypeDamageTarget>();
            target.Configure(SourceGameplayContract.SharukurusuHealth);

            GameObject projectileObject = new GameObject("SourceRangeProjectile");
            PrototypeProjectile projectile = projectileObject.AddComponent<PrototypeProjectile>();
            projectile.Initialize(Vector3.forward, SourceGameplayContract.MegaBusterDamage);

            float timeout = 1.25f;
            while (target.CurrentHealth >= SourceGameplayContract.SharukurusuHealth && timeout > 0f)
            {
                timeout -= Time.deltaTime;
                yield return null;
            }

            Assert.That(
                target.CurrentHealth,
                Is.EqualTo(SourceGameplayContract.SharukurusuHealth - SourceGameplayContract.MegaBusterDamage)
                    .Within(0.0001f));

            Object.Destroy(targetObject);
            if (projectileObject != null)
            {
                Object.Destroy(projectileObject);
            }
            yield return null;
        }

        [UnityTest]
        public IEnumerator MegaBusterExpiresAfterSourceRangeWithoutTarget()
        {
            GameObject projectileObject = new GameObject("ExpiringSourceRangeProjectile");
            PrototypeProjectile projectile = projectileObject.AddComponent<PrototypeProjectile>();
            projectile.Initialize(Vector3.forward, SourceGameplayContract.MegaBusterDamage);

            float timeout = 1.25f;
            while (projectileObject != null && timeout > 0f)
            {
                timeout -= Time.deltaTime;
                yield return null;
            }

            Assert.That(projectileObject == null, Is.True);
        }

        [UnityTest]
        public IEnumerator PlayerShotStartsAtTheAuthoredLeftBarrel()
        {
            yield return SceneManager.LoadSceneAsync("PortingSandbox", LoadSceneMode.Single);
            yield return null;

            PrototypePlayerController controller = Object.FindAnyObjectByType<PrototypePlayerController>();
            Assert.That(controller, Is.Not.Null);
            controller.enabled = false;
            Transform muzzle = controller.Muzzle;
            Transform leftHand = controller.GetComponentsInChildren<Transform>(true)
                .Single(transform => transform.name == "mixamorig:LeftHand");
            Transform rightHand = controller.GetComponentsInChildren<Transform>(true)
                .Single(transform => transform.name == "mixamorig:RightHand");
            Vector3 expectedDirection = controller.transform.forward;

            GameObject projectileObject = controller.FireBusterShot();
            PrototypeProjectile projectile = projectileObject.GetComponent<PrototypeProjectile>();
            Vector3 alignedOrigin = muzzle.position;
            Assert.That(Vector3.Distance(projectileObject.transform.position, alignedOrigin),
                Is.LessThan(0.0001f));
            Assert.That(Vector3.Dot(projectile.Direction, expectedDirection), Is.GreaterThan(0.9999f));
            Assert.That(Vector3.Dot(projectile.Direction, muzzle.forward), Is.GreaterThan(0.9999f));
            Assert.That(Mathf.Abs(Vector3.Dot(muzzle.forward, controller.transform.up)), Is.LessThan(0.001f));
            Assert.That(Vector3.Distance(alignedOrigin, leftHand.position),
                Is.LessThan(Vector3.Distance(alignedOrigin, rightHand.position)));
            Assert.That(controller.BusterVisual.IsEquipped, Is.True);

            Vector3 start = projectileObject.transform.position;
            yield return null;
            if (projectileObject != null)
            {
                Vector3 displacement = projectileObject.transform.position - start;
                Assert.That(displacement.magnitude, Is.GreaterThan(0f));
                Assert.That(Vector3.Dot(displacement.normalized, expectedDirection), Is.GreaterThan(0.9999f));
                Object.Destroy(projectileObject);
            }
        }
    }
}
