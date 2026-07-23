import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'bun:test' {
  interface Matchers<T> extends TestingLibraryMatchers<never, T> {}
  interface AsymmetricMatchers extends TestingLibraryMatchers<never, void> {}
}
