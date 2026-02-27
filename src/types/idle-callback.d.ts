/**
 * Type declarations for requestIdleCallback / cancelIdleCallback.
 * These APIs are available in most browsers but missing from TypeScript's DOM lib.
 */

interface IdleDeadline {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

interface IdleRequestOptions {
  timeout?: number;
}

interface Window {
  requestIdleCallback(callback: (deadline: IdleDeadline) => void, options?: IdleRequestOptions): number;
  cancelIdleCallback(handle: number): void;
}
