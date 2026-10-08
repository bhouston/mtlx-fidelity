import path from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import { materialXNodeRegistry, readMaterialX, validateDocument } from '@material-viewer/mtlx-core';
import type { MaterialXDocument, MaterialXInput, MaterialXNode, MaterialXNodeSpec } from '@material-viewer/mtlx-core';
import { RenderValidationReportSchema, type RenderReportIssue } from '@mtlx-fidelity/samples';

const UNKNOWN_NODE_CATEGORY_PREFIX = 'Unknown node category "';

export interface PreflightIssue {
  materialPath: string;
  level: 'error' | 'warning';
  location: string;
  message: string;
}

export interface PreflightResult {
  fatalIssues: PreflightIssue[];
  warningIssues: PreflightIssue[];
}

function normalizeFilePrefix(filePrefix: string | undefined): string {
  if (!filePrefix) {
    return '';
  }
  return filePrefix.trim();
}

function hasUriScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
}

function combineFilePrefix(parentPrefix: string, childPrefix: string): string {
  if (!childPrefix) {
    return parentPrefix;
  }
  if (!parentPrefix || path.isAbsolute(childPrefix) || hasUriScheme(childPrefix)) {
    return childPrefix;
  }
  return `${parentPrefix}${childPrefix}`;
}

function extractFilenameInputValue(input: MaterialXInput): string {
  const inputValue = input.value ?? input.attributes.value ?? '';
  return inputValue.trim();
}

async function validateTextureInputsForNodes(
  materialPath: string,
  nodes: MaterialXNode[],
  scope: string,
  inheritedFilePrefix: string,
): Promise<PreflightResult> {
  const fatalIssues: PreflightIssue[] = [];
  const warningIssues: PreflightIssue[] = [];
  const materialDirectory = path.dirname(materialPath);

  for (const node of nodes) {
    const nodePrefix = combineFilePrefix(inheritedFilePrefix, normalizeFilePrefix(node.attributes.fileprefix));
    const nodeLocation = `${scope}/${node.category}:${node.name ?? 'unnamed'}`;

    for (const input of node.inputs) {
      if (input.type !== 'filename') {
        continue;
      }

      const filenameValue = extractFilenameInputValue(input);
      if (filenameValue.length === 0) {
        continue;
      }
      const location = `${nodeLocation}/input:${input.name || 'unnamed'}`;
      if (hasUriScheme(filenameValue)) {
        warningIssues.push({
          materialPath,
          level: 'warning',
          location,
          message: `Skipping texture existence check for URI "${filenameValue}".`,
        });
        continue;
      }

      const inputPrefix = combineFilePrefix(nodePrefix, normalizeFilePrefix(input.attributes.fileprefix));
      const sourcePath = `${inputPrefix}${filenameValue}`;
      const resolvedPath = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(materialDirectory, sourcePath);

      try {
        await access(resolvedPath);
      } catch {
        fatalIssues.push({
          materialPath,
          level: 'error',
          location,
          message: `Missing texture file "${sourcePath}" resolved to "${resolvedPath}".`,
        });
      }
    }
  }

  return { fatalIssues, warningIssues };
}

// Documents may declare their own nodes, as a nodedef implemented by a nodegraph; MaterialX accepts these.
function getDocumentNodeSpecs(document: MaterialXDocument): MaterialXNodeSpec[] {
  const nodeDefs = document.nodes.filter((node) => node.category === 'nodedef');
  const categories = ['nodedef', ...nodeDefs.flatMap((node) => (node.attributes.node ? [node.attributes.node] : []))];
  return categories.map((category) => ({ category, inputs: [], outputs: [], parameters: [] }));
}

export async function validateMaterial(materialPath: string): Promise<PreflightResult> {
  const fatalIssues: PreflightIssue[] = [];
  const warningIssues: PreflightIssue[] = [];

  let document: MaterialXDocument;
  try {
    document = await readMaterialX(materialPath);
  } catch (error) {
    fatalIssues.push({
      materialPath,
      level: 'error',
      location: 'materialx',
      message: error instanceof Error ? error.message : String(error),
    });
    return { fatalIssues, warningIssues };
  }

  for (const issue of validateDocument(document, [...materialXNodeRegistry, ...getDocumentNodeSpecs(document)])) {
    const issueRecord: PreflightIssue = {
      materialPath,
      level: issue.level,
      location: issue.location,
      message: issue.message,
    };
    if (issue.level === 'error' || issue.message.startsWith(UNKNOWN_NODE_CATEGORY_PREFIX)) {
      fatalIssues.push(issueRecord);
    } else {
      warningIssues.push(issueRecord);
    }
  }

  const documentPrefix = normalizeFilePrefix(document.attributes.fileprefix);
  const documentTextureIssues = await validateTextureInputsForNodes(
    materialPath,
    document.nodes,
    'materialx',
    documentPrefix,
  );
  fatalIssues.push(...documentTextureIssues.fatalIssues);
  warningIssues.push(...documentTextureIssues.warningIssues);
  for (const nodeGraph of document.nodeGraphs) {
    const nodeGraphPrefix = combineFilePrefix(documentPrefix, normalizeFilePrefix(nodeGraph.attributes.fileprefix));
    const nodeGraphScope = `materialx/nodegraph:${nodeGraph.name ?? 'unnamed'}`;
    const nodeGraphTextureIssues = await validateTextureInputsForNodes(
      materialPath,
      nodeGraph.nodes,
      nodeGraphScope,
      nodeGraphPrefix,
    );
    fatalIssues.push(...nodeGraphTextureIssues.fatalIssues);
    warningIssues.push(...nodeGraphTextureIssues.warningIssues);
  }

  return { fatalIssues, warningIssues };
}

export function writeValidationWarnings(warnings: PreflightIssue[]): void {
  for (const warning of warnings) {
    process.stderr.write(`WARN ${warning.materialPath} | ${warning.location}: ${warning.message}\n`);
  }
}

export function formatFatalValidationIssues(materialPath: string, issues: PreflightIssue[]): string {
  return [
    `MaterialX validation failed for ${materialPath}:`,
    ...issues.map((issue) => `- ${issue.location}: ${issue.message}`),
  ].join('\n');
}

function createFailureJsonPath(materialPath: string, rendererName: string): string {
  return path.join(path.dirname(materialPath), `${rendererName}.json`);
}

function toRenderReportIssue(issue: PreflightIssue): RenderReportIssue {
  return {
    level: issue.level,
    location: issue.location,
    message: issue.message,
  };
}

export async function writeValidationFailureReport(
  materialPath: string,
  rendererName: string,
  issues: PreflightIssue[],
): Promise<string> {
  const reportPath = createFailureJsonPath(materialPath, rendererName);
  const report = RenderValidationReportSchema.parse({
    rendererName,
    materialPath,
    status: 'validation_failed',
    issues: issues.map(toRenderReportIssue),
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}
