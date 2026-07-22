type LogFields = Record<string, unknown>;

type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, fields: LogFields | undefined): void {
  const line = JSON.stringify({
    level,
    message,
    at: new Date().toISOString(),
    service: 'realtime',
    ...fields,
  });
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.info(line);
}

export const logger = {
  info: (message: string, fields?: LogFields): void => write('info', message, fields),
  warn: (message: string, fields?: LogFields): void => write('warn', message, fields),
  error: (message: string, fields?: LogFields): void => write('error', message, fields),
};

export function errorFields(error: unknown): LogFields {
  return { error: error instanceof Error ? error.message : String(error) };
}
