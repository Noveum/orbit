import { and, db, eq, schema } from '@orbit/db';
import { DomainError } from '@orbit/shared/errors';
import { randomUUIDv7 } from '@orbit/shared/utils';
import { aiProviderConfigSchema } from '@orbit/shared/validators';
import { decryptAiApiKey } from './credentials.ts';
import type {
  AiCompletionOptions,
  AiCompletionResult,
  AiProviderConfig,
  AiTokenUsage,
} from './types.ts';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1_000;

export class AiDisabledError extends DomainError {
  constructor(message = 'AI is not enabled for this workspace.') {
    super('not_found', message);
    this.name = 'AiDisabledError';
  }
}

export class AiClientError extends DomainError {
  constructor(message: string, cause?: unknown, apiKey?: string) {
    super(
      'internal',
      stripApiKey(message, apiKey),
      cause === undefined ? {} : { cause: sanitizeErrorCause(cause, apiKey) },
    );
    this.name = 'AiClientError';
  }
}

function stripApiKey(text: string, apiKey?: string): string {
  if (apiKey === undefined || apiKey.length === 0) return text;
  return text.replaceAll(apiKey, '[REDACTED]');
}

function sanitizeErrorCause(cause: unknown, apiKey?: string): string {
  let message = 'Unknown error';
  if (cause instanceof Error) message = cause.message;
  else if (typeof cause === 'string') message = cause;
  return stripApiKey(message, apiKey);
}

function boundedSignal(
  timeoutMs: number | undefined,
  externalSignal: AbortSignal | undefined,
): AbortSignal {
  const boundedMs = Math.min(
    Math.max(timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS),
    MAX_TIMEOUT_MS,
  );
  const timeoutSignal = AbortSignal.timeout(boundedMs);
  if (externalSignal === undefined) return timeoutSignal;
  return AbortSignal.any([externalSignal, timeoutSignal]);
}

interface ResolvedClientTarget {
  readonly config: AiProviderConfig;
  readonly apiKey: string;
  readonly organizationId: string | null;
}

async function resolveTarget(options: AiCompletionOptions): Promise<ResolvedClientTarget> {
  if (options.config !== undefined && options.apiKey !== undefined) {
    return {
      config: options.config,
      apiKey: options.apiKey,
      organizationId: options.organizationId ?? null,
    };
  }

  if (options.organizationId === undefined) {
    throw new AiDisabledError('Workspace context is required when config is not provided.');
  }

  const [row] = await db
    .select({
      config: schema.integration.config,
      credentials: schema.integration.credentials,
    })
    .from(schema.integration)
    .where(
      and(
        eq(schema.integration.organizationId, options.organizationId),
        eq(schema.integration.provider, 'ai'),
        eq(schema.integration.externalId, 'default'),
      ),
    )
    .limit(1);

  if (row === undefined) {
    throw new AiDisabledError();
  }

  const parsedConfig = aiProviderConfigSchema.safeParse(row.config);
  if (!(parsedConfig.success && parsedConfig.data.enabled)) {
    throw new AiDisabledError();
  }

  const decryptedKey = decryptAiApiKey(row.credentials, {
    organizationId: options.organizationId,
  });

  if (decryptedKey === null || decryptedKey.length === 0) {
    throw new AiDisabledError('AI API key is missing or invalid.');
  }

  return {
    config: parsedConfig.data,
    apiKey: decryptedKey,
    organizationId: options.organizationId,
  };
}

interface RawCompletionPayload {
  readonly text: string;
  readonly usage?: AiTokenUsage | undefined;
}

function trimTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') {
    end -= 1;
  }
  return text.slice(0, end);
}

function resolveOpenAiUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlashes(baseUrl.trim());
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

function resolveAnthropicUrl(baseUrl: string): string {
  const trimmed = trimTrailingSlashes(baseUrl.trim());
  if (trimmed.endsWith('/messages')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

async function callOpenAiCompatible(
  prompt: string,
  target: ResolvedClientTarget,
  options: AiCompletionOptions,
  signal: AbortSignal,
): Promise<RawCompletionPayload> {
  const url = resolveOpenAiUrl(target.config.baseUrl);
  const model = options.model ?? target.config.model;
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
  };
  if (options.maxTokens !== undefined) body['max_tokens'] = options.maxTokens;
  if (options.temperature !== undefined) body['temperature'] = options.temperature;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${target.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new AiClientError(
      'Failed to connect to OpenAI-compatible endpoint.',
      error,
      target.apiKey,
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new AiClientError(
      `OpenAI-compatible endpoint returned HTTP ${response.status}: ${errorText.slice(0, 256)}`,
      undefined,
      target.apiKey,
    );
  }

  const json = (await response.json()) as {
    choices?: readonly { message?: { content?: string } }[];
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  const text = json.choices?.[0]?.message?.content ?? '';
  const usage: AiTokenUsage | undefined =
    json.usage === undefined
      ? undefined
      : {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        };

  return { text, usage };
}

async function callAnthropic(
  prompt: string,
  target: ResolvedClientTarget,
  options: AiCompletionOptions,
  signal: AbortSignal,
): Promise<RawCompletionPayload> {
  const url = resolveAnthropicUrl(target.config.baseUrl);
  const model = options.model ?? target.config.model;
  const body: Record<string, unknown> = {
    model,
    max_tokens: options.maxTokens ?? 1024,
    messages: [{ role: 'user', content: prompt }],
  };
  if (options.temperature !== undefined) body['temperature'] = options.temperature;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': target.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    throw new AiClientError('Failed to connect to Anthropic endpoint.', error, target.apiKey);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new AiClientError(
      `Anthropic endpoint returned HTTP ${response.status}: ${errorText.slice(0, 256)}`,
      undefined,
      target.apiKey,
    );
  }

  const json = (await response.json()) as {
    content?: readonly { type?: string; text?: string }[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };

  const textBlocks = (json.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string);
  const text = textBlocks.join('');

  const inputTokens = json.usage?.input_tokens;
  const outputTokens = json.usage?.output_tokens;
  const totalTokens =
    inputTokens === undefined && outputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) + (outputTokens ?? 0);

  const usage: AiTokenUsage | undefined =
    inputTokens === undefined && outputTokens === undefined
      ? undefined
      : {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens,
        };

  return { text, usage };
}

async function recordUsageIfApplicable(
  organizationId: string | null,
  provider: string,
  model: string,
  usage: AiTokenUsage | undefined,
  recordUsage: boolean | undefined,
): Promise<void> {
  if (organizationId === null || recordUsage === false) return;
  try {
    await db.insert(schema.aiUsage).values({
      id: randomUUIDv7(),
      organizationId,
      provider,
      model,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
    });
  } catch (error) {
    console.error('Failed to log AI token usage telemetry:', error);
    return;
  }
}

export async function complete(
  prompt: string,
  options: AiCompletionOptions = {},
): Promise<AiCompletionResult> {
  const target = await resolveTarget(options);
  const signal = boundedSignal(options.timeoutMs, options.signal);
  const startTime = Date.now();

  const raw =
    target.config.kind === 'anthropic'
      ? await callAnthropic(prompt, target, options, signal)
      : await callOpenAiCompatible(prompt, target, options, signal);

  const latencyMs = Date.now() - startTime;
  const model = options.model ?? target.config.model;

  await recordUsageIfApplicable(
    target.organizationId,
    target.config.kind,
    model,
    raw.usage,
    options.recordUsage,
  );

  return {
    text: raw.text,
    model,
    usage: raw.usage,
    latencyMs,
  };
}
