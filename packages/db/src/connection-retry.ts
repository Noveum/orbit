function hasRetryableErrorName(error: Error): boolean {
  let current: object | null = error;
  for (let depth = 0; current !== null && depth < 8; depth += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(current, 'name');
    if (descriptor !== undefined) {
      return (
        'value' in descriptor &&
        typeof descriptor.value === 'string' &&
        descriptor.value !== 'AbortError' &&
        descriptor.value !== 'TimeoutError'
      );
    }
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function isInitialConnectionTimeout(error: unknown): boolean {
  const visited = new Set<Error>();
  let current: unknown = error;
  try {
    for (let depth = 0; depth < 8; depth += 1) {
      if (!(current instanceof Error) || visited.has(current) || !hasRetryableErrorName(current))
        return false;
      visited.add(current);
      const code = Object.getOwnPropertyDescriptor(current, 'code');
      const errno = Object.getOwnPropertyDescriptor(current, 'errno');
      if (code !== undefined || errno !== undefined) {
        return (
          code !== undefined &&
          errno !== undefined &&
          'value' in code &&
          'value' in errno &&
          code.value === 'CONNECT_TIMEOUT' &&
          errno.value === 'CONNECT_TIMEOUT'
        );
      }
      const cause = Object.getOwnPropertyDescriptor(current, 'cause');
      if (cause === undefined || !('value' in cause)) return false;
      current = cause.value;
    }
  } catch {
    return false;
  }
  return false;
}

export async function retryInitialDatabaseConnection<T>(
  operation: () => Promise<T>,
  isRetryablePhase: () => boolean,
): Promise<T> {
  const startedInRetryablePhase = isRetryablePhase();
  try {
    return await operation();
  } catch (error: unknown) {
    if (!(startedInRetryablePhase && isInitialConnectionTimeout(error) && isRetryablePhase()))
      throw error;
    return operation();
  }
}
