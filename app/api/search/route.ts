import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { getSearchCache, getTranscriptFromStore, searchHitsFromStore, setSearchCache, setVideoTranscript, upsertIngestJob } from '@/lib/store/file-store';
import type { Hit, TranscriptLine } from '@/lib/store/types';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const SEARCH_LIVE_FALLBACK_ENABLED =
  (process.env.SEARCH_LIVE_FALLBACK_ENABLED ?? 'true').toLowerCase() !== 'false';

const NO_KEY_SEED_VIDEOS: Array<{
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
}> = [
  {
    videoId: 'dQw4w9WgXcQ',
    title: 'Rick Astley - Never Gonna Give You Up',
    channelTitle: 'Rick Astley',
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
  },
  {
    videoId: 'arj7oStGLkU',
    title: 'TED Talk sample',
    channelTitle: 'TED',
    thumbnail: 'https://i.ytimg.com/vi/arj7oStGLkU/mqdefault.jpg',
  },
];

// 検索の多様性を高めるための付加ワードプール
const SEED_WORDS = [
  'podcast', 'interview', 'lesson', 'conversation', 'speech',
  'vlog', 'documentary', 'debate', 'talk', 'lecture',
  'story', 'review', 'advice', 'tips', 'experience',
  'daily', 'travel', 'news', 'comedy', 'motivation',
];

// アクセント別の検索キーワード（①）
const ACCENT_KEYWORDS: Record<string, string> = {
  us: 'American English',
  gb: 'British English',
  au: 'Australian English',
  ie: 'Irish English',
  in: 'Indian English',
  ca: 'Canadian English',
  nz: 'New Zealand English',
  za: 'South African English',
};

// アクセント別字幕言語コード（③）
const ACCENT_LANG: Record<string, string> = {
  us: 'en-US',
  gb: 'en-GB',
  au: 'en-AU',
  ie: 'en-IE',
  in: 'en-IN',
  ca: 'en-CA',
  nz: 'en-NZ',
  za: 'en-ZA',
};

// アクセント別チャンネルID（②）
// チャンネルIDは youtube.com/@channelname のページで確認できます
const ACCENT_CHANNELS: Record<string, string[]> = {
  us: [
    'UCVTyTA7KZpC4sCeHXtsEZLg', // English with Greg (American)
    'UCBcRF18a7Qf58cCRy5xuWwQ', // MrBeast
    'UCsT0YIqwnpJCM-mx7-gSA4Q', // TEDx Talks
    'UCAuUUnT6oDeKwE6v1NGQxug', // TED
  ],
  gb: [
    'UCHaHD477h-FeBbVh9Sh7syA', // BBC Learning English
    'UC0RhatS1pyxInC00YKjjBqQ', // Markiplier (English)
    'UCddiUEpeqJcYeBxX1IVBKvQ', // The Telegraph
    'UC4K0_GaYsMkwGFGHFHrXxAw', // TED (British content)
  ],
  au: [
    'UCF9IOB2TExg3QIBupFtBDxg', // How to Adult (Australian)
    'UC3yBzOaQBxg6H7MRvHQ_vJg', // ABC Australia
    'UCQfwfsi5VrQ8yKZ-UWmAoBw', // ABC Australia News
  ],
  ie: [
    'UCav5aUFimRHkSwDYkRgmFqQ', // RTÉ (Irish national broadcaster)
    'UC5KO2_lmSBuBvFg03LSpZ4Q', // Irish content
  ],
  in: [
    'UCt_QcMFRNUPDGJQ8QgTnqFg', // Logical Indian
    'UCnUYZLuoy1rq1aVMwx4aTzw', // NDTV
    'UCIvaYmKn-gg3mIoFa_zV4wQ', // BYJU'S
    'UCvGEK5_U-kLgO6-AMDx2ZGg', // Ranveer Allahbadia
    'UCZFMm1mMw0F81Z37aaEzTUA', // Sandeep Maheshwari
  ],
  ca: [
    'UCZWlSUNDvCCS1hBiXV0zKcA', // CBC News
    'UCPyiXEBfQjjYaJOLBuflUSg', // CBC
  ],
  nz: [
    'UCb_ckSMzDC5Gi7Lp_FqDTAg', // RNZ (Radio New Zealand)
  ],
  za: [
    'UCqBpWK_dNzLM1SLfk1pGCyg', // SABC News
  ],
};

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    thumbnails: { medium: { url: string } };
  };
};

