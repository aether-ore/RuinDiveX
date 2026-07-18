Shader "Ruin/MagmaSurface"
{
    Properties
    {
        _Color ("Crust Tint", Color) = (0.78, 0.32, 0.12, 1)
        _MainTex ("Magma Albedo", 2D) = "white" {}
        _EmissionMap ("Heat Emission Mask", 2D) = "white" {}
        [HDR] _EmissionColor ("Heat Color", Color) = (1.6, 0.23, 0.015, 1)
        _EmissionStrength ("Emission Strength", Range(0, 12)) = 4.5
        _ScrollA ("Primary Scroll", Vector) = (0.015, 0.008, 0, 0)
        _ScrollB ("Secondary Scroll", Vector) = (-0.009, 0.012, 0, 0)
        _PulseSpeed ("Heat Pulse Speed", Range(0, 8)) = 1.7
        _PulseAmount ("Heat Pulse Amount", Range(0, 1)) = 0.18
        _Smoothness ("Smoothness", Range(0, 1)) = 0.2
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
        fixed4 _EmissionColor;
        float4 _ScrollA;
        float4 _ScrollB;
        half _EmissionStrength;
        half _PulseSpeed;
        half _PulseAmount;
        half _Smoothness;

        struct Input
        {
            float2 uv_MainTex;
        };

        void surf(Input input, inout SurfaceOutputStandard output)
        {
            float2 uvA = input.uv_MainTex + (_ScrollA.xy * _Time.y);
            float2 uvB = input.uv_MainTex + (_ScrollB.xy * _Time.y);
            fixed3 albedoA = tex2D(_MainTex, uvA).rgb;
            fixed3 albedoB = tex2D(_MainTex, uvB).rgb;
            fixed3 emissionA = tex2D(_EmissionMap, uvA).rgb;
            fixed3 emissionB = tex2D(_EmissionMap, uvB).rgb;
            half pulse = 1.0 + (sin(_Time.y * _PulseSpeed) * _PulseAmount);

            output.Albedo = lerp(albedoA, albedoB, 0.35) * _Color.rgb;
            output.Metallic = 0;
            output.Smoothness = _Smoothness;
            output.Emission = max(emissionA, emissionB) * _EmissionColor.rgb * _EmissionStrength * pulse;
            output.Alpha = 1;
        }
        ENDCG
    }

    FallBack "Diffuse"
}
