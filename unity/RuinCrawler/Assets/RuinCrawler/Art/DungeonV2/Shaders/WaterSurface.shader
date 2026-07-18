Shader "Ruin/WaterSurface"
{
    Properties
    {
        _MainTex ("Surface Texture", 2D) = "white" {}
        _DetailTex ("Deep Detail Texture", 2D) = "white" {}
        _ShallowColor ("Shallow Color", Color) = (0.12, 0.72, 0.76, 1)
        _DeepColor ("Deep Color", Color) = (0.015, 0.16, 0.25, 1)
        _ScrollA ("Primary Scroll", Vector) = (0.025, 0.012, 0, 0)
        _ScrollB ("Secondary Scroll", Vector) = (-0.014, 0.021, 0, 0)
        _DetailScale ("Detail Scale", Range(0.25, 4)) = 1.35
        _WaveAmplitude ("Vertex Wave Amplitude", Range(0, 0.2)) = 0.035
        _WaveFrequency ("Vertex Wave Frequency", Range(0.1, 8)) = 2.2
        _WaveSpeed ("Vertex Wave Speed", Range(0, 8)) = 1.1
        _Opacity ("Opacity", Range(0, 1)) = 0.72
        _Smoothness ("Smoothness", Range(0, 1)) = 0.68
        _EmissionStrength ("Emission Strength", Range(0, 2)) = 0.12
    }

    SubShader
    {
        Tags
        {
            "Queue"="Transparent"
            "RenderType"="Transparent"
            "IgnoreProjector"="True"
        }
        LOD 250
        ZWrite Off

        CGPROGRAM
        #pragma surface surf Standard alpha:fade vertex:vert
        #pragma target 3.0

        sampler2D _MainTex;
        sampler2D _DetailTex;
        fixed4 _ShallowColor;
        fixed4 _DeepColor;
        float4 _ScrollA;
        float4 _ScrollB;
        half _DetailScale;
        half _WaveAmplitude;
        half _WaveFrequency;
        half _WaveSpeed;
        half _Opacity;
        half _Smoothness;
        half _EmissionStrength;

        struct Input
        {
            float2 uv_MainTex;
            float3 worldPos;
        };

        void vert(inout appdata_full vertex)
        {
            float phase = (vertex.vertex.x + vertex.vertex.z) * _WaveFrequency + (_Time.y * _WaveSpeed);
            vertex.vertex.y += sin(phase) * _WaveAmplitude;
        }

        void surf(Input input, inout SurfaceOutputStandard output)
        {
            float2 uvA = input.uv_MainTex + (_ScrollA.xy * _Time.y);
            float2 uvB = (input.uv_MainTex * _DetailScale) + (_ScrollB.xy * _Time.y);
            fixed3 primary = tex2D(_MainTex, uvA).rgb;
            fixed3 detail = tex2D(_DetailTex, uvB).rgb;
            half pattern = saturate(dot(primary, fixed3(0.25, 0.55, 0.2)) * 0.7 +
                                    dot(detail, fixed3(0.2, 0.6, 0.2)) * 0.3);
            fixed3 water = lerp(_DeepColor.rgb, _ShallowColor.rgb, pattern);

            output.Albedo = water;
            output.Metallic = 0;
            output.Smoothness = _Smoothness;
            output.Emission = water * _EmissionStrength;
            output.Alpha = _Opacity;
        }
        ENDCG
    }

    FallBack "Transparent/Diffuse"
}
