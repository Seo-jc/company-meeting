import { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell } from 'electron';
import { join } from 'path';
import { autoUpdater } from 'electron-updater';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

type UpdateStatus =
  | { kind: 'available'; version: string }
  | { kind: 'progress'; percent: number; version: string; transferred: number; total: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

function sendUpdateStatus(status: UpdateStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', status);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    title: '사내 미팅 프로그램',
    icon: join(__dirname, isDev ? '../public/icon.png' : '../dist/icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }
}

let pendingDownloadedVersion: string | null = null;

function setupAutoUpdater(): void {
  if (isDev) {
    console.log('[updater] dev mode, skipping auto-update');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    sendUpdateStatus({ kind: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
  });

  autoUpdater.on('error', (err) => {
    const message = err?.message ?? String(err);
    console.error('[updater] error:', message);
    sendUpdateStatus({ kind: 'error', message });
  });

  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] download progress: ${Math.round(p.percent)}%`);
    sendUpdateStatus({
      kind: 'progress',
      percent: p.percent,
      version: '',
      transferred: p.transferred,
      total: p.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded:', info.version);
    pendingDownloadedVersion = info.version;
    sendUpdateStatus({ kind: 'downloaded', version: info.version });
  });

  // Check 3 seconds after launch so the window is fully loaded first
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err?.message ?? err);
    });
  }, 3000);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'display-capture', 'audioCapture'];
    callback(allowed.includes(permission));
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        if (sources.length === 0) {
          callback({});
          return;
        }
        callback({ video: sources[0] });
      });
    },
    { useSystemPicker: true }
  );

  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('open-mic-settings', async () => {
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:privacy-microphone');
  } else if (process.platform === 'darwin') {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    );
  } else {
    await shell.openExternal('https://support.google.com/chrome/answer/2693767');
  }
});

ipcMain.handle('apply-update', async () => {
  if (!pendingDownloadedVersion) {
    console.warn('[updater] apply-update called but no pending download');
    return;
  }
  console.log('[updater] quitAndInstall for v' + pendingDownloadedVersion);
  // Defer slightly so the IPC reply is returned to the renderer before quit.
  setTimeout(() => autoUpdater.quitAndInstall(), 200);
});
