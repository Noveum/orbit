export function devLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env['ORBIT_DEV_LOGIN'] === '1';
}
