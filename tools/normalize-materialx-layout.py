#!/usr/bin/env python3
"""Normalize MaterialX sample layout.

Transforms each material directory under `submodules/material-samples/materials` to:
- one `.mtlx` file named after the material directory
- texture assets under `textures/`
- `.mtlx` filename references rewritten to `textures/<basename>`
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Sequence

IGNORED_BASENAMES = {"info.txt"}
IGNORED_PREFIXES = ("materialxview.", "threejs.")
TEXTURE_EXTENSIONS = {
    ".avif",
    ".bmp",
    ".exr",
    ".gif",
    ".hdr",
    ".jpeg",
    ".jpg",
    ".png",
    ".svg",
    ".tga",
    ".tif",
    ".tiff",
    ".webp",
}


@dataclass
class MaterialChange:
    directory: Path
    source_mtlx: Path
    target_mtlx: Path
    value_updates: Dict[int, str] = field(default_factory=dict)
    clear_fileprefix_indices: List[int] = field(default_factory=list)
    moves: List[tuple[Path, Path]] = field(default_factory=list)
    deletions: List[Path] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def should_ignore(path: Path) -> bool:
    if path.name in IGNORED_BASENAMES:
        return True
    return any(path.name.startswith(prefix) for prefix in IGNORED_PREFIXES)


def has_texture_extension(value: str) -> bool:
    return Path(value).suffix.lower() in TEXTURE_EXTENSIONS


def is_remote_or_absolute(value: str) -> bool:
    lowered = value.lower()
    return lowered.startswith(("http://", "https://", "data:")) or os.path.isabs(value)


def split_query_and_fragment(value: str) -> tuple[str, str]:
    cut = len(value)
    for marker in ("?", "#"):
        idx = value.find(marker)
        if idx != -1:
            cut = min(cut, idx)
    return value[:cut], value[cut:]


def collect_material_directories(materials_root: Path) -> List[Path]:
    dirs: set[Path] = set()
    for mtlx_path in materials_root.rglob("*.mtlx"):
        if mtlx_path.is_file():
            dirs.add(mtlx_path.parent)
    return sorted(dirs)


def inherited_fileprefix(element: ET.Element, parent_map: Dict[ET.Element, ET.Element]) -> str:
    prefixes: List[str] = []
    node = element
    while node is not None:
        value = node.attrib.get("fileprefix")
        if value:
            prefixes.append(value)
        node = parent_map.get(node)
    if not prefixes:
        return ""
    return os.path.join(*reversed(prefixes))


def resolve_texture_source(material_dir: Path, prefix: str, raw_value: str) -> Path:
    clean_value, _ = split_query_and_fragment(raw_value)
    if prefix:
        preferred = (material_dir / prefix / clean_value).resolve()
        if preferred.exists():
            return preferred
    return (material_dir / clean_value).resolve()


def plan_material_change(material_dir: Path) -> MaterialChange | None:
    mtlx_files = sorted(p for p in material_dir.glob("*.mtlx") if p.is_file())
    if not mtlx_files:
        return None
    target_mtlx = material_dir / f"{material_dir.name}.mtlx"
    source_mtlx: Path
    extra_mtlx: List[Path] = []
    if len(mtlx_files) == 1:
        source_mtlx = mtlx_files[0]
    else:
        material_mtlx = material_dir / "material.mtlx"
        if material_mtlx in mtlx_files:
            source_mtlx = material_mtlx
            extra_mtlx = [candidate for candidate in mtlx_files if candidate != material_mtlx]
        elif target_mtlx in mtlx_files:
            source_mtlx = target_mtlx
            extra_mtlx = [candidate for candidate in mtlx_files if candidate != target_mtlx]
        else:
            raise RuntimeError(
                f"Expected one .mtlx file or a material.mtlx/canonical file in {material_dir}, found {len(mtlx_files)}"
            )
    change = MaterialChange(directory=material_dir, source_mtlx=source_mtlx, target_mtlx=target_mtlx)
    for candidate in extra_mtlx:
        if candidate.read_bytes() == source_mtlx.read_bytes():
            change.deletions.append(candidate)
        else:
            raise RuntimeError(f"Ambiguous multiple .mtlx files with differing content in {material_dir}: {candidate}")

    tree = ET.parse(source_mtlx)
    root = tree.getroot()
    parent_map = {child: parent for parent in root.iter() for child in parent}

    destination_to_source: Dict[Path, Path] = {}
    files_to_move: Dict[Path, Path] = {}

    for iter_index, element in enumerate(root.iter()):
        if "fileprefix" in element.attrib:
            change.clear_fileprefix_indices.append(iter_index)

    for input_index, element in enumerate(root.iter("input")):
        if element.attrib.get("name") != "file" or element.attrib.get("type") != "filename":
            continue
        raw_value = element.attrib.get("value")
        if not raw_value:
            continue
        clean_value, suffix = split_query_and_fragment(raw_value.strip())
        if not clean_value or is_remote_or_absolute(clean_value) or not has_texture_extension(clean_value):
            continue

        prefix = inherited_fileprefix(element, parent_map)
        source_texture = resolve_texture_source(material_dir, prefix, clean_value)
        if not source_texture.exists():
            change.warnings.append(f"Missing referenced texture: {source_texture}")
            continue
        textures_dir = material_dir / "textures"
        target_texture = (textures_dir / source_texture.name).resolve()

        previous_source = destination_to_source.get(target_texture)
        if previous_source and previous_source != source_texture:
            raise RuntimeError(
                f"Texture name collision in {material_dir}: {previous_source} and {source_texture} "
                f"would both map to {target_texture}"
            )
        destination_to_source[target_texture] = source_texture

        if source_texture != target_texture:
            files_to_move[source_texture] = target_texture

        change.value_updates[input_index] = f"textures/{source_texture.name}{suffix}"

    change.moves = sorted(files_to_move.items(), key=lambda item: (str(item[0]), str(item[1])))
    if (
        not change.value_updates
        and not change.moves
        and not change.deletions
        and source_mtlx == target_mtlx
        and not change.clear_fileprefix_indices
    ):
        return None
    return change


def apply_change(change: MaterialChange) -> None:
    tree = ET.parse(change.source_mtlx)
    root = tree.getroot()
    input_index = 0

    for iter_index, element in enumerate(root.iter()):
        if iter_index in change.clear_fileprefix_indices and "fileprefix" in element.attrib:
            del element.attrib["fileprefix"]
        if element.tag == "input":
            if input_index in change.value_updates:
                element.attrib["value"] = change.value_updates[input_index]
            input_index += 1

    if change.value_updates or change.clear_fileprefix_indices:
        tree.write(change.source_mtlx, encoding="utf-8", xml_declaration=True)

    if change.moves:
        (change.directory / "textures").mkdir(exist_ok=True)
    for source, target in change.moves:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(target))

    for redundant_path in change.deletions:
        redundant_path.unlink()

    if change.source_mtlx != change.target_mtlx:
        if change.target_mtlx.exists():
            raise RuntimeError(f"Refusing to overwrite existing file: {change.target_mtlx}")
        change.source_mtlx.rename(change.target_mtlx)


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description="Normalize MaterialX material directory layout.")
    parser.add_argument(
        "--materials-root",
        type=Path,
        default=Path("submodules/material-samples/materials"),
        help="Path to material-samples materials root",
    )
    parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry-run.")
    args = parser.parse_args(argv)

    materials_root = args.materials_root.resolve()
    if not materials_root.exists():
        print(f"materials root not found: {materials_root}", file=sys.stderr)
        return 1

    material_dirs = collect_material_directories(materials_root)
    changes: List[MaterialChange] = []
    warnings: List[str] = []
    for material_dir in material_dirs:
        if should_ignore(material_dir):
            continue
        change = plan_material_change(material_dir)
        if not change:
            continue
        changes.append(change)
        warnings.extend(change.warnings)

    print(f"Material directories scanned: {len(material_dirs)}")
    print(f"Directories requiring changes: {len(changes)}")
    print(f"Referenced-texture warnings: {len(warnings)}")
    for warning in warnings:
        print(f"  WARN: {warning}")

    rename_count = sum(1 for c in changes if c.source_mtlx != c.target_mtlx)
    move_count = sum(len(c.moves) for c in changes)
    rewrite_count = sum(1 for c in changes if c.value_updates or c.clear_fileprefix_indices)
    deletion_count = sum(len(c.deletions) for c in changes)
    print(f"Planned mtlx renames: {rename_count}")
    print(f"Planned texture moves: {move_count}")
    print(f"Planned xml rewrites: {rewrite_count}")
    print(f"Planned redundant .mtlx deletions: {deletion_count}")

    if not args.apply:
        print("Dry run complete. Re-run with --apply to execute.")
        return 0

    for change in changes:
        apply_change(change)
    print("Apply complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
