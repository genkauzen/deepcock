const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { faker } = require('@faker-js/faker');

class SteamRegistrator {
  constructor(proxyManager, captchaSolver, db, concurrency = 3) {
    this.proxyManager = proxyManager;
    this.captchaSolver = captchaSolver;
    this.db = db;
    this.concurrency = concurrency;
    this.isRunning = false;
    this.browserPool = [];
  }

  async register(count, delay, onProgress) {
    this.isRunning = true;
    const results = { success: 0, failed: 0, accounts: [] };
    let completed = 0;

    // Создаём очередь из индексов
    const queue = Array.from({ length: count }, (_, i) => i);

    // Запускаем воркеры (ограничение параллелизма)
    const workers = [];
    for (let w = 0; w < Math.min(this.concurrency, count); w++) {
      workers.push(this.worker(queue, results, delay, onProgress, () => {
        completed++;
        return completed;
      }));
    }

    await Promise.all(workers);
    this.isRunning = false;
    return results;
  }

  async worker(queue, results, delay, onProgress, getCompleted) {
    while (this.isRunning && queue.length > 0) {
      const index = queue.shift();
      if (index === undefined) break;

      try {
        const proxy = this.proxyManager.getProxy();
        const browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1280,720',
            `--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`
          ],
          defaultViewport: null
        });

        const page = await browser.newPage();
        await page.authenticate({
          username: proxy.username || '',
          password: proxy.password || ''
        });

        // Генерация данных
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const username = faker.internet.userName().slice(0, 15);
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${Date.now()}@mailinator.com`;
        const password = faker.internet.password({ length: 12 });

        await page.goto('https://store.steampowered.com/join/', {
          waitUntil: 'networkidle2',
          timeout: 60000
        });

        await page.waitForSelector('#email', { timeout: 15000 });
        await page.type('#email', email);
        await page.type('#password', password);
        await page.type('#password_confirm', password);
        await page.type('#username', username);
        await page.click('#accept_terms');

        // Капча
        const siteKey = await page.evaluate(() => {
          const el = document.querySelector('[data-sitekey]');
          return el ? el.dataset.sitekey : null;
        });
        if (siteKey) {
          const token = await this.captchaSolver.solveRecaptchaV2(
            siteKey,
            'https://store.steampowered.com/join/',
            proxy
          );
          await page.evaluate(`document.getElementById('g-recaptcha-response').innerHTML = "${token}";`);
          await page.evaluate(`document.querySelector('#createAccountButton').click();`);
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        } else {
          await page.click('#createAccountButton');
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        }

        const success = await page.evaluate(() => {
          return document.querySelector('.account_creation_success') !== null;
        });
        if (!success) {
          throw new Error('Ошибка регистрации');
        }

        const account = { username, email, password, proxy: `${proxy.host}:${proxy.port}` };
        await this.db.saveSteamAccount(account);

        results.success++;
        results.accounts.push(account);

        if (onProgress) {
          onProgress({
            current: getCompleted(),
            total: count,
            success: results.success,
            error: results.failed,
            status: `Создан аккаунт ${email}`
          });
        }

        await browser.close();
        await new Promise(r => setTimeout(r, delay || 3000));

      } catch (error) {
        results.failed++;
        console.error(`[Steam] Ошибка: ${error.message}`);
        if (onProgress) {
          onProgress({
            current: getCompleted(),
            total: count,
            success: results.success,
            error: results.failed,
            status: `Ошибка: ${error.message}`
          });
        }
      }
    }
  }

  async stop() {
    this.isRunning = false;
  }
}

module.exports = { SteamRegistrator };