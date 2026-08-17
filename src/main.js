const { app, BrowserWindow, ipcMain, Tray, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { Orchestrator } = require('./core/orchestrator');
const { Database } = require('./core/database');
const { logger } = require('./core/logger');

const store = new Store();

let mainWindow = null;
let tray = null;
let orchestrator = null;
let db = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../resources/icon.ico'),
    title: 'Triumph AutoReg'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  const menuTemplate = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Экспорт базы (CSV)',
          click: () => exportDatabase('csv')
        },
        {
          label: 'Экспорт базы (JSON)',
          click: () => exportDatabase('json')
        },
        {
          label: 'Очистить базу',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'warning',
              buttons: ['Да', 'Нет'],
              defaultId: 1,
              title: 'Подтверждение',
              message: 'Удалить все аккаунты из базы?'
            }).then(result => {
              if (result.response === 0) {
                db.clearAll();
                mainWindow.webContents.send('db-updated', {});
              }
            });
          }
        },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Перезагрузить', role: 'reload' },
        { label: 'Инструменты разработчика', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Сброс настроек', click: () => { store.clear(); } }
      ]
    },
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'GitHub',
          click: () => shell.openExternal('https://github.com/triumph/autoreg')
        },
        { type: 'separator' },
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Triumph AutoReg v1.0',
              message: 'Авторегистратор аккаунтов Steam и PSN\n\nРазработка: @triumphad'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray) {
        tray.displayBalloon({
          icon: 'info',
          title: 'Triumph AutoReg',
          content: 'Приложение свёрнуто в трей. Кликните дважды для открытия.'
        });
      }
    }
  });
}

function createTray() {
  tray = new Tray(path.join(__dirname, '../resources/icon.ico'));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Выход',
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);
  tray.setToolTip('Triumph AutoReg');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  db = new Database(path.join(app.getPath('userData'), 'accounts.db'));
  db.init();

  orchestrator = new Orchestrator(db);

  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ================= IPC =================
ipcMain.handle('get-config', () => {
  return store.get('config', {
    captchaApiKey: '',
    captchaService: '2captcha',
    steamConcurrency: 3,
    psnConcurrency: 2,
    steamDelay: 3000,
    psnDelay: 5000,
    proxies: []
  });
});

ipcMain.handle('save-config', (event, config) => {
  store.set('config', config);
  return { success: true };
});

ipcMain.handle('get-accounts', (event, platform) => {
  if (platform === 'steam') return db.getSteamAccounts();
  if (platform === 'psn') return db.getPsnAccounts();
  return db.getAllAccounts();
});

ipcMain.handle('start-registration', async (event, data) => {
  const { platform, count } = data;
  const settings = store.get('config', {});
  logger.info(`Запуск регистрации: ${platform}, кол-во: ${count}`);

  try {
    const result = await orchestrator.start({
      platform,
      count,
      settings,
      onProgress: (progress) => {
        mainWindow.webContents.send('registration-progress', {
          platform,
          current: progress.current,
          total: progress.total,
          success: progress.success,
          error: progress.error,
          status: progress.status
        });
      },
      onComplete: (result) => {
        mainWindow.webContents.send('registration-complete', {
          platform,
          success: result.success,
          failed: result.failed,
          accounts: result.accounts
        });
      }
    });
    return result;
  } catch (error) {
    logger.error(`Ошибка запуска: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-registration', async () => {
  if (orchestrator) {
    await orchestrator.stop();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return await dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('export-database', async (event, format) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Сохранить как',
    defaultPath: `accounts.${format === 'csv' ? 'csv' : 'json'}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  });
  if (filePath) {
    if (format === 'csv') await db.exportCsv(filePath);
    else await db.exportJson(filePath);
    return { success: true, filePath };
  }
  return { success: false };
});

async function exportDatabase(format) {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Сохранить как',
    defaultPath: `accounts.${format === 'csv' ? 'csv' : 'json'}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }]
  });
  if (filePath) {
    if (format === 'csv') await db.exportCsv(filePath);
    else await db.exportJson(filePath);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Готово',
      message: `Экспорт завершён: ${filePath}`
    });
  }
}