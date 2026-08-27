import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = mock();
const toast = mock();
const originalFetch = globalThis.fetch;

mock.module('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast, dismiss: mock() }),
}));

const { GeneralForm } = await import('@/features/settings/general-form.tsx');

function renderForm(agentInstructions = 'Prefer concise issue titles') {
  return render(
    <GeneralForm
      name="Nova"
      logo={null}
      allowedEmailDomains={['orbit.test']}
      agentInstructions={agentInstructions}
      syncId={42}
      canManage
    />,
  );
}

function renderTwoForms() {
  return render(
    <>
      <GeneralForm
        name="Nova"
        logo={null}
        allowedEmailDomains={['orbit.test']}
        agentInstructions="Prefer concise issue titles"
        syncId={42}
        canManage
      />
      <GeneralForm
        name="Nova"
        logo={null}
        allowedEmailDomains={['orbit.test']}
        agentInstructions="Prefer concise issue titles"
        syncId={42}
        canManage
      />
    </>,
  );
}

function captureRequest(): ReturnType<typeof mock> {
  const fetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ organization: { id: 'org_nova', syncId: 43 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  refresh.mockClear();
  toast.mockClear();
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('GeneralForm agent instructions', () => {
  it('renders the current instructions with a locale-independent character count', () => {
    renderForm();

    expect(screen.getByRole('textbox', { name: 'Agent instructions' })).toHaveValue(
      'Prefer concise issue titles',
    );
    expect(screen.getByText('27 / 4000 characters')).toBeVisible();
  });

  it('submits edited instructions in the workspace update payload', async () => {
    const fetchMock = captureRequest();
    const user = userEvent.setup();
    renderForm();

    const editor = screen.getByRole('textbox', { name: 'Agent instructions' });
    await user.clear(editor);
    await user.type(editor, 'Use ENG for engineering issues');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/organizations/current');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toMatchObject({
      agentInstructions: 'Use ENG for engineering issues',
      expectedSyncId: 42,
    });
  });

  it('accepts and submits the 4000-character boundary', async () => {
    const fetchMock = captureRequest();
    const user = userEvent.setup();
    renderForm('');

    const editor = screen.getByRole('textbox', { name: 'Agent instructions' });
    expect(editor).toHaveAttribute('maxlength', '4000');
    fireEvent.change(editor, { target: { value: 'a'.repeat(4000) } });
    expect(screen.getByText('4000 / 4000 characters')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      agentInstructions: 'a'.repeat(4000),
      expectedSyncId: 42,
    });
  });

  it('does not let an old tab overwrite newer instructions when changing another field', async () => {
    const fetchMock = captureRequest();
    const user = userEvent.setup();
    renderTwoForms();

    const editors = screen.getAllByRole('textbox', { name: 'Agent instructions' });
    const secondEditor = editors[1];
    const saveButtons = screen.getAllByRole('button', { name: 'Save changes' });
    const secondSaveButton = saveButtons[1];
    if (secondEditor === undefined || secondSaveButton === undefined) {
      throw new Error('Expected two forms');
    }
    await user.clear(secondEditor);
    await user.type(secondEditor, 'Use ENG for engineering issues');
    await user.click(secondSaveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const names = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="name"]'));
    const firstName = names[0];
    const firstSaveButton = saveButtons[0];
    if (firstName === undefined || firstSaveButton === undefined) {
      throw new Error('Expected two forms');
    }
    await user.clear(firstName);
    await user.type(firstName, 'Nova updated');
    await user.click(firstSaveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const requests = fetchMock.mock.calls as [string, RequestInit][];
    const staleTabRequest = requests[1];
    if (staleTabRequest === undefined) throw new Error('Expected the stale tab request');
    const staleTabPayload = JSON.parse(String(staleTabRequest[1].body)) as Record<string, unknown>;
    expect(staleTabPayload).toEqual({ name: 'Nova updated' });
  });

  it('reports a conflict when two administrators edit the same instructions version', async () => {
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ organization: { id: 'org_nova', syncId: 43 } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 'conflict',
              message:
                'Workspace instructions changed since this page was loaded. Refresh and try again.',
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    renderTwoForms();

    const editors = screen.getAllByRole('textbox', { name: 'Agent instructions' });
    const saveButtons = screen.getAllByRole('button', { name: 'Save changes' });
    const firstEditor = editors[0];
    const secondEditor = editors[1];
    const firstSaveButton = saveButtons[0];
    const secondSaveButton = saveButtons[1];
    if (
      firstEditor === undefined ||
      secondEditor === undefined ||
      firstSaveButton === undefined ||
      secondSaveButton === undefined
    ) {
      throw new Error('Expected two forms');
    }

    await user.clear(secondEditor);
    await user.type(secondEditor, 'Use ENG for engineering issues');
    await user.click(secondSaveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.clear(firstEditor);
    await user.type(firstEditor, 'Use DESIGN for every issue');
    await user.click(firstSaveButton);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstRequest = fetchMock.mock.calls[0];
    const secondRequest = fetchMock.mock.calls[1];
    expect(JSON.parse(String(firstRequest?.[1]?.body))).toMatchObject({ expectedSyncId: 42 });
    expect(JSON.parse(String(secondRequest?.[1]?.body))).toMatchObject({ expectedSyncId: 42 });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Workspace instructions changed since this page was loaded. Refresh and try again.',
    );
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
