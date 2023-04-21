import { Cluster } from '../src';

test('Cluster is exported', () => {
  expect(Cluster).toBeDefined();
  expect(typeof Cluster.launch).toBe('function');
});
