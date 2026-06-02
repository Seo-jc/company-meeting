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
  platform: process.platform,
});
