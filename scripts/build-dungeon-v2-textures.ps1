[CmdletBinding()]
param(
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$RepositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$UnityProjectRoot = Join-Path $RepositoryRoot 'unity/RuinCrawler'
$ConfigurationPath = Join-Path $RepositoryRoot 'scripts/dungeon-v2-texture-sources.json'
$ManifestAssetPath = 'Assets/RuinCrawler/Art/DungeonV2/Textures/dungeon_v2_texture_manifest.json'
$ManifestPath = Join-Path $UnityProjectRoot $ManifestAssetPath
$MaterialCatalogAssetPath = 'Assets/RuinCrawler/Art/DungeonV2/DungeonV2MaterialCatalog.asset'
$MaterialCatalogPath = Join-Path $UnityProjectRoot $MaterialCatalogAssetPath
$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Get-Sha256Bytes {
    param([byte[]]$Bytes)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '')
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-Sha256File {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Get-DeterministicGuid {
    param([string]$AssetPath)
    $normalized = $AssetPath.Replace('\', '/').ToLowerInvariant()
    $bytes = $Utf8NoBom.GetBytes("ruindivex-dungeon-v2-art:$normalized")
    return (Get-Sha256Bytes $bytes).Substring(0, 32).ToLowerInvariant()
}

function Convert-ToRgbaBitmap {
    param([System.Drawing.Image]$Image)
    $bitmap = [System.Drawing.Bitmap]::new(
        $Image.Width,
        $Image.Height,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.DrawImageUnscaled($Image, 0, 0)
    }
    finally {
        $graphics.Dispose()
    }
    return $bitmap
}

function Copy-Crop {
    param(
        [System.Drawing.Bitmap]$Source,
        [int]$X,
        [int]$Y,
        [int]$Width,
        [int]$Height
    )
    $rectangle = [System.Drawing.Rectangle]::new($X, $Y, $Width, $Height)
    return $Source.Clone($rectangle, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Remove-GrayBackground {
    param([System.Drawing.Bitmap]$Bitmap)

    $edgeWidth = [Math]::Max(8, [Math]::Floor($Bitmap.Width / 24))
    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
        [double]$backgroundR = 0
        [double]$backgroundG = 0
        [double]$backgroundB = 0
        [int]$samples = 0
        for ($x = 0; $x -lt $edgeWidth; $x++) {
            $left = $Bitmap.GetPixel($x, $y)
            $right = $Bitmap.GetPixel($Bitmap.Width - 1 - $x, $y)
            $backgroundR += $left.R + $right.R
            $backgroundG += $left.G + $right.G
            $backgroundB += $left.B + $right.B
            $samples += 2
        }
        $backgroundR /= $samples
        $backgroundG /= $samples
        $backgroundB /= $samples

        for ($x = 0; $x -lt $Bitmap.Width; $x++) {
            $pixel = $Bitmap.GetPixel($x, $y)
            $deltaR = $pixel.R - $backgroundR
            $deltaG = $pixel.G - $backgroundG
            $deltaB = $pixel.B - $backgroundB
            $distance = [Math]::Sqrt(($deltaR * $deltaR) + ($deltaG * $deltaG) + ($deltaB * $deltaB))
            $alpha = [int][Math]::Round([Math]::Min(255, [Math]::Max(0, ($distance - 5.0) * 10.2)))
            if ($alpha -le 3) {
                $Bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
            }
            else {
                $Bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $pixel.R, $pixel.G, $pixel.B))
            }
        }
    }
}

function Resize-Bitmap {
    param(
        [System.Drawing.Bitmap]$Source,
        [int]$Size
    )
    $destination = [System.Drawing.Bitmap]::new(
        $Size,
        $Size,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($destination)
    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage(
            $Source,
            [System.Drawing.Rectangle]::new(0, 0, $Size, $Size),
            [System.Drawing.Rectangle]::new(0, 0, $Source.Width, $Source.Height),
            [System.Drawing.GraphicsUnit]::Pixel)
    }
    finally {
        $graphics.Dispose()
    }
    return $destination
}

function Convert-ToEmissionMask {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [string]$Mode
    )
    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
        for ($x = 0; $x -lt $Bitmap.Width; $x++) {
            $pixel = $Bitmap.GetPixel($x, $y)
            if ($Mode -eq 'CyanEmissionMask') {
                $cyan = ($pixel.G + $pixel.B) * 0.5
                $dominance = [Math]::Max(0, $cyan - ($pixel.R * 0.9))
                $value = [int][Math]::Round([Math]::Min(255, [Math]::Max(0,
                    ($dominance * 2.2) + ([Math]::Max(0, $cyan - 105) * 0.65))))
            }
            elseif ($Mode -eq 'HeatEmissionMask') {
                $dominance = [Math]::Max(0, $pixel.R - ($pixel.B * 0.75))
                $value = [int][Math]::Round([Math]::Min(255, [Math]::Max(0,
                    ($dominance * 1.45) + ([Math]::Max(0, $pixel.G - 85) * 0.45))))
            }
            else {
                throw "Unsupported emission mask mode '$Mode'."
            }
            if ($value -lt 8) { $value = 0 }
            $Bitmap.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $value, $value, $value))
        }
    }
}

