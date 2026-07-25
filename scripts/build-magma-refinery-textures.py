"""Normalize image-generation masters and deterministically derive PBR maps."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PROJECT = Path(r"C:\Users\K\Documents\New Three.js Practice")
GENERATED = Path(r"C:\Users\K\.codex\generated_images\019f8ce1-c9ed-7053-b639-a0dd2043365d")
ROOT = PROJECT / "assets" / "textures" / "magma-refinery"
MASTER_ROOT = ROOT / "masters"
CELL_ROOT = ROOT / "cells"
CONCEPT_ROOT = PROJECT / "assets" / "concepts" / "magma-refinery"

SOURCES = {
    "walls": "exec-9c01cc8c-7f8a-40ca-a6fa-7f4057e2c6ac.png",
    "floors": "exec-0a16ef0c-d6ab-4880-a222-4611490e6c5a.png",
    "machinery": "exec-6871dd51-672d-4d30-93d5-dd7d780c29d1.png",
    "decals": "exec-78691e1b-b817-4716-bc78-36982de15be7.png",
    "seamless": "exec-ddca60d9-eafb-42b2-8be4-da6243585ca1.png",
}
CONCEPT_SOURCE = "exec-eb319cf7-1a07-4bcd-aaed-f76ec1abf289.png"
CELL_NAMES = {
    "seamless": [
        "basalt", "magma", "blackened-metal",
        "ceramic", "rails", "chains",
        "oxidized-bronze", "service-grate", "ash-mineral-stone",
    ],
}


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def derive_maps(albedo: Image.Image):
    rgb = np.asarray(albedo.convert("RGB"), dtype=np.float32) / 255.0
    luminance = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    height = Image.fromarray(np.uint8(np.clip(luminance ** 0.82 * 255, 0, 255)), "L")
    height = height.filter(ImageFilter.GaussianBlur(radius=1.15))
    h = np.asarray(height, dtype=np.float32) / 255.0
    dy, dx = np.gradient(h)
    strength = 3.2
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(h)
    norm = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack(((nx / norm + 1) * 0.5, (ny / norm + 1) * 0.5, nz / norm), axis=-1)
    normal_image = Image.fromarray(np.uint8(np.clip(normal * 255, 0, 255)), "RGB")
    roughness = np.clip(0.94 - luminance * 0.32 + np.abs(dx) * 0.65 + np.abs(dy) * 0.65, 0.28, 0.98)
    roughness_image = Image.fromarray(np.uint8(roughness * 255), "L")
    hot = np.maximum(rgb[..., 0] - np.maximum(rgb[..., 1], rgb[..., 2]) * 1.15, 0)
    cyan = np.maximum(np.minimum(rgb[..., 1], rgb[..., 2]) - rgb[..., 0] * 0.75, 0)
    emission = np.zeros_like(rgb)
    emission[..., 0] = hot * 1.8
    emission[..., 1] = hot * 0.32 + cyan * 0.35
    emission[..., 2] = cyan * 1.7
    emission_image = Image.fromarray(np.uint8(np.clip(emission * 255, 0, 255)), "RGB")
    return {
        "height": height,
        "normal": normal_image,
        "roughness": roughness_image,
        "emission": emission_image,
    }


def build():
    for folder in (MASTER_ROOT, CELL_ROOT, CONCEPT_ROOT):
        folder.mkdir(parents=True, exist_ok=True)
    provenance = {
        "schema": "ruindivex-texture-provenance/v1",
        "generator": "OpenAI image_gen built-in tool",
        "masterDimensions": [3072, 3072],
        "grid": {"columns": 3, "rows": 3, "cellSize": [1024, 1024], "gutters": 0},
        "macroScaleMeters": 2.8,
        "unityAssetsReused": False,
        "masters": [],
    }
    for family, filename in SOURCES.items():
        source = GENERATED / filename
        image = Image.open(source).convert("RGB").resize((3072, 3072), Image.Resampling.LANCZOS)
        master_path = MASTER_ROOT / f"{family}-master.png"
        image.save(master_path, optimize=True)
        cell_folder = CELL_ROOT / family
        cell_folder.mkdir(parents=True, exist_ok=True)
        cells = []
        for row in range(3):
            for column in range(3):
                index = row * 3 + column
                label = CELL_NAMES.get(family, [f"cell-{value + 1:02}" for value in range(9)])[index]
                albedo = image.crop((column * 1024, row * 1024, (column + 1) * 1024, (row + 1) * 1024))
                albedo_path = cell_folder / f"{label}-albedo.png"
                albedo.save(albedo_path, optimize=True)
                derived = derive_maps(albedo)
                maps = {"albedo": str(albedo_path.relative_to(PROJECT)).replace("\\", "/")}
                for map_name, map_image in derived.items():
                    map_path = cell_folder / f"{label}-{map_name}.png"
                    map_image.save(map_path, optimize=True)
                    maps[map_name] = str(map_path.relative_to(PROJECT)).replace("\\", "/")
                cells.append({"index": index, "row": row, "column": column, "label": label, "maps": maps})
        provenance["masters"].append({
            "family": family,
            "sourceRun": filename,
            "sourceHash": file_hash(source),
            "master": str(master_path.relative_to(PROJECT)).replace("\\", "/"),
            "masterHash": file_hash(master_path),
            "approval": "accepted-for-magma-refinery-v1",
            "cells": cells,
        })
    concept_source = GENERATED / CONCEPT_SOURCE
    concept_path = CONCEPT_ROOT / "magma-refinery-concept-board.png"
    Image.open(concept_source).convert("RGB").save(concept_path, optimize=True)
    provenance["conceptBoard"] = {
        "sourceRun": CONCEPT_SOURCE,
        "sourceHash": file_hash(concept_source),
        "asset": str(concept_path.relative_to(PROJECT)).replace("\\", "/"),
        "assetHash": file_hash(concept_path),
        "approval": "visual-direction-reference",
    }
    provenance["promptRecord"] = {
        "walls": "Exact 3x3 no-gutter basalt refinery wall atlas; flat PBR scan; one 2.8 m bay per cell.",
        "floors": "Exact 3x3 no-gutter refinery floor/deck atlas; orthographic top-down PBR scan.",
        "machinery": "Exact 3x3 no-gutter furnace machinery atlas; flat PBR scan.",
        "decals": "Exact 3x3 no-gutter excavation decal atlas; no readable language.",
        "seamless": "Exact 3x3 no-gutter repeat atlas for basalt, magma, metal, ceramic, rails, chains and variants.",
        "concept": "Ancient refinery visual-language board with shrine, wings, connectors and Warden.",
    }
    manifest_path = ROOT / "texture-provenance.json"
    manifest_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    return {"masters": len(SOURCES), "cells": len(SOURCES) * 9, "mapsPerCell": 5, "manifest": str(manifest_path)}


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
