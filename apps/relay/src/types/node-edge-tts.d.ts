// The free optional Edge Read Aloud client is installed by the root prebuild
// script. These declarations allow static typechecking before prebuild, too.
declare module 'node-edge-tts' {
  export interface EdgeTTSOptions {
    voice?: string;
    lang?: string;
    outputFormat?: string;
    saveSubtitles?: boolean;
    rate?: string;
    pitch?: string;
    volume?: string;
    timeout?: number;
  }
  export class EdgeTTS {
    constructor(options?: EdgeTTSOptions);
    streamAudio(text: string): AsyncGenerator<Buffer | { part: string; start: number; end: number }>;
  }
}
