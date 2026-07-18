Shader "Ruin/IndustrialLit"
{
    Properties
    {
        _Color ("Tint", Color) = (1, 1, 1, 1)
        _MainTex ("Albedo", 2D) = "white" {}
        _EmissionMap ("Emission Mask", 2D) = "black" {}
        [HDR] _EmissionColor ("Emission Color", Color) = (0, 0, 0, 1)
        _EmissionStrength ("Emission Strength", Range(0, 8)) = 0
        _Metallic ("Metallic", Range(0, 1)) = 0
        _Smoothness ("Smoothness", Range(0, 1)) = 0.12
        _VertexColorWeight ("Vertex Color Weight", Range(0, 1)) = 0
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
        half _EmissionStrength;
        half _Metallic;
        half _Smoothness;
        half _VertexColorWeight;

        struct Input
        {
            float2 uv_MainTex;
            float2 uv_EmissionMap;
            fixed4 color : COLOR;
        };

        void surf(Input input, inout SurfaceOutputStandard output)
        {
            fixed4 albedo = tex2D(_MainTex, input.uv_MainTex) * _Color;
            fixed3 vertexTint = lerp(fixed3(1, 1, 1), input.color.rgb, _VertexColorWeight);
            fixed3 emissionMask = tex2D(_EmissionMap, input.uv_EmissionMap).rgb;

            output.Albedo = albedo.rgb * vertexTint;
            output.Metallic = _Metallic;
            output.Smoothness = _Smoothness;
            output.Emission = emissionMask * _EmissionColor.rgb * _EmissionStrength;
            output.Alpha = albedo.a;
        }
        ENDCG
    }

    FallBack "Diffuse"
}
