// Minimal type-only surface used by this dependency-free Node harness.
// Actual execution uses Node's built-in node:test and node:assert/strict modules.
declare module 'node:test' {
  export function test(name: string, callback: () => void | Promise<void>): void;
  export namespace test { function todo(name: string): void; }
}
declare module 'node:assert/strict' {
  interface Assert {
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
  }
  const assert: Assert;
  export default assert;
}
