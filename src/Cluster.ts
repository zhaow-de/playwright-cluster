// noinspection DuplicatedCode

import { ExecuteResolve, ExecuteReject, ExecuteCallbacks, Job } from './Job.js';
import { Display } from './Display.js';
import * as util from './util.js';
import { Worker, WorkResult } from './Worker.js';

import * as builtInConcurrency from './concurrency/builtInConcurrency.js';

import type { Page, LaunchOptions, BrowserContextOptions, BrowserType } from 'playwright';
import { firefox } from 'playwright';
import { Queue } from './Queue.js';
import { SystemMonitor } from './SystemMonitor.js';
import { EventEmitter } from 'events';
import {
  WorkerInstance,
  ConcurrencyImplementationClassType,
  ConcurrencyImplementation,
} from './concurrency/ConcurrencyImplementation.js';

const debug = util.debugGenerator('Cluster');

interface ClusterOptions {
  concurrency: number | ConcurrencyImplementationClassType;
  maxConcurrency: number;
  workerCreationDelay: number;
  playwrightOptions: LaunchOptions;
  perBrowserOptions: LaunchOptions[] | undefined;
  contextOptions: BrowserContextOptions;
  monitor: boolean;
  timeout: number;
  retryLimit: number;
  retryDelay: number;
  skipDuplicateUrls: boolean;
  sameDomainDelay: number;
  playwright: BrowserType | null | undefined;
}

type Partial<T> = {
  [P in keyof T]?: T[P];
};

type ClusterOptionsArgument = Partial<ClusterOptions>;

const DEFAULT_OPTIONS: ClusterOptions = {
  concurrency: 2, // CONTEXT
  maxConcurrency: 1,
  workerCreationDelay: 0,
  playwrightOptions: {
    // headless: false, // just for testing...
  },
  contextOptions: {},
  perBrowserOptions: undefined,
  monitor: false,
  timeout: 30 * 1000,
  retryLimit: 0,
  retryDelay: 0,
  skipDuplicateUrls: false,
  sameDomainDelay: 0,
  playwright: undefined,
};

interface WorkersInfo {
  id: number;
  status: string;
  url: string;
}

interface StatusMetrics {
  startTime: string;
  now: string;
  idle: boolean;
  doneTargets: number;
  allTargetCount: number;
  donePercStr: string;
  errorCount: number;
  errorPerc: string;
  timeRunning: string;
  timeRemaining: string;
  pagesPerSecond: string;
  pagesPerSecondString: string;
  remainingPages: number;
  workers: WorkersInfo[];
}

interface TaskFunctionArguments<JobData> {
  page: Page;
  data: JobData;
  worker: {
    id: number;
  };
}

export type TaskFunction<JobData, ReturnData> = (arg: TaskFunctionArguments<JobData>) => Promise<ReturnData>;

const MONITORING_DISPLAY_INTERVAL = 500;
const CHECK_FOR_WORK_INTERVAL = 100;
const WORK_CALL_INTERVAL_LIMIT = 10;

export class Cluster<JobData = any, ReturnData = any> extends EventEmitter {
  public static CONCURRENCY_PAGE = 1; // shares cookies, etc.
  public static CONCURRENCY_CONTEXT = 2; // no cookie sharing (uses contexts)
  public static CONCURRENCY_BROWSER = 3; // no cookie sharing and individual processes (uses contexts)

  private options: ClusterOptions;
  private perBrowserOptions: LaunchOptions[] | null = null;
  private workers: Worker<JobData, ReturnData>[] = [];
  private workersAvail: Worker<JobData, ReturnData>[] = [];
  private workersBusy: Worker<JobData, ReturnData>[] = [];
  private workersStarting = 0;

  private allTargetCount = 0;
  private jobQueue: Queue<Job<JobData, ReturnData>> = new Queue<Job<JobData, ReturnData>>();
  private errorCount = 0;

  private taskFunction: TaskFunction<JobData, ReturnData> | null = null;
  private idleResolvers: (() => void)[] = [];
  private waitForOneResolvers: ((data: JobData) => void)[] = [];
  private browser: ConcurrencyImplementation | null = null;

  private isClosed = false;
  private startTime = Date.now();
  private nextWorkerId = -1;

  private monitoringInterval: NodeJS.Timeout | null = null;
  private display: Display | null = null;

