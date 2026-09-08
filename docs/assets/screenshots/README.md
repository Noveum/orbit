# Product screenshots

The release gallery uses the fictional Orbit Demo workspace and the seeded
`alex@orbit.example` account. Capture real application screens in light and dark
themes at a 1680 by 1000 viewport with a device scale factor of two.

The main gallery is refreshed for source release `2026.09.08`. It includes
similar-issue suggestions and the workspace project updates feed in both themes.

Start the local app with the demo database, then run from the repository root:

```bash
bun run screenshots
```

To capture selected screens or use another local development port:

```bash
ORBIT_SHOTS_FILTER=board,projects,project-updates bun run screenshots
ORBIT_SHOTS_URL=http://localhost:3001 bun run screenshots
```

The script uses development sign-in, so `ORBIT_DEV_LOGIN=1` must be enabled.
Do not point it at a production workspace. Existing non-demo databases must
not be reset to prepare screenshots; use a separate disposable demo database
when needed.

Review the images after capture. A successful file write alone does not prove
that a page loaded: inspect for skeletons, error messages, missing content,
menus that cover the subject, and identifying data from a real workspace.
The script reports skipped captures and exits unsuccessfully for an incomplete
or empty selection; resolve them before claiming a complete gallery refresh.

The README shows a selection. The gallery also covers issue detail, personal
issues, inbox, projects, workspace project updates, document lists, analytics
views, and both themes. Feature-specific captures such as reviewer controls
may come from the corresponding feature's browser verification and retain
their original capture until that surface changes.
