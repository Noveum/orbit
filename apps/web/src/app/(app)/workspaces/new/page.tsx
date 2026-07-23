import { CreateWorkspaceForm } from '@/features/workspaces/create-workspace-form.tsx';
import { requireSession } from '@/lib/auth/session.ts';

export default async function NewWorkspacePage() {
  await requireSession();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-text text-xl">Create a workspace</h1>
        <p className="text-muted text-xs">
          A workspace gets its own teams, issues, and members. You start as its admin with a default
          team, its workflow states, and a starter label set.
        </p>
      </header>
      <CreateWorkspaceForm />
    </div>
  );
}
