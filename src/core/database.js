const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  init() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new sqlite3.Database(this.dbPath);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS steam_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        email TEXT UNIQUE,
        password TEXT,
        proxy TEXT,
        status TEXT DEFAULT 'success',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS psn_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        password TEXT,
        outlook_password TEXT,
        proxy TEXT,
        access_token TEXT,
        refresh_token TEXT,
        status TEXT DEFAULT 'success',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT,
        message TEXT,
        type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    return this;
  }

  getSteamAccounts() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT *, "steam" as platform FROM steam_accounts ORDER BY id DESC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  getPsnAccounts() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT *, "psn" as platform FROM psn_accounts ORDER BY id DESC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  getAllAccounts() {
    return Promise.all([this.getSteamAccounts(), this.getPsnAccounts()])
      .then(([steam, psn]) => [...steam, ...psn]);
  }

  saveSteamAccount(data) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT OR IGNORE INTO steam_accounts (username, email, password, proxy, status) VALUES (?, ?, ?, ?, ?)',
        [data.username, data.email, data.password, data.proxy, data.status || 'success'],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, ...data });
        }
      );
    });
  }

  savePsnAccount(data) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR IGNORE INTO psn_accounts 
         (email, password, outlook_password, proxy, access_token, refresh_token, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          data.email,
          data.password,
          data.outlookPassword || '',
          data.proxy,
          data.accessToken || '',
          data.refreshToken || '',
          data.status || 'success'
        ],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, ...data });
        }
      );
    });
  }

  clearAll() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM steam_accounts', (err) => {
        if (err) reject(err);
        this.db.run('DELETE FROM psn_accounts', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  exportCsv(filePath) {
    return this.getAllAccounts().then(accounts => {
      const header = 'id,platform,email,password,status,created_at\n';
      const rows = accounts.map(a =>
        `${a.id},${a.platform},${a.email},${a.password},${a.status},${a.created_at}`
      ).join('\n');
      fs.writeFileSync(filePath, header + rows);
    });
  }

  exportJson(filePath) {
    return this.getAllAccounts().then(accounts => {
      fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2));
    });
  }
}

module.exports = { Database };