using UnityEngine;
using UnityEngine.UIElements;

namespace RuinCrawler.UI.Common
{
    /// <summary>
    /// Runtime-safe presentation primitives derived from the supplied Doni Arts
    /// menu references. The dialogue surface is generated in code so message
    /// boxes stay crisp at any panel resolution; the mechanical bitmaps are
    /// optional low-opacity texture layers, never gameplay data.
    /// </summary>
    public static class RuinCrawlerUiTheme
    {
        public const string MechanicalFrameClass = "rc-mechanical-frame";
        public const string MechanicalSurfaceClass = "rc-mechanical-surface";
        public const string DialogueBoxClass = "rc-dialogue-box";
        public const string RivetClass = "rc-corner-rivet";

        public static readonly Color Navy = new Color32(24, 48, 70, 255);
        public static readonly Color NavyInset = new Color32(12, 29, 43, 246);
        public static readonly Color PaleCyan = new Color32(135, 241, 219, 255);
        public static readonly Color Mint = new Color32(177, 234, 169, 255);
        public static readonly Color MutedText = new Color32(205, 232, 239, 255);
        public static readonly Color DialogueTop = new Color32(76, 105, 196, 255);
        public static readonly Color DialogueMiddle = new Color32(45, 69, 148, 255);
        public static readonly Color DialogueBottom = new Color32(24, 35, 76, 255);

        private const string WideSurfaceResource = "Art/doni-arts-mechanical-surface-wide";
        private const string DiagonalSurfaceResource = "Art/doni-arts-mechanical-surface-diagonal";
        private static Texture2D dialogueGradient;

        public static Texture2D DialogueGradientTexture
        {
            get
            {
                if (dialogueGradient == null)
                {
                    dialogueGradient = BuildDialogueGradient(4, 64);
                }

                return dialogueGradient;
            }
        }

        public static Texture2D LoadMechanicalSurface(bool diagonal = false)
        {
            return Resources.Load<Texture2D>(diagonal ? DiagonalSurfaceResource : WideSurfaceResource);
        }

        public static void StyleScreenRoot(VisualElement root)
        {
            if (root == null) return;
            root.style.flexGrow = 1f;
            root.style.color = Color.white;
            root.style.unityFontStyleAndWeight = FontStyle.Normal;
        }

        public static void StyleMechanicalFrame(VisualElement element, bool strong = false)
        {
            if (element == null) return;
            element.AddToClassList(MechanicalFrameClass);
            element.style.backgroundColor = strong ? Navy : NavyInset;
            SetBorder(element, PaleCyan, strong ? 4f : 2f);
            element.style.borderTopLeftRadius = 8f;
            element.style.borderTopRightRadius = 8f;
            element.style.borderBottomLeftRadius = 8f;
            element.style.borderBottomRightRadius = 8f;
        }

        public static void StyleDialogueBox(VisualElement element, bool addRivets = true)
        {
            if (element == null) return;
            element.AddToClassList(DialogueBoxClass);
            element.style.backgroundImage = new StyleBackground(DialogueGradientTexture);
            SetBackgroundLayout(element, cover: false);
            SetBorder(element, PaleCyan, 3f);
            element.style.borderTopLeftRadius = 5f;
            element.style.borderTopRightRadius = 5f;
            element.style.borderBottomLeftRadius = 5f;
            element.style.borderBottomRightRadius = 5f;
            element.style.color = Color.white;
            if (addRivets)
            {
                AddCornerRivets(element);
            }
        }

        public static VisualElement AddMechanicalSurface(
            VisualElement parent,
            bool diagonal = false,
            float opacity = 0.12f)
        {
            if (parent == null) return null;
            Texture2D texture = LoadMechanicalSurface(diagonal);
            if (texture == null) return null;

            var surface = new VisualElement
            {
                name = diagonal ? "mechanical-surface-diagonal" : "mechanical-surface-wide",
                pickingMode = PickingMode.Ignore
            };
            surface.AddToClassList(MechanicalSurfaceClass);
            SetAbsoluteStretch(surface);
            surface.style.backgroundImage = new StyleBackground(texture);
            SetBackgroundLayout(surface, cover: true);
            surface.style.opacity = Mathf.Clamp01(opacity);
            parent.Insert(0, surface);
            return surface;
        }

        public static void StyleHeading(Label label, int size = 22, bool centered = false)
        {
            if (label == null) return;
            label.style.color = Color.white;
            label.style.fontSize = size;
            label.style.unityFontStyleAndWeight = FontStyle.Bold;
            if (centered)
            {
                label.style.unityTextAlign = TextAnchor.MiddleCenter;
            }
        }

