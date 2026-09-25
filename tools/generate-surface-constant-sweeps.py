#!/usr/bin/env python3
"""Generate constant per-parameter surface sweeps for MaterialX samples."""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


REPO_ROOT = Path(__file__).resolve().parents[1]
SURFACE_ROOT = REPO_ROOT / "submodules" / "material-samples" / "materials" / "surfaces"
SURFACE_FAMILIES = ("standard_surface", "gltf_pbr", "open_pbr_surface")
VALUE_TOKEN_TO_FLOAT = {
    "0_00": 0.00,
    "0_25": 0.25,
    "0_50": 0.50,
    "0_75": 0.75,
    "1_00": 1.00,
}
TARGET_TOKENS = ("0_25", "0_50", "0_75", "1_00")


@dataclass(frozen=True)
class SweepTemplate:
    family: str
    parameter: str
    inputs: Dict[str, str]

    @property
    def base_stem(self) -> str:
        return f"{self.family}_sweep_{self.parameter}_0_00"


ROUGHNESS_BASE_COLOR = "0.92, 0.52, 0.22"
METALLIC_BASE_COLOR = "0.98, 0.78, 0.22"
COAT_BASE_COLOR = "0.20, 0.78, 0.82"
SHEEN_BASE_COLOR = "0.22, 0.08, 0.30"
SHEEN_TINT_COLOR = "0.70, 0.35, 0.90"
TRANSMISSION_BASE_COLOR = "0.06, 0.14, 0.32"
OPACITY_BASE_COLOR = "0.95, 0.90, 0.18"
ALPHA_BASE_COLOR = "0.90, 0.12, 0.70"
IRIDESCENCE_BASE_COLOR = "0.02, 0.02, 0.02"
DISPERSION_BASE_COLOR = "0.30, 0.03, 0.06"

