'use client';

import { useState } from 'react';
import { IntegrationCard } from '../settings/integration-card.tsx';
import { StarterPromptPicker } from './starter-prompt-picker.tsx';

export function StarterPromptsCard() {
  const [error, setError] = useState<string | null>(null);

  return (
    <IntegrationCard
      title="Starter prompts"
      description="Once a client is connected, paste one of these to move your work in from another tool, plan something new, or build a backlog from your code."
      status={null}
    >
      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      <StarterPromptPicker onError={setError} />
    </IntegrationCard>
  );
}
