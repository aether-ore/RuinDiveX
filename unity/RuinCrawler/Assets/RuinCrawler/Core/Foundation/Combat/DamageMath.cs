using System;

namespace RuinCrawler.Core.Foundation
{
    public static class DamageMath
    {
        /// <summary>
        /// Mirrors the source contract: max(0, armor - armorPierce).
        /// Positive-infinite armor pierce intentionally bypasses all armor.
        /// </summary>
        public static double ComputeEffectiveArmor(double armor, double armorPierce)
        {
            DoubleVector3.RequireFinite(armor, nameof(armor));
            if (armor < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(armor), armor, "Armor cannot be negative.");
            }

            if (double.IsNaN(armorPierce) || double.IsNegativeInfinity(armorPierce) || armorPierce < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(armorPierce), armorPierce, "Armor pierce must be non-negative and may be positive infinity.");
            }

            if (double.IsPositiveInfinity(armorPierce))
            {
                return 0d;
            }

            return Math.Max(0d, armor - armorPierce);
        }

        /// <summary>
        /// Applies damage * 100 / (100 + effectiveArmor), matching Enemy.js
        /// and the Custom Buster simulator.
        /// </summary>
        public static double ApplyArmor(double damage, double armor, double armorPierce = 0d)
        {
            DoubleVector3.RequireFinite(damage, nameof(damage));
            if (damage < 0d)
            {
                throw new ArgumentOutOfRangeException(nameof(damage), damage, "Damage cannot be negative.");
            }

            double effectiveArmor = ComputeEffectiveArmor(armor, armorPierce);
            return damage * (100d / (100d + effectiveArmor));
        }
    }
}
