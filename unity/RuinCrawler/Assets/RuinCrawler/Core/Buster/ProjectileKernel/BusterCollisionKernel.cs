using System;

namespace RuinCrawler.Core.Buster.ProjectileKernel
{
    public readonly struct BusterVerticalCapsule
    {
        public BusterVerticalCapsule(
            double x,
            double z,
            double radius,
            double bottomY,
            double topY)
        {
            X = x;
            Z = z;
            Radius = radius;
            BottomY = bottomY;
            TopY = topY;
        }

        public double X { get; }
        public double Z { get; }
        public double Radius { get; }
        public double BottomY { get; }
        public double TopY { get; }
    }

    public static class BusterCollisionKernel
    {
        public static double GetTargetCollisionHeight(BusterProjectileTargetSnapshot target)
        {
            if (target == null)
            {
                return BusterProjectileKernelRules.DefaultTargetCollisionHeight;
            }

            return Math.Max(target.Radius * 2.2d, target.CollisionHeight);
        }

        public static BusterVerticalCapsule GetVerticalCapsule(BusterProjectileTargetSnapshot target)
        {
            if (target == null)
            {
                throw new ArgumentNullException(nameof(target));
            }

            double height = GetTargetCollisionHeight(target);
            double bottomY = target.Position.Y + target.Radius;
            return new BusterVerticalCapsule(
                target.Position.X,
                target.Position.Z,
                target.Radius,
                bottomY,
                Math.Max(bottomY, target.Position.Y + height - target.Radius));
        }

        public static double GetPointToVerticalCapsuleAxisDistanceSquared(
            BusterVector3 point,
            BusterProjectileTargetSnapshot target)
        {
            BusterVerticalCapsule capsule = GetVerticalCapsule(target);
            double dx = point.X - capsule.X;
            double dy = point.Y - BusterTrajectoryKernel.Clamp(
                point.Y,
                capsule.BottomY,
                capsule.TopY);
            double dz = point.Z - capsule.Z;
            return (dx * dx) + (dy * dy) + (dz * dz);
        }

        public static double GetPointToVerticalCapsuleSurfaceDistance(
            BusterVector3 point,
            BusterProjectileTargetSnapshot target)
        {
            return Math.Max(
                0d,
                Math.Sqrt(GetPointToVerticalCapsuleAxisDistanceSquared(point, target))
                    - target.Radius);
        }

        public static bool SphereIntersectsTargetCapsule(
            BusterVector3 center,
            double radius,
            BusterProjectileTargetSnapshot target,
            double epsilon = BusterProjectileKernelRules.EventEpsilon)
        {
            return GetPointToVerticalCapsuleSurfaceDistance(center, target)
                <= Math.Max(0d, BusterTrajectoryKernel.FiniteOr(radius, 0d))
                    + Math.Max(0d, BusterTrajectoryKernel.FiniteOr(epsilon, 0d));
        }

        public static double? FindStraightCapsuleHitFraction(
            BusterVector3 start,
            BusterVector3 end,
            BusterProjectileTargetSnapshot target,
            double projectileRadius)
        {
            if (target == null)
            {
                return null;
            }

            double collisionRadius = Math.Max(0d, projectileRadius) + target.Radius;
            double radiusSquared = collisionRadius * collisionRadius;
            Func<double, BusterVector3> positionAt = fraction => BusterVector3.Lerp(start, end, fraction);
            Func<double, double> distanceAt = fraction =>
                GetPointToVerticalCapsuleAxisDistanceSquared(positionAt(fraction), target);

            if (distanceAt(0d) <= radiusSquared)
            {
                return 0d;
            }

            double minimumLow = 0d;
            double minimumHigh = 1d;
            for (int iteration = 0; iteration < 28; iteration += 1)
            {
                double third = (minimumHigh - minimumLow) / 3d;
                double left = minimumLow + third;
                double right = minimumHigh - third;
                if (distanceAt(left) <= distanceAt(right))
                {
                    minimumHigh = right;
                }
                else
                {
                    minimumLow = left;
                }
            }

            double minimum = (minimumLow + minimumHigh) * 0.5d;
            if (distanceAt(minimum) > radiusSquared + BusterProjectileKernelRules.EventEpsilon)
            {
                return null;
            }

            double low = 0d;
            double high = minimum;
            for (int iteration = 0; iteration < 32; iteration += 1)
            {
                double middle = (low + high) * 0.5d;
                if (distanceAt(middle) <= radiusSquared)
                {
                    high = middle;
                }
                else
                {
                    low = middle;
                }
            }

            return high;
        }

        public static double? FindSampledCapsuleHitFraction(
            Func<double, BusterVector3> positionAt,
            BusterProjectileTargetSnapshot target,
            double projectileRadius)
        {
            if (positionAt == null)
            {
                throw new ArgumentNullException(nameof(positionAt));
            }

            if (target == null)
            {
                return null;
            }

            double collisionRadius = Math.Max(0d, projectileRadius) + target.Radius;
            double radiusSquared = collisionRadius * collisionRadius;
            Func<double, bool> isInside = fraction =>
                GetPointToVerticalCapsuleAxisDistanceSquared(positionAt(fraction), target)
                    <= radiusSquared;
            return FindFirstSampledBoundary(isInside, 32);
        }

        public static double? FindSphereHitFraction(
            Func<double, BusterVector3> positionAt,
            BusterVector3 center,
            double radius)
        {
            if (positionAt == null)
            {
                throw new ArgumentNullException(nameof(positionAt));
            }

            double radiusSquared = Math.Max(0d, radius) * Math.Max(0d, radius);
            Func<double, bool> isInside = fraction =>
                BusterVector3.DistanceSquared(positionAt(fraction), center) <= radiusSquared;
            return FindFirstSampledBoundary(isInside, 28);
        }

        private static double? FindFirstSampledBoundary(
            Func<double, bool> isInside,
            int binaryIterations)
        {
            if (isInside(0d))
            {
                return 0d;
            }

            double previous = 0d;
            const int steps = 64;
            for (int step = 1; step <= steps; step += 1)
            {
                double fraction = (double)step / steps;
                if (!isInside(fraction))
                {
                    previous = fraction;
                    continue;
                }

                double low = previous;
                double high = fraction;
                for (int iteration = 0; iteration < binaryIterations; iteration += 1)
                {
                    double middle = (low + high) * 0.5d;
                    if (isInside(middle))
                    {
                        high = middle;
                    }
                    else
                    {
                        low = middle;
                    }
                }

                return high;
            }

            return null;
        }
    }
}
