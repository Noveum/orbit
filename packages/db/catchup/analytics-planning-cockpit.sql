BEGIN;

CREATE TABLE IF NOT EXISTS public.cycle_issue_membership (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL,
  team_id text NOT NULL,
  cycle_id text NOT NULL,
  issue_id text NOT NULL,
  issue_identifier text NOT NULL,
  added_at timestamp with time zone NOT NULL,
  removed_at timestamp with time zone,
  entry_kind text NOT NULL,
  estimate_at_add integer,
  assignee_id_at_add text,
  project_id_at_add text,
  milestone_id_at_add text,
  coverage text DEFAULT 'captured' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cycle_issue_membership_organization_id_organization_id_fk
    FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE,
  CONSTRAINT cycle_issue_membership_team_id_team_id_fk
    FOREIGN KEY (team_id) REFERENCES public.team(id) ON DELETE CASCADE,
  CONSTRAINT cycle_issue_membership_cycle_id_cycle_id_fk
    FOREIGN KEY (cycle_id) REFERENCES public.cycle(id) ON DELETE CASCADE,
  CONSTRAINT cycle_issue_membership_assignee_id_at_add_user_id_fk
    FOREIGN KEY (assignee_id_at_add) REFERENCES public."user"(id) ON DELETE SET NULL,
  CONSTRAINT cycle_issue_membership_project_id_at_add_project_id_fk
    FOREIGN KEY (project_id_at_add) REFERENCES public.project(id) ON DELETE SET NULL,
  CONSTRAINT cycle_issue_membership_milestone_id_at_add_milestone_id_fk
    FOREIGN KEY (milestone_id_at_add) REFERENCES public.milestone(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.cycle_issue_outcome (
  id text PRIMARY KEY NOT NULL,
  organization_id text NOT NULL,
  team_id text NOT NULL,
  cycle_id text NOT NULL,
  issue_id text NOT NULL,
  issue_identifier text NOT NULL,
  planned boolean DEFAULT false NOT NULL,
  estimate_at_commitment integer,
  estimate_at_close integer,
  assignee_id_at_close text,
  project_id_at_close text,
  milestone_id_at_close text,
  outcome text NOT NULL,
  completed_at timestamp with time zone,
  closed_at timestamp with time zone NOT NULL,
  rollover_cycle_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT cycle_issue_outcome_organization_id_organization_id_fk
    FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE,
  CONSTRAINT cycle_issue_outcome_team_id_team_id_fk
    FOREIGN KEY (team_id) REFERENCES public.team(id) ON DELETE CASCADE,
  CONSTRAINT cycle_issue_outcome_cycle_id_cycle_id_fk
    FOREIGN KEY (cycle_id) REFERENCES public.cycle(id) ON DELETE CASCADE,
  CONSTRAINT cycle_issue_outcome_assignee_id_at_close_user_id_fk
    FOREIGN KEY (assignee_id_at_close) REFERENCES public."user"(id) ON DELETE SET NULL,
  CONSTRAINT cycle_issue_outcome_project_id_at_close_project_id_fk
    FOREIGN KEY (project_id_at_close) REFERENCES public.project(id) ON DELETE SET NULL,
  CONSTRAINT cycle_issue_outcome_milestone_id_at_close_milestone_id_fk
    FOREIGN KEY (milestone_id_at_close) REFERENCES public.milestone(id) ON DELETE SET NULL,
  CONSTRAINT cycle_issue_outcome_rollover_cycle_id_cycle_id_fk
    FOREIGN KEY (rollover_cycle_id) REFERENCES public.cycle(id) ON DELETE SET NULL
);

ALTER TABLE public.cycle_progress_snapshot
  ADD COLUMN IF NOT EXISTS captured_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cycle_progress_snapshot
  ADD COLUMN IF NOT EXISTS is_final boolean DEFAULT false NOT NULL;

CREATE INDEX IF NOT EXISTS cycle_issue_membership_cycle_added_idx
  ON public.cycle_issue_membership USING btree (cycle_id, added_at);
CREATE INDEX IF NOT EXISTS cycle_issue_membership_cycle_removed_idx
  ON public.cycle_issue_membership USING btree (cycle_id, removed_at);
CREATE INDEX IF NOT EXISTS cycle_issue_membership_issue_added_idx
  ON public.cycle_issue_membership USING btree (issue_id, added_at);
CREATE UNIQUE INDEX IF NOT EXISTS cycle_issue_membership_one_open_per_issue_unique
  ON public.cycle_issue_membership USING btree (issue_id)
  WHERE removed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cycle_issue_outcome_cycle_issue_unique
  ON public.cycle_issue_outcome USING btree (cycle_id, issue_id);
CREATE INDEX IF NOT EXISTS cycle_issue_outcome_cycle_outcome_idx
  ON public.cycle_issue_outcome USING btree (cycle_id, outcome);
CREATE INDEX IF NOT EXISTS cycle_issue_outcome_completion_attribution_idx
  ON public.cycle_issue_outcome USING btree (
    organization_id,
    issue_id,
    completed_at,
    closed_at
  )
  WHERE outcome = 'completed';
CREATE INDEX IF NOT EXISTS issue_activity_assignee_attribution_idx
  ON public.issue_activity USING btree (organization_id, issue_id, created_at)
  WHERE field = 'assigneeId';

COMMIT;
