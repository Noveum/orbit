import type { AiProviderKind } from '@orbit/shared/validators';

export interface AiProviderConfig {
  readonly kind: AiProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly enabled: boolean;
}

export interface AiCompletionOptions {
  readonly organizationId?: string | undefined;
  readonly config?: AiProviderConfig | undefined;
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  readonly maxTokens?: number | undefined;
  readonly temperature?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly recordUsage?: boolean | undefined;
}

export interface AiTokenUsage {
  readonly promptTokens?: number | undefined;
  readonly completionTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

export interface AiCompletionResult {
  readonly text: string;
  readonly model: string;
  readonly usage?: AiTokenUsage | undefined;
  readonly latencyMs: number;
}
