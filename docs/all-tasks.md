# All tasks

Open **Workspace > All tasks** for a read-only overview of tasks across every
team and project in the current workspace. Workspace users, including
contributors and guests, can read task summaries without joining each team.
Standard issue lists and saved views continue to use team membership.

The overview shows the identifier, title, team, status, assignee, project and
priority. Search matches titles and identifiers. Filter by assignee or status,
and select **Include archived** when needed. Subtasks are included. Results
are ordered by most recently updated, with **Load more** for additional pages.

Task links are available when the current user can open the task's team.
Descriptions, comments, attachments and editing continue to require the
existing team permissions. The new `issue:read:workspace` permission applies
only to summaries in this overview and never crosses workspace boundaries.

The overview refreshes every 30 seconds while open, on returning to the window,
or when **Refresh** is selected. It does not subscribe to other teams' realtime
streams.