BASE_TEMPLATES: Tuple[SweepTemplate, ...] = (
    SweepTemplate(
        "standard_surface",
        "specular_roughness",
        {
            "base_color": ROUGHNESS_BASE_COLOR,
            "base": "0.85",
            "specular": "1.0",
            "specular_color": "1.0, 1.0, 1.0",
            "specular_roughness": "0.00",
            "metalness": "0.0",
            "coat": "0.0",
            "sheen": "0.0",
            "transmission": "0.0",
            "opacity": "1.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "metalness",
        {
            "base_color": METALLIC_BASE_COLOR,
            "base": "1.0",
            "specular": "1.0",
            "specular_roughness": "0.15",
            "metalness": "0.00",
            "coat": "0.0",
            "sheen": "0.0",
            "transmission": "0.0",
            "opacity": "1.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "coat",
        {
            "base_color": COAT_BASE_COLOR,
            "base": "0.8",
            "specular": "0.8",
            "specular_roughness": "0.2",
            "metalness": "0.0",
            "coat": "0.00",
            "coat_roughness": "0.12",
            "sheen": "0.0",
            "transmission": "0.0",
            "opacity": "1.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "coat_roughness",
        {
            "base_color": COAT_BASE_COLOR,
            "base": "0.8",
            "specular": "0.8",
            "specular_roughness": "0.2",
            "metalness": "0.0",
            "coat": "1.0",
            "coat_roughness": "0.00",
            "sheen": "0.0",
            "transmission": "0.0",
            "opacity": "1.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "sheen",
        {
            "base_color": SHEEN_BASE_COLOR,
            "base": "0.8",
            "specular": "0.8",
            "specular_roughness": "0.2",
            "metalness": "0.0",
            "coat": "0.0",
            "sheen": "0.00",
            "sheen_color": SHEEN_TINT_COLOR,
            "sheen_roughness": "0.3",
            "transmission": "0.0",
            "opacity": "1.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "sheen_roughness",
        {
            "base_color": SHEEN_BASE_COLOR,
            "base": "0.8",
            "specular": "0.8",
            "specular_roughness": "0.2",
            "metalness": "0.0",
            "coat": "0.0",
            "sheen": "1.0",
            "sheen_color": SHEEN_TINT_COLOR,
            "sheen_roughness": "0.00",
            "transmission": "0.0",
            "opacity": "1.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "transmission",
        {
            "base_color": TRANSMISSION_BASE_COLOR,
            "base": "0.7",
            "specular": "1.0",
            "specular_roughness": "0.08",
            "metalness": "0.0",
            "coat": "0.0",
            "sheen": "0.0",
            "transmission": "0.00",
            "transmission_color": "0.95, 0.98, 1.0",
            "transmission_depth": "0.7",
            "opacity": "1.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "opacity",
        {
            "base_color": OPACITY_BASE_COLOR,
            "base": "0.85",
            "specular": "0.9",
            "specular_roughness": "0.2",
            "metalness": "0.0",
            "coat": "0.0",
            "sheen": "0.0",
            "transmission": "0.0",
            "opacity": "0.00",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "standard_surface",
        "thin_film_thickness",
        {
            "base_color": IRIDESCENCE_BASE_COLOR,
            "base": "0.85",
            "specular": "1.0",
            "specular_roughness": "0.12",
            "metalness": "0.0",
            "coat": "0.0",
            "sheen": "0.0",
            "transmission": "0.0",
            "opacity": "1.0",
            "thin_film_thickness": "0.00",
            "thin_film_ior": "1.5",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "roughness",
        {
            "base_color": ROUGHNESS_BASE_COLOR,
            "metallic": "0.0",
            "roughness": "0.00",
            "clearcoat": "0.0",
            "clearcoat_roughness": "0.2",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "0.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "metallic",
        {
            "base_color": METALLIC_BASE_COLOR,
            "metallic": "0.00",
            "roughness": "0.18",
            "clearcoat": "0.0",
            "clearcoat_roughness": "0.2",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "0.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "clearcoat",
        {
            "base_color": COAT_BASE_COLOR,
            "metallic": "0.1",
            "roughness": "0.25",
            "clearcoat": "0.00",
            "clearcoat_roughness": "0.1",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "0.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "clearcoat_roughness",
        {
            "base_color": COAT_BASE_COLOR,
            "metallic": "0.1",
            "roughness": "0.25",
            "clearcoat": "1.0",
            "clearcoat_roughness": "0.00",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "0.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "sheen_roughness",
        {
            "base_color": SHEEN_BASE_COLOR,
            "metallic": "0.0",
            "roughness": "0.28",
            "clearcoat": "0.0",
            "clearcoat_roughness": "0.2",
            "sheen_color": SHEEN_TINT_COLOR,
            "sheen_roughness": "0.00",
            "transmission": "0.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "transmission",
        {
            "base_color": TRANSMISSION_BASE_COLOR,
            "metallic": "0.0",
            "roughness": "0.08",
            "clearcoat": "0.0",
            "clearcoat_roughness": "0.2",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "0.00",
            "thickness": "0.7",
            "attenuation_distance": "1.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "alpha",
        {
            "base_color": ALPHA_BASE_COLOR,
            "metallic": "0.0",
            "roughness": "0.2",
            "clearcoat": "0.0",
            "clearcoat_roughness": "0.2",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "0.0",
            "alpha": "0.00",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "dispersion",
        {
            "base_color": DISPERSION_BASE_COLOR,
            "metallic": "0.0",
            "roughness": "0.03",
            "clearcoat": "0.0",
            "clearcoat_roughness": "0.2",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "1.0",
            "thickness": "0.8",
            "attenuation_distance": "1.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "0.0",
            "iridescence_thickness": "100.0",
            "dispersion": "0.00",
        },
    ),
    SweepTemplate(
        "gltf_pbr",
        "iridescence_thickness",
        {
            "base_color": IRIDESCENCE_BASE_COLOR,
            "metallic": "0.0",
            "roughness": "0.2",
            "clearcoat": "0.0",
            "clearcoat_roughness": "0.2",
            "sheen_color": "0.0, 0.0, 0.0",
            "sheen_roughness": "0.0",
            "transmission": "0.0",
            "alpha": "1.0",
            "alpha_mode": "2",
            "iridescence": "1.0",
            "iridescence_ior": "1.3",
            "iridescence_thickness": "0.00",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "specular_roughness",
        {
            "base_weight": "1.0",
            "base_color": ROUGHNESS_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_color": "1.0, 1.0, 1.0",
            "specular_roughness": "0.00",
            "base_metalness": "0.0",
            "coat_weight": "0.0",
            "fuzz_weight": "0.0",
            "transmission_weight": "0.0",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "base_metalness",
        {
            "base_weight": "1.0",
            "base_color": METALLIC_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_color": "1.0, 1.0, 1.0",
            "specular_roughness": "0.15",
            "base_metalness": "0.00",
            "coat_weight": "0.0",
            "fuzz_weight": "0.0",
            "transmission_weight": "0.0",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "coat_weight",
        {
            "base_weight": "1.0",
            "base_color": COAT_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.18",
            "base_metalness": "0.0",
            "coat_weight": "0.00",
            "coat_roughness": "0.12",
            "fuzz_weight": "0.0",
            "transmission_weight": "0.0",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "coat_roughness",
        {
            "base_weight": "1.0",
            "base_color": COAT_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.18",
            "base_metalness": "0.0",
            "coat_weight": "1.0",
            "coat_roughness": "0.00",
            "fuzz_weight": "0.0",
            "transmission_weight": "0.0",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "fuzz_weight",
        {
            "base_weight": "1.0",
            "base_color": SHEEN_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.22",
            "base_metalness": "0.0",
            "coat_weight": "0.0",
            "fuzz_weight": "0.00",
            "fuzz_color": SHEEN_TINT_COLOR,
            "fuzz_roughness": "0.4",
            "transmission_weight": "0.0",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "fuzz_roughness",
        {
            "base_weight": "1.0",
            "base_color": SHEEN_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.22",
            "base_metalness": "0.0",
            "coat_weight": "0.0",
            "fuzz_weight": "1.0",
            "fuzz_color": SHEEN_TINT_COLOR,
            "fuzz_roughness": "0.00",
            "transmission_weight": "0.0",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "transmission_weight",
        {
            "base_weight": "1.0",
            "base_color": TRANSMISSION_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.08",
            "base_metalness": "0.0",
            "coat_weight": "0.0",
            "fuzz_weight": "0.0",
            "transmission_weight": "0.00",
            "transmission_color": "0.95, 0.98, 1.0",
            "transmission_depth": "0.8",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "geometry_opacity",
        {
            "base_weight": "1.0",
            "base_color": OPACITY_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.2",
            "base_metalness": "0.0",
            "coat_weight": "0.0",
            "fuzz_weight": "0.0",
            "transmission_weight": "0.0",
            "geometry_opacity": "0.00",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "transmission_dispersion_scale",
        {
            "base_weight": "1.0",
            "base_color": DISPERSION_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.04",
            "base_metalness": "0.0",
            "coat_weight": "0.0",
            "fuzz_weight": "0.0",
            "transmission_weight": "1.0",
            "transmission_color": "0.95, 0.98, 1.0",
            "transmission_depth": "0.8",
            "transmission_dispersion_abbe_number": "20.0",
            "transmission_dispersion_scale": "0.00",
            "geometry_opacity": "1.0",
            "thin_film_weight": "0.0",
            "thin_film_thickness": "0.0",
        },
    ),
    SweepTemplate(
        "open_pbr_surface",
        "thin_film_thickness",
        {
            "base_weight": "1.0",
            "base_color": IRIDESCENCE_BASE_COLOR,
            "specular_weight": "1.0",
            "specular_roughness": "0.12",
            "base_metalness": "0.0",
            "coat_weight": "0.0",
            "fuzz_weight": "0.0",
            "transmission_weight": "0.0",
            "geometry_opacity": "1.0",
            "thin_film_weight": "1.0",
            "thin_film_ior": "1.4",
            "thin_film_thickness": "0.00",
        },
    ),
)


def fmt_float(value: float) -> str:
    return f"{value:.2f}"


def format_value_for_input(input_name: str, input_type: str, value: float) -> str:
    literal = fmt_float(value)
    if input_name == "opacity" and input_type == "color3":
        return f"{literal}, {literal}, {literal}"
    return literal


def build_base_xml(template: SweepTemplate) -> str:
    stem = template.base_stem
    input_lines = [
        (
            f'    <input name="{input_name}" type="{infer_type(input_name)}" '
            f'value="{normalize_input_value(input_name, infer_type(input_name), input_value)}" />'
        )
        for input_name, input_value in template.inputs.items()
    ]
    shader_name = f"SR_{stem}"
    lines = [
        '<?xml version="1.0"?>',
        '<materialx version="1.39" colorspace="lin_rec709">',
        f'  <{template.family} name="{shader_name}" type="surfaceshader">',
        *input_lines,
        f"  </{template.family}>",
        f'  <surfacematerial name="{stem}" type="material">',
        f'    <input name="surfaceshader" type="surfaceshader" nodename="{shader_name}" />',
        "  </surfacematerial>",
        "</materialx>",
        "",
    ]
    return "\n".join(lines)


def infer_type(input_name: str) -> str:
    if input_name in {
        "base_color",
        "specular_color",
        "coat_color",
        "sheen_color",
        "transmission_color",
        "emission_color",
        "emissive",
        "attenuation_color",
        "fuzz_color",
    }:
        return "color3"
    if input_name == "alpha_mode":
        return "integer"
    if input_name == "opacity":
        return "color3"
    return "float"


def normalize_input_value(input_name: str, input_type: str, raw_value: str) -> str:
    if input_name == "opacity" and input_type == "color3" and "," not in raw_value:
        return f"{raw_value}, {raw_value}, {raw_value}"
    return raw_value


def bootstrap_base_templates(overwrite: bool) -> Tuple[int, int]:
    created = 0
    updated = 0
    for template in BASE_TEMPLATES:
        family_root = SURFACE_ROOT / template.family
        target_dir = family_root / template.base_stem
        target_file = target_dir / f"{template.base_stem}.mtlx"
        contents = build_base_xml(template)
        if target_file.exists():
            if not overwrite:
                continue
            if target_file.read_text(encoding="utf-8") != contents:
                target_file.parent.mkdir(parents=True, exist_ok=True)
                target_file.write_text(contents, encoding="utf-8")
                updated += 1
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        target_file.write_text(contents, encoding="utf-8")
        created += 1
    return created, updated


def discover_base_templates() -> List[Tuple[Path, Path, str, str, str]]:
    discovered: List[Tuple[Path, Path, str, str, str]] = []
    for family in SURFACE_FAMILIES:
        family_root = SURFACE_ROOT / family
        for mtlx_file in sorted(family_root.glob("*_sweep_*_0_00/*.mtlx")):
            folder = mtlx_file.parent
            stem = folder.name
            if mtlx_file.name != f"{stem}.mtlx":
                continue
            prefix = f"{family}_sweep_"
            if not stem.startswith(prefix) or not stem.endswith("_0_00"):
                continue
            parameter = stem[len(prefix) : -len("_0_00")].rstrip("_")
            if not parameter:
                continue
            discovered.append((family_root, folder, family, parameter, stem))
    return discovered


def replace_swept_input_literal(contents: str, parameter: str, value: float) -> str:
    pattern = re.compile(
        rf'(<input\s+name="{re.escape(parameter)}"\s+type="(?P<input_type>[^"]+)"\s+value=")[^"]+("\s*/>)'
    )
    matched = pattern.search(contents)
    if matched:
        input_type = matched.group("input_type")
        value_literal = format_value_for_input(parameter, input_type, value)
        return pattern.sub(rf"\g<1>{value_literal}\3", contents)
    fallback_pattern = re.compile(rf'(name="{re.escape(parameter)}"[^>]*\bvalue=")[^"]+(")')
    if fallback_pattern.search(contents):
        value_literal = fmt_float(value)
        return fallback_pattern.sub(rf"\g<1>{value_literal}\2", contents)
    return contents


def generate_variants(base_templates: Iterable[Tuple[Path, Path, str, str, str]], overwrite: bool) -> Dict[str, int]:
    stats = {
        "created": 0,
        "updated": 0,
        "skipped": 0,
    }
    for family_root, base_dir, family, parameter, base_stem in base_templates:
        base_file = base_dir / f"{base_stem}.mtlx"
        if not base_file.exists():
            continue
        base_contents = base_file.read_text(encoding="utf-8")
        for token in TARGET_TOKENS:
            target_stem = base_stem.replace("_0_00", f"_{token}")
            target_dir = family_root / target_stem
            target_file = target_dir / f"{target_stem}.mtlx"
            variant_contents = base_contents.replace(base_stem, target_stem)
            variant_contents = replace_swept_input_literal(
                variant_contents,
                parameter,
                VALUE_TOKEN_TO_FLOAT[token],
            )
            if target_file.exists():
                if not overwrite:
                    stats["skipped"] += 1
                    continue
                previous_contents = target_file.read_text(encoding="utf-8")
                if previous_contents == variant_contents:
                    stats["skipped"] += 1
                    continue
                target_dir.mkdir(parents=True, exist_ok=True)
                target_file.write_text(variant_contents, encoding="utf-8")
                stats["updated"] += 1
                continue
            target_dir.mkdir(parents=True, exist_ok=True)
            target_file.write_text(variant_contents, encoding="utf-8")
            stats["created"] += 1
    return stats


def structural_checks(base_templates: Iterable[Tuple[Path, Path, str, str, str]]) -> List[str]:
    errors: List[str] = []
    valid_tokens = set(VALUE_TOKEN_TO_FLOAT.keys())
    for family_root, _, family, parameter, _ in base_templates:
        for token in VALUE_TOKEN_TO_FLOAT.keys():
            stem = f"{family}_sweep_{parameter}_{token}"
            folder = family_root / stem
            if not folder.exists():
                errors.append(f"missing folder: {folder}")
                continue
            mtlx_files = sorted(folder.glob("*.mtlx"))
            if len(mtlx_files) != 1:
                errors.append(f"{folder} expected 1 .mtlx, found {len(mtlx_files)}")
                continue
            if mtlx_files[0].name != f"{stem}.mtlx":
                errors.append(f"{folder} file name mismatch: {mtlx_files[0].name}")
            suffix = stem.rsplit("_", 2)[-2] + "_" + stem.rsplit("_", 1)[-1]
            if suffix not in valid_tokens:
                errors.append(f"{folder} has non-sortable token {suffix}")
    return errors


def semantic_checks(base_templates: Iterable[Tuple[Path, Path, str, str, str]]) -> List[str]:
    errors: List[str] = []
    for family_root, _, family, parameter, _ in base_templates:
        baseline_inputs: List[str] | None = None
        for token, value in VALUE_TOKEN_TO_FLOAT.items():
            stem = f"{family}_sweep_{parameter}_{token}"
            file_path = family_root / stem / f"{stem}.mtlx"
            if not file_path.exists():
                continue
            contents = file_path.read_text(encoding="utf-8")
            expected_value = fmt_float(value)
            sweep_input = re.search(
                rf'<input\s+name="{re.escape(parameter)}"\s+type="(?P<input_type>[^"]+)"\s+value="(?P<input_value>[^"]+)"\s*/>',
                contents,
            )
            if not sweep_input:
                errors.append(f"{file_path} missing sweep input {parameter}")
                continue
            input_type = sweep_input.group("input_type")
            expected_formatted = format_value_for_input(parameter, input_type, value)
            if sweep_input.group("input_value") != expected_formatted:
                errors.append(
                    f"{file_path} {parameter} expected {expected_formatted}, got {sweep_input.group('input_value')}"
                )
            normalized_inputs = [
                line.strip()
                for line in contents.splitlines()
                if line.strip().startswith("<input ")
                and 'name="surfaceshader"' not in line
                and f'name="{parameter}"' not in line
            ]
            if baseline_inputs is None:
                baseline_inputs = normalized_inputs
            elif normalized_inputs != baseline_inputs:
                errors.append(f"{file_path} non-swept defaults differ from 0_00 variant")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing generated variants.")
    parser.add_argument(
        "--bootstrap-base-templates",
        action="store_true",
        help="Create missing *_0_00 base templates from built-in defaults.",
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Run structural/semantic checks only without generating variants.",
    )
    args = parser.parse_args()

    bootstrap_created = 0
    bootstrap_updated = 0
    if args.bootstrap_base_templates:
        bootstrap_created, bootstrap_updated = bootstrap_base_templates(args.overwrite)

    base_templates = discover_base_templates()
    if not base_templates:
        print("No base templates found matching *_sweep_*_0_00/*.mtlx")
        return

    generation_stats = {"created": 0, "updated": 0, "skipped": 0}
    if not args.check_only:
        generation_stats = generate_variants(base_templates, args.overwrite)

    structural_errors = structural_checks(base_templates)
    semantic_errors = semantic_checks(base_templates)
    all_errors = structural_errors + semantic_errors

    print(
        "Base templates: "
        f"{len(base_templates)} discovered, {bootstrap_created} created, {bootstrap_updated} updated"
    )
    print(
        "Variants: "
        f"{generation_stats['created']} created, "
        f"{generation_stats['updated']} updated, "
        f"{generation_stats['skipped']} skipped"
    )
    print(f"Checks: {len(all_errors)} issue(s)")
    for issue in all_errors:
        print(f"- {issue}")

    if all_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