type YouTubeTranscriptItem = {
  offset: number;
  duration: number;
  text: string;
};

type SearchSource =
  | 'cache'
  | 'store-search'
  | 'youtube-live'
  | 'stale-cache'
  | 'none'
  | 'live-disabled';

function logSearchMetric(params: {
  phrase: string;
  accent: string;
  source: SearchSource;
  hitCount: number;
  elapsedMs: number;
  liveFallbackEnabled: boolean;
}): void {
  console.info('[search-metric]', JSON.stringify(params));
}

function normalizeForMatch(input: string): string {
  return input.toLowerCase().replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim();
}

function lineMatchesPhrase(lineText: string, phrase: string): boolean {
  const normalizedLine = normalizeForMatch(lineText);
  const normalizedPhrase = normalizeForMatch(phrase);
  if (!normalizedLine || !normalizedPhrase) return false;
  if (normalizedLine.includes(normalizedPhrase)) return true;

  const tokens = normalizedPhrase.split(' ').filter(Boolean);
  if (tokens.length <= 1) return normalizedLine.includes(normalizedPhrase);
  return tokens.every((token) => normalizedLine.includes(token));
}

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

async function searchYouTube(query: string, extraParams = ''): Promise<YouTubeSearchItem[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCaption=closedCaption&maxResults=5${extraParams}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error || !data.items) return [];
  return data.items;
}

