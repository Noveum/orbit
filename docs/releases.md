# Releasing and upgrading Orbit

Orbit publishes source snapshots in the
[source repository's GitHub Releases](https://github.com/Noveum/orbit/releases).
The [changelog](https://github.com/Noveum/orbit/blob/main/CHANGELOG.md) records
each release's features, fixes, and upgrade requirements.

## Versioning and compatibility

Release tags use the UTC date: `YYYY.MM.DD`. Additional releases on the same day
use `YYYY.MM.DD-2`, then `-3`. Tags identify immutable source snapshots. Private
workspace package versions are not the release version and are not published
as a collection of packages.

These are source releases with **Preview** self-hosting support. A dated tag
does not promise semantic-version compatibility, certify a new hosting
provider, or complete the [readiness requirements](open-source-readiness.md).
Read the upgrade notes for every release between your current and target tag.

GitHub supplies source archives for each tag. The project does not yet publish
release container images, signed binary artifacts, SBOMs, or provenance
attestations. The reference deployment remains the Next.js app on Vercel;
the portable realtime host is not yet a supported production deployment.

## Prepare a release

1. Inspect open pull requests. Include only changes that meet the repository's
   review policy: current `main` incorporated into the branch, completed bot
   reviews, resolved threads, and green checks against that state. Apply any
   required production migration before merging a schema change.
2. Prepare a release pull request into `main`. Update `CHANGELOG.md`, the
   README, relevant operator and feature documentation, and screenshots. Keep
   blocked or unmerged work out of the release claims.
3. Capture screenshots from the local seeded demo app in both themes with
   `bun run screenshots`. Inspect every changed image for loading states,
   errors, and non-demo data. See the
   [screenshot guide](assets/screenshots/README.md).
4. Run `bun run verify` and `bun run docs:build`. Review the diff for comments,
   em dash characters, broken links, and unexpected files. Complete hosted CI
   and reviews before merging the release pull request.
5. Publish a dated tag on the verified `main` commit. Use the matching changelog
   entry as the GitHub release body, including upgrade notes and the comparison
   link. Verify that the published tag points to the intended commit and that
   the source archives and release page are accessible.

The **Automated Releases** workflow runs weekly and supports manual dispatch.
It pins a commit from `main`, generates notes from the previous published
release, and creates or recovers a dated tag and release. It does not update
the README, changelog, or screenshots, and it does not replace the verification
and review steps above. For a curated release, merge those updates first and
publish the matching notes for the selected tag. Never move an existing tag to
a different commit; use the next date suffix instead.

## Upgrade an existing installation

1. Record the current tag and deployed commit. Read the intervening changelog
   entries and configuration changes, and back up PostgreSQL and uploaded files.
2. Check out the target source tag and run `bun install --frozen-lockfile`.
3. Apply and verify migrations using a direct or session-mode database
   connection before deploying the application:

   ```bash
   DIRECT_URL="postgres://..." bun run db:release
   DATABASE_URL="postgres://..." bun run db:check-drift
   ```

4. Build and deploy using the [self-hosting guide](self-hosting.md). Keep any
   newly introduced capability gates disabled until their rollout requirements
   have been met.
5. Verify sign-in, workspace access, issue creation and editing, realtime
   updates between two tabs, document rendering, and attachment access. Check
   OAuth and integration flows that your installation enables.

`bun run db:seed` is for disposable demo databases and resets its target. It is
never an upgrade step. `bun run db:push` is a development command; production
uses the ordered migrations above.

## Roll back

Restore the previous application commit only when it is compatible with the
current database. Keep compatible additive schema changes in place. Never edit
or remove an applied migration to simulate a rollback. Use a forward repair or
the database provider's recovery procedure when data or schema must be
restored. The [database release guide](database-releases.md#rollback) describes
the migration policy.
