using System;
using NUnit.Framework;

namespace RuinCrawler.Core.Foundation.Tests
{
    public sealed class CoordinateConverterTests
    {
        [Test]
        public void AsymmetricPoseMatchesPortConventionAndRoundTrips()
        {
            var threePose = new DoublePose(new DoubleVector3(3.25d, -1.5d, 7.75d), 1.125d);

            DoublePose unityPose = CoordinateConverter.ThreeToUnityPose(threePose);

            Assert.That(unityPose.Position, Is.EqualTo(new DoubleVector3(-3.25d, -1.5d, 7.75d)));
            Assert.That(unityPose.YawRadians, Is.EqualTo(-1.125d));
            Assert.That(CoordinateConverter.UnityToThreePose(unityPose), Is.EqualTo(threePose));
        }

        [Test]
        public void PositionAndDirectionConversionAreInvolutions()
        {
            var value = new DoubleVector3(-9.2d, 4.1d, 0.35d);

            Assert.That(
                CoordinateConverter.UnityToThreePosition(CoordinateConverter.ThreeToUnityPosition(value)),
                Is.EqualTo(value));
            Assert.That(
                CoordinateConverter.UnityToThreeDirection(CoordinateConverter.ThreeToUnityDirection(value)),
                Is.EqualTo(value));
        }

        [Test]
        public void NonFiniteCoordinatesFailVisibly()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                new DoubleVector3(double.NaN, 0d, 0d));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                CoordinateConverter.ThreeToUnityYawRadians(double.PositiveInfinity));
        }
    }
}
