import { afterEach, expect, it, mock, spyOn } from 'bun:test';
import { act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { DevSignIn } from '../../../src/components/auth/dev-sign-in.tsx';
import { ToastProvider } from '../../../src/components/ui/toast.tsx';

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const originalLocation = window.location;
const assign = mock();

afterEach(async () => {
  await act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  mock.restore();
});

it('keeps development sign-in inactive until hydration and submits one request when ready', async () => {
  const users = [
    { email: 'alex@orbit.example', name: 'Alex', image: null },
    { email: 'sam@orbit.example', name: 'Sam', image: null },
  ];
  const view = (
    <ToastProvider>
      <DevSignIn users={users} />
    </ToastProvider>
  );
  container = document.createElement('div');
  container.innerHTML = renderToString(view);
  document.body.append(container);
  const alex = container.querySelector<HTMLButtonElement>(
    '[data-testid="dev-sign-in-alex@orbit.example"]',
  );
  const sam = container.querySelector<HTMLButtonElement>(
    '[data-testid="dev-sign-in-sam@orbit.example"]',
  );
  expect(alex).not.toBeNull();
  expect(sam).not.toBeNull();
  if (alex === null || sam === null) throw new Error('Development sign-in controls are missing');
  expect(alex.disabled).toBe(true);
  expect(sam.disabled).toBe(true);
  const response = Promise.withResolvers<Response>();
  const implementation = Object.assign(async () => await response.promise, {
    preconnect: globalThis.fetch.preconnect,
  });
  const request = spyOn(globalThis, 'fetch').mockImplementation(implementation);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign },
  });
  await act(() => {
    if (container === undefined) throw new Error('Hydration container is missing');
    root = hydrateRoot(container, view);
  });
  expect(alex.disabled).toBe(false);
  expect(sam.disabled).toBe(false);
  await userEvent.setup().click(alex);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('/api/dev/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'alex@orbit.example' }),
  });
  expect(alex.disabled).toBe(true);
  expect(sam.disabled).toBe(true);
  sam.click();
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => response.resolve(new Response(null, { status: 200 })));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/my-issues'));
  expect(request).toHaveBeenCalledTimes(1);
});
