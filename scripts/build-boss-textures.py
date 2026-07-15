"""Crop generated boss texture masters into validated runtime semantic maps."""

from pathlib import Path
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
MASTER_ROOT = ROOT / "docs" / "concepts" / "reaverbot-bosses"
OUTPUT_ROOT = ROOT / "assets" / "textures" / "reaverbots" / "bosses"
PROFILES = (
    "pursuitRegent",
    "rubyOpticOracle",
    "ballisticsVizier",
    "revolvingFusillade",
    "highAngleBastion",
    "clusterSalvoReliquary",
    "feedDrumArsenal",
    "overloadReliquary",
)
CELL_SIZE = 512
RUNTIME_SIZE = (256, 256)
STANDARD_CELLS = {
    "primary_armor.png": (0, 0),
    "secondary_circuit_armor.png": (1, 0),
    "weapon_housing.png": (2, 0),
    "ornate_trim.png": (0, 1),
    "emissive_mask.png": (1, 1),
}


def crop_cell(master: Image.Image, column: int, row: int) -> Image.Image:
    left = column * CELL_SIZE
    top = row * CELL_SIZE
    return master.crop((left, top, left + CELL_SIZE, top + CELL_SIZE))


def clean_mask(image: Image.Image) -> Image.Image:
    luminance = ImageOps.autocontrast(image.convert("L"), cutoff=(0.15, 0.15))
    # Generated near-black compression noise must not become faint emissive haze.
    luminance = luminance.point(lambda value: 0 if value < 10 else value)
    alpha = Image.new("L", RUNTIME_SIZE, 255)
    return Image.merge("RGBA", (luminance, luminance, luminance, alpha))


def write_map(image: Image.Image, destination: Path, *, mask: bool) -> None:
    resized = image.resize(RUNTIME_SIZE, Image.Resampling.LANCZOS)
    output = clean_mask(resized) if mask else resized.convert("RGBA")
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, format="PNG", optimize=True)
    with Image.open(destination) as check:
        if check.size != RUNTIME_SIZE or check.mode != "RGBA":
            raise RuntimeError(f"Invalid runtime texture {destination}: {check.size} {check.mode}")


def main() -> None:
    written = []
    for profile_id in PROFILES:
        master_path = MASTER_ROOT / f"{profile_id}-texture-master.png"
        with Image.open(master_path) as source:
            master = source.convert("RGBA")
        if master.size != (1536, 1024):
            raise RuntimeError(f"Unexpected master dimensions for {profile_id}: {master.size}")
        output_dir = OUTPUT_ROOT / profile_id
        for file_name, (column, row) in STANDARD_CELLS.items():
            destination = output_dir / file_name
            write_map(
                crop_cell(master, column, row),
                destination,
                mask=file_name.endswith("_mask.png"),
            )
            written.append(destination)
        if profile_id == "rubyOpticOracle":
            destination = output_dir / "ruby_lens.png"
            write_map(crop_cell(master, 2, 1), destination, mask=False)
            written.append(destination)
        if profile_id == "overloadReliquary":
            destination = output_dir / "energy_field_mask.png"
            write_map(crop_cell(master, 2, 1), destination, mask=True)
            written.append(destination)
    print(f"Built and validated {len(written)} boss runtime textures.")


if __name__ == "__main__":
    main()
