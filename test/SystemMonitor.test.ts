// Align the following two values with src/SystemMonitor.ts
import { SystemMonitor } from '../src/SystemMonitor.js';

const MEASURE_INTERVAL = 200;
const MEASURE_TIMESPAN = 5000;
const loadListSize = MEASURE_TIMESPAN / MEASURE_INTERVAL;

describe('SystemMonitor', () => {
  it('should not let the loads history grow endlessly', async () => {
    const monitor = new SystemMonitor();
    // private property, but we need to access it for testing
    // eslint-disable-next-line dot-notation
    const loads = monitor['loads'];
    expect(loads.length).toBe(0);
    for (let i = 0; i < loadListSize + 10; i += 1) {
      await monitor.init();
    }
    expect(loads.length).toBe(loadListSize);
    monitor.close();
    expect(loads.length).toBe(loadListSize);
  });
});
