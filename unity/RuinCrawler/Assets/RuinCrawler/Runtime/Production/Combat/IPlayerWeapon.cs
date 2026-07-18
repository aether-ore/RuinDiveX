using UnityEngine;

namespace RuinCrawler.Runtime.Combat
{
    public interface IPlayerWeapon
    {
        bool TryFire(Vector3 origin, Vector3 direction);
        WeaponTelemetrySnapshot Telemetry { get; }
    }

    public enum WeaponReadinessState
    {
        Ready = 0,
        Cycle = 1,
        Energy = 2,
        Recovery = 3
    }

    public readonly struct WeaponTelemetrySnapshot
    {
        public WeaponTelemetrySnapshot(
            string weaponName,
            double currentEnergy,
            double maximumEnergy,
            int shotsRemaining,
            WeaponReadinessState state,
            int power,
            int energy,
            int range,
            int rapid,
            int magazine)
        {
            WeaponName = weaponName ?? "Buster";
            CurrentEnergy = currentEnergy;
            MaximumEnergy = maximumEnergy;
            ShotsRemaining = shotsRemaining;
            State = state;
            Power = power;
            Energy = energy;
            Range = range;
            Rapid = rapid;
            Magazine = magazine;
        }

        public string WeaponName { get; }
        public double CurrentEnergy { get; }
        public double MaximumEnergy { get; }
        public int ShotsRemaining { get; }
        public WeaponReadinessState State { get; }
        public int Power { get; }
        public int Energy { get; }
        public int Range { get; }
        public int Rapid { get; }
        public int Magazine { get; }
        public double NormalizedEnergy => MaximumEnergy <= 0d ? 0d : CurrentEnergy / MaximumEnergy;
    }
}
