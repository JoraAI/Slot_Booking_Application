import prisma from '../src/lib/prisma';
import { createMediaAsset } from '../src/services/MediaService';

const U = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=640&q=50`;

/**
 * Unique still-life / product photos (Unsplash License). Chosen to avoid
 * people performing the service: tools, bottles, chairs, flowers, spa objects.
 */
const SERVICE_SOURCE_BY_NAME: Record<string, string> = {
  'Haircut & Style': U('photo-1596362601603-b74f6ef166e4'),
  'Hair Color': U('photo-1584906755531-f83be6b88d6b'),
  'Swedish Massage': U('photo-1600334129128-685c5582fd35'),
  'Signature Facial': U('photo-1556228720-195a672e8a03'),
  'Classic Manicure': U('photo-1667242003851-e76e43823b8d'),
  Haircut: U('photo-1549271568-e87e07c5406b'),
  "Kids' Cut": U('photo-1625038032200-648fbcd800d0'),
  'Bang Trim': U('photo-1527799820374-dcf8d9d4a388'),
  Hairstyling: U('photo-1678356163587-6bb3afb89679'),
  'Curly Hair Styling': U('photo-1522338140262-f46f5913618a'),
  Blowdry: U('photo-1634449571010-02389ed0f9b0'),
  'Shampoo & Conditioning': U('photo-1608248543803-ba4f8c70ae0b'),
  'Beard Trim': U('photo-1638383258375-0d294725071b'),
  Shaving: U('photo-1621605815971-fbc98d665033'),
  'Hair Coloring': U('photo-1571781926291-c477ebfd024b'),
  Balayage: U('photo-1596462502278-27bfdc403348'),
  'Ombre Hair Color': U('photo-1512496015851-a90fb38ba796'),
  'Hair Highlighting': U('photo-1571875257727-256c39da42af'),
  'Gloss or Glaze': U('photo-1598440947619-2c35fc9aa908'),
  'Hair Glazing': U('photo-1612817288484-6f916006741a'),
  'Hair Glossing': U('photo-1522335789203-aabd1fc54bc9'),
  'Hair Extensions': U('photo-1487412947147-5cebf100ffc2'),
  'Hair Hydration Treatment': U('photo-1580870069867-74c57ee1bb07'),
  'Hair Straightening': U('photo-1515372039744-b8f02a3ae446'),
  'Brazilian Hair Straightening': U('photo-1540555700478-4be289fbecef'),
  'Hair Treatment': U('photo-1507652313519-d4e9174996dd'),
  'Keratin Treatment': U('photo-1714387648824-2493ef18b7bc'),
  Perm: U('photo-1614438865362-9137f7e3036e'),
  'Eyebrow Threading': U('photo-1632345031435-8727f6897d53'),
  Massage: U('photo-1693776529733-c23cce5f4a63'),
  'Bridal Services': U('photo-1465495976277-4387d4b0b4c6'),
};

const COVER_SOURCES = [
  U('photo-1560066984-138dadb4c035'),
  U('photo-1585747860715-2ba37e788b70'),
];

const FALLBACK_SOURCES = [
  U('photo-1519014816548-bf5fe059798b'),
  U('photo-1492707892479-7bc8d5a4ee93'),
];

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ReservlySeed/1.0 (salon service images)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) throw new Error(`Empty image from ${url}`);
  return buf;
}

async function storeUniqueImage(businessId: string, sourceUrl: string): Promise<string> {
  const bytes = await downloadImage(sourceUrl);
  const asset = await createMediaAsset(businessId, bytes);
  return `/api/media/${asset.id}`;
}

/**
 * Store a unique compressed still-life photo in Postgres for each service.
 * Replaces previous Unsplash CDN URLs and leftover /api/media placeholders.
 */
export async function ensureServiceImages(params: {
  businessId: string;
  services: { id: string; name: string; imageUrl: string | null }[];
  coverImageUrl?: string | null;
  setCover?: boolean;
}): Promise<{ attached: number; cover: boolean }> {
  await prisma.mediaAsset.deleteMany({ where: { businessId: params.businessId } });

  const usedSources = new Set<string>();
  let fallbackIdx = 0;
  let attached = 0;

  const nextSource = (name: string): string => {
    const preferred = SERVICE_SOURCE_BY_NAME[name];
    if (preferred && !usedSources.has(preferred)) return preferred;
    while (fallbackIdx < FALLBACK_SOURCES.length) {
      const candidate = FALLBACK_SOURCES[fallbackIdx++];
      if (!usedSources.has(candidate)) return candidate;
    }
    throw new Error(`No unique image source left for ${name}`);
  };

  for (const service of params.services) {
    try {
      const source = nextSource(service.name);
      usedSources.add(source);
      const url = await storeUniqueImage(params.businessId, source);
      await prisma.service.update({ where: { id: service.id }, data: { imageUrl: url } });
      attached += 1;
    } catch (err: any) {
      console.warn(`Skip image for ${service.name}: ${err.message}`);
    }
  }

  let cover = false;
  if (params.setCover) {
    try {
      const source = COVER_SOURCES.find((u) => !usedSources.has(u)) || COVER_SOURCES[0];
      usedSources.add(source);
      const url = await storeUniqueImage(params.businessId, source);
      await prisma.business.update({ where: { id: params.businessId }, data: { coverImageUrl: url } });
      cover = true;
    } catch (err: any) {
      console.warn(`Skip cover image: ${err.message}`);
    }
  }

  return { attached, cover };
}
