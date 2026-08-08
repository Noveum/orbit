import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/render.tsx';

const requestMutate = mock();
let gateway: {
  data: { id: string; title: string; ownerName: string; requested: boolean } | undefined;
  isPending: boolean;
} = { data: undefined, isPending: false };

mock.module('@/lib/query/use-doc-access.ts', () => ({
  useDocGateway: () => gateway,
  useRequestDocAccess: () => ({ mutate: requestMutate, isPending: false }),
}));

mock.module('@/components/ui/toast.tsx', () => ({
  useToast: () => ({ toast: mock(), dismiss: mock() }),
}));

const { DocGateway } = await import('../../../src/features/docs/doc-gateway.tsx');

beforeEach(() => {
  requestMutate.mockClear();
  gateway = {
    data: { id: 'doc_1', title: 'Severance terms', ownerName: 'Ada Author', requested: false },
    isPending: false,
  };
});

describe('the screen behind a doc you cannot read', () => {
  it('names the doc and its owner without showing the body', () => {
    render(<DocGateway docId="doc_1" />);

    const panel = screen.getByTestId('doc-gateway');
    expect(panel.textContent).toContain('Severance terms');
    expect(panel.textContent).toContain('Ada Author');
  });

  it('asks the owner for access, carrying the reason along', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<DocGateway docId="doc_1" />);

    await user.type(screen.getByTestId('doc-gateway-message'), 'Picking up the payroll work');
    await user.click(screen.getByTestId('doc-gateway-request'));

    expect(requestMutate.mock.calls[0]?.[0]).toBe('Picking up the payroll work');
  });

  it('says the request is already in when one is pending', () => {
    gateway = {
      data: { id: 'doc_1', title: 'Severance terms', ownerName: 'Ada Author', requested: true },
      isPending: false,
    };
    render(<DocGateway docId="doc_1" />);

    expect(screen.getByTestId('doc-gateway-waiting')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-gateway-request')).toBeNull();
  });

  it('falls back to not found when the doc is not in this workspace at all', () => {
    gateway = { data: undefined, isPending: false };
    render(<DocGateway docId="doc_1" />);

    expect(screen.queryByTestId('doc-gateway')).toBeNull();
    expect(screen.getByText('Doc not found')).toBeInTheDocument();
  });
});
