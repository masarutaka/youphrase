import { readFileSync } from 'fs';

// .env.local からAPIキーを読み込む
const env = readFileSync('.env.local', 'utf-8');
const apiKey = env.match(/YOUTUBE_API_KEY=(.+)/)[1].trim();

const phrase = 'look up';
const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(phrase)}&type=video&videoCaption=closedCaption&maxResults=5&key=${apiKey}`;

console.log(`「${phrase}」で動画検索中...`);

const res = await fetch(url);
const data = await res.json();

if (data.error) {
  console.error('エラー:', data.error.message);
} else {
  console.log(`${data.items.length}件取得:`);
  data.items.forEach(item => {
    console.log(`- [${item.id.videoId}] ${item.snippet.title}`);
  });
}
