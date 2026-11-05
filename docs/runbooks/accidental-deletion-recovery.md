# Accidental deletion recovery runbook

Use this procedure after deleting a workspace, project, document, or user whose records
must be recovered from a backup taken before the deletion.

## Recovery strategy

The supported recovery operation restores a complete backup into an isolated environment.
It preserves users, authentication accounts and sessions, workflow states, team memberships,
cycles, milestones, parent issues, labels, reviewers, grants, attachment references, and the
rest of the relational graph together. Orbit does not provide a selective workspace or
entity import tool. Do not copy a subset of tables into production: required foreign keys,
parent relationships, global users, and newer live changes can make that import incomplete
or inconsistent.

A full restore returns every workspace to the backup time. Keep the current deployment
available for comparison while evaluating the restored environment. If unrelated live
changes must be retained, use the restored environment to inspect or export the missing
content for manual recreation through normal application workflows. Do not promote the
backup database over the live database in that case.

## Step 1: Preserve the incident state

Pause writes if the restored environment may replace the live deployment. Create a new
backup of the current database and object store before changing either. Record the deletion
time, affected IDs, backup time, and the changes that would be lost by reverting to it.

## Step 2: Restore the complete backup into an isolated environment

Provision a separate empty database and object-storage bucket. Use separate storage
credentials and Redis, and configure the recovery deployment to point only at those
resources. Follow [Routine restore into a test environment](./routine-restore-test-environment.md)
with the backup from before the deletion. Restore both the database and objects, then run
validation against the explicit recovery database URL. Keep the live connection URLs out
of the recovery deployment environment.

## Step 3: Verify the recovered content and access

Locate the deleted entity in the restored deployment. For a deleted workspace, check its
teams and workflow states, projects and milestones, issues and sub-issues, comments,
documents, labels, and attachments. Download representative attachments and compare their
contents. Sign in as a restored administrator and ordinary member, confirm the member sees
only their teams, and confirm expired sessions and revoked grants remain refused.

Run the recovery drill against separately provisioned disposable resources before relying
on this procedure. Its representative records exercise the complete backup and restore
path and check authentication records, team access, and attachment hashes.

## Step 4: Recover content or promote the verified deployment

If retaining newer live changes is required, recreate the missing content through the live
application using the isolated restored deployment as the reference. Parent issues must be
created before their children. Reapply labels, reviewers, milestones, and attachments using
the application so normal validation, permissions, identifiers, and realtime events apply.

If reverting all workspaces to the backup time is acceptable, obtain incident-owner sign-off
on the recorded data-loss window. Keep writes paused, retain the incident backup, point the
application at the verified restored database and object bucket, and validate that explicit
database URL again before reopening writes. Follow the deployment cutover and rollback steps
in [Complete host loss](./complete-host-loss.md).

## Step 5: Retire the isolated recovery resources

After confirming recovery with affected users, remove only the disposable database, Redis,
and bucket created for this incident. Retain the source backup, incident-state backup,
validation report, and recovery decision according to your retention policy.
