import { NextRequest, NextResponse } from 'next/server';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { getTranscriptFromStore, setVideoTranscript } from '@/lib/store/file-store';
import type { TranscriptLine } from '@/lib/store/types';

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get('videoId');
  if (!videoId) {
    return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  }

  const cached = await getTranscriptFromStore(videoId, ['en']);
  if (cached) {
    return NextResponse.json({ transcript: cached, source: 'cache' });
  }

  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    const transcript: TranscriptLine[] = raw.map((t: { offset: number; duration: number; text: string }) => ({
      offset: t.offset,       // ms
      duration: t.duration,   // ms
      text: t.text,
    }));
    if (transcript.length > 0) {
      await setVideoTranscript(
        { videoId, title: '', channelTitle: '', thumbnail: '' },
        'en',
        transcript
      );
    }
    return NextResponse.json({ transcript, source: 'youtube-live' });
  } catch {
    return NextResponse.json({ transcript: [] });
  }
}
