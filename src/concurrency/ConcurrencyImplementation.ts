import { Page, LaunchOptions, BrowserContextOptions } from 'playwright';

export interface ResourceData {
  page: Page;

  [key: string]: any;
}

/**
 * JobInstance which is created for the execution of one job. After usage
 * the associated resources will be destroyed by calling close.
 * resources needs to contain the page and might contain any other
 * related resources (like the browser).
 */
export interface JobInstance {
  resources: ResourceData;

  /**
   * Called to close the related resources
   */
  close: () => Promise<void>;
}

/**
 * WorkerInstances are created by calling the workerInstance function.
 * In case maxWorkers is set to 4, 4 workers will be created.
 */
export interface WorkerInstance {
  jobInstance: () => Promise<JobInstance>;

  /**
   * Closes the worker (called when the cluster is about to shut down)
   */
  close: () => Promise<void>;

  /**
   * Repair is called when there is a problem with the worker (like call or close throwing
   * an error)
   */
  repair: () => Promise<void>;
}

/**
 * ABSTRACT CLASS Needs to be implemented to manage one or more browsers via playwright instances
 *
 * The ConcurrencyImplementation creates WorkerInstances. Workers create JobInstances:
 * One WorkerInstance per maxWorkers, one JobInstance per job
 */
export abstract class ConcurrencyImplementation {
  protected options: LaunchOptions;
  protected contextOptions: BrowserContextOptions;
  protected playwright: any;

  /**
   * @param options  Options that should be provided to playwright.launch
   * @param contextOptions Options that should be provided to browser.newContext
   * @param playwright  playwright object
   */
  public constructor(options: LaunchOptions, contextOptions: BrowserContextOptions, playwright: any) {
    this.options = options;
    this.contextOptions = contextOptions;
    this.playwright = playwright;
  }

  /**
   * Initializes the manager
   */
  public abstract init(): Promise<void>;

  /**
   * Closes the manager (called when cluster is about to shut down)
   */
  public abstract close(): Promise<void>;

  /**
   * Creates a worker and returns it
   */
  public abstract workerInstance(perBrowserOptions: LaunchOptions | undefined): Promise<WorkerInstance>;
}

export type ConcurrencyImplementationClassType = new (
  options: LaunchOptions,
  contextOptions: BrowserContextOptions,
  playwright: any
) => ConcurrencyImplementation;