function Convert-BitmapToPngBytes {
    param([System.Drawing.Bitmap]$Bitmap)
    $stream = [System.IO.MemoryStream]::new()
    try {
        $Bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return $stream.ToArray()
    }
    finally {
        $stream.Dispose()
    }
}

function New-TextureMeta {
    param(
        [string]$Guid,
        [bool]$Srgb,
        [bool]$Clamp,
        [bool]$AlphaTransparency
    )
    $srgbValue = if ($Srgb) { 1 } else { 0 }
    $wrapValue = if ($Clamp) { 1 } else { 0 }
    $alphaValue = if ($AlphaTransparency) { 1 } else { 0 }
    return @"
fileFormatVersion: 2
guid: $Guid
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 1
    sRGBTexture: $srgbValue
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
    flipGreenChannel: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMipmapLimit: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: 256
  textureSettings:
    serializedVersion: 2
    filterMode: 2
    aniso: 4
    mipBias: 0
    wrapU: $wrapValue
    wrapV: $wrapValue
    wrapW: $wrapValue
  nPOTScale: 1
  lightmap: 0
  compressionQuality: 50
  spriteMode: 0
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: $alphaValue
  spriteTessellationDetail: -1
  textureType: 0
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 1
  compressionQualitySet: 0
  textureFormatSet: 0
  ignorePngGamma: 0
  applyGammaDecoding: 0
  swizzle: 50462976
  cookieLightType: 0
  platformSettings:
  - serializedVersion: 4
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 256
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 1
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
  spriteSheet:
    serializedVersion: 2
    sprites: []
    outline: []
    customData:
    physicsShape: []
    bones: []
    spriteID:
    internalID: 0
    vertices: []
    indices:
    edges: []
    weights: []
    secondaryTextures: []
    spriteCustomMetadata:
      entries: []
    nameFileIdTable: {}
  mipmapLimitGroupName:
  pSDRemoveMatte: 0
  userData: DungeonV2 deterministic derived runtime texture
  assetBundleName:
  assetBundleVariant:
"@.TrimStart()
}

