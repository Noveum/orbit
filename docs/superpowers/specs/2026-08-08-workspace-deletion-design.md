# Workspace deletion design

## Goal

Add a permanent workspace deletion flow to General settings. An administrator can inspect a categorized inventory, confirm the exact active workspace name, and delete that workspace together with its database records and object storage. The operation must remain tenant scoped and must not accept a caller supplied organization id.

## Product behavior

General settings ends with an administrator-only danger zone. Selecting `Delete workspace` opens a dialog that loads a fresh deletion summary for the active workspace.

The dialog shows counts for:

- members
- teams
- projects
- issues
- documents
- files, total file size, and stored version history when present
- integrations
- webhooks

It also states that comments, cycles, milestones, modules, labels, saved views, notifications, activity, invitations, OAuth grants, API keys, repository links, automations, and workspace settings are included. User accounts and their data in other workspaces are not deleted.

The administrator must type the exact workspace name. The destructive button remains disabled while the summary is loading or the typed name differs. The first confirmation locks the workspace even when a recent upload is still protected. A pending deletion changes the danger zone into a retry flow, keeps the exact-name requirement, and disables the retry until every upload capability has drained. The dialog explains that deletion is permanent.

If the deleted workspace is not the user's only workspace, the client activates another membership and performs a full navigation to `/my-issues`. If no membership remains, it navigates to `/workspaces/new`.

## Authorization and tenant isolation

The shared policy adds `org:delete`, granted only to the administrator role. The summary and deletion services both call `assertCan` on the server.

The API is rooted at `/api/organizations/current/deletion`. It never accepts an organization id, slug, or storage prefix. Both `GET` and `DELETE` resolve the workspace from the authenticated principal. The delete body contains only the workspace-name confirmation. This makes a cross-workspace request impossible even when the caller administers more than one workspace.

The confirmation is preserved exactly and compared case-sensitively with the current database value while the organization row is locked. Surrounding spaces are rejected instead of silently changed. A stale dialog cannot delete a workspace after another administrator renames it.

## Deletion summary

`getOrganizationDeletionSummary` returns the organization name, categorized counts, actual stored object bytes, stored object-version bytes, an optional `availableAt` timestamp, and an optional `deletionRequestedAt` timestamp. Database counts come from bounded aggregate queries over direct organization columns. File counts and bytes come from `StorageDriver.summarizePrefix`, so pending uploads, orphaned objects, and recoverable historical versions under the organization prefix are visible even when they do not have an attachment row. The summary does not fetch row bodies or enumerate names.

`availableAt` protects outstanding presigned uploads. A nullable `attachment.uploadExpiresAt` records the expiration of each committed presigned target and remains null for inline uploads. The summary uses the later of the latest recorded expiration plus a 15-minute upload-completion grace and the deletion request plus the 15-minute URL lifetime and 15-minute completion grace. Once deletion is pending, the dialog names when a retry becomes available and the server refuses an early cleanup even if a client bypasses the UI.

## Upload and deletion serialization

Storage keys already begin with `<organizationId>/`. Deleting the whole prefix removes tracked attachments, pending uploads, and orphaned objects.

S3 checks a presigned URL when the HTTP request begins, so a request started before expiration can finish afterward. A prefix that was empty at deletion time could otherwise receive a late upload. Creating a presigned target is also external work: the target can remain valid if its database transaction later fails and no attachment guard row is committed. The upload registration and deletion paths therefore serialize on the organization row, and every confirmed deletion drains both recorded and potentially unrecorded capabilities:

1. Upload registration locks the organization row before it creates a target and attachment record.
2. The target expiration is stored on the attachment, and the transaction commits before the target is returned to the browser.
3. Workspace deletion obtains the same lock and commits `organization.deletionRequestedAt` before storage work begins.
4. Upload registration and inline storage reject a workspace carrying that timestamp, so no new capability or object can be created.
5. Final cleanup waits until both every recorded target expiration plus completion grace and the deletion timestamp plus one full URL lifetime and completion grace have passed.
6. The timestamp-based drain covers a target issued immediately before deletion whose attachment insert or transaction commit failed.

