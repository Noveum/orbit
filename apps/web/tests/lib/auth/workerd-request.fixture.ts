import { nativeFetchGlobals } from '../../../tests-preload.ts';

const NativeRequest = nativeFetchGlobals.Request;

class RequestReadingCf extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init !== undefined && init !== null && typeof init === 'object') {
      Reflect.get(init, 'cf');
    }
    super(input, init);
  }
}

export function readCfLikeWorkerd(): () => void {
  const previousRequest = globalThis.Request;
  const previousHeaders = globalThis.Headers;
  globalThis.Request = RequestReadingCf;
  globalThis.Headers = nativeFetchGlobals.Headers;
  return () => {
    globalThis.Request = previousRequest;
    globalThis.Headers = previousHeaders;
  };
}

export function requestWithoutCf(request: Request): Request {
  return new Proxy(request, {
    get(target, property) {
      if (property === 'cf') throw new TypeError('Illegal invocation');
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