  private duplicateCheckUrls: Set<string> = new Set();
  private lastDomainAccesses: Map<string, number> = new Map();

  private systemMonitor: SystemMonitor = new SystemMonitor();

  private checkForWorkInterval: NodeJS.Timeout | null = null;

  public static async launch(options: ClusterOptionsArgument) {
    debug('Launching');
    const cluster = new Cluster(options);
    await cluster.init();

    return cluster;
  }

  private constructor(options: ClusterOptionsArgument) {
    super();

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    if (this.options.monitor) {
      this.monitoringInterval = setInterval(() => this.monitor(), MONITORING_DISPLAY_INTERVAL);
    }
  }

  private async init() {
    const browserOptions = this.options.playwrightOptions;
    const contextOptions = this.options.contextOptions;
    let playwright = this.options.playwright;

    if (this.options.playwright == null) {
      // check for null or undefined
      playwright = firefox;
    } else {
      /* istanbul ignore next */
      debug('Using provided (custom) playwright object.');
    }

    if (this.options.concurrency === Cluster.CONCURRENCY_PAGE) {
      this.browser = new builtInConcurrency.Page(browserOptions, contextOptions, playwright!);
    } else if (this.options.concurrency === Cluster.CONCURRENCY_CONTEXT) {
      this.browser = new builtInConcurrency.Context(browserOptions, contextOptions, playwright!);
    } else if (this.options.concurrency === Cluster.CONCURRENCY_BROWSER) {
      this.browser = new builtInConcurrency.Browser(browserOptions, contextOptions, playwright!);
    } else if (typeof this.options.concurrency === 'function') {
      // eslint-disable-next-line new-cap
      this.browser = new this.options.concurrency(browserOptions, contextOptions, playwright!);
    } else {
      throw new Error(`Unknown concurrency option: ${this.options.concurrency}`);
    }

    // noinspection SuspiciousTypeOfGuard
    if (typeof this.options.maxConcurrency !== 'number') {
      throw new Error('maxConcurrency must be of number type');
    }
    if (this.options.perBrowserOptions && this.options.perBrowserOptions.length !== this.options.maxConcurrency) {
      throw new Error('perBrowserOptions length must equal maxConcurrency');
    }
    if (this.options.perBrowserOptions) {
      this.perBrowserOptions = [...this.options.perBrowserOptions];
    }

    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore TS2531: Object is possibly 'null'.
      await this.browser.init();
    } catch (err: any) {
      /* istanbul ignore next */
      throw new Error(`Unable to launch browser, error message: ${err.message}`);
    }

    if (this.options.monitor) {
      await this.systemMonitor.init();
    }

