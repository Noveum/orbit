import { can } from '@orbit/shared/policy';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeploymentGuide } from '@/features/settings/deployment-guide.tsx';
import { deploymentGuides } from '@/features/settings/deployment-guides.ts';
import { deploymentStatus } from '@/features/settings/deployment-status.ts';
import { pageContext } from '@/lib/api/handler.ts';

export default async function DeploymentSettingsPage() {
  const { principal } = await pageContext();
  if (!can(principal, 'org:manage')) notFound();
  const checks = deploymentStatus(principal, process.env);
  const guides = deploymentGuides(principal, process.env);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h2 className="font-medium text-lg text-text">Deployment setup</h2>
        <p className="text-muted text-dense">
          Set up services, connect your workspace, then verify delivery. Configured means the
          required settings are present, not that a connection or delivery has been tested.
        </p>
        <p className="text-muted text-xs">
          The server operator manages credentials in the hosting provider or server environment and
          redeploys after changes. Credentials apply to every workspace and are never shown here.
          Workspace admins manage people, notifications and connections in Settings.
        </p>
        <p className="text-muted text-xs">
          This page cannot save server credentials yet. If you operate this installation, follow the
          hosting instructions and provider guides below. Otherwise, share the setup guide with your
          server operator. Never put credentials in chat, issues or screenshots.
        </p>
        <div className="flex flex-wrap gap-4 text-accent text-xs">
          <Link href="/settings/members">Manage members</Link>
          <Link href="/settings/notifications">Notification preferences</Link>
          <Link href="/settings/integrations">Connect integrations</Link>
          <a href="/settings/deployment">Refresh configuration status</a>
          <a
            href="https://github.com/Noveum/orbit/blob/main/docs/self-hosting.md"
            target="_blank"
            rel="noreferrer"
          >
            Deployment guide
          </a>
        </div>
      </header>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="font-medium text-dense text-text">Where to configure your deployment</h3>
        <p className="text-muted text-xs">
          These settings apply to every workspace. Creating a workspace makes you its admin, but
          does not give you control of server credentials.
        </p>
        <ul className="list-disc space-y-2 pl-5 text-muted text-xs">
          <li>
            Docker or RepoCloud: the server operator edits the private .env.docker.local file in the
            Orbit checkout, preserves existing generated credentials and COMPOSE_PROJECT_NAME, then
            rebuilds and recreates the app services using the Docker deployment guide. A container
            restart alone does not load a changed environment file.
          </li>
          <li>
            Vercel: add the variables under Project Settings, Environment Variables for the intended
            environment, then redeploy. Rebuild whenever the public app URL changes.
          </li>
          <li>
            Other Node hosts: update the environment used by all application processes and redeploy.
            Static hosting alone, including a static Netlify deployment, cannot run Orbit.
          </li>
        </ul>
        <div className="flex flex-wrap gap-4 text-accent text-xs underline">
          <a
            href="https://github.com/Noveum/orbit/blob/main/docs/docker-preview.md"
            target="_blank"
            rel="noreferrer"
          >
            Docker and RepoCloud deployment guide
          </a>
          <a
            href="https://github.com/Noveum/orbit/blob/main/docs/self-hosting.md#deploy-on-vercel"
            target="_blank"
            rel="noreferrer"
          >
            Vercel deployment guide
          </a>
        </div>
      </section>
      <nav
        aria-label="Service setup guides"
        className="flex flex-wrap gap-4 text-accent text-xs underline"
      >
        <a href="#email">Email setup</a>
        <a href="#slack">Slack setup</a>
        <a href="#github">GitHub setup</a>
      </nav>
      <ul className="flex flex-col gap-3">
        {checks.map((check) => (
          <li
            key={check.id}
            id={check.id}
            className="flex scroll-mt-4 flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium text-dense text-text">{check.title}</h3>
              <span className="text-muted text-xs">{check.status}</span>
            </div>
            <p className="text-muted text-xs">{check.description}</p>
            {check.variables.length > 0 ? (
              <dl className="flex flex-col gap-1 text-2xs text-muted">
                {check.variables.map((variable) => (
                  <div key={variable} className="flex flex-wrap justify-between gap-2">
                    <dt className="break-all font-mono">{variable}</dt>
                    <dd>
                      {(process.env[variable]?.trim().length ?? 0) > 0
                        ? 'Set in environment'
                        : 'Not set'}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {guides
              .filter((guide) => guide.id === check.id)
              .map((guide) => (
                <DeploymentGuide key={guide.id} guide={guide} />
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
