import * as playwright from 'playwright';

import { ResourceData } from '../ConcurrencyImplementation';
import { SingleBrowserImplementation } from '../SingleBrowserImplementation';

export class Page extends SingleBrowserImplementation {
  protected async repair(): Promise<void> {
    this.resetContext();
    return super.repair();
  }

  private context: playwright.BrowserContext | null = null;

  protected async createResources(): Promise<ResourceData> {
    const browser = this.browser as playwright.Browser;
    const contextOptions = Object.keys(this.contextOptions).length > 0 ? this.contextOptions : undefined;
    if (!this.context) {
      this.context = await browser.newContext(contextOptions);
    }
    return {
      page: await this.context.newPage(),
    };
  }

  public resetContext() {
    this.context = null;
  }

  protected async freeResources(resources: ResourceData): Promise<void> {
    await resources.page.close();
  }
}
