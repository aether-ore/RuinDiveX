using System.Collections;
using NUnit.Framework;
using RuinCrawler.Runtime.Player;
using RuinCrawler.UI.Common;
using RuinCrawler.UI.Pause;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.TestTools;
using UnityEngine.UIElements;

namespace RuinCrawler.Production.Tests
{
    public sealed class PauseStatusMenuPlayModeTests
    {
        [UnityTest]
        public IEnumerator OpeningPause_SuppressesGameplayButKeepsPauseAndRestoresState()
        {
            Time.timeScale = 1f;
            InputActionAsset actions = ScriptableObject.CreateInstance<InputActionAsset>();
            var gameplay = new InputActionMap("Gameplay");
            InputAction move = gameplay.AddAction("Move", InputActionType.Value);
            move.AddBinding("<Gamepad>/leftStick");
            InputAction pause = gameplay.AddAction("Pause", InputActionType.Button);
            pause.AddBinding("<Keyboard>/escape");
            actions.AddActionMap(gameplay);
            gameplay.Enable();

            var playerObject = new GameObject("PauseTestPlayer");
            playerObject.AddComponent<CharacterController>();
            ProductionPlayerController player = playerObject.AddComponent<ProductionPlayerController>();
            player.Configure(actions, null, player.transform, null, null, null, null, null);

            var menuObject = new GameObject("PauseStatusMenuTest");
            UIDocument document = menuObject.AddComponent<UIDocument>();
            PauseStatusMenuController menu = menuObject.AddComponent<PauseStatusMenuController>();
            menu.Configure(actions, player);
            yield return null;

            menu.SetOpen(true);
            yield return null;
            Assert.That(menu.IsOpen, Is.True);
            Assert.That(document.sortingOrder, Is.EqualTo(1000));
            Assert.That(document.panelSettings.sortingOrder, Is.EqualTo(1000));
            Assert.That(move.enabled, Is.False, "Movement must remain disabled behind the pause screen.");
            Assert.That(pause.enabled, Is.True, "Pause remains enabled so Escape/Start can close the screen.");
            Assert.That(Time.timeScale, Is.EqualTo(0f));

            VisualElement root = menu.VisualRoot;
            Assert.That(root.Q("pause-status-shell"), Is.Not.Null);
            Assert.That(root.Q("pause-message-box").ClassListContains(RuinCrawlerUiTheme.DialogueBoxClass), Is.True);
            Assert.That(root.Q("pause-nav-map"), Is.Not.Null);
            Assert.That(root.Q("pause-nav-items"), Is.Not.Null);
            Assert.That(root.Q("pause-nav-equipment"), Is.Not.Null);
            Assert.That(root.Q("pause-nav-options"), Is.Not.Null);
            Assert.That(root.Q("pause-nav-back"), Is.Not.Null);

            Assert.DoesNotThrow(() => menu.SelectSection("Items"));
            Assert.That(menu.SelectedSectionId, Is.EqualTo("Items"));
            Assert.DoesNotThrow(() => menu.SelectSection("Equipment"));
            Assert.DoesNotThrow(() => menu.SelectSection("Options"));

            menu.SetOpen(false);
            yield return null;
            Assert.That(menu.IsOpen, Is.False);
            Assert.That(move.enabled, Is.True);
            Assert.That(Time.timeScale, Is.EqualTo(1f));

            Object.Destroy(menuObject);
            Object.Destroy(playerObject);
            Object.Destroy(actions);
            yield return null;
        }

        [TearDown]
        public void RestoreTimeScale()
        {
            Time.timeScale = 1f;
        }
    }
}
