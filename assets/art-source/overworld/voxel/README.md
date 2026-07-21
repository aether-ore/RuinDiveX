# Overworld voxel texture provenance

The PNG files in this directory are the untouched native-size outputs from the
built-in image-generation workflow. Their dimensions vary because the image
generator returns native aspect-ratio outputs; each axis is at least 1024 px.
They are never overwritten by the texture build script.

`source-1024/` contains the canonical square source art used by the project.
Each file is a deterministic 1024 × 1024 centre-square crop and high-quality
resample of the corresponding untouched generator artifact. These canonical
files are source derivatives, not claims about the generator's native output.

The shipping 256 × 256 textures in
`assets/textures/overworld/voxel/` are derived only from the canonical sources.
The build step applies the tile-edge treatment and records SHA-256 hashes for
all three stages in `voxel-texture-validation.json`. Run
`npm run check:overworld-voxel-textures` to verify that the raw artifacts are
unchanged and that every canonical/runtime image is the deterministic expected
derivative.

All images were generated without reference images using the requested prompt
template: seamless square stylized hand-painted voxel game texture, the
specific surface and face description, bright retro anime expedition
aesthetic, evenly lit flat albedo, readable weathering, no directional shadow,
no object silhouette, no border, no text, no watermark, and tileable edges.
