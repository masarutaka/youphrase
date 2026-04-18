export type TranscriptLine = {
  offset: number;
  duration: number;
  text: string;
};

export type Hit = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  startSec: number;
  text: string;
};

export type StoredVideo = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  updatedAt: number;
  transcripts: Record<string, TranscriptLine[]>;
};

export type SearchCacheEntry = {
  key: string;
  hits: Hit[];
  updatedAt: number;
};

export type IngestJobStatus = 'pending' | 'retry' | 'done' | 'failed';

export type IngestJob = {
  id: string;
  videoId: string;
  lang: string;
  status: IngestJobStatus;
  attempt: number;
  nextRetryAt: number;
  lastError: string;
  updatedAt: number;
};

export type StoreSchema = {
  videos: Record<string, StoredVideo>;
  searches: Record<string, SearchCacheEntry>;
  ingestJobs: Record<string, IngestJob>;
};
