import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'bun:test' {
  interface Matchers<T> extends Omit<TestingLibraryMatchers<never, T>, 'toBeEmpty'> {}
  interface AsymmetricMatchers extends Omit<TestingLibraryMatchers<never, void>, 'toBeEmpty'> {}
}
