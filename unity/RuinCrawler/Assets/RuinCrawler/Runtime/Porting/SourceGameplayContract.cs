namespace RuinCrawler.Port.Porting
{
    /// <summary>
    /// First set of player-facing constants carried across from the Three.js
    /// implementation. Keeping them together prevents the Unity graybox from
    /// quietly drifting while the full gameplay systems are ported.
    /// </summary>
    public static class SourceGameplayContract
    {
        public const float PlayerHeight = 2.85f;
        public const float PlayerRadius = 0.42f;
        public const float PlayerWalkSpeed = 6.2f;
        public const float PlayerJogSpeedMultiplier = 1.68f;
        public const float PlayerSprintSpeedMultiplier = 2.25f;
        public const float PlayerJogSpeed = PlayerWalkSpeed * PlayerJogSpeedMultiplier;
        public const float PlayerSprintSpeed = PlayerWalkSpeed * PlayerSprintSpeedMultiplier;
        // The Three.js player turns at 2.7 radians per second. Unity owns yaw
        // in degrees, so the runtime converts this value at the scene boundary.
        public const float PlayerTankTurnRateRadians = 2.7f;
        // Compatibility alias for the original Unity graybox field.
        public const float PlayerMoveSpeed = PlayerWalkSpeed;
        public const float PlayerJumpHeight = 1.65f;
        public const float PlayerJumpTimeToApex = 0.33f;
        public const float PlayerFallGravityMultiplier = 1.22f;
        public const float PlayerLandingRecoveryTime = 0.11f;
        public const float PlayerCombatIdleHoldSeconds = 20f;

        // Roll uses a separate imported rig but should read at nearly the same
        // gameplay scale as Mega Man while retaining her shorter silhouette.
        public const float RollHeight = 2.6f;
        public const float RollRadius = 0.38f;

        public const float CameraFieldOfView = 48f;
        public const float CameraNearClip = 0.1f;
        public const float CameraFarClip = 120f;
        public const float CameraDistance = 6.8f;
        public const float CameraHeight = 3.25f;
        public const float CameraLookHeight = 1.35f;
        public const float CameraLookAhead = 1.7f;
        public const float CameraFollowResponsiveness = 7f;
        public const float CameraYawResponsiveness = 5.4f;
        public const float CameraTankTurnYawResponsiveness = 3.8f;

        public const float MegaBusterDamage = 8f;
        public const float MegaBusterRange = 6.9f;
        public const float MegaBusterSpeed = 9.5f;
        public const float MegaBusterRadius = 0.17f;
        public const float MegaBusterCadence = 4.2f;
        public const float MegaBusterFireInterval = 1f / MegaBusterCadence;
        public const float MegaBusterAimLockDuration = 0.44f;

        public const float SharukurusuHeight = 2.42f;
        public const float SharukurusuRadius = 0.78f;
        public const float SharukurusuHealth = 68f;
    }
}
