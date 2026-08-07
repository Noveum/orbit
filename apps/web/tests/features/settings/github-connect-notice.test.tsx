import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import {
  GithubConnectNotice,
  githubConnectStatusOf,
} from '../../../src/features/settings/github-connect-notice.tsx';

describe('githubConnectStatusOf', () => {
  it('accepts every status the callback can redirect with', () => {
    expect(githubConnectStatusOf('connected')).toBe('connected');
    expect(githubConnectStatusOf('error')).toBe('error');
    expect(githubConnectStatusOf('denied')).toBe('denied');
    expect(githubConnectStatusOf('claimed')).toBe('claimed');
  });

  it('refuses anything else, so the page cannot echo attacker text back', () => {
    expect(githubConnectStatusOf('<script>alert(1)</script>')).toBeNull();
    expect(githubConnectStatusOf(['connected'])).toBeNull();
    expect(githubConnectStatusOf(undefined)).toBeNull();
  });
});

describe('GithubConnectNotice', () => {
  it('confirms a successful connection and points at the next step', () => {
    render(<GithubConnectNotice status="connected" />);
    expect(screen.getByRole('status')).toHaveTextContent(/GitHub is connected/);
  });

  it('explains that the installation belongs to another workspace', () => {
    render(<GithubConnectNotice status="claimed" />);
    expect(screen.getByRole('status')).toHaveTextContent(/already connected to another Orbit/);
  });

  it('explains that the install was only requested, not approved', () => {
    render(<GithubConnectNotice status="denied" />);
    expect(screen.getByRole('status')).toHaveTextContent(/not approved for your account/);
  });

  it('tells the person to start again when something went wrong', () => {
    render(<GithubConnectNotice status="error" />);
    expect(screen.getByRole('status')).toHaveTextContent(/Start the connection again/);
  });
});
