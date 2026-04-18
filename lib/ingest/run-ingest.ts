import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { listDueIngestJobs, setVideoTranscript, upsertIngestJob } from '@/lib/store/file-store';
import type { TranscriptLine } from '@/lib/store/types';

function backoffMs(attempt: number): number {
  const base = 30_000;
  const capped = Math.min(base * 2 ** Math.max(0, attempt - 1), 1000 * 60 * 60);
  const jitter = Math.floor(Math.random() * 5_000);
  return capped + jitter;
}

export type IngestResult = {
  processed: number;
  results: Array<{ id: string; status: string; message: string }>;
};

export async function runIngest(limit: number): Promise<IngestResult> {
  const jobs = await listDueIngestJobs(limit);
  const results: Array<{ id: string; status: string; message: string }> = [];

  for (const job of jobs) {
    try {
      const raw = await YoutubeTranscript.fetchTranscript(job.videoId, { lang: job.lang });
      const transcript: TranscriptLine[] = raw.map((t: { offset: number; duration: number; text: string }) => ({
        offset: t.offset,
        duration: t.duration,
        text: t.text,
      }));

      if (transcript.length === 0) {
        throw new Error('empty transcript');
      }

      await setVideoTranscript(
        { videoId: job.videoId, title: '', channelTitle: '', thumbnail: '' },
        job.lang,
        transcript
      );
      await upsertIngestJob({
        videoId: job.videoId,
        lang: job.lang,
        status: 'done',
        lastError: '',
      });
      results.push({ id: job.id, status: 'done', message: `stored ${transcript.length} segments` });
    } catch (error) {
      const nextAttempt = job.attempt + 1;
      const waitMs = backoffMs(nextAttempt);
      const message = error instanceof Error ? error.message : 'unknown error';
      await upsertIngestJob({
        videoId: job.videoId,
        lang: job.lang,
        status: nextAttempt >= 6 ? 'failed' : 'retry',
        attemptDelta: 1,
        nextRetryAt: Date.now() + waitMs,
        lastError: message,
      });
      results.push({ id: job.id, status: nextAttempt >= 6 ? 'failed' : 'retry', message });
    }
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.info(
    '[ingest-metric]',
    JSON.stringify({ limit, processed: results.length, queued: jobs.length, summary })
  );

  return { processed: results.length, results };
}
