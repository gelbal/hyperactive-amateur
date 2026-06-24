// ABOUTME: Tiny async helpers shared by browser media flows.
// ABOUTME: Keeps timeout/error wiring consistent without repeating Promise.race boilerplate.

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function timeoutAfter(ms: number, message: string): Promise<never> {
  return waitMs(ms).then(() => {
    throw new Error(message);
  });
}
