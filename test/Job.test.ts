import { Job } from '../src/Job.js';

describe('Job', () => {
  it('should extract url', () => {
    const job1 = new Job<string, unknown>('https://sub1.example.com');
    expect(job1.getUrl()).toBe('https://sub1.example.com');
    expect(job1.getDomain()).toBe('sub1.example.com');

    const job2 = new Job<{ name: string; url: string }, unknown>({ name: 'test2', url: 'https://sub2.example.com' });
    expect(job2.getUrl()).toBe('https://sub2.example.com');
    expect(job2.getDomain()).toBe('sub2.example.com');
  });

  it('should handle incomplete initialization', () => {
    const job = new Job<string, unknown>();
    expect(job.getUrl()).toBeUndefined();
  });

  it('should handle wrong initialization', () => {
    const job = new Job<{ name: string; link: string }, unknown>({ name: 'test3', link: 'https://sub3.example.com' });
    expect(job.getUrl()).toBeUndefined();
    expect(job.getDomain()).toBeUndefined();
  });

  it('should handle domain from wrong url', () => {
    const job = new Job<string, unknown>('<obviously-this-is-not-a-url />');
    expect(job.getUrl()).toBe('<obviously-this-is-not-a-url />');
    expect(job.getDomain()).toBeUndefined();
  });

  it('should handle url without domain name', () => {
    const job = new Job<string, unknown>('file:///a/b.c');
    expect(job.getUrl()).toBe('file:///a/b.c');
    expect(job.getDomain()).toBeUndefined();
  });

  it('should handle error history', () => {
    const job = new Job<string, unknown>('https://sub4.example.com');
    // eslint-disable-next-line dot-notation
    expect(job['lastError']).toBeNull();
    expect(job.tries).toBe(0);

    job.addError(new Error('test error 1'));

    // eslint-disable-next-line dot-notation
    expect(job['lastError']).toEqual(new Error('test error 1'));
    expect(job.tries).toBe(1);

    job.addError(new Error('test error 2'));

    // eslint-disable-next-line dot-notation
    expect(job['lastError']).toEqual(new Error('test error 2'));
    expect(job.tries).toBe(2);
  });
});
