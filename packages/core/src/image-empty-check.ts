import sharp from 'sharp';

const EMPTY_IMAGE_RMS_THRESHOLD = 0.005;
const cachedReferenceImages = new Map<string, Promise<RawRgbaImage>>();

interface RawRgbaImage {
  data: Buffer;
  width: number;
  height: number;
}

export async function readImageAsRawRgba(
  image: string | Buffer,
  resizeTo?: { width: number; height: number },
): Promise<RawRgbaImage> {
  let pipeline = sharp(image).ensureAlpha();
  if (resizeTo) {
    pipeline = pipeline.resize(resizeTo.width, resizeTo.height, { fit: 'fill' });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
  };
}

function getReferenceCacheKey(emptyReferenceImagePath: string, width: number, height: number): string {
  return `${emptyReferenceImagePath}|${width}x${height}`;
}

async function readReferenceImageAsRawRgba(
  emptyReferenceImagePath: string,
  width: number,
  height: number,
): Promise<RawRgbaImage> {
  const cacheKey = getReferenceCacheKey(emptyReferenceImagePath, width, height);
  const cached = cachedReferenceImages.get(cacheKey);
  if (cached) {
    return cached;
  }

  const loadPromise = readImageAsRawRgba(emptyReferenceImagePath, { width, height });
  cachedReferenceImages.set(cacheKey, loadPromise);
  return loadPromise;
}

export function calculateNormalizedRgbRms(source: Buffer, reference: Buffer): number {
  if (source.length !== reference.length) {
    throw new Error(`Image size mismatch: source ${source.length} bytes vs reference ${reference.length} bytes.`);
  }

  let sumSquaredDifferences = 0;
  let channelCount = 0;
  for (let pixelOffset = 0; pixelOffset < source.length; pixelOffset += 4) {
    const redDelta = (source[pixelOffset] ?? 0) - (reference[pixelOffset] ?? 0);
    const greenDelta = (source[pixelOffset + 1] ?? 0) - (reference[pixelOffset + 1] ?? 0);
    const blueDelta = (source[pixelOffset + 2] ?? 0) - (reference[pixelOffset + 2] ?? 0);
    sumSquaredDifferences += redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
    channelCount += 3;
  }

  return Math.sqrt(sumSquaredDifferences / channelCount) / 255;
}

export async function calculateImageNormalizedRgbRms(
  source: string | Buffer,
  referenceImagePath: string,
  options?: { treatDimensionMismatchAsMaxDifference?: boolean },
): Promise<number> {
  const sourceImage = await readImageAsRawRgba(source);
  const referenceImage = await readImageAsRawRgba(referenceImagePath);
  if (sourceImage.width !== referenceImage.width || sourceImage.height !== referenceImage.height) {
    if (options?.treatDimensionMismatchAsMaxDifference) {
      return 1;
    }
    throw new Error(
      `Image dimensions mismatch: source ${sourceImage.width}x${sourceImage.height} vs reference ${referenceImage.width}x${referenceImage.height}.`,
    );
  }
  return calculateNormalizedRgbRms(sourceImage.data, referenceImage.data);
}

export async function assertRenderIsNotEmpty(outputPngPath: string, emptyReferenceImagePath: string): Promise<void> {
  const outputImage = await readImageAsRawRgba(outputPngPath);
  const emptyReferenceImage = await readReferenceImageAsRawRgba(
    emptyReferenceImagePath,
    outputImage.width,
    outputImage.height,
  );
  const normalizedRms = calculateNormalizedRgbRms(outputImage.data, emptyReferenceImage.data);
  if (normalizedRms <= EMPTY_IMAGE_RMS_THRESHOLD) {
    throw new Error(
      `Render output is empty (similar to blank reference): rms=${normalizedRms.toFixed(6)} threshold=${EMPTY_IMAGE_RMS_THRESHOLD.toFixed(6)}.`,
    );
  }
}