Inline uploads use the same organization lock around storage and attachment registration. A deletion that wins the lock removes the organization before a waiting upload can proceed. The waiting upload then fails closed instead of recreating the prefix.

The upload URL lifetime and completion grace are exported from the storage package so registration, migration backfill, summary, deletion, and tests use the same values. The migration conservatively gives every recently created existing attachment an expiration based on its creation time. The nullable column also has a 15-minute database default, so an older application instance that omits it during a rolling release remains protected. The new inline-upload path explicitly stores null.

## Storage cleanup

`StorageDriver` gains `summarizePrefix(prefix)` and `deletePrefix(prefix)`. Both operations use the same strict prefix validation. The summary walks every page and totals the exact objects and bytes reported by S3. The deletion implementation:

1. validates a non-empty safe prefix ending in `/`
2. lists all current objects under the prefix with pagination
3. deletes listed keys in S3 batch limits
4. lists object versions and delete markers and permanently deletes each version id
5. treats an empty prefix as success
6. reports any per-object deletion error as an internal domain error
7. lists again until the prefix and its version history are empty

The implementation sends exact keys and version ids returned by S3 and never broadens the requested prefix. Truncated version pages must include both continuation markers required by S3 or cleanup fails closed. Providers such as Cloudflare R2 that return `501 Not Implemented` for the version-listing API fall back to current-object cleanup because they do not expose S3 object versioning. Permission or partial-delete errors continue to fail closed. AWS S3 policies used by Orbit need `s3:ListBucketVersions` and `s3:DeleteObjectVersion` in addition to current-object list and delete permissions. Tests cover pagination, more than one deletion batch, version history, delete markers, unsupported version APIs, empty prefixes, malformed prefixes, and partial S3 errors.

## Database cleanup

PostgreSQL and object storage cannot share one atomic transaction. The deletion service therefore uses a durable two-phase retry state.

The first transaction locks the active organization, locks and rechecks the caller's current membership role, rechecks the confirmation, and commits `organization.deletionRequestedAt`. A demoted or removed administrator cannot start or resume deletion using a stale principal. Once this state is present, normal API and page access is redirected or rejected, uploads cannot create new objects, ordinary organization lists omit the workspace, MCP and realtime authentication fail closed, and public docs and attachments stop resolving. The deletion summary and delete endpoint remain available. The app switcher includes pending workspaces only for their administrators, so an authorized retry remains discoverable after a sign-out or workspace switch.

The readiness transaction repeats the lock, role, and confirmation checks, then calculates the later of the tracked-upload guard and deletion-request drain. An early retry returns that exact timestamp without touching storage. A ready retry releases the transaction before it deletes the exact storage prefix. Because the durable marker blocks uploads and every normal ingress, the prefix remains quiescent while paginated cleanup runs.

After storage cleanup, a short final transaction repeats the lock, role, confirmation, and readiness checks. It clears `session.active_organization_id`, chooses a next organization that is not itself pending deletion, and deletes the organization so existing foreign keys cascade through workspace-owned rows. User, account, passkey, and avatar records remain because they belong to the person rather than a workspace.

If storage fails, the database graph remains intact and the deletion timestamp from the first transaction stays committed. If a final database statement or commit fails after storage cleanup, the graph and durable timestamp also remain. The dialog can retry the same endpoint, and prefix deletion is idempotent even after partial or complete cleanup. A successful final commit removes the organization and its deletion state together.

The schema migration adds `attachment.upload_expires_at`, its conservative backfill, and `organization.deletion_requested_at`.

A database schema regression test queries PostgreSQL metadata and requires every direct foreign key to `organization.id` to use `ON DELETE CASCADE`. The session field is the intentional non-foreign-key exception and is covered by service tests. This prevents a future workspace table from silently surviving deletion or blocking it.

The transaction returns the deleting user's next organization id, if one exists, plus the deleted organization id and name.

## Realtime behavior

