import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/toast.tsx';
import { ProjectSettingsForm } from '../../../src/features/projects/project-settings-form.tsx';

const calls: { url: string; init: unknown }[] = [];

const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init });
  return Promise.resolve(
    new Response(JSON.stringify({ project: { id: 'project_1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as typeof fetch;

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const TEAMS = [
  { id: 'team_eng', key: 'ENG', name: 'Engineering' },
  { id: 'team_dsg', key: 'DSGN', name: 'Design' },
];

function renderForm(canManage = true) {
  render(
    <ToastProvider>
      <ProjectSettingsForm
        projectId="project_1"
        slug="atlas"
        name="Atlas"
        summary="The rebuild"
        status="in_progress"
        health="on_track"
        startDate="2026-01-01T00:00:00.000Z"
        targetDate={null}
        teams={TEAMS}
        selectedTeamIds={['team_eng']}
        canManage={canManage}
      />
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  calls.length = 0;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('ProjectSettingsForm', () => {
  it('shows the project as it stands', () => {
    renderForm();

    expect(screen.getByTestId('project-name')).toHaveValue('Atlas');
    expect(screen.getByTestId('project-summary')).toHaveValue('The rebuild');
    expect(screen.getByTestId('project-status')).toHaveValue('in_progress');
    expect(screen.getByTestId('project-health')).toHaveValue('on_track');
    expect(screen.getByTestId('project-start')).toHaveValue('2026-01-01');
    expect(screen.getByTestId('project-target')).toHaveValue('');
  });

  it('marks the teams the project already belongs to', () => {
    renderForm();

    expect(screen.getByTestId('project-team-ENG')).toBeChecked();
    expect(screen.getByTestId('project-team-DSGN')).not.toBeChecked();
  });

  it('sends every field on save, with an unset date as null', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('project-save'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toContain('/api/projects/project_1');
    const first = calls[0];
    if (first === undefined) throw new Error('no request captured');
    const body = JSON.parse(String((first.init as RequestInit).body));
    expect(body).toMatchObject({
      name: 'Atlas',
      summary: 'The rebuild',
      status: 'in_progress',
      health: 'on_track',
      startDate: '2026-01-01',
      targetDate: null,
      teamIds: ['team_eng'],
    });
  });

  it('adds a team the user ticks', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('project-team-DSGN'));
    await user.click(screen.getByTestId('project-save'));

    await waitFor(() => expect(calls).toHaveLength(1));
    const first = calls[0];
    if (first === undefined) throw new Error('no request captured');
    const body = JSON.parse(String((first.init as RequestInit).body));
    expect(body.teamIds).toEqual(['team_eng', 'team_dsg']);
  });

  it('archives through the archive mode rather than deleting', async () => {
    renderForm();
    const user = userEvent.setup();

    await user.click(screen.getByTestId('project-archive'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toContain('mode=archive');
    const archiveCall = calls[0];
    if (archiveCall === undefined) throw new Error('no request captured');
    expect((archiveCall.init as RequestInit).method).toBe('DELETE');
  });

  it('offers no way to save when the user cannot manage projects', () => {
    renderForm(false);

    expect(screen.queryByTestId('project-save')).toBeNull();
    expect(screen.queryByTestId('project-archive')).toBeNull();
    expect(screen.getByTestId('project-name')).toBeDisabled();
  });
});
