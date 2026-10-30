/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
  readonly VITE_SUMMARY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*?url' {
  const src: string;
  export default src;
}

declare module '*.xls?url' {
  const src: string;
  export default src;
}

declare global {
  const __APP_VERSION__: string;
  interface Window {
    electronAPI?: {
      getScreenSources: () => Promise<
        Array<{ id: string; name: string; thumbnail: string }>
      >;
      openMicSettings: () => Promise<void>;
      applyUpdate: () => Promise<void>;
      onUpdateStatus: (
        callback: (
          status:
            | { kind: 'available'; version: string }
            | {
                kind: 'progress';
                percent: number;
                version: string;
                transferred: number;
                total: number;
              }
            | { kind: 'downloaded'; version: string }
            | { kind: 'error'; message: string }
        ) => void
      ) => () => void;
      getDefaultRecordingFolder: () => Promise<string>;
      chooseRecordingFolder: (currentDir?: string) => Promise<string | null>;
      startRecording: (
        dir: string,
        fileName: string
      ) => Promise<
        | { ok: true; filePath: string }
        | { ok: false; error: 'permission' | 'unknown'; message: string }
      >;
      appendRecordingChunk: (
        chunk: ArrayBuffer
      ) => Promise<{ ok: true } | { ok: false; message: string }>;
      stopRecording: () => Promise<
        { ok: true; filePath: string } | { ok: false; message: string }
      >;
      openRecordingFolder: (filePath: string) => Promise<void>;
      // 회의록 엑셀 저장 (electron/preload.ts · 계약 C). 폴더 고르기·폴더 열기는 위의 recording 함수를 같이 쓴다.
      getDefaultMinutesFolder: () => Promise<string>;
      saveMinutes: (req: {
        dir: string;
        doc: import('./lib/minutes/types').MinutesExport;
      }) => Promise<import('./lib/minutes/types').MinutesSaveResult>;
      openMinutesFile: (filePath: string) => Promise<void>;
      platform: string;
    };
  }
}

export {};
