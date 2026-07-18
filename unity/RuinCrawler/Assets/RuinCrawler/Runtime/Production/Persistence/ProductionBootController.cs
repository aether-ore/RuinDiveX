using UnityEngine;
using UnityEngine.SceneManagement;

namespace RuinCrawler.Runtime.Persistence
{
    public sealed class ProductionBootController : MonoBehaviour
    {
        [SerializeField] private string firstScene = "Camp";

        private void Start()
        {
            if (!string.IsNullOrWhiteSpace(firstScene))
            {
                SceneManager.LoadScene(firstScene);
            }
        }
    }
}
