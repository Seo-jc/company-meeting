import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

export type ScreenSource = {
  id: string;
  name: string;
  thumbnail: string;
};

export type UpdateStatus =
  | { kind: 'available'; version: string }
  | { kind: 'progress'; percent: number; version: string; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

export type RecordingStartResult =
  | { ok: true; filePath: string }
  | { ok: false; error: 'permission' | 'unknown'; message: string };

export type RecordingChunkResult = { ok: true } | { ok: false; message: string };

export type RecordingStopResult =
  | { ok: true; filePath: string }
  | { ok: false; message: string };

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: (): Promise<ScreenSource[]> =>
    ipcRenderer.invoke('get-screen-sources'),
  openMicSettings: (): Promise<void> =>
    ipcRenderer.invoke('open-mic-settings'),
  applyUpdate: (): Promise<void> =>
    ipcRenderer.invoke('apply-update'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },
  getDefaultRecordingFolder: (): Promise<string> =>
    ipcRenderer.invoke('recording-get-default-folder'),
  chooseRecordingFolder: (currentDir?: string): Promise<string | null> =>
    ipcRenderer.invoke('recording-choose-folder', currentDir),
  startRecording: (dir: string, fileName: string): Promise<RecordingStartResult> =>
    ipcRenderer.invoke('recording-start', { dir, fileName }),
  appendRecordingChunk: (chunk: ArrayBuffer): Promise<RecordingChunkResult> =>
    ipcRenderer.invoke('recording-chunk', chunk),
  stopRecording: (): Promise<RecordingStopResult> =>
    ipcRenderer.invoke('recording-stop'),
  openRecordingFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('recording-open-folder', filePath),
  platform: process.platform,
});
