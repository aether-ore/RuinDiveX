using System.Linq;
using NUnit.Framework;
using RuinCrawler.UI.Common;
using UnityEditor;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.UIElements;

namespace RuinCrawler.Production.Tests
{
    public sealed class ProductionUiThemeEditModeTests
    {
        [Test]
        public void DialogueGradient_IsDerivedVerticalBlueAndReadable()
        {
            Texture2D texture = RuinCrawlerUiTheme.DialogueGradientTexture;
            Assert.That(texture, Is.Not.Null);
            Assert.That(texture.width, Is.EqualTo(4));
            Assert.That(texture.height, Is.EqualTo(64));

            Color bottom = texture.GetPixel(1, 0);
            Color top = texture.GetPixel(1, texture.height - 1);
            Assert.That(top.grayscale, Is.GreaterThan(bottom.grayscale));
            Assert.That(top.b, Is.GreaterThan(top.r));
            Assert.That(bottom.b, Is.GreaterThan(bottom.r));
            Assert.That(texture.GetPixel(0, 20), Is.EqualTo(texture.GetPixel(3, 20)));
        }

        [Test]
        public void MechanicalSurfaces_AreRuntimeLoadableAndThemeAddsFourRivets()
        {
            Assert.That(RuinCrawlerUiTheme.LoadMechanicalSurface(), Is.Not.Null);
            Assert.That(RuinCrawlerUiTheme.LoadMechanicalSurface(true), Is.Not.Null);

            var dialogue = new VisualElement();
            RuinCrawlerUiTheme.StyleDialogueBox(dialogue);
            Assert.That(dialogue.ClassListContains(RuinCrawlerUiTheme.DialogueBoxClass), Is.True);
            Assert.That(
                dialogue.Query<VisualElement>(className: RuinCrawlerUiTheme.RivetClass).ToList().Count,
                Is.EqualTo(4));
        }

        [Test]
        public void ProductionInput_HasKeyboardAndGamepadPauseBindings()
        {
            const string path = "Assets/RuinCrawler/Input/RuinCrawlerInput.inputactions";
            InputActionAsset input = AssetDatabase.LoadAssetAtPath<InputActionAsset>(path);
            Assert.That(input, Is.Not.Null);
            InputAction pause = input.FindAction("Gameplay/Pause", true);
            string[] bindings = pause.bindings.Select(value => value.path).ToArray();
            CollectionAssert.Contains(bindings, "<Keyboard>/escape");
            CollectionAssert.Contains(bindings, "<Gamepad>/start");
        }
    }
}
