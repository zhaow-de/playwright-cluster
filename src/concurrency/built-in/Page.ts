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
    if (!this.context) {
      this.context = await browser.newContext();
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