function Format-InvariantNumber {
    param([object]$Value)
    return [System.Convert]::ToString([double]$Value, [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-ConfigurationValue {
    param(
        [object]$Object,
        [string]$Name,
        [object]$Default = $null
    )
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) { return $Default }
    return $property.Value
}

function Format-Color {
    param(
        [object[]]$Values,
        [object[]]$Fallback
    )
    $resolved = if ($null -eq $Values -or $Values.Count -ne 4) { $Fallback } else { $Values }
    return "{r: $(Format-InvariantNumber $resolved[0]), g: $(Format-InvariantNumber $resolved[1]), b: $(Format-InvariantNumber $resolved[2]), a: $(Format-InvariantNumber $resolved[3])}"
}

function New-TextureEnvironment {
    param(
        [string]$Property,
        [string]$Guid,
        [double]$ScaleX = 1,
        [double]$ScaleY = 1
    )
    $texture = if ([string]::IsNullOrWhiteSpace($Guid)) {
        '{fileID: 0}'
    }
    else {
        "{fileID: 2800000, guid: $Guid, type: 3}"
    }
    return @"
    - ${Property}:
        m_Texture: $texture
        m_Scale: {x: $(Format-InvariantNumber $ScaleX), y: $(Format-InvariantNumber $ScaleY)}
        m_Offset: {x: 0, y: 0}
"@.TrimEnd()
}

function New-NativeAssetMeta {
    param([string]$Guid)
    return @"
fileFormatVersion: 2
guid: $Guid
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 2100000
  userData: DungeonV2 deterministic derived material
  assetBundleName:
  assetBundleVariant:
"@.TrimStart()
}

function New-TextAssetMeta {
    param([string]$Guid)
    return @"
fileFormatVersion: 2
guid: $Guid
TextScriptImporter:
  externalObjects: {}
  userData: DungeonV2 deterministic art manifest
  assetBundleName:
  assetBundleVariant:
"@.TrimStart()
}

function New-ScriptableObjectMeta {
    param([string]$Guid)
    return @"
fileFormatVersion: 2
guid: $Guid
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 11400000
  userData: DungeonV2 deterministic semantic material catalog
  assetBundleName:
  assetBundleVariant:
"@.TrimStart()
}

function New-MaterialCatalogYaml {
    param([object[]]$Materials)
    $entryLines = New-Object System.Collections.Generic.List[string]
    foreach ($material in $Materials) {
        $entryLines.Add("  - roleId: $($material.role)")
        $entryLines.Add("    material: {fileID: 2100000, guid: $($material.guid), type: 2}")
    }
    $entries = $entryLines.ToArray() -join "`n"
    return @"
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 0}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: d9a58e7060a94ac0be1dc6fb56f099b9, type: 3}
  m_Name: DungeonV2MaterialCatalog
  m_EditorClassIdentifier: RuinCrawler.Art.DungeonV2::RuinCrawler.Art.DungeonV2.DungeonV2MaterialCatalog
  entries:
$entries
"@.TrimStart()
}

function Resolve-MapGuid {
    param(
        [hashtable]$MapById,
        [string]$MapId,
        [string]$MaterialId,
        [switch]$Optional
    )
    if ([string]::IsNullOrWhiteSpace($MapId)) {
        if ($Optional) { return '' }
        throw "Material '$MaterialId' is missing a required texture map ID."
    }
    if (-not $MapById.ContainsKey($MapId)) {
        throw "Material '$MaterialId' references unknown map '$MapId'."
    }
    return [string]$MapById[$MapId].guid
}