    // needed in case resources are getting free (like CPU/memory) to check if
    // can launch workers
    this.checkForWorkInterval = setInterval(() => this.work(), CHECK_FOR_WORK_INTERVAL);
  }

  private async launchWorker() {
    // signal, that we are starting a worker
    this.workersStarting += 1;
    this.nextWorkerId += 1;
    this.lastLaunchedWorkerTime = Date.now();

    let nextWorkerOption;
    if (this.perBrowserOptions && this.perBrowserOptions.length > 0) {
      nextWorkerOption = this.perBrowserOptions.shift();
    }

    const workerId = this.nextWorkerId;

    let workerBrowserInstance: WorkerInstance;
    try {
      workerBrowserInstance = await (this.browser as ConcurrencyImplementation).workerInstance(nextWorkerOption);
    } catch (err: any) {
      /* istanbul ignore next */
      throw new Error(`Unable to launch browser for worker, error message: ${err.message}`);
    }

    const worker = new Worker<JobData, ReturnData>({
      cluster: this,
      args: [''], // this.options.args,
      browser: workerBrowserInstance,
      id: workerId,
    });
    this.workersStarting -= 1;

    /* istanbul ignore next */
    if (this.isClosed) {
      // cluster was closed while we created a new worker (should rarely happen)
      /* istanbul ignore next */
      worker.close();
    } else {
      this.workersAvail.push(worker);
      this.workers.push(worker);
    }
  }

  public async task(taskFunction: TaskFunction<JobData, ReturnData>) {
    this.taskFunction = taskFunction;
  }

  private nextWorkCall = 0;
  private workCallTimeout: NodeJS.Timeout | null = null;

  // check for new work soon (wait if there will be put more data into the queue, first)
  private async work() {
    // make sure, we only call work once every WORK_CALL_INTERVAL_LIMIT (currently: 10ms)
    if (this.workCallTimeout === null) {
      const now = Date.now();

      // calculate when the next work call should happen
      this.nextWorkCall = Math.max(this.nextWorkCall + WORK_CALL_INTERVAL_LIMIT, now);
      const timeUntilNextWorkCall = this.nextWorkCall - now;

      this.workCallTimeout = setTimeout(() => {
        this.workCallTimeout = null;
        this.doWork();
      }, timeUntilNextWorkCall);
    }
  }

  private async doWork() {
    if (this.jobQueue.size() === 0 || this.isClosed) {
      // no jobs available
      if (this.workersBusy.length === 0) {
        // allow retry jobs to be executed.
        setTimeout(() => {
          if (this.jobQueue.size() === 0 || this.isClosed) {
            // no jobs available
            if (this.workersBusy.length === 0) {
              this.idleResolvers.forEach((resolve) => resolve());
              // if any tasks has completed
              if (this.allTargetCount > 0) {
                this.emit('idle');
              }
            }
          }
        }, 500);
      }
      return;
    }

    if (this.workersAvail.length === 0) {
      // no workers available
      if (this.allowedToStartWorker()) {
        await this.launchWorker();
        this.work();
      }
      return;
    }

    const job = this.jobQueue.shift();

    if (job === undefined) {
      // skip, there are items in the queue but they are all delayed
      return;
    }

    const url = job.getUrl();
    const domain = job.getDomain();

    // Check if URL was already crawled (on skipDuplicateUrls)
    if (this.options.skipDuplicateUrls && url !== undefined && this.duplicateCheckUrls.has(url) && job.tries === 0) {
      // already crawled, just ignore
      debug(`Skipping duplicate URL: ${job.getUrl()}`);
      this.work();
      return;
    }

    // Check if the job needs to be delayed due to sameDomainDelay
    if (this.options.sameDomainDelay !== 0 && domain !== undefined) {
      const lastDomainAccess = this.lastDomainAccesses.get(domain);
      if (lastDomainAccess !== undefined && lastDomainAccess + this.options.sameDomainDelay > Date.now()) {
        this.jobQueue.push(job, {
          delayUntil: lastDomainAccess + this.options.sameDomainDelay,
        });
        this.work();
        return;
      }
    }

    // Check are all positive, let's actually run the job
    if (this.options.skipDuplicateUrls && url !== undefined) {
      this.duplicateCheckUrls.add(url);
    }
    if (this.options.sameDomainDelay !== 0 && domain !== undefined) {
      this.lastDomainAccesses.set(domain, Date.now());
    }

    const worker = this.workersAvail.shift() as Worker<JobData, ReturnData>;
    this.workersBusy.push(worker);

    if (this.workersAvail.length !== 0 || this.allowedToStartWorker()) {
      // we can execute more work in parallel
      this.work();
    }

    let jobFunction;
    if (job.taskFunction !== undefined) {
      jobFunction = job.taskFunction;
    } else if (this.taskFunction !== null) {
      jobFunction = this.taskFunction;
    } else {
      // It should not reach this point, because `Worker.handle` should throw error "TypeError: task is not a function"
      // already.
      /* istanbul ignore next */
      throw new Error('No task function defined!');
    }

    const result: WorkResult = await worker.handle(
      jobFunction as TaskFunction<JobData, ReturnData>,
      job,
      this.options.timeout
    );

    if (result.type === 'error') {
      if (job.executeCallbacks) {
        job.executeCallbacks.reject(result.error);
        this.errorCount += 1;
      } else {
        // ignore retryLimits in case of executeCallbacks
        job.addError(result.error);
        const jobWillRetry = job.tries <= this.options.retryLimit;
        this.emit('taskerror', result.error, job.data, jobWillRetry);
        if (jobWillRetry) {
          let delayUntil;
          if (this.options.retryDelay !== 0) {
            delayUntil = Date.now() + this.options.retryDelay;
          }
          this.jobQueue.push(job, {
            delayUntil,
          });
        } else {
          this.errorCount += 1;
        }
      }
    } else if (result.type === 'success' && job.executeCallbacks) {
      job.executeCallbacks.resolve(result.data);
    }

    this.waitForOneResolvers.forEach((resolve) => resolve(job.data as JobData));
    this.waitForOneResolvers = [];

    // add worker to available workers again
    const workerIndex = this.workersBusy.indexOf(worker);
    this.workersBusy.splice(workerIndex, 1);

    this.workersAvail.push(worker);

    this.work();
  }

  private lastLaunchedWorkerTime = 0;

  private allowedToStartWorker(): boolean {
    const workerCount = this.workers.length + this.workersStarting;
    return (
      // option: maxConcurrency
      (this.options.maxConcurrency === 0 || workerCount < this.options.maxConcurrency) &&
      // just allow worker creation every few milliseconds
      (this.options.workerCreationDelay === 0 ||
        this.lastLaunchedWorkerTime + this.options.workerCreationDelay < Date.now())
    );
  }

  // Type Guard for TypeScript
  private isTaskFunction(data: JobData | TaskFunction<JobData, ReturnData>): data is TaskFunction<JobData, ReturnData> {
    return typeof data === 'function';
  }

  private queueJob(
    data: JobData | TaskFunction<JobData, ReturnData>,
    taskFunction?: TaskFunction<JobData, ReturnData>,
    callbacks?: ExecuteCallbacks
  ): void {
    let realData: JobData | undefined;
    let realFunction: TaskFunction<JobData, ReturnData> | undefined;
    if (this.isTaskFunction(data)) {
      realFunction = data;
    } else {
      realData = data;
      realFunction = taskFunction;
    }
    const job = new Job<JobData, ReturnData>(realData, realFunction, callbacks);

    this.allTargetCount += 1;
    this.jobQueue.push(job);
    this.emit('queue', realData, realFunction);
    this.work();
  }

  // eslint-disable-next-line no-dupe-class-members
  public async queue(data: JobData, taskFunction?: TaskFunction<JobData, ReturnData>): Promise<void>;
  // eslint-disable-next-line no-dupe-class-members
  public async queue(taskFunction: TaskFunction<JobData, ReturnData>): Promise<void>;
  // eslint-disable-next-line no-dupe-class-members
  public async queue(
    data: JobData | TaskFunction<JobData, ReturnData>,
    taskFunction?: TaskFunction<JobData, ReturnData>
  ): Promise<void> {
    this.queueJob(data, taskFunction);
  }

  // eslint-disable-next-line no-dupe-class-members
  public execute(data: JobData, taskFunction?: TaskFunction<JobData, ReturnData>): Promise<ReturnData>;
  // eslint-disable-next-line no-dupe-class-members
  public execute(taskFunction: TaskFunction<JobData, ReturnData>): Promise<ReturnData>;
  // eslint-disable-next-line no-dupe-class-members
  public execute(
    data: JobData | TaskFunction<JobData, ReturnData>,
    taskFunction?: TaskFunction<JobData, ReturnData>
  ): Promise<ReturnData> {
    return new Promise<ReturnData>((resolve: ExecuteResolve, reject: ExecuteReject) => {
      const callbacks = { resolve, reject };
      this.queueJob(data, taskFunction, callbacks);
    });
  }

  public idle(): Promise<void> {
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  public waitForOne(): Promise<JobData> {
    return new Promise((resolve) => this.waitForOneResolvers.push(resolve));
  }

  public async close(): Promise<void> {
    this.isClosed = true;

    clearInterval(this.checkForWorkInterval as NodeJS.Timeout);
    clearTimeout(this.workCallTimeout as NodeJS.Timeout);

    // close workers
    await Promise.all(this.workers.map((worker) => worker.close()));

    try {
      await (this.browser as ConcurrencyImplementation).close();
    } catch (err: any) {
      /* istanbul ignore next */
      debug(`Error: Unable to close browser, message: ${err.message}`);
    }

    if (this.monitoringInterval) {
      this.monitor();
      clearInterval(this.monitoringInterval);
    }

    if (this.display) {
      this.display.close();
    }

    this.systemMonitor.close();

    debug('Closed');
  }

  private monitor(): void {
    if (!this.display) {
      this.display = new Display();
    }
    const display = this.display;

    const now = Date.now();
    const timeDiff = now - this.startTime;

    const doneTargets = this.allTargetCount - this.jobQueue.size() - this.workersBusy.length;
    const donePercentage = this.allTargetCount === 0 ? 1 : doneTargets / this.allTargetCount;
    const donePercStr = (100 * donePercentage).toFixed(2);

    const errorPerc = doneTargets === 0 ? '0.00' : ((100 * this.errorCount) / doneTargets).toFixed(2);

    const timeRunning = util.formatDuration(timeDiff);

    let timeRemainingMillis = -1;
    if (donePercentage !== 0) {
      timeRemainingMillis = timeDiff / donePercentage - timeDiff;
    }
    const timeRemaining = util.formatDuration(timeRemainingMillis);

    const cpuUsage = this.systemMonitor.getCpuUsage().toFixed(1);
    const memoryUsage = this.systemMonitor.getMemoryUsage().toFixed(1);

    const pagesPerSecond = doneTargets === 0 ? '0' : ((doneTargets * 1000) / timeDiff).toFixed(2);

    display.log(`== Start:     ${util.formatDateTime(this.startTime)}`);
    display.log(`== Now:       ${util.formatDateTime(now)} (running for ${timeRunning})`);
    display.log(
      `== Progress:  ${doneTargets} / ${this.allTargetCount} (${donePercStr}%)` +
        `, errors: ${this.errorCount} (${errorPerc}%)`
    );
    display.log(`== Remaining: ${timeRemaining} (@ ${pagesPerSecond} pages/second)`);
    display.log(`== Sys. load: ${cpuUsage}% CPU / ${memoryUsage}% memory`);
    display.log(`== Workers:   ${this.workers.length + this.workersStarting}`);

    this.workers.forEach((worker, i) => {
      const isIdle = this.workersAvail.indexOf(worker) !== -1;
      let workOrIdle;
      let workerUrl = '';
      if (isIdle) {
        workOrIdle = 'IDLE';
      } else {
        workOrIdle = 'WORK';
        if (worker.activeTarget) {
          workerUrl = worker.activeTarget.getUrl() || 'UNKNOWN TARGET';
        } else {
          /* istanbul ignore next */
          workerUrl = 'NO TARGET (should not be happening)';
        }
      }

      display.log(`   #${i} ${workOrIdle} ${workerUrl}`);
    });
    for (let i = 0; i < this.workersStarting; i += 1) {
      /* istanbul ignore next */
      display.log(`   #${this.workers.length + i} STARTING...`);
    }

    display.resetCursor();
  }

  public status(): StatusMetrics {
    const now = Date.now();
    const timeDiff = now - this.startTime;

    const doneTargets = this.allTargetCount - this.jobQueue.size() - this.workersBusy.length;
    const donePercentage = this.allTargetCount === 0 ? 1 : doneTargets / this.allTargetCount;
    const donePercStr = (100 * donePercentage).toFixed(2);

    const errorPerc = doneTargets === 0 ? '0.00' : ((100 * this.errorCount) / doneTargets).toFixed(2);

    const timeRunning = util.formatDuration(timeDiff);

    let timeRemainingMillis = -1;
    if (donePercentage !== 0) {
      timeRemainingMillis = timeDiff / donePercentage - timeDiff;
    }
    const timeRemaining = util.formatDuration(timeRemainingMillis);
    const pagesPerSecond = doneTargets === 0 ? '0' : ((doneTargets * 1000) / timeDiff).toFixed(2);

    const workersInfo = this.workers.map((worker, i) => {
      const isIdle = this.workersAvail.indexOf(worker) !== -1;
      let workOrIdle;
      let workerUrl = '';
      if (isIdle) {
        workOrIdle = 'IDLE';
      } else {
        workOrIdle = 'WORK';
        if (worker.activeTarget) {
          workerUrl = worker.activeTarget.getUrl() || 'UNKNOWN TARGET';
        } else {
          /* istanbul ignore next */
          workerUrl = 'NO TARGET (should not be happening)';
        }
      }
      return {
        id: i,
        status: workOrIdle,
        url: workerUrl,
      };
    });
    const clusterIsIdle = this.workersBusy.length === 0 && this.jobQueue.size() === 0;

    return {
      startTime: util.formatDateTime(this.startTime),
      now: util.formatDateTime(now),
      doneTargets,
      idle: clusterIsIdle,
      allTargetCount: this.allTargetCount,
      donePercStr: donePercStr + '%',
      errorCount: this.errorCount,
      remainingPages: this.jobQueue.size(),
      errorPerc: errorPerc + '%',
      timeRunning,
      timeRemaining,
      pagesPerSecond,
      pagesPerSecondString: pagesPerSecond + ' pages/second',
      workers: workersInfo,
    };
  }
}
