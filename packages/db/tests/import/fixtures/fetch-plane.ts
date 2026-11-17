import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';

net.Socket.prototype.connect = () => {
  throw new Error('Network is disabled in this fixture.');
};
tls.connect = () => {
  throw new Error('Network is disabled in this fixture.');
};

const html = '<p>&amp;lt;em&amp;gt;literal&amp;lt;/em&amp;gt; &amp;amp; *plain* <em>real</em></p>';
const pages = [{ id: 'page-1', name: 'Literal page' }];
const fixtureFetch = (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(url.origin, 'https://api.plane.so');
  assert(url.pathname.startsWith('/api/v1/workspaces/conversion-fixture/'));
  const path = url.pathname.replace('/api/v1/workspaces/conversion-fixture', '');
  let value: unknown;
  if (path === '/projects/') value = [{ id: 'project-1', identifier: 'FIX', name: 'Fixture' }];
  else if (path === '/projects/project-1/issues/')
    value = [
      {
        id: 'issue-1',
        sequence_id: 1,
        name: 'Literal body',
        priority: 'none',
        state: 'state-1',
        description_html: html,
      },
    ];
  else if (path === '/projects/project-1/pages/') value = pages;
  else if (path === '/projects/project-1/pages/page-1/')
    value = { ...pages[0], description_html: html };
  else if (
    [
      '/members/',
      '/pages/',
      '/projects/project-1/states/',
      '/projects/project-1/labels/',
      '/projects/project-1/cycles/',
      '/projects/project-1/members/',
      '/projects/project-1/issue-types/',
      '/projects/project-1/issues/issue-1/comments/',
    ].includes(path)
  )
    value = [];
  else throw new Error(`Unexpected fixture request: ${path}`);
  return Promise.resolve(Response.json(value));
};
globalThis.fetch = Object.assign(fixtureFetch, {
  preconnect: () => {
    throw new Error('Unexpected preconnect in offline fixture.');
  },
});
