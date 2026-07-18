Shader "Ruin/ElectricPanel"
{
    Properties
    {
        _Color ("Panel Tint", Color) = (1, 1, 1, 1)
        _MainTex ("Panel Albedo", 2D) = "white" {}
        _EmissionMap ("Circuit Emission Mask", 2D) = "black" {}
        [HDR] _SafeColor ("Safe Color", Color) = (0.02, 0.12, 0.15, 1)
        [HDR] _ChargeColor ("Charge Color", Color) = (1.0, 0.38, 0.03, 1)
        [HDR] _LiveColor ("Live Color", Color) = (0.05, 1.2, 1.8, 1)
        [HDR] _GroundedColor ("Grounded Color", Color) = (0.08, 0.45, 0.3, 1)
        _Phase ("Phase: Safe 0, Charge 1, Live 2, Grounded 3", Range(0, 3)) = 0
        _EmissionStrength ("Emission Strength", Range(0, 10)) = 3.2
        _PulseSpeed ("Pulse Speed", Range(0, 12)) = 5
        _Metallic ("Metallic", Range(0, 1)) = 0.05
        _Smoothness ("Smoothness", Range(0, 1)) = 0.18
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 250

        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows addshadow
        #pragma target 3.0

        sampler2D _MainTex;
        sampler2D _EmissionMap;
        fixed4 _Color;
        fixed4 _SafeColor;
        fixed4 _ChargeColor;
        fixed4 _LiveColor;
        fixed4 _GroundedColor;
        half _Phase;
        half _EmissionStrength;
        half _PulseSpeed;
        half _Metallic;
        half _Smoothness;

        struct Input
        {
            float2 uv_MainTex;
            float2 uv_EmissionMap;
        };

        fixed3 PhaseColor(half phase)
        {
            if (phase < 0.5) return _SafeColor.rgb;
            if (phase < 1.5) return _ChargeColor.rgb;
            if (phase < 2.5) return _LiveColor.rgb;
            return _GroundedColor.rgb;
        }

        void surf(Input input, inout SurfaceOutputStandard output)
        {
            fixed4 albedo = tex2D(_MainTex, input.uv_MainTex) * _Color;
            fixed3 emissionMask = tex2D(_EmissionMap, input.uv_EmissionMap).rgb;
            half pulse = 1;
            if (_Phase > 0.5 && _Phase < 2.5)
            {
                half amplitude = _Phase < 1.5 ? 0.32 : 0.12;
                pulse += sin(_Time.y * _PulseSpeed) * amplitude;
            }
            half phaseStrength = _Phase < 0.5 ? 0.12 : (_Phase > 2.5 ? 0.3 : 1.0);

            output.Albedo = albedo.rgb;
            output.Metallic = _Metallic;
            output.Smoothness = _Smoothness;
            output.Emission = emissionMask * PhaseColor(_Phase) * _EmissionStrength * phaseStrength * pulse;
            output.Alpha = albedo.a;
        }
        ENDCG
    }

    FallBack "Diffuse"
}
