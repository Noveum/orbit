export const CHART_WIDTH = 320;
export const CHART_HEIGHT = 132;
export const CHART_PADDING = 6;

export function chartX(index: number, count: number, width = CHART_WIDTH): number {
  if (count <= 1) return width / 2;
  return CHART_PADDING + (index * (width - CHART_PADDING * 2)) / (count - 1);
}

export function chartY(value: number, max: number, height = CHART_HEIGHT): number {
  const span = max <= 0 ? 1 : max;
  const usable = height - CHART_PADDING * 2;
  return height - CHART_PADDING - (Math.min(value, span) / span) * usable;
}

export function linePath(values: readonly number[], max: number): string {
  if (values.length === 0) return '';
  return values
    .map((value, index) => {
      const command = index === 0 ? 'M' : 'L';
      return `${command}${chartX(index, values.length).toFixed(2)} ${chartY(value, max).toFixed(2)}`;
    })
    .join(' ');
}

export function areaPath(values: readonly number[], max: number): string {
  const line = linePath(values, max);
  if (line === '') return '';
  const lastX = chartX(values.length - 1, values.length).toFixed(2);
  const baseline = (CHART_HEIGHT - CHART_PADDING).toFixed(2);
  const firstX = chartX(0, values.length).toFixed(2);
  return `${line} L${lastX} ${baseline} L${firstX} ${baseline} Z`;
}

export function niceMax(values: readonly number[]): number {
  const peak = Math.max(1, ...values);
  const step = 10 ** Math.max(0, Math.floor(Math.log10(peak)) - 1);
  return Math.ceil(peak / step) * step;
}