The shared control protocol adds an `organization_deleted` message carrying the organization id. After the database commit, the route publishes this control message. The realtime hub closes every connection authenticated for that organization with the existing organization-forbidden close code and an `organization_deleted` reason.

The calling tab navigates immediately from the delete response. The web realtime provider gains recovery for the organization-forbidden close code. It lists the signed-in user's remaining organizations through the existing API, activates the first result, and performs a full navigation to `/my-issues`, or navigates to `/workspaces/new` when the list is empty. This also repairs tabs affected by a membership removal. No deleted organization data remains subscribed in memory.

Publishing is best effort after commit, matching existing delta behavior. A missed control message cannot restore access because membership validation fails on the next request, subscription, or connection.

While deletion is pending, new realtime tickets are refused and periodic membership validation closes existing connections. The app layout does not mount a realtime client for the pending workspace.

## API responses and errors

`GET /api/organizations/current/deletion` returns `{ summary }` with private no-cache headers.

`DELETE /api/organizations/current/deletion` parses `{ confirmation }` through the shared validator and returns `{ deletedOrganizationId, nextOrganizationId }`.

Expected failures are:

- `401` when signed out
- `403` when the role lacks `org:delete`
- `409` when the confirmation does not match or an upload URL or started upload remains protected
- `500` when object storage cannot be fully cleaned

The UI keeps the dialog open and displays the server message. It does not remove the workspace locally until the delete response succeeds.

## UI structure and accessibility

The existing General form remains focused on editable workspace fields. A separate `WorkspaceDangerZone` client component owns summary loading, confirmation state, deletion, errors, and navigation.

The server page passes the active organization name, deletion timestamp, and `can(principal, 'org:delete')`. Non-admin users do not receive the destructive control. A pending workspace disables ordinary settings writes and labels the action as a retry.

The dialog uses the shared Radix-based dialog, an explicit title and description, a labelled confirmation input, an alert region for errors, and a danger button. Focus starts on the dialog content rather than the delete button. Closing is disabled only during the final request. All colors and transitions use existing tokens.

## Testing

Shared tests cover the validator and `org:delete` permission matrix.

Storage tests cover safe prefix validation, current and version summary pagination, byte totals, deletion pagination, batch deletion, historical versions, delete markers, providers without a version API, idempotent empty cleanup, and partial errors.

Core integration tests cover:

- summary counts and file bytes
- administrator-only access
- exact-name confirmation
- stale-name refusal after rename
- active-workspace scoping when one administrator belongs to two workspaces
- preservation of the neighboring workspace and shared users
- deletion of every direct organization table through cascades
- clearing active session references without deleting user sessions
- presigned expiration storage, conservative migration backfill, tracked completion-grace blocking, untracked capability draining, and both exact boundaries
- stale administrator role refusal inside readiness and final transactions
- durable retry state with no database transaction held during storage cleanup
- final database statement and commit failures after storage cleanup
- pending-deletion access locks for APIs, uploads, public docs, public attachments, MCP principals, and realtime principals
- upload and deletion lock ordering
- selection of the next surviving workspace

Realtime contract and hub tests cover closing only connections for the deleted organization. Web realtime tests cover selecting another organization and the no-membership workspace-creation fallback after a terminal organization close.

Web route tests cover authentication, authorization, validation, summary headers, successful deletion, publish behavior, and storage failure responses. Component tests cover summary loading, categorized counts, byte formatting, exact confirmation, recent-upload messaging, error retry, single submission, and both navigation outcomes.

The completed branch must pass focused package tests and `ORBIT_TEST_LANE=workspace_deletion bun run verify`. The pull request includes a screenshot of the dialog in both themes when practical.

## Out of scope

This change does not delete a user's account, data in another workspace, or third-party accounts. Removing an Orbit integration deletes its stored credentials, grants, repository associations, channel associations, and webhook configuration. It does not uninstall an app from the administrator's GitHub, Slack, or other provider account.

This change does not add soft deletion, restoration, data export, scheduled deletion, or a second workspace selection control inside the dialog.
