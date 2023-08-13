import playwright from 'playwright';

import { ResourceData } from '../ConcurrencyImplementation.js';
import { SingleBrowserImplementation } from '../SingleBrowserImplementation.js';
import debug = require('debug');

export class Context extends SingleBrowserImplementation {
  public async init() {}

  public async close() {
    try {
      await (this.browser as playwright.Browser)?.close();
    } catch (error: any) {
      debug('Error closing browser: ' + error.message);
    }
  }

  protected async createResources(): Promise<ResourceData> {
    const contextOptions = Object.keys(this.contextOptions).length > 0 ? this.contextOptions : undefined;
    const context = await (this.browser as playwright.Browser).newContext(contextOptions);
    const page = await context.newPage();
    return {
      context,
      page,
    };
  }

  protected async freeResources(resources: ResourceData): Promise<void> {
    await resources.context.close();
  }
}
