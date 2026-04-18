import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Hit, IngestJob, IngestJobStatus, SearchCacheEntry, StoreSchema, StoredVideo, TranscriptLine } from './types';

const STORE_DIR = path.join(process.cwd(), '.cache');
const STORE_FILE = path.join(STORE_DIR, 'youphrase-store.json');
const DEFAULT_SEARCH_TTL_MS = 1000 * 60 * 60 * 24;

const EMPTY_STORE: StoreSchema = {
  videos: {},
  searches: {},
  ingestJobs: {},
};

let writeQueue: Promise<void> = Promise.resolve();

async function ensureStoreFile(): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  try {
    await readFile(STORE_FILE, 'utf8');
  } catch {
    await writeFile(STORE_FILE, JSON.stringify(EMPTY_STORE, null, 2), 'utf8');
  }
}

async function readStore(): Promise<StoreSchema> {
  await ensureStoreFile();
  try {
    const raw = await readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreSchema>;
    return {
      videos: parsed.videos ?? {},
      searches: parsed.searches ?? {},
      ingestJobs: parsed.ingestJobs ?? {},
    };
  } catch {
    return { ...EMPTY_STORE };
  }
}

async function writeStore(store: StoreSchema): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    await ensureStoreFile();
    await writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
  });
  await writeQueue;
}

function normalizeSearchKey(phrase: string, accent = ''): string {
  return `${phrase.trim().toLowerCase()}::${accent.trim().toLowerCase()}`;
}

export async function getSearchCache(
  phrase: string,
  accent = '',
  options?: { allowStale?: boolean; ttlMs?: number }
): Promise<SearchCacheEntry | null> {
  const key = normalizeSearchKey(phrase, accent);
  const store = await readStore();
  const entry = store.searches[key];
  if (!entry) return null;
  if (options?.allowStale) return entry;

  const ttlMs = options?.ttlMs ?? DEFAULT_SEARCH_TTL_MS;
  if (Date.now() - entry.updatedAt > ttlMs) return null;
  return entry;
}

export async function setSearchCache(phrase: string, accent: string, hits: SearchCacheEntry['hits']): Promise<void> {
  const key = normalizeSearchKey(phrase, accent);
  const store = await readStore();
  store.searches[key] = { key, hits, updatedAt: Date.now() };
  await writeStore(store);
}

export async function getTranscriptFromStore(
  videoId: string,
  preferredLangs: string[] = []
): Promise<TranscriptLine[] | null> {
  const store = await readStore();
  const video = store.videos[videoId];
  if (!video) return null;

  for (const lang of preferredLangs) {
    if (video.transcripts[lang]?.length) return video.transcripts[lang];
  }

  const fallback = Object.values(video.transcripts).find((segments) => segments.length > 0);
  return fallback ?? null;
}

export async function setVideoTranscript(
  video: Pick<StoredVideo, 'videoId' | 'title' | 'channelTitle' | 'thumbnail'>,
  lang: string,
  transcript: TranscriptLine[]
): Promise<void> {
  const store = await readStore();
  const existing = store.videos[video.videoId];

  store.videos[video.videoId] = {
    videoId: video.videoId,
    title: video.title || existing?.title || '',
    channelTitle: video.channelTitle || existing?.channelTitle || '',
    thumbnail: video.thumbnail || existing?.thumbnail || '',
    updatedAt: Date.now(),
    transcripts: {
      ...(existing?.transcripts ?? {}),
      [lang]: transcript,
    },
  };

  await writeStore(store);
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function searchHitsFromStore(
  phrase: string,
  accent = '',
  options?: { perVideoLimit?: number; totalLimit?: number }
): Promise<Hit[]> {
  const store = await readStore();
  const phraseNorm = normalizeText(phrase);
  if (!phraseNorm) return [];

  const perVideoLimit = options?.perVideoLimit ?? 3;
  const totalLimit = options?.totalLimit ?? 40;
  const preferredLang = accent ? `en-${accent.toUpperCase()}` : '';
  const hits: Hit[] = [];

  for (const video of Object.values(store.videos)) {
    if (hits.length >= totalLimit) break;
    const transcripts = Object.entries(video.transcripts);
    const ordered = preferredLang
      ? transcripts.sort(([a], [b]) => Number(b === preferredLang) - Number(a === preferredLang))
      : transcripts;

    let perVideoCount = 0;
    for (const [, lines] of ordered) {
      for (const line of lines) {
        if (perVideoCount >= perVideoLimit || hits.length >= totalLimit) break;
        if (normalizeText(line.text).includes(phraseNorm)) {
          hits.push({
            videoId: video.videoId,
            title: video.title,
            channelTitle: video.channelTitle,
            thumbnail: video.thumbnail,
            startSec: Math.max(0, Math.floor(line.offset / 1000) - 1),
            text: line.text,
          });
          perVideoCount += 1;
        }
      }
      if (perVideoCount > 0) break;
    }
  }

  return hits;
}

function jobId(videoId: string, lang: string): string {
  return `${videoId}:${lang}`;
}

export async function upsertIngestJob(params: {
  videoId: string;
  lang: string;
  status?: IngestJobStatus;
  lastError?: string;
  nextRetryAt?: number;
  attemptDelta?: number;
}): Promise<IngestJob> {
  const store = await readStore();
  const id = jobId(params.videoId, params.lang);
  const existing = store.ingestJobs[id];
  const now = Date.now();
  const next: IngestJob = {
    id,
    videoId: params.videoId,
    lang: params.lang,
    status: params.status ?? existing?.status ?? 'pending',
    attempt: (existing?.attempt ?? 0) + (params.attemptDelta ?? 0),
    nextRetryAt: params.nextRetryAt ?? existing?.nextRetryAt ?? now,
    lastError: params.lastError ?? existing?.lastError ?? '',
    updatedAt: now,
  };
  store.ingestJobs[id] = next;
  await writeStore(store);
  return next;
}

export async function listDueIngestJobs(limit = 20): Promise<IngestJob[]> {
  const store = await readStore();
  const now = Date.now();
  return Object.values(store.ingestJobs)
    .filter((job) => job.status === 'pending' || (job.status === 'retry' && job.nextRetryAt <= now))
    .sort((a, b) => a.nextRetryAt - b.nextRetryAt)
    .slice(0, limit);
}