        public static void StyleBodyText(Label label, int size = 14)
        {
            if (label == null) return;
            label.style.color = MutedText;
            label.style.fontSize = size;
            label.style.whiteSpace = WhiteSpace.Normal;
        }

        public static void StyleMenuButton(Button button, bool selected = false)
        {
            if (button == null) return;
            button.style.height = 46f;
            button.style.marginTop = 5f;
            button.style.marginBottom = 5f;
            button.style.paddingLeft = 14f;
            button.style.unityTextAlign = TextAnchor.MiddleLeft;
            button.style.unityFontStyleAndWeight = FontStyle.Bold;
            button.style.fontSize = 16f;
            button.style.color = selected ? NavyInset : Color.white;
            button.style.backgroundColor = selected ? Mint : (Color)new Color32(58, 69, 105, 255);
            SetBorder(button, selected ? PaleCyan : new Color32(95, 112, 151, 255), 2f);
        }

        public static void AddCornerRivets(VisualElement parent)
        {
            if (parent == null || parent.Q(className: RivetClass) != null) return;
            AddRivet(parent, "rivet-top-left", true, true);
            AddRivet(parent, "rivet-top-right", false, true);
            AddRivet(parent, "rivet-bottom-left", true, false);
            AddRivet(parent, "rivet-bottom-right", false, false);
        }

        public static void SetBorder(VisualElement element, Color color, float width)
        {
            if (element == null) return;
            element.style.borderTopWidth = width;
            element.style.borderRightWidth = width;
            element.style.borderBottomWidth = width;
            element.style.borderLeftWidth = width;
            element.style.borderTopColor = color;
            element.style.borderRightColor = color;
            element.style.borderBottomColor = color;
            element.style.borderLeftColor = color;
        }

        private static Texture2D BuildDialogueGradient(int width, int height)
        {
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, false, false)
            {
                name = "RuinCrawler_DerivedDialogueGradient",
                filterMode = FilterMode.Bilinear,
                wrapMode = TextureWrapMode.Clamp,
                hideFlags = HideFlags.HideAndDontSave
            };

            for (int y = 0; y < height; y += 1)
            {
                float fromBottom = height <= 1 ? 1f : y / (float)(height - 1);
                Color color = fromBottom < 0.5f
                    ? Color.Lerp(DialogueBottom, DialogueMiddle, fromBottom * 2f)
                    : Color.Lerp(DialogueMiddle, DialogueTop, (fromBottom - 0.5f) * 2f);
                for (int x = 0; x < width; x += 1)
                {
                    texture.SetPixel(x, y, color);
                }
            }

            texture.Apply(false, false);
            return texture;
        }

        private static void AddRivet(VisualElement parent, string name, bool left, bool top)
        {
            var rivet = new VisualElement { name = name, pickingMode = PickingMode.Ignore };
            rivet.AddToClassList(RivetClass);
            rivet.style.position = Position.Absolute;
            rivet.style.width = 18f;
            rivet.style.height = 18f;
            rivet.style.backgroundColor = Navy;
            rivet.style.borderTopLeftRadius = 9f;
            rivet.style.borderTopRightRadius = 9f;
            rivet.style.borderBottomLeftRadius = 9f;
            rivet.style.borderBottomRightRadius = 9f;
            SetBorder(rivet, PaleCyan, 3f);
            if (left) rivet.style.left = -10f; else rivet.style.right = -10f;
            if (top) rivet.style.top = -10f; else rivet.style.bottom = -10f;
            parent.Add(rivet);
        }

        private static void SetAbsoluteStretch(VisualElement element)
        {
            element.style.position = Position.Absolute;
            element.style.left = 0f;
            element.style.right = 0f;
            element.style.top = 0f;
            element.style.bottom = 0f;
        }

        private static void SetBackgroundLayout(VisualElement element, bool cover)
        {
            BackgroundSize size = cover
                ? new BackgroundSize(BackgroundSizeType.Cover)
                : new BackgroundSize(Length.Percent(100f), Length.Percent(100f));
            element.style.backgroundSize = new StyleBackgroundSize(size);
            element.style.backgroundRepeat = new StyleBackgroundRepeat(
                new BackgroundRepeat(Repeat.NoRepeat, Repeat.NoRepeat));
            element.style.backgroundPositionX = new StyleBackgroundPosition(
                new BackgroundPosition(BackgroundPositionKeyword.Center));
            element.style.backgroundPositionY = new StyleBackgroundPosition(
                new BackgroundPosition(BackgroundPositionKeyword.Center));
        }
    }
}
