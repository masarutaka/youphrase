import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from '../../../node_modules/youtube-transcript/dist/youtube-transcript.esm.js';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

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

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

async function searchYouTube(query: string, extraParams = ''): Promise<any[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCaption=closedCaption&maxResults=5${extraParams}&key=${YOUTUBE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error || !data.items) return [];
  return data.items;
}

export async function GET(req: NextRequest) {
  const phrase = req.nextUrl.searchParams.get('phrase');
  const accent = req.nextUrl.searchParams.get('accent');
  if (!phrase) {
    return NextResponse.json({ error: 'phrase is required' }, { status: 400 });
  }

  const regionParam = accent ? `&regionCode=${accent.toUpperCase()}` : '';
  const accentKeyword = accent ? ACCENT_KEYWORDS[accent] : null;
  const basePhrase = accentKeyword ? `"${phrase}" ${accentKeyword}` : phrase;

  // ① キーワード検索（アクセントキーワード + seedワード）
  const seeds = pickRandom(SEED_WORDS, 2);
  const keywordQueries = [basePhrase, ...seeds.map((s) => `${basePhrase} ${s}`)];

  const keywordSearches = keywordQueries.map((q) => searchYouTube(q, regionParam));

  // ② チャンネル絞り込み検索（アクセント指定時のみ）
  const channelSearches: Promise<any[]>[] = [];
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
  const allItems: any[] = [];

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
    shuffledItems.map(async (item: any) => {
      const videoId = item.id.videoId;
      try {
        // ③ アクセント指定時はその言語バリアントで字幕取得を試みる
        //    失敗したら汎用 'en' にフォールバック
        let transcript;
        const accentLang = accent ? ACCENT_LANG[accent] : null;
        if (accentLang) {
          try {
            transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: accentLang });
          } catch {
            transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
          }
        } else {
          transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
        }
        const lowerPhrase = phrase.toLowerCase();

        const matches = transcript
          .filter((t: any) => t.text.toLowerCase().includes(lowerPhrase))
          .slice(0, 3);

        if (matches.length === 0) return null;

        return matches.map((match: any) => ({
          videoId,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails.medium.url,
          startSec: Math.max(0, Math.floor(match.offset / 1000) - 1),
          text: match.text,
        }));
      } catch {
        return null;
      }
    })
  );

  const hits = results
    .filter((r) => r.status === 'fulfilled' && r.value !== null)
    .flatMap((r) => (r as PromiseFulfilledResult<any>).value);

  return NextResponse.json({ hits });
}
