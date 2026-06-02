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
      platform: string;
    };
  }
}

export {};
