const { ProxyManager } = require('./proxy-manager');
const { CaptchaSolver } = require('./captcha-solver');
const { SteamRegistrator } = require('../platforms/steam/client');
const { PSNRegistrator } = require('../platforms/psn/client');
const { logger } = require('./logger');

class Orchestrator {
  constructor(db) {
    this.db = db;
    this.proxyManager = new ProxyManager();
    this.captchaSolver = null;
    this.steamRegistrator = null;
    this.psnRegistrator = null;
    this.isRunning = false;
  }

  async start(options) {
    const { platform, count, settings, onProgress, onComplete } = options;

    // Инициализация прокси
    this.proxyManager.loadProxies(settings.proxies || []);
    await this.proxyManager.warmup();

    // Инициализация капчи
    this.captchaSolver = new CaptchaSolver(
      settings.captchaApiKey || '',
      settings.captchaService || '2captcha'
    );

    this.isRunning = true;

    try {
      let result;
      if (platform === 'steam') {
        this.steamRegistrator = new SteamRegistrator(
          this.proxyManager,
          this.captchaSolver,
          this.db,
          settings.steamConcurrency || 3
        );
        result = await this.steamRegistrator.register(
          count,
          settings.steamDelay || 3000,
          (progress) => {
            if (onProgress) onProgress({ ...progress, platform: 'steam' });
          }
        );
      } else if (platform === 'psn') {
        this.psnRegistrator = new PSNRegistrator(
          this.proxyManager,
          this.captchaSolver,
          this.db,
          settings.psnConcurrency || 2
        );
        result = await this.psnRegistrator.register(
          count,
          settings.psnDelay || 5000,
          (progress) => {
            if (onProgress) onProgress({ ...progress, platform: 'psn' });
          }
        );
      }

      this.isRunning = false;
      if (onComplete) {
        onComplete({
          platform,
          success: result.success || 0,
          failed: result.failed || 0,
          accounts: result.accounts || []
        });
      }
      return result;
    } catch (error) {
      logger.error(`Ошибка в оркестраторе: ${error.message}`);
      this.isRunning = false;
      throw error;
    }
  }

  async stop() {
    this.isRunning = false;
    if (this.steamRegistrator) await this.steamRegistrator.stop();
    if (this.psnRegistrator) await this.psnRegistrator.stop();
    logger.info('Остановлено пользователем');
  }
}

module.exports = { Orchestrator };