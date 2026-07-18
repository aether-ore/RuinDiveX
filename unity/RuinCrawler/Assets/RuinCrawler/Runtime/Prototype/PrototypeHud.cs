using UnityEngine;

namespace RuinCrawler.Port.Prototype
{
    public sealed class PrototypeHud : MonoBehaviour
    {
        private void OnGUI()
        {
            GUI.Box(new Rect(16f, 16f, 520f, 102f), string.Empty);
            GUI.Label(new Rect(30f, 28f, 380f, 24f), "Ruin Crawler Unity port - first graybox slice");
            GUI.Label(new Rect(30f, 52f, 490f, 24f), "Move: WASD / arrows    Sprint: Shift    Walk toggle: Ctrl");
            GUI.Label(new Rect(30f, 74f, 490f, 20f), "Jump: Space    Fire: hold left mouse");
            GUI.Label(new Rect(30f, 94f, 490f, 20f), "Goal: shoot the imported Sharukurusu target.");
        }
    }
}
