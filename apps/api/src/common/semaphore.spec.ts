import { Semaphore } from './semaphore.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('Semaphore', () => {
  it('never runs more than the limit at once, and runs everything', async () => {
    const semaphore = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        semaphore.run(async () => {
          peak = Math.max(peak, ++running);
          await tick();
          running--;
          return i;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('frees the slot when a task fails', async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(semaphore.run(async () => 'next')).resolves.toBe('next');
  });
});