function New-MaterialYaml {
    param(
        [object]$Material,
        [hashtable]$MapById
    )

    $mainMapId = [string](Get-ConfigurationValue $Material 'mainMapId')
    $emissionMapId = [string](Get-ConfigurationValue $Material 'emissionMapId' '')
    $detailMapId = [string](Get-ConfigurationValue $Material 'detailMapId' '')
    $mainGuid = Resolve-MapGuid $MapById $mainMapId $Material.id
    $emissionGuid = Resolve-MapGuid $MapById $emissionMapId $Material.id -Optional
    $detailGuid = Resolve-MapGuid $MapById $detailMapId $Material.id -Optional
    $name = [System.IO.Path]::GetFileNameWithoutExtension([string]$Material.output)
    $smoothness = [double](Get-ConfigurationValue $Material 'smoothness' 0.12)
    $emissionStrength = [double](Get-ConfigurationValue $Material 'emissionStrength' 0)
    $textureEnvironments = New-Object System.Collections.Generic.List[string]
    $floatLines = New-Object System.Collections.Generic.List[string]
    $colorLines = New-Object System.Collections.Generic.List[string]

    switch ([string]$Material.kind) {
        'Industrial' {
            $shaderGuid = 'b71d57db33a545fa94ca7174b1b4a201'
            $shaderName = 'Ruin/IndustrialLit'
            $textureEnvironments.Add((New-TextureEnvironment '_EmissionMap' $emissionGuid))
            $textureEnvironments.Add((New-TextureEnvironment '_MainTex' $mainGuid))
            $floatLines.Add("    - _EmissionStrength: $(Format-InvariantNumber $emissionStrength)")
            $floatLines.Add('    - _Metallic: 0')
            $floatLines.Add("    - _Smoothness: $(Format-InvariantNumber $smoothness)")
            $floatLines.Add('    - _VertexColorWeight: 0')
            $colorLines.Add("    - _Color: $(Format-Color @(Get-ConfigurationValue $Material 'tint') @(1, 1, 1, 1))")
            $colorLines.Add("    - _EmissionColor: $(Format-Color @(Get-ConfigurationValue $Material 'emissionColor') @(0, 0, 0, 1))")
        }
        'Water' {
            $shaderGuid = '2d1a6c5b8aa84e238633d2ac64c56f01'
            $shaderName = 'Ruin/WaterSurface'
            $textureEnvironments.Add((New-TextureEnvironment '_DetailTex' $detailGuid))
            $textureEnvironments.Add((New-TextureEnvironment '_MainTex' $mainGuid))
            $floatLines.Add('    - _DetailScale: 1.35')
            $floatLines.Add("    - _EmissionStrength: $(Format-InvariantNumber $emissionStrength)")
            $opacity = [double](Get-ConfigurationValue $Material 'opacity' 0.72)
            $floatLines.Add("    - _Opacity: $(Format-InvariantNumber $opacity)")
            $floatLines.Add("    - _Smoothness: $(Format-InvariantNumber $smoothness)")
            $floatLines.Add('    - _WaveAmplitude: 0.035')
            $floatLines.Add('    - _WaveFrequency: 2.2')
            $floatLines.Add('    - _WaveSpeed: 1.1')
            $colorLines.Add('    - _DeepColor: {r: 0.015, g: 0.16, b: 0.25, a: 1}')
            $colorLines.Add('    - _ScrollA: {r: 0.025, g: 0.012, b: 0, a: 0}')
            $colorLines.Add('    - _ScrollB: {r: -0.014, g: 0.021, b: 0, a: 0}')
            $colorLines.Add('    - _ShallowColor: {r: 0.12, g: 0.72, b: 0.76, a: 1}')
        }
        'Magma' {
            $shaderGuid = 'f14c6d10ad6849e6a0e874db1b9f3c17'
            $shaderName = 'Ruin/MagmaSurface'
            $textureEnvironments.Add((New-TextureEnvironment '_EmissionMap' $emissionGuid))
            $textureEnvironments.Add((New-TextureEnvironment '_MainTex' $mainGuid))
            $floatLines.Add("    - _EmissionStrength: $(Format-InvariantNumber $emissionStrength)")
            $floatLines.Add('    - _PulseAmount: 0.18')
            $floatLines.Add('    - _PulseSpeed: 1.7')
            $floatLines.Add("    - _Smoothness: $(Format-InvariantNumber $smoothness)")
            $colorLines.Add("    - _Color: $(Format-Color @(Get-ConfigurationValue $Material 'tint') @(0.78, 0.32, 0.12, 1))")
            $colorLines.Add("    - _EmissionColor: $(Format-Color @(Get-ConfigurationValue $Material 'emissionColor') @(1.6, 0.23, 0.015, 1))")
            $colorLines.Add('    - _ScrollA: {r: 0.015, g: 0.008, b: 0, a: 0}')
            $colorLines.Add('    - _ScrollB: {r: -0.009, g: 0.012, b: 0, a: 0}')
        }
        'Electric' {
            $shaderGuid = '5e8833e62f8344d098d2a3b710a9f05a'
            $shaderName = 'Ruin/ElectricPanel'
            $textureEnvironments.Add((New-TextureEnvironment '_EmissionMap' $emissionGuid))
            $textureEnvironments.Add((New-TextureEnvironment '_MainTex' $mainGuid))
            $phase = [double](Get-ConfigurationValue $Material 'phase' 0)
            $floatLines.Add('    - _EmissionStrength: 3.2')
            $floatLines.Add('    - _Metallic: 0.05')
            $floatLines.Add("    - _Phase: $(Format-InvariantNumber $phase)")
            $floatLines.Add('    - _PulseSpeed: 5')
            $floatLines.Add("    - _Smoothness: $(Format-InvariantNumber $smoothness)")
            $colorLines.Add('    - _ChargeColor: {r: 1, g: 0.38, b: 0.03, a: 1}')
            $colorLines.Add('    - _Color: {r: 1, g: 1, b: 1, a: 1}')
            $colorLines.Add('    - _GroundedColor: {r: 0.08, g: 0.45, b: 0.3, a: 1}')
            $colorLines.Add('    - _LiveColor: {r: 0.05, g: 1.2, b: 1.8, a: 1}')
            $colorLines.Add('    - _SafeColor: {r: 0.02, g: 0.12, b: 0.15, a: 1}')
        }
        default {
            throw "Unsupported material kind '$($Material.kind)' for '$($Material.id)'."
        }
    }

    $textureBlock = $textureEnvironments.ToArray() -join "`n"
    $floatBlock = $floatLines.ToArray() -join "`n"
    $colorBlock = $colorLines.ToArray() -join "`n"
    $yaml = @"
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!21 &2100000
Material:
  serializedVersion: 8
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: $name
  m_Shader: {fileID: 4800000, guid: $shaderGuid, type: 3}
  m_Parent: {fileID: 0}
  m_ModifiedSerializedProperties: 0
  m_ValidKeywords: []
  m_InvalidKeywords: []
  m_LightmapFlags: 4
  m_EnableInstancingVariants: 1
  m_DoubleSidedGI: 0
  m_CustomRenderQueue: -1
  stringTagMap: {}
  disabledShaderPasses: []
  m_LockedProperties:
  m_SavedProperties:
    serializedVersion: 3
    m_TexEnvs:
$textureBlock
    m_Ints: []
    m_Floats:
$floatBlock
    m_Colors:
$colorBlock
  m_BuildTextureStacks: []
  m_AllowLocking: 1
"@.TrimStart()
    return [ordered]@{
        yaml = $yaml
        shaderName = $shaderName
        mainGuid = $mainGuid
        emissionGuid = $emissionGuid
        detailGuid = $detailGuid
    }
}

