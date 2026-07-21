import { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, shell } from 'electron';
import { join } from 'path';
import { promises as fsp } from 'fs';
import * as os from 'os';
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
    title: 'PikMeeting',
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

/**
 * Compare two SemVer strings. Returns >0 if a>b, <0 if a<b, 0 if equal.
 * Only handles "x.y.z" format (no pre-release tags).
 */
function compareVersions(a: string, b: string): number {
  const ap = a.split('.').map((n) => parseInt(n, 10) || 0);
  const bp = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((ap[i] ?? 0) > (bp[i] ?? 0)) return 1;
    if ((ap[i] ?? 0) < (bp[i] ?? 0)) return -1;
  }
  return 0;
}

/**
 * Clean up update files left by electron-updater after a successful install.
 * Files in the pending/ folder with version <= current app version are stale
 * and can be safely deleted to free disk space (~80MB per file).
 *
 * Cache locations vary by app.name; we try both common candidates.
 */
async function cleanupOldUpdateFiles(): Promise<void> {
  if (process.platform !== 'win32') return;
  const localAppData =
    process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    join(localAppData, `${app.name}-updater`, 'pending'),
    join(localAppData, 'company-meeting-updater', 'pending'),
    // Legacy (pre-PikMeeting rebrand) and current product-name variants.
    join(localAppData, 'CompanyMeeting-updater', 'pending'),
    join(localAppData, 'PikMeeting-updater', 'pending'),
  ];

  const currentVersion = app.getVersion();
  const seen = new Set<string>();

  for (const dir of candidates) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    try {
      const entries = await fsp.readdir(dir);
      let removedCount = 0;
      let removedBytes = 0;
      for (const entry of entries) {
        const match = entry.match(/Setup-(\d+\.\d+\.\d+)\.exe(\.blockmap)?$/i);
        if (!match) continue;
        const fileVersion = match[1];
        if (compareVersions(fileVersion, currentVersion) > 0) continue;
        const filePath = join(dir, entry);
        try {
          const stat = await fsp.stat(filePath);
          await fsp.unlink(filePath);
          removedCount += 1;
          removedBytes += stat.size;
          console.log('[cleanup] removed', entry);
        } catch (err) {
          console.warn('[cleanup] could not remove', entry, err);
        }
      }
      if (removedCount > 0) {
        const mb = (removedBytes / 1024 / 1024).toFixed(1);
        console.log(`[cleanup] freed ${mb} MB (${removedCount} files) from ${dir}`);
      }
    } catch {
      // Directory doesn't exist or unreadable; skip silently.
    }
  }
}

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

  // Clean up old update files left behind by previous auto-updates.
  // Delayed so it doesn't compete with startup work.
  setTimeout(() => {
    cleanupOldUpdateFiles().catch((err) => {
      console.warn('[cleanup] failed:', err);
    });
  }, 8000);

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
  console.log('[updater] quitAndInstall (silent) for v' + pendingDownloadedVersion);
  // Defer slightly so the IPC reply is returned to the renderer before quit.
  // Args: isSilent=true (no installer wizard), isForceRunAfter=true (auto-relaunch).
  setTimeout(() => autoUpdater.quitAndInstall(true, true), 200);
});
