/**
 * Event handlers that start asynchronous work. React ignores the promise a handler returns, so `onClick={saveAsync}` silently drops its
 * rejection and `@typescript-eslint/no-misused-promises` (attributes) rejects it. `voidHandler(saveAsync)` is the explicit form: the same
 * arguments are passed through, the promise is deliberately not awaited, and the call site says so.
 *
 * Failures must still be handled inside the handler (toast, error state); this changes the type, not the behavior.
 */
export function voidHandler<A extends unknown[]>(handler: (...args: A) => unknown): (...args: A) => void {
  return (...args: A) => { void handler(...args); };
}
