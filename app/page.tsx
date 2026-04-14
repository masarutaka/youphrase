'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import YoutubePlayer, { YoutubePlayerHandle } from './components/YoutubePlayer';

type Hit = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  startSec: number;
  text: string;
};

type VideoGroup = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  hits: Hit[];
};

const HISTORY_KEY = 'yp_search_history';
const VOCAB_KEY = 'yp_vocab';
const SESSION_KEY = 'yp_last_session';
const MAX_HISTORY = 30;

type VocabEntry = {
  phrase: string;
  savedAt: string;
  video: {
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnail: string;
    startSec: number;
    text: string;
  };
};

export default function Home() {
  const [phrase, setPhrase] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const [accent, setAccent] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [showVocab, setShowVocab] = useState(false);

  // 動画グループ単位のナビゲーション
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [activeOccurrence, setActiveOccurrence] = useState(0);

  type TranscriptState = { line: { text: string } | null; wordIndex: number; loading: boolean };
  const [transcriptState, setTranscriptState] = useState<TranscriptState>({ line: null, wordIndex: 0, loading: true });
  const [speed, setSpeed] = useState(1);
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

  const inputRef = useRef<HTMLInputElement>(null);
  const playerHandleRef = useRef<YoutubePlayerHandle>(null);

  const ACCENTS = [
    { value: '',   label: '🌐 All' },
    { value: 'us', label: '🇺🇸 American' },
    { value: 'gb', label: '🇬🇧 British' },
    { value: 'au', label: '🇦🇺 Australian' },
    { value: 'ie', label: '🇮🇪 Irish' },
    { value: 'in', label: '🇮🇳 Indian' },
    { value: 'ca', label: '🇨🇦 Canadian' },
    { value: 'nz', label: '🇳🇿 New Zealand' },
    { value: 'za', label: '🇿🇦 South African' },
  ];

  // hitsを動画単位でグループ化
  const groups: VideoGroup[] = useMemo(() => {
    const map = new Map<string, VideoGroup>();
    for (const hit of hits) {
      if (!map.has(hit.videoId)) {
        map.set(hit.videoId, {
          videoId: hit.videoId,
          title: hit.title,
          channelTitle: hit.channelTitle,
          thumbnail: hit.thumbnail,
          hits: [],
        });
      }
      map.get(hit.videoId)!.hits.push(hit);
    }
    return Array.from(map.values());
  }, [hits]);

  const activeGroup = groups[activeGroupIndex] ?? null;
  const activeHit = activeGroup?.hits[activeOccurrence] ?? null;

  useEffect(() => {
    const saved = localStorage.getItem(HISTORY_KEY);
    if (saved) setHistory(JSON.parse(saved));
    const savedVocab = localStorage.getItem(VOCAB_KEY);
    if (savedVocab) {
      try {
        const parsed = JSON.parse(savedVocab);
        // 旧フォーマット（string[]）は無視して削除
        if (Array.isArray(parsed) && (parsed.length === 0 || typeof parsed[0] === 'object')) {
          setVocab(parsed);
        } else {
          localStorage.removeItem(VOCAB_KEY);
        }
      } catch {
        localStorage.removeItem(VOCAB_KEY);
      }
    }
  }, []);

  const saveToHistory = (word: string) => {
    const updated = [word, ...history.filter((h) => h !== word)].slice(0, MAX_HISTORY);
    setHistory(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  const deleteFromHistory = (word: string) => {
    const updated = history.filter((h) => h !== word);
    setHistory(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  const isInVocab = vocab.some((v) => v.phrase === searched && v.video.videoId === activeHit?.videoId && v.video.startSec === activeHit?.startSec);

  const toggleVocab = () => {
    if (!activeHit) return;
    const updated = isInVocab
      ? vocab.filter((v) => !(v.phrase === searched && v.video.videoId === activeHit.videoId && v.video.startSec === activeHit.startSec))
      : [{ phrase: searched, savedAt: new Date().toISOString(), video: activeHit }, ...vocab];
    setVocab(updated);
    localStorage.setItem(VOCAB_KEY, JSON.stringify(updated));
  };

  const deleteFromVocab = (index: number) => {
    const updated = vocab.filter((_, i) => i !== index);
    setVocab(updated);
    localStorage.setItem(VOCAB_KEY, JSON.stringify(updated));
  };

  const playVocabEntry = (entry: VocabEntry) => {
    setSearched(entry.phrase);
    setPhrase(entry.phrase);
    setHits([entry.video]);
    setActiveGroupIndex(0);
    setActiveOccurrence(0);
    setShowVocab(false);
  };

  const search = useCallback(async (target = phrase, accentOverride = accent) => {
    if (!target.trim()) return;
    setPhrase(target);
    setShowHistory(false);
    setShowVocab(false);
    setLoading(true);
    setHits([]);
    setActiveGroupIndex(0);
    setActiveOccurrence(0);
    setSearched(target);
    saveToHistory(target.trim());

    const accentParam = accentOverride ? `&accent=${accentOverride}` : '';
    const res = await fetch(`/api/search?phrase=${encodeURIComponent(target)}${accentParam}`);
    const data = await res.json();
    if (data.error) {
      console.error('API error:', data.error);
      alert(`検索エラー: ${data.error}`);
    }
    const newHits: Hit[] = data.hits ?? [];
    setHits(newHits);
    setLoading(false);
  }, [phrase, accent]);

  // hits / activeGroup が変わるたびにURL & localStorage を更新
  useEffect(() => {
    if (!searched || hits.length === 0) return;
    const currentHit = groups[activeGroupIndex]?.hits[activeOccurrence];
    if (!currentHit) return;

    // URL を更新
    const params = new URLSearchParams();
    params.set('phrase', searched);
    if (accent) params.set('accent', accent);
    params.set('v', currentHit.videoId);
    params.set('t', String(currentHit.startSec));
    window.history.replaceState(null, '', `?${params.toString()}`);

    // localStorage を更新
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      phrase: searched,
      accent,
      hits,
      activeGroupIndex,
      activeOccurrence,
    }));
  }, [searched, accent, hits, activeGroupIndex, activeOccurrence]);

  // ページロード時の復元
  useEffect(() => {
    // ① localStorage にデータがあれば常にそこから復元（再検索しない）
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.hits?.length > 0) {
          const params = new URLSearchParams(window.location.search);
          const urlVideoId = params.get('v') ?? '';
          const urlStartSec = parseInt(params.get('t') ?? '0', 10);

          setHits(s.hits);
          setSearched(s.phrase ?? '');
          setPhrase(s.phrase ?? '');
          setAccent(s.accent ?? '');

          // URL の v= に合わせてアクティブ動画を特定
          if (urlVideoId) {
            const savedHits: Hit[] = s.hits;
            const uniqueIds = [...new Set(savedHits.map((h: Hit) => h.videoId))];
            const gIdx = Math.max(0, uniqueIds.indexOf(urlVideoId));
            const hitsOfGroup = savedHits.filter((h: Hit) => h.videoId === urlVideoId);
            const oIdx = Math.max(0, hitsOfGroup.findIndex(
              (h: Hit) => Math.abs(h.startSec - urlStartSec) < 3
            ));
            setActiveGroupIndex(gIdx);
            setActiveOccurrence(oIdx);
          } else {
            setActiveGroupIndex(s.activeGroupIndex ?? 0);
            setActiveOccurrence(s.activeOccurrence ?? 0);
          }
          return;
        }
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }

    // ② localStorage がない → URLのフレーズで検索（初回のみ）
    const params = new URLSearchParams(window.location.search);
    const urlPhrase = params.get('phrase') ?? '';
    const urlAccent = params.get('accent') ?? '';
    if (urlPhrase) {
      setAccent(urlAccent);
      search(urlPhrase, urlAccent);
    }
  }, []);

  const selectGroup = (index: number, occurrence = 0) => {
    setActiveGroupIndex(index);
    setActiveOccurrence(occurrence);
    setSpeed(1);
    // URL & localStorage は useEffect が自動更新するので不要
  };

  const filteredHistory = phrase.trim()
    ? history.filter((h) => h.toLowerCase().includes(phrase.toLowerCase()))
    : history;

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <h1
          className="text-xl font-bold text-red-500 cursor-pointer hover:text-red-400 transition"
          onClick={() => { setHits([]); setActiveGroupIndex(0); setActiveOccurrence(0); setSearched(''); setPhrase(''); setShowVocab(false); localStorage.removeItem(SESSION_KEY); window.history.replaceState(null, '', '/'); }}
        >YouPhrase</h1>
        <select
          value={accent}
          onChange={(e) => { setAccent(e.target.value); }}
          className="bg-gray-800 text-white text-sm rounded px-3 py-2 outline-none focus:ring-2 focus:ring-red-500 cursor-pointer"
        >
          {ACCENTS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
        <div className="relative flex flex-1 max-w-xl gap-2">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              className="w-full bg-gray-800 rounded px-4 py-2 text-white outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Search a phrase... (e.g. look up)"
              value={phrase}
              onChange={(e) => { setPhrase(e.target.value); setShowHistory(true); }}
              onFocus={() => setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 150)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
            {showHistory && filteredHistory.length > 0 && (
              <ul className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg z-50 max-h-64 overflow-y-auto">
                {filteredHistory.map((h) => (
                  <li
                    key={h}
                    className="flex items-center justify-between px-4 py-2 hover:bg-gray-700 cursor-pointer group"
                    onMouseDown={() => search(h)}
                  >
                    <span className="text-sm text-white">{h}</span>
                    <button
                      onMouseDown={(e) => { e.stopPropagation(); deleteFromHistory(h); }}
                      className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs px-1"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            onClick={() => search()}
            disabled={loading}
            className="bg-red-600 hover:bg-red-700 disabled:opacity-50 px-5 py-2 rounded font-semibold flex items-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Searching...
              </>
            ) : 'Search'}
          </button>
        </div>

        {/* 単語帳ボタン */}
        <div className="flex items-center gap-2 ml-auto">
          {searched && (
            <button
              onClick={toggleVocab}
              title={isInVocab ? '単語帳から削除' : '単語帳に追加'}
              className={`text-xl transition ${isInVocab ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-500 hover:text-yellow-400'}`}
            >
              {isInVocab ? '★' : '☆'}
            </button>
          )}
          <button
            onClick={() => setShowVocab(!showVocab)}
            className={`flex items-center gap-1 px-3 py-2 rounded text-sm transition ${showVocab ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            📖 単語帳 {vocab.length > 0 && <span className="bg-red-500 text-white text-xs px-1.5 rounded-full">{vocab.length}</span>}
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex h-[calc(100vh-65px)]">

        {/* 単語帳パネル */}
        {showVocab && (
          <div className="w-64 border-r border-gray-800 bg-gray-900 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <span className="text-sm font-semibold text-yellow-400">★ 単語帳 ({vocab.length})</span>
              <button onClick={() => setShowVocab(false)} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>
            {vocab.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">☆ を押して単語と動画を保存</p>
            ) : (
              <ul className="flex-1 overflow-y-auto">
                {vocab.map((entry, i) => (
                  <li
                    key={i}
                    className="group cursor-pointer hover:bg-gray-800 border-b border-gray-800 transition"
                    onClick={() => playVocabEntry(entry)}
                  >
                    <div className="flex gap-3 px-3 py-3">
                      <div className="relative flex-shrink-0">
                        <img
                          src={entry.video.thumbnail}
                          alt={entry.video.title}
                          className="w-20 h-12 object-cover rounded"
                        />
                        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/50 rounded text-white text-lg">▶</span>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <span className="inline-block text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded mb-1">
                          {entry.phrase}
                        </span>
                        <p className="text-xs text-white line-clamp-1 leading-tight">{entry.video.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{entry.video.channelTitle}</p>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteFromVocab(i); }}
                        className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs self-start mt-1"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Player */}
        <div className="flex-1 flex flex-col items-center bg-black overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center gap-4 justify-center flex-1">
              <span className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">検索中...</p>
            </div>
          ) : activeHit ? (
            <div className="w-full max-w-3xl flex flex-col">
              <YoutubePlayer
                key={`${activeHit.videoId}-${activeHit.startSec}`}
                ref={playerHandleRef}
                videoId={activeHit.videoId}
                startSec={activeHit.startSec}
                onTranscript={setTranscriptState}
              />

              {/* ── YouGlish風 統合コントローラー ── */}
              <div className="flex justify-center py-3 bg-gray-950">
              <div className="flex items-center gap-1 bg-gray-800 rounded-full px-2 py-1.5">

                {/* Prev */}
                <button
                  type="button"
                  onClick={() => selectGroup(activeGroupIndex - 1)}
                  disabled={activeGroupIndex <= 0}
                  className="flex items-center gap-1 px-4 py-1.5 rounded-full text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-30 transition"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"/></svg>
                  PREV
                </button>

                {/* カウンター */}
                <span className="px-3 text-sm font-bold text-white tabular-nums">
                  {activeGroupIndex + 1} / {groups.length}
                </span>

                {/* Next */}
                <button
                  type="button"
                  onClick={() => selectGroup(activeGroupIndex + 1)}
                  disabled={activeGroupIndex >= groups.length - 1}
                  className="flex items-center gap-1 px-4 py-1.5 rounded-full text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-30 transition"
                >
                  NEXT
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"/></svg>
                </button>

                {/* 同一動画内の複数箇所（2件以上の時のみ） */}
                {activeGroup.hits.length > 1 && (
                  <>
                    <div className="w-px h-5 bg-gray-600 mx-1" />
                    <button
                      type="button"
                      onClick={() => setActiveOccurrence(activeOccurrence - 1)}
                      disabled={activeOccurrence <= 0}
                      className="w-7 h-7 rounded-full text-white hover:bg-gray-700 disabled:opacity-30 transition flex items-center justify-center text-base"
                    >‹</button>
                    <span className="text-xs text-gray-400 tabular-nums px-1">
                      {activeOccurrence + 1}/{activeGroup.hits.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveOccurrence(activeOccurrence + 1)}
                      disabled={activeOccurrence >= activeGroup.hits.length - 1}
                      className="w-7 h-7 rounded-full text-white hover:bg-gray-700 disabled:opacity-30 transition flex items-center justify-center text-base"
                    >›</button>
                  </>
                )}

                {/* リスタートボタン */}
                <div className="w-px h-5 bg-gray-600 mx-1" />
                <button
                  type="button"
                  onClick={() => playerHandleRef.current?.seekTo(activeHit.startSec)}
                  title="リスタート"
                  className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-500 active:scale-95 transition flex items-center justify-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-5 h-5">
                    <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                  </svg>
                </button>

                {/* 速度ボタン */}
                <div className="w-px h-5 bg-gray-600 mx-1" />
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setSpeed(s); playerHandleRef.current?.setSpeed(s); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${s === speed ? 'bg-white text-gray-900' : 'text-gray-300 hover:bg-gray-700'}`}
                  >
                    {s === 1 ? '1×' : `${s}×`}
                  </button>
                ))}
              </div>
              </div>

              {/* 字幕エリア */}
              <div className="w-full min-h-[3.5rem] flex items-center justify-center px-6 py-3 bg-gray-900">
                {transcriptState.loading ? (
                  <p className="text-gray-600 text-sm">字幕を読み込み中...</p>
                ) : transcriptState.line ? (
                  <p className="text-center text-lg leading-relaxed">
                    {transcriptState.line.text.trim().split(/\s+/).map((word, i) => (
                      <span key={i} className={i === transcriptState.wordIndex ? 'text-yellow-400 font-bold transition-colors duration-75' : 'text-gray-300'}>
                        {word}{i < transcriptState.line!.text.trim().split(/\s+/).length - 1 ? ' ' : ''}
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="text-gray-600 text-sm">―</p>
                )}
              </div>

            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-500 text-lg">フレーズを入力して検索してください</p>
            </div>
          )}
        </div>

        {/* Sidebar: 動画単位で表示 */}
        {groups.length > 0 && (
          <div className="w-72 border-l border-gray-800 overflow-y-auto">
            <p className="px-4 py-3 text-sm text-gray-400">
              「{searched}」{groups.length}動画
            </p>
            {groups.map((group, i) => (
              <div
                key={group.videoId}
                onClick={() => selectGroup(i)}
                className={`flex gap-3 px-4 py-3 cursor-pointer hover:bg-gray-800 transition ${
                  i === activeGroupIndex ? 'bg-gray-800 border-l-2 border-red-500' : ''
                }`}
              >
                <div className="relative flex-shrink-0">
                  <img
                    src={group.thumbnail}
                    alt={group.title}
                    className="w-24 h-14 object-cover rounded"
                  />
                  {group.hits.length > 1 && (
                    <span className="absolute bottom-1 right-1 bg-red-600 text-white text-xs px-1 rounded">
                      ×{group.hits.length}
                    </span>
                  )}
                </div>
                <div className="overflow-hidden">
                  <p className="text-xs text-white line-clamp-2 leading-tight">{group.title}</p>
                  <p className="text-xs text-gray-400 mt-1">{group.channelTitle}</p>
                  <p className="text-xs text-yellow-400 mt-1 truncate">
                    "{group.hits[0].text}"
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
