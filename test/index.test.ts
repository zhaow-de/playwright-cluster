import { Cluster } from '../src/Cluster.js';

test('Cluster is exported', () => {
  expect(Cluster).toBeDefined();
  expect(typeof Cluster.launch).toBe('function');
});