function Assert-OrWriteBytes {
    param(
        [string]$Path,
        [byte[]]$Bytes,
        [switch]$CheckOnly
    )
    if ($CheckOnly) {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            throw "Missing generated asset: $Path"
        }
        $currentHash = Get-Sha256File $Path
        $expectedHash = Get-Sha256Bytes $Bytes
        if ($currentHash -ne $expectedHash) {
            throw "Stale generated asset: $Path (expected $expectedHash, found $currentHash)"
        }
        return
    }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path)) | Out-Null
    [System.IO.File]::WriteAllBytes($Path, $Bytes)
}

function Assert-OrWriteText {
    param(
        [string]$Path,
        [string]$Text,
        [switch]$CheckOnly
    )
    $normalized = $Text.Replace("`r`n", "`n")
    if (-not $normalized.EndsWith("`n")) { $normalized += "`n" }
    if ($CheckOnly) {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            throw "Missing generated file: $Path"
        }
        $current = [System.IO.File]::ReadAllText($Path).Replace("`r`n", "`n")
        if ($current -ne $normalized) {
            throw "Stale generated file: $Path"
        }
        return
    }
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path)) | Out-Null
    [System.IO.File]::WriteAllText($Path, $normalized, $Utf8NoBom)
}

$configuration = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json
if ($configuration.schemaVersion -ne 1) {
    throw "Unsupported Dungeon V2 texture source schema '$($configuration.schemaVersion)'."
}

