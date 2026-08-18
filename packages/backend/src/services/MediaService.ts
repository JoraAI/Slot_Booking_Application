import type { Request, Response } from 'express';
import sharp from 'sharp';
import prisma from '../lib/prisma';

/** Incoming upload cap (before compression). */
export const MEDIA_MAX_FILE_BYTES = 2 * 1024 * 1024;
/** Stored file cap after WebP compression. */
export const MEDIA_MAX_STORED_BYTES = 80 * 1024;
/** Per salon — enough for unique service photos plus a cover. */
export const MEDIA_MAX_ASSETS = 50;
/** Per salon — 8MB after compression. */
export const MEDIA_MAX_BUSINESS_BYTES = 8 * 1024 * 1024;
/** Platform-wide cap so ~10 salons fit on Neon free (0.5GB) with room for bookings. */
export const MEDIA_MAX_PLATFORM_BYTES = 10 * MEDIA_MAX_BUSINESS_BYTES;
const MAX_EDGE_PX = 640;
const WEBP_QUALITY = 48;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffImageMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf.length >= 3 && buf.subarray(0, 3).equals(JPEG)) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export function decodeImageBase64(dataBase64: string): Buffer {
  const raw = dataBase64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  return Buffer.from(raw, 'base64');
}

export function publicMediaUrl(id: string, req?: Request): string {
  const envBase = (process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (envBase) return `${envBase}/api/media/${id}`;
  if (req) {
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
    if (host) return `${proto}://${host}/api/media/${id}`;
  }
  return `/api/media/${id}`;
}

export async function compressImage(bytes: Buffer): Promise<{ data: Buffer; mimeType: 'image/webp' }> {
  if (!sniffImageMime(bytes)) {
    throw Object.assign(new Error('Only JPEG, PNG, or WebP images are allowed'), { status: 400 });
  }
  if (!bytes.length) throw Object.assign(new Error('Empty image'), { status: 400 });
  if (bytes.length > MEDIA_MAX_FILE_BYTES) {
    throw Object.assign(new Error(`Image too large (max ${Math.round(MEDIA_MAX_FILE_BYTES / 1024 / 1024)}MB)`), { status: 400 });
  }

  let data: Buffer;
  try {
    data = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({
        width: MAX_EDGE_PX,
        height: MAX_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY, effort: 5 })
      .toBuffer();
  } catch {
    throw Object.assign(new Error('Could not process that image'), { status: 400 });
  }

  if (data.length > MEDIA_MAX_STORED_BYTES) {
    data = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({
        width: 480,
        height: 480,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 38, effort: 5 })
      .toBuffer();
  }

  if (data.length > MEDIA_MAX_STORED_BYTES) {
    throw Object.assign(new Error('Image is still too large after compression. Try a simpler photo.'), { status: 400 });
  }

  return { data, mimeType: 'image/webp' };
}

export async function createMediaAsset(businessId: string, bytes: Buffer) {
  const { data, mimeType } = await compressImage(bytes);

  const [perBusiness, platform] = await Promise.all([
    prisma.mediaAsset.aggregate({
      where: { businessId },
      _count: { _all: true },
      _sum: { byteSize: true },
    }),
    prisma.mediaAsset.aggregate({
      _sum: { byteSize: true },
    }),
  ]);

  if (perBusiness._count._all >= MEDIA_MAX_ASSETS) {
    throw Object.assign(new Error(`Image limit reached (${MEDIA_MAX_ASSETS} per business)`), { status: 400 });
  }
  if ((perBusiness._sum.byteSize ?? 0) + data.length > MEDIA_MAX_BUSINESS_BYTES) {
    throw Object.assign(new Error('Image storage limit reached for this business'), { status: 400 });
  }
  if ((platform._sum.byteSize ?? 0) + data.length > MEDIA_MAX_PLATFORM_BYTES) {
    throw Object.assign(new Error('Free-plan image storage is full (sized for about 10 stores). Delete unused images or upgrade storage.'), { status: 400 });
  }

  return prisma.mediaAsset.create({
    data: {
      businessId,
      mimeType,
      byteSize: data.length,
      data,
    },
    select: { id: true, mimeType: true, byteSize: true },
  });
}

export async function serveMediaAsset(req: Request, res: Response) {
  const id = String(req.params.id || '');
  if (!id) return res.status(404).end();

  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { mimeType: true, byteSize: true, data: true },
  });
  if (!asset) return res.status(404).json({ error: 'Image not found' });

  res.setHeader('Content-Type', asset.mimeType);
  res.setHeader('Content-Length', String(asset.byteSize));
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('ETag', `"${id}"`);
  if (req.headers['if-none-match'] === `"${id}"`) return res.status(304).end();
  return res.status(200).end(Buffer.from(asset.data));
}
