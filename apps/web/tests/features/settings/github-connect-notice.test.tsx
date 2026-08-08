import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import {
  GithubConnectNotice,
  githubConnectStatusOf,
  misroutedGithubInstall,
} from '../../../src/features/settings/github-connect-notice.tsx';

describe('githubConnectStatusOf', () => {
  it('accepts every status the callback can redirect with', () => {
    expect(githubConnectStatusOf('connected')).toBe('connected');
    expect(githubConnectStatusOf('error')).toBe('error');
    expect(githubConnectStatusOf('denied')).toBe('denied');
    expect(githubConnectStatusOf('claimed')).toBe('claimed');
    expect(githubConnectStatusOf('unverified')).toBe('unverified');
    expect(githubConnectStatusOf('misrouted')).toBe('misrouted');
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

describe('misroutedGithubInstall', () => {
  it('spots an install GitHub delivered to the settings page instead of the callback', () => {
    expect(misroutedGithubInstall({ installation_id: '152125342', setup_action: 'install' })).toBe(
      true,
    );
  });

  it('ignores the page loaded normally', () => {
    expect(misroutedGithubInstall({})).toBe(false);
    expect(misroutedGithubInstall({ github: 'connected' })).toBe(false);
  });

  it('ignores a repeated parameter rather than trusting an array', () => {
    expect(misroutedGithubInstall({ installation_id: ['1', '2'], setup_action: 'install' })).toBe(
      false,
    );
  });

  it('holds the installation id to the digits GitHub actually sends', () => {
    expect(misroutedGithubInstall({ installation_id: 'abc', setup_action: 'install' })).toBe(false);
    expect(misroutedGithubInstall({ installation_id: '', setup_action: 'install' })).toBe(false);
    expect(
      misroutedGithubInstall({ installation_id: '1'.repeat(33), setup_action: 'install' }),
    ).toBe(false);
  });

  it('holds the action to the two GitHub uses for a finished install', () => {
    expect(misroutedGithubInstall({ installation_id: '152125342', setup_action: 'update' })).toBe(
      true,
    );
    expect(misroutedGithubInstall({ installation_id: '152125342', setup_action: 'request' })).toBe(
      false,
    );
    expect(misroutedGithubInstall({ installation_id: '152125342' })).toBe(false);
  });
});

describe('GithubConnectNotice for a misconfigured app', () => {
  it('names the Setup URL when GitHub delivered the install to the wrong place', () => {
    render(<GithubConnectNotice status="misrouted" />);
    expect(screen.getByRole('status')).toHaveTextContent(/Setup URL/);
    expect(screen.getByRole('status')).toHaveTextContent(/api\/integrations\/github\/callback/);
  });

  it('names the user authorization setting when the install carried no proof of ownership', () => {
    render(<GithubConnectNotice status="unverified" />);
    expect(screen.getByRole('status')).toHaveTextContent(/Request user authorization/);
    expect(screen.getByRole('status')).toHaveTextContent(/GITHUB_APP_CLIENT_ID/);
  });
});