$sourceById = @{}
$manifestSources = New-Object System.Collections.Generic.List[object]
foreach ($source in $configuration.sources) {
    $sourcePath = Join-Path $UnityProjectRoot $source.path
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Missing Dungeon V2 source master: $sourcePath"
    }
    $actualHash = Get-Sha256File $sourcePath
    if ($actualHash -ne $source.sha256.ToUpperInvariant()) {
        throw "Source master hash mismatch for '$($source.id)': expected $($source.sha256), found $actualHash."
    }
    $loaded = [System.Drawing.Image]::FromFile($sourcePath)
    try {
        if ($loaded.Width -ne $source.width -or $loaded.Height -ne $source.height) {
            throw "Source master dimensions mismatch for '$($source.id)': expected $($source.width)x$($source.height), found $($loaded.Width)x$($loaded.Height)."
        }
        $bitmap = Convert-ToRgbaBitmap $loaded
    }
    finally {
        $loaded.Dispose()
    }
    $sourceById[$source.id] = $bitmap
    $manifestSources.Add([ordered]@{
        id = $source.id
        path = $source.path
        width = [int]$source.width
        height = [int]$source.height
        sha256 = $actualHash
        provenance = $source.provenance
    })
}

$manifestMaps = New-Object System.Collections.Generic.List[object]
$manifestMapById = @{}
try {
    foreach ($map in $configuration.maps) {
        if (-not $sourceById.ContainsKey($map.sourceId)) {
            throw "Map '$($map.id)' references unknown source '$($map.sourceId)'."
        }
        $rect = @($map.rect)
        if ($rect.Count -ne 4) { throw "Map '$($map.id)' must have a four-value source rect." }
        $sourceBitmap = $sourceById[$map.sourceId]
        $x = [int]$rect[0]
        $y = [int]$rect[1]
        $width = [int]$rect[2]
        $height = [int]$rect[3]
        if ($x -lt 0 -or $y -lt 0 -or $width -le 0 -or $height -le 0 -or
            $x + $width -gt $sourceBitmap.Width -or $y + $height -gt $sourceBitmap.Height) {
            throw "Map '$($map.id)' source rect is outside '$($map.sourceId)'."
        }

        $crop = Copy-Crop $sourceBitmap $x $y $width $height
        try {
            if ($map.alphaMode -eq 'GrayBackgroundToAlpha') {
                Remove-GrayBackground $crop
            }
            $resized = Resize-Bitmap $crop ([int]$configuration.runtimeSize)
        }
        finally {
            $crop.Dispose()
        }
        try {
            if ($map.alphaMode -eq 'CyanEmissionMask' -or $map.alphaMode -eq 'HeatEmissionMask') {
                Convert-ToEmissionMask $resized $map.alphaMode
            }
            $pngBytes = Convert-BitmapToPngBytes $resized
        }
        finally {
            $resized.Dispose()
        }

        $outputPath = Join-Path $UnityProjectRoot $map.output
        Assert-OrWriteBytes $outputPath $pngBytes -CheckOnly:$Check
        $guid = Get-DeterministicGuid $map.output
        $meta = New-TextureMeta `
            -Guid $guid `
            -Srgb ($map.colorSpace -eq 'sRGB') `
            -Clamp ($map.wrapMode -eq 'Clamp') `
            -AlphaTransparency ($map.alphaMode -eq 'GrayBackgroundToAlpha')
        Assert-OrWriteText "$outputPath.meta" $meta -CheckOnly:$Check

        $manifestMap = [ordered]@{
            id = $map.id
            role = $map.role
            sourceId = $map.sourceId
            sourceRect = @($x, $y, $width, $height)
            output = $map.output
            guid = $guid
            sha256 = Get-Sha256Bytes $pngBytes
            width = [int]$configuration.runtimeSize
            height = [int]$configuration.runtimeSize
            colorSpace = $map.colorSpace
            wrapMode = $map.wrapMode
            alphaMode = $map.alphaMode
        }
        $manifestMaps.Add($manifestMap)
        $manifestMapById[$map.id] = $manifestMap
    }
}
finally {
    foreach ($bitmap in $sourceById.Values) { $bitmap.Dispose() }
}

