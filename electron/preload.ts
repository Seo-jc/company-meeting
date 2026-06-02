import { contextBridge, ipcRenderer } from 'electron';

export type ScreenSource = {
  id: string;
  name: string;
  thumbnail: string;
};

contextBridge.exposeInMainWorld('electronAPI', {
  getScreenSources: (): Promise<ScreenSource[]> =>
    ipcRenderer.invoke('get-screen-sources'),
  platform: process.platform,
});
