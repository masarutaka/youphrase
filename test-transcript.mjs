import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';

// テスト用: TED Talk の動画ID
const videoId = 'arj7oStGLkU';

console.log('字幕を取得中...');

try {
  const transcript = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
  console.log('取得成功！最初の5件:');
  transcript.slice(0, 5).forEach(item => {
    console.log(`[${Math.floor(item.offset / 1000)}秒] ${item.text}`);
  });
} catch (e) {
  console.error('エラー:', e.message);
}
