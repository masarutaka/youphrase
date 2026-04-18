declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  export class YoutubeTranscript {
    static fetchTranscript(
      videoId: string,
      options?: { lang?: string }
    ): Promise<Array<{ text: string; duration: number; offset: number }>>;
  }
}
