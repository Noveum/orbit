import { expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import { starterPrompt } from '@/features/ai-connect/starter-prompts.ts';
import { StarterPromptsCard } from '@/features/ai-connect/starter-prompts-card.tsx';

it('offers the starter prompts outside onboarding, without assuming which tool is connected', () => {
  render(<StarterPromptsCard />);
  expect(screen.getByRole('heading', { name: 'Starter prompts' })).toBeVisible();
  expect(screen.getByTestId('starter-prompt-text')).toHaveTextContent(
    starterPrompt('import', 'linear').split('\n')[0] ?? '',
  );
  expect(screen.queryByRole('link', { name: 'Open in Claude' })).toBeNull();
  expect(screen.getByText(/Paste it into the AI tool you connected\./)).toBeVisible();
});