$manifestMaterials = New-Object System.Collections.Generic.List[object]
foreach ($material in $configuration.materials) {
    $materialData = New-MaterialYaml $material $manifestMapById
    $materialPath = Join-Path $UnityProjectRoot $material.output
    Assert-OrWriteText $materialPath $materialData.yaml -CheckOnly:$Check
    $materialGuid = Get-DeterministicGuid $material.output
    Assert-OrWriteText "$materialPath.meta" (New-NativeAssetMeta $materialGuid) -CheckOnly:$Check
    $materialBytes = $Utf8NoBom.GetBytes(($materialData.yaml.Replace("`r`n", "`n").TrimEnd() + "`n"))
    $manifestMaterials.Add([ordered]@{
        id = $material.id
        role = $material.role
        output = $material.output
        guid = $materialGuid
        sha256 = Get-Sha256Bytes $materialBytes
        shader = $materialData.shaderName
        kind = $material.kind
        mainMapId = $material.mainMapId
        emissionMapId = if ([string]::IsNullOrWhiteSpace([string](Get-ConfigurationValue $material 'emissionMapId' ''))) { $null } else { Get-ConfigurationValue $material 'emissionMapId' }
        detailMapId = if ([string]::IsNullOrWhiteSpace([string](Get-ConfigurationValue $material 'detailMapId' ''))) { $null } else { Get-ConfigurationValue $material 'detailMapId' }
    })
}

$materialCatalogYaml = New-MaterialCatalogYaml $manifestMaterials.ToArray()
Assert-OrWriteText $MaterialCatalogPath $materialCatalogYaml -CheckOnly:$Check
$materialCatalogGuid = Get-DeterministicGuid $MaterialCatalogAssetPath
Assert-OrWriteText "$MaterialCatalogPath.meta" `
    (New-ScriptableObjectMeta $materialCatalogGuid) `
    -CheckOnly:$Check
$materialCatalogBytes = $Utf8NoBom.GetBytes(
    ($materialCatalogYaml.Replace("`r`n", "`n").TrimEnd() + "`n"))
$materialCatalogRecord = [ordered]@{
    output = $MaterialCatalogAssetPath
    guid = $materialCatalogGuid
    sha256 = Get-Sha256Bytes $materialCatalogBytes
    entryCount = $manifestMaterials.Count
}

$manifest = [ordered]@{
    schemaVersion = 1
    profileId = $configuration.profileId
    generator = 'scripts/build-dungeon-v2-textures.ps1'
    generatorVersion = '1.0.0'
    runtimeSize = [int]$configuration.runtimeSize
    shippingStatus = $configuration.shippingStatus
    sources = $manifestSources.ToArray()
    maps = $manifestMaps.ToArray()
    materials = $manifestMaterials.ToArray()
    materialCatalog = $materialCatalogRecord
}
$manifestText = $manifest | ConvertTo-Json -Depth 12
Assert-OrWriteText $ManifestPath $manifestText -CheckOnly:$Check
Assert-OrWriteText "$ManifestPath.meta" `
    (New-TextAssetMeta (Get-DeterministicGuid $ManifestAssetPath)) `
    -CheckOnly:$Check

$verb = if ($Check) { 'Verified' } else { 'Built' }
Write-Host "$verb $($manifestMaps.Count) deterministic Dungeon V2 runtime textures, $($manifestMaterials.Count) shared materials, and the semantic material catalog from $($manifestSources.Count) source masters."
