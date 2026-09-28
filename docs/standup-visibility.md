# Standup task visibility

Standup shows task cards across every team and project in the current workspace,
including teams the viewer has not joined. The existing person tiles include both
assigned tasks and review work. Selecting a person, applying filters, and grouping
cards all use the same workspace scope for rows, counts and filter choices.

The dedicated `standup:read` permission allows all workspace roles to read task
summaries in this view. Cards from inaccessible teams have no detail link, editing
controls or drag action. Issue details and mutations still require their existing
team permissions. Standup does not return descriptions or search their contents.
Standard task lists, saved views and project permissions keep their existing scope.

Standup loads workspace state and project names for its cards and filters without
changing the metadata used elsewhere. Its task queries, counts and metadata refresh
every 30 seconds while open because other teams' realtime streams remain restricted.
