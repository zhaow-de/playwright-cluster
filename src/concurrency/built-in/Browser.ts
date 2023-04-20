import * as playwright from 'playwright';

import { debugGenerator, timeoutExecute } from '../../util';
import { ConcurrencyImplementation, WorkerInstance } from '../ConcurrencyImplementation';

const debug = debugGenerator('BrowserConcurrency');

const BROWSER_TIMEOUT = 5000;

export class Browser extends ConcurrencyImplementation {
  public async init() {}

  public async close() {}

  public async workerInstance(perBrowserOptions: playwright.LaunchOptions | undefined): Promise<WorkerInstance> {
    const options = perBrowserOptions || this.options;
    let firefox = (await this.playwright.firefox.launch(options)) as playwright.Browser;
    let page: playwright.Page;
    let context: any;

    return {
      jobInstance: async () => {
        await timeoutExecute(
          BROWSER_TIMEOUT,
          (async () => {
            context = await firefox.newContext();
            page = await context.newPage();
          })()
        );

        return {
          resources: {
            page,
          },

          close: async () => {
            await timeoutExecute(BROWSER_TIMEOUT, context.close());
          },
        };
      },

      close: async () => {
        await firefox.close();
      },

      repair: async () => {
        debug('Starting repair');
        try {
          // will probably fail, but just in case the repair was not necessary
          await firefox.close();
        } catch (e) {}

        // just relaunch as there is only one page per browser
        firefox = await this.playwright.firefox.launch(options);
      },
    };
  }
}
