import { NextRequest, NextResponse } from 'next/server';
// @ts-ignore
import { YoutubeTranscript } from '../../../node_modules/youtube-transcript/dist/youtube-transcript.esm.js';

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get('videoId');
  if (!videoId) {
    return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  }

  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
    const transcript = raw.map((t: any) => ({
      offset: t.offset,       // ms
      duration: t.duration,   // ms
      text: t.text,
    }));
    return NextResponse.json({ transcript });
  } catch {
    return NextResponse.json({ transcript: [] });
  }
}