async function searchYouTubeWithoutApiKey(query: string): Promise<YouTubeSearchItem[]> {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const html = await res.text();
    const idMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)];
    const uniqueIds = [...new Set(idMatches.map((m) => m[1]))].slice(0, 12);
    return uniqueIds.map((videoId) => ({
      id: { videoId },
      snippet: {
        title: `YouTube video ${videoId}`,
        channelTitle: 'YouTube',
        thumbnails: { medium: { url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` } },
      },
    }));
  } catch {
    return [];
  }
}

function toTranscriptLines(raw: YouTubeTranscriptItem[]): TranscriptLine[] {
  return raw.map((t) => ({
    offset: t.offset,
    duration: t.duration,
    text: t.text,
  }));
}

async function fetchAndStoreTranscript(
  videoId: string,
  accent: string | null,
  fallbackMeta: { title: string; channelTitle: string; thumbnail: string }
): Promise<TranscriptLine[] | null> {
  const accentLang = accent ? ACCENT_LANG[accent] : null;
  const preferredLangs = [accentLang, 'en'].filter(Boolean) as string[];

  const fromStore = await getTranscriptFromStore(videoId, preferredLangs);
  if (fromStore?.length) return fromStore;

  try {
    let raw: YouTubeTranscriptItem[];
    let usedLang = 'en';
    if (accentLang) {
      try {
        raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: accentLang });
        usedLang = accentLang;
      } catch {
        raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      }
    } else {
      raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    }

    const transcript = toTranscriptLines(raw);
    if (transcript.length > 0) {
      await setVideoTranscript(
        { videoId, ...fallbackMeta },
        usedLang,
        transcript
      );
    }
    return transcript;
  } catch {
    return null;
  }
}

async function searchFromSeedVideos(phrase: string, accent: string | null): Promise<Hit[]> {
  const all = await Promise.all(
    NO_KEY_SEED_VIDEOS.map(async (video) => {
      const transcript = await fetchAndStoreTranscript(video.videoId, accent, {
        title: video.title,
        channelTitle: video.channelTitle,
        thumbnail: video.thumbnail,
      });
      if (!transcript?.length) return [];

      return transcript
        .filter((line) => lineMatchesPhrase(line.text, phrase))
        .slice(0, 3)
        .map((line): Hit => ({
          videoId: video.videoId,
          title: video.title,
          channelTitle: video.channelTitle,
          thumbnail: video.thumbnail,
          startSec: Math.max(0, Math.floor(line.offset / 1000) - 1),
          text: line.text,
        }));
    })
  );

  return all.flat();
}

async function searchFromVideoItems(
  items: YouTubeSearchItem[],
  phrase: string,
  accent: string | null
): Promise<Hit[]> {
  const all = await Promise.all(
    items.map(async (item) => {
      const videoId = item.id?.videoId;
      if (!videoId) return [];
      const transcript = await fetchAndStoreTranscript(videoId, accent, {
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium.url,
      });
      if (!transcript?.length) return [];
      return transcript
        .filter((line) => lineMatchesPhrase(line.text, phrase))
        .slice(0, 3)
        .map((line): Hit => ({
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails.medium.url,
          startSec: Math.max(0, Math.floor(line.offset / 1000) - 1),
          text: line.text,
        }));
    })
  );
  return all.flat();
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const phrase = req.nextUrl.searchParams.get('phrase');
  const accent = req.nextUrl.searchParams.get('accent');
  if (!phrase) {
    return NextResponse.json({ error: 'phrase is required' }, { status: 400 });
  }
  const cached = await getSearchCache(phrase, accent ?? '', { ttlMs: 1000 * 60 * 60 * 12 });
  if (cached) {
    logSearchMetric({
      phrase,
      accent: accent ?? '',
      source: 'cache',
      hitCount: cached.hits.length,
      elapsedMs: Date.now() - startedAt,
      liveFallbackEnabled: SEARCH_LIVE_FALLBACK_ENABLED,
    });
    return NextResponse.json({ hits: cached.hits, source: 'cache' });
  }

  const fromStore = await searchHitsFromStore(phrase, accent ?? '', { perVideoLimit: 3, totalLimit: 60 });
  if (fromStore.length > 0) {
    await setSearchCache(phrase, accent ?? '', fromStore);
    logSearchMetric({
      phrase,
      accent: accent ?? '',
      source: 'store-search',
      hitCount: fromStore.length,
      elapsedMs: Date.now() - startedAt,
      liveFallbackEnabled: SEARCH_LIVE_FALLBACK_ENABLED,
    });
    return NextResponse.json({ hits: fromStore, source: 'store-search' });
  }

  if (!SEARCH_LIVE_FALLBACK_ENABLED) {
    const stale = await getSearchCache(phrase, accent ?? '', { allowStale: true });
    const source: SearchSource = stale?.hits.length ? 'stale-cache' : 'live-disabled';
    const hits = stale?.hits ?? [];
    logSearchMetric({
      phrase,
      accent: accent ?? '',
      source,
      hitCount: hits.length,
      elapsedMs: Date.now() - startedAt,
      liveFallbackEnabled: SEARCH_LIVE_FALLBACK_ENABLED,
    });
    return NextResponse.json({ hits, source });
  }

  if (!YOUTUBE_API_KEY) {
    const seeded = await searchFromSeedVideos(phrase, accent);
    const scrapedCandidates = await searchYouTubeWithoutApiKey(phrase);
    const scrapedHits = await searchFromVideoItems(scrapedCandidates, phrase, accent);
    const fallbackHits = [...seeded, ...scrapedHits];

    if (fallbackHits.length > 0) {
      await setSearchCache(phrase, accent ?? '', fallbackHits);
      logSearchMetric({
        phrase,
        accent: accent ?? '',
        source: 'store-search',
        hitCount: fallbackHits.length,
        elapsedMs: Date.now() - startedAt,
        liveFallbackEnabled: SEARCH_LIVE_FALLBACK_ENABLED,
      });
      return NextResponse.json({ hits: fallbackHits, source: 'store-search' });
    }

    const stale = await getSearchCache(phrase, accent ?? '', { allowStale: true });
    const hits = stale?.hits ?? [];
    const source: SearchSource = stale ? 'stale-cache' : 'none';
    logSearchMetric({
      phrase,
      accent: accent ?? '',
      source,
      hitCount: hits.length,
      elapsedMs: Date.now() - startedAt,
      liveFallbackEnabled: SEARCH_LIVE_FALLBACK_ENABLED,
    });
    return NextResponse.json({
      error: 'API key not set',
      hits,
      source,
    });
  }

  const regionParam = accent ? `&regionCode=${accent.toUpperCase()}` : '';
  const accentKeyword = accent ? ACCENT_KEYWORDS[accent] : null;
  const basePhrase = accentKeyword ? `"${phrase}" ${accentKeyword}` : phrase;

  // ① キーワード検索（アクセントキーワード + seedワード）
  const seeds = pickRandom(SEED_WORDS, 2);
  const keywordQueries = [basePhrase, ...seeds.map((s) => `${basePhrase} ${s}`)];

  const keywordSearches = keywordQueries.map((q) => searchYouTube(q, regionParam));

  // ② チャンネル絞り込み検索（アクセント指定時のみ）
  const channelSearches: Promise<YouTubeSearchItem[]>[] = [];
  if (accent && ACCENT_CHANNELS[accent]?.length) {
    const channels = pickRandom(ACCENT_CHANNELS[accent], 2);
    for (const channelId of channels) {
      channelSearches.push(
        searchYouTube(phrase, `&channelId=${channelId}`)
      );
    }
  }

  // 全検索を並列実行
  const allResults = await Promise.allSettled([...keywordSearches, ...channelSearches]);

  // 重複排除（チャンネル検索結果を先に追加して優先）
  const seen = new Set<string>();
  const allItems: YouTubeSearchItem[] = [];

  // チャンネル検索結果を優先（末尾に入れたものを先に処理）
  const channelOffset = keywordSearches.length;
  const ordered = [
    ...allResults.slice(channelOffset),   // チャンネル検索を先に
    ...allResults.slice(0, channelOffset), // キーワード検索を後に
  ];

  for (const result of ordered) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      const videoId = item.id?.videoId;
      if (videoId && !seen.has(videoId)) {
        seen.add(videoId);
        allItems.push(item);
      }
    }
  }

  const shuffledItems = shuffle(allItems);

  // 各動画の字幕からフレーズのタイムスタンプを探す
  const results = await Promise.allSettled(
    shuffledItems.map(async (item) => {
      const videoId = item.id?.videoId;
      if (!videoId) return null;
      const transcript = await fetchAndStoreTranscript(videoId, accent, {
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.medium.url,
      });
      if (!transcript) return null;

        const matches = transcript
          .filter((t) => lineMatchesPhrase(t.text, phrase))
          .slice(0, 3);

        if (matches.length === 0) return null;

        return matches.map((match): Hit => ({
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails.medium.url,
          startSec: Math.max(0, Math.floor(match.offset / 1000) - 1),
          text: match.text,
        }));
    })
  );

  const hits = results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .flatMap((r) => (r as PromiseFulfilledResult<Hit[]>).value);

  if (hits.length > 0) {
    await setSearchCache(phrase, accent ?? '', hits);
    for (const hit of hits) {
      await upsertIngestJob({
        videoId: hit.videoId,
        lang: accent ? ACCENT_LANG[accent] ?? 'en' : 'en',
        status: 'pending',
      });
    }
  } else {
    const stale = await getSearchCache(phrase, accent ?? '', { allowStale: true });
    if (stale?.hits.length) {
      logSearchMetric({
        phrase,
        accent: accent ?? '',
        source: 'stale-cache',
        hitCount: stale.hits.length,
        elapsedMs: Date.now() - startedAt,
        liveFallbackEnabled: SEARCH_LIVE_FALLBACK_ENABLED,
      });
      return NextResponse.json({ hits: stale.hits, source: 'stale-cache' });
    }
  }

  logSearchMetric({
    phrase,
    accent: accent ?? '',
    source: 'youtube-live',
    hitCount: hits.length,
    elapsedMs: Date.now() - startedAt,
    liveFallbackEnabled: SEARCH_LIVE_FALLBACK_ENABLED,
  });
  return NextResponse.json({ hits, source: 'youtube-live' });
}
