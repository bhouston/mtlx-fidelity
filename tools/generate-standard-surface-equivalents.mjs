#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MATERIAL_NAMES = `
absval acos add and artistic_ior asin atan2 blackbody bump burn ceil cellnoise2d cellnoise3d checkerboard circle clamp colorcorrect combine2 combine3 combine4 constant contrast convert cos creatematrix crossproduct determinant difference distance divide dodge dot dotproduct exp extract floor fract fractal3d frame heighttonormal hextiledimage hextilednormalmap hsvtorgb ifequal ifgreater ifgreatereq image invert invertmatrix ln luminance magnitude max min minus mix modulo multiply noise2d noise3d normal normalize normalmap not or overlay place2d position power ramp ramp_gradient ramp4 ramplr ramptb range reflect refract remap rgbtohsv rotate2d rotate3d round safepower saturate screen separate2 separate3 separate4 sign sin smoothstep splitlr splittb sqrt subtract tan tangent texcoord tiledimage time transformmatrix transformnormal transformpoint transformvector transpose unifiednoise2d unifiednoise3d unpremult viewdirection worleynoise2d worleynoise3d xor
`
  .trim()
  .split(/\s+/)
  .toSorted((a, b) => a.localeCompare(b));

const STRICT_NEUTRAL_INPUTS = new Map([
  ['occlusion', '1'],
  ['alpha_mode', '0'],
  ['alpha_cutoff', '0.5'],
  ['iridescence', '0'],
  ['iridescence_ior', '1.3'],
  ['iridescence_thickness', '300'],
  ['sheen_color', '0,0,0'],
  ['sheen_roughness', '0'],
  ['clearcoat', '0'],
  ['clearcoat_roughness', '0'],
  ['clearcoat_normal', '0,0,1'],
  ['thickness', '0'],
  ['attenuation_distance', '100000'],
  ['attenuation_color', '0,0,0'],
]);

const MAPPED_INPUTS = [
  { source: 'base_color', target: 'base_color', targetType: 'color3' },
  { source: 'metallic', target: 'metalness', targetType: 'float' },
  { source: 'roughness', target: 'specular_roughness', targetType: 'float' },
  { source: 'normal', target: 'normal', targetType: 'vector3' },
  { source: 'transmission', target: 'transmission', targetType: 'float' },
  { source: 'specular', target: 'specular', targetType: 'float' },
  { source: 'specular_color', target: 'specular_color', targetType: 'color3' },
  { source: 'ior', target: 'specular_IOR', targetType: 'float' },
  { source: 'emissive_strength', target: 'emission', targetType: 'float' },
  { source: 'emissive', target: 'emission_color', targetType: 'color3' },
  {
    source: 'alpha',
    target: 'opacity',
    targetType: 'color3',
    valueTransform: (value) => {
      const numberValue = Number.parseFloat(value.trim());
      if (!Number.isFinite(numberValue)) {
        return null;
      }
      return `${numberValue}, ${numberValue}, ${numberValue}`;
    },
  },
];

const ATTR_REGEX = /([A-Za-z_][A-Za-z0-9_:.-]*)="([^"]*)"/g;
const INPUT_TAG_REGEX = /<input\b([^>]*)\/>/g;
const GLTF_PBR_REGEX = /<gltf_pbr\b[\s\S]*?<\/gltf_pbr>/;

function parseAttributes(attributeText) {
  const attributes = [];
  for (const match of attributeText.matchAll(ATTR_REGEX)) {
    attributes.push({ name: match[1], value: match[2] });
  }
  return attributes;
}

function attributesToMap(attributes) {
  return new Map(attributes.map((attribute) => [attribute.name, attribute.value]));
}

function normalizeScalar(value) {
  return value.replace(/\s+/g, '');
}

function normalizeTuple(value) {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(',');
}

function isNeutralValue(value, neutral) {
  if (neutral.includes(',')) {
    return normalizeTuple(value) === normalizeTuple(neutral);
  }
  return normalizeScalar(value) === normalizeScalar(neutral);
}

function hasConnection(attributes) {
  return Boolean(
    attributes.get('nodename') ||
    attributes.get('nodegraph') ||
    attributes.get('interfacename') ||
    attributes.get('defaultinput'),
  );
}

function formatInputTag(name, type, attributes) {
  const attrParts = [`name="${name}"`, `type="${type}"`];
  for (const [attributeName, attributeValue] of attributes) {
    attrParts.push(`${attributeName}="${attributeValue}"`);
  }
  return `    <input ${attrParts.join(' ')} />`;
}

function convertMaterialContent(sourceContent) {
  const gltfBlockMatch = sourceContent.match(GLTF_PBR_REGEX);
  if (!gltfBlockMatch) {
    return { ok: false, reason: 'No <gltf_pbr> block found' };
  }

  const gltfBlock = gltfBlockMatch[0];
  const startTagMatch = gltfBlock.match(/<gltf_pbr\b([^>]*)>/);
  if (!startTagMatch) {
    return { ok: false, reason: 'Malformed <gltf_pbr> start tag' };
  }

  const shaderAttributes = parseAttributes(startTagMatch[1]);
  const parsedInputs = new Map();

  for (const match of gltfBlock.matchAll(INPUT_TAG_REGEX)) {
    const inputAttributes = parseAttributes(match[1]);
    const attributeMap = attributesToMap(inputAttributes);
    const name = attributeMap.get('name');
    const type = attributeMap.get('type');
    if (!name || !type) {
      return { ok: false, reason: 'Encountered <input> tag missing name or type' };
    }
    parsedInputs.set(name, {
      name,
      type,
      attributes: attributeMap,
    });
  }

  for (const [unsupportedName, neutralValue] of STRICT_NEUTRAL_INPUTS.entries()) {
    const input = parsedInputs.get(unsupportedName);
    if (!input) {
      continue;
    }
    if (hasConnection(input.attributes)) {
      return { ok: false, reason: `Unsupported connected input "${unsupportedName}"` };
    }
    const value = input.attributes.get('value');
    if (!value) {
      return { ok: false, reason: `Unsupported input "${unsupportedName}" missing value` };
    }
    if (!isNeutralValue(value, neutralValue)) {
      return { ok: false, reason: `Unsupported non-neutral input "${unsupportedName}" (${value})` };
    }
  }

  const convertedInputTags = [];
  for (const mapping of MAPPED_INPUTS) {
    const input = parsedInputs.get(mapping.source);
    if (!input) {
      continue;
    }

    const outputAttributes = new Map();
    if (input.attributes.has('nodename')) {
      outputAttributes.set('nodename', input.attributes.get('nodename'));
    }
    if (input.attributes.has('nodegraph')) {
      outputAttributes.set('nodegraph', input.attributes.get('nodegraph'));
    }
    if (input.attributes.has('interfacename')) {
      outputAttributes.set('interfacename', input.attributes.get('interfacename'));
    }
    if (input.attributes.has('output')) {
      outputAttributes.set('output', input.attributes.get('output'));
    }

    if (outputAttributes.size === 0) {
      const value = input.attributes.get('value');
      if (!value) {
        return { ok: false, reason: `Mapped input "${mapping.source}" missing connection and value` };
      }
      const transformedValue = mapping.valueTransform ? mapping.valueTransform(value) : value;
      if (transformedValue == null) {
        return {
          ok: false,
          reason: `Mapped input "${mapping.source}" has unsupported value format (${value})`,
        };
      }
      outputAttributes.set('value', transformedValue);
    } else if (input.type !== mapping.targetType) {
      return {
        ok: false,
        reason: `Mapped connected input "${mapping.source}" type mismatch (${input.type} -> ${mapping.targetType})`,
      };
    }

    convertedInputTags.push(formatInputTag(mapping.target, mapping.targetType, outputAttributes));
  }

  const shaderAttrText = shaderAttributes.map((attribute) => ` ${attribute.name}="${attribute.value}"`).join('');
  const standardSurfaceBlock = [
    `  <standard_surface${shaderAttrText}>`,
    ...convertedInputTags,
    '  </standard_surface>',
  ].join('\n');

  const convertedContent = sourceContent.replace(gltfBlock, standardSurfaceBlock);
  return { ok: true, content: convertedContent };
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const samplesRoot = path.join(repoRoot, 'submodules', 'material-samples', 'materials');
  const sourceRoot = path.join(samplesRoot, 'gltf_pbr');
  const targetRoot = path.join(samplesRoot, 'standard_surface');

  const summary = {
    generated: [],
    skipped: [],
  };

  for (const materialName of MATERIAL_NAMES) {
    const sourcePath = path.join(sourceRoot, materialName, `${materialName}.mtlx`);
    const targetPath = path.join(targetRoot, materialName, `${materialName}.mtlx`);

    if (!(await pathExists(sourcePath))) {
      summary.skipped.push({ material: materialName, reason: `source ${materialName}.mtlx not found` });
      continue;
    }

    if (await pathExists(targetPath)) {
      summary.skipped.push({ material: materialName, reason: `target ${materialName}.mtlx already exists` });
      continue;
    }

    const sourceContent = await readFile(sourcePath, 'utf8');
    const conversionResult = convertMaterialContent(sourceContent);
    if (!conversionResult.ok) {
      summary.skipped.push({ material: materialName, reason: conversionResult.reason });
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, conversionResult.content, 'utf8');
    summary.generated.push({ material: materialName, path: path.relative(repoRoot, targetPath) });
  }

  const summaryPath = path.join(targetRoot, 'strict-equivalents-summary.json');
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        sourceType: 'gltf_pbr',
        targetType: 'standard_surface',
        mode: 'strict',
        requestedCount: MATERIAL_NAMES.length,
        generatedCount: summary.generated.length,
        skippedCount: summary.skipped.length,
        ...summary,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`Generated: ${summary.generated.length}`);
  console.log(`Skipped: ${summary.skipped.length}`);
  console.log(`Summary: ${path.relative(repoRoot, summaryPath)}`);
}

await main();
