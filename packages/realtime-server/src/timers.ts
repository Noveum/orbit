type Timer = ReturnType<typeof setTimeout>;

export function detach<T extends Timer>(timer: T): T {
  const handle: unknown = timer;
  if (typeof handle === 'object' && handle !== null && 'unref' in handle) {
    const unref = handle.unref;
    if (typeof unref === 'function') unref.call(handle);
  }
  return timer;
}
