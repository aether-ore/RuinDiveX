using System;
using System.Collections.Generic;

namespace RuinCrawler.Core.Buster.ProjectileKernel
{
    public static class BusterTrajectoryKernel
    {
        private const double Tau = Math.PI * 2d;

        public static BusterVector3 RotateDirectionYaw(BusterVector3 direction, double radians)
        {
            double angle = FiniteOr(radians, 0d);
            double cosine = Math.Cos(angle);
            double sine = Math.Sin(angle);
            var rotated = new BusterVector3(
                (direction.X * cosine) + (direction.Z * sine),
                direction.Y,
                (direction.Z * cosine) - (direction.X * sine));
            return rotated.Normalized(BusterVector3.Forward);
        }

        public static IReadOnlyList<BusterVector3> GetSpreadDirections(
            BusterVector3 direction,
            IReadOnlyList<double> offsets)
        {
            int count = offsets?.Count ?? 0;
            var result = new BusterVector3[count];
            for (int index = 0; index < count; index += 1)
            {
                result[index] = RotateDirectionYaw(direction, offsets[index]);
            }

            return Array.AsReadOnly(result);
        }

        public static IReadOnlyList<BusterVector3> GetClusterDirections(
            BusterVector3 direction,
            int count = 5,
            double phase = -Math.PI / 2d)
        {
            int total = Math.Max(1, count);
            BusterVector3 forward = direction.Normalized(BusterVector3.Forward);
            BusterVector3 reference = Math.Abs(forward.Y) < 0.9d
                ? new BusterVector3(0d, 1d, 0d)
                : new BusterVector3(1d, 0d, 0d);
            BusterVector3 right = BusterVector3.Cross(reference, forward)
                .Normalized(new BusterVector3(1d, 0d, 0d));
            BusterVector3 up = BusterVector3.Cross(forward, right);
            var result = new BusterVector3[total];
            for (int index = 0; index < total; index += 1)
            {
                double angle = FiniteOr(phase, -Math.PI / 2d) + (((double)index / total) * Tau);
                double radialX = Math.Cos(angle);
                double radialY = Math.Sin(angle);
                result[index] = ((forward * 0.78d)
                    + (((right * radialX) + (up * radialY)) * 0.62d))
                    .Normalized(BusterVector3.Forward);
            }

            return Array.AsReadOnly(result);
        }

        public static double GetBallisticApexProgress(
            BusterVector3 start,
            BusterVector3 end,
            double arcHeight)
        {
            double height = Math.Max(0d, FiniteOr(arcHeight, 0d));
            if (height <= 0d)
            {
                return end.Y > start.Y ? 1d : 0d;
            }

            double ratio = -(end.Y - start.Y) / (height * Math.PI);
            if (ratio <= -1d)
            {
                return 1d;
            }

            if (ratio >= 1d)
            {
                return 0d;
            }

            return Math.Acos(ratio) / Math.PI;
        }

        public static BusterVector3 SampleBallisticPoint(
            BusterVector3 start,
            BusterVector3 end,
            double arcHeight,
            double progress)
        {
            double t = Clamp(FiniteOr(progress, 0d), 0d, 1d);
            return new BusterVector3(
                start.X + ((end.X - start.X) * t),
                start.Y + ((end.Y - start.Y) * t)
                    + (Math.Sin(t * Math.PI) * Math.Max(0d, FiniteOr(arcHeight, 0d))),
                start.Z + ((end.Z - start.Z) * t));
        }

        public static BusterVector3 SampleSegment(
            BusterVector3 start,
            BusterVector3 direction,
            double travel,
            double previousDistance,
            double range,
            double baseY,
            double endY,
            double arcHeight,
            double fraction)
        {
            double alpha = Clamp(FiniteOr(fraction, 0d), 0d, 1d);
            double normalizedTravel = Math.Max(0d, FiniteOr(travel, 0d));
            double normalizedRange = Math.Max(0.001d, FiniteOr(range, 1d));
            BusterVector3 position = start + (direction * (normalizedTravel * alpha));
            double height = Math.Max(0d, FiniteOr(arcHeight, 0d));
            if (height <= 0d)
            {
                return position;
            }

            double progress = Clamp(
                (FiniteOr(previousDistance, 0d) + (normalizedTravel * alpha)) / normalizedRange,
                0d,
                1d);
            BusterVector3 ballistic = SampleBallisticPoint(
                new BusterVector3(0d, baseY, 0d),
                new BusterVector3(0d, endY, 0d),
                height,
                progress);
            return new BusterVector3(position.X, ballistic.Y, position.Z);
        }

        public static BusterVector3 SteerDirection(
            BusterVector3 direction,
            BusterVector3 targetDirection,
            double strength,
            double elapsedSeconds,
            double maximumAlpha = 0.28d)
        {
            BusterVector3 source = direction.Normalized(BusterVector3.Forward);
            if (targetDirection.Length <= 0.000001d)
            {
                return source;
            }

            BusterVector3 target = targetDirection.Normalized(source);
            double alpha = Clamp(
                Math.Max(0d, FiniteOr(strength, 0d))
                    * Math.Max(0d, FiniteOr(elapsedSeconds, 0d)),
                0d,
                Math.Max(0d, FiniteOr(maximumAlpha, 0.28d)));
            return (source + ((target - source) * alpha)).Normalized(source);
        }

        internal static double Clamp(double value, double minimum, double maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }

        internal static double FiniteOr(double value, double fallback)
        {
            return double.IsNaN(value) || double.IsInfinity(value) ? fallback : value;
        }
    }
}
