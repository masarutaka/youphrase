'use client';

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';

type TranscriptLine = {
  offset: number;
  duration: number;
  text: string;
};

type TranscriptState = {
  line: TranscriptLine | null;
  wordIndex: number;
  loading: boolean;
};

type Props = {
  videoId: string;
  startSec: number;
  onTranscript?: (state: TranscriptState) => void;
};

export type YoutubePlayerHandle = {
  seekTo: (sec: number) => void;
  setSpeed: (rate: number) => void;
};

function loadYouTubeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if ((window as any).YT?.Player) { resolve(); return; }
    const prev = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    if (!document.getElementById('yt-iframe-api')) {
      const script = document.createElement('script');
      script.id = 'yt-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    }
  });
}

const YoutubePlayer = forwardRef<YoutubePlayerHandle, Props>(({ videoId, startSec, onTranscript }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [currentLine, setCurrentLine] = useState<TranscriptLine | null>(null);
  const [wordIndex, setWordIndex] = useState(0);
  const [loadingTranscript, setLoadingTranscript] = useState(true);

  // 親から seekTo を呼べるように公開
  useImperativeHandle(ref, () => ({
    seekTo: (sec: number) => {
      try { playerRef.current?.seekTo(sec, true); } catch {}
    },
    setSpeed: (rate: number) => {
      try { playerRef.current?.setPlaybackRate(rate); } catch {}
    },
  }));

  // 字幕を取得
  useEffect(() => {
    setLoadingTranscript(true);
    setTranscript([]);
    setCurrentLine(null);
    onTranscript?.({ line: null, wordIndex: 0, loading: true });
    fetch(`/api/transcript?videoId=${videoId}`)
      .then((r) => r.json())
      .then((data) => setTranscript(data.transcript ?? []))
      .finally(() => setLoadingTranscript(false));
  }, [videoId]);

  // YouTubeプレイヤーを初期化
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let destroyed = false;

    loadYouTubeAPI().then(() => {
      if (destroyed || !container) return;
      playerRef.current = new (window as any).YT.Player(container, {
        videoId,
        playerVars: { start: startSec, autoplay: 1, rel: 0, playsinline: 1, mute: 1 },
        events: {
          onReady: (e: any) => {
            e.target.mute();
            e.target.seekTo(startSec, true);
            e.target.playVideo();
            setTimeout(() => {
              e.target.unMute();
              e.target.setVolume(100);
            }, 250);
          },
        },
      });
    });

    return () => {
      destroyed = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId, startSec]);

  // 再生時間に合わせて字幕を同期
  useEffect(() => {
    if (transcript.length === 0) return;
    intervalRef.current = setInterval(() => {
      if (!playerRef.current?.getCurrentTime) return;
      const currentMs = playerRef.current.getCurrentTime() * 1000;
      const line = transcript.find(
        (t) => currentMs >= t.offset && currentMs < t.offset + t.duration
      ) ?? null;
      setCurrentLine(line);
      let wi = 0;
      if (line) {
        const elapsed = currentMs - line.offset;
        const words = line.text.trim().split(/\s+/);
        const msPerWord = line.duration / words.length;
        wi = Math.min(Math.floor(elapsed / msPerWord), words.length - 1);
        setWordIndex(wi);
      }
      onTranscript?.({ line, wordIndex: wi, loading: false });
    }, 100);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [transcript]);

  return (
    <div className="w-full aspect-video bg-black">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
});

YoutubePlayer.displayName = 'YoutubePlayer';
export default YoutubePlayer;
