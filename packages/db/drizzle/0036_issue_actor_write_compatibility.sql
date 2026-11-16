ALTER TABLE "issue" ALTER COLUMN "creator_id" DROP NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_issue_human_actors() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  assignment_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.creator_agent_id IS NOT NULL THEN
      NEW.creator_user_id := NULL;
      NEW.creator_id := NULL;
    ELSE
      NEW.creator_user_id := COALESCE(NEW.creator_user_id, NEW.creator_id);
      NEW.creator_id := NEW.creator_user_id;
    END IF;
    IF NEW.assignee_agent_id IS NOT NULL THEN
      NEW.assignee_user_id := NULL;
      NEW.assignee_id := NULL;
    ELSE
      NEW.assignee_user_id := COALESCE(NEW.assignee_user_id, NEW.assignee_id);
      NEW.assignee_id := NEW.assignee_user_id;
    END IF;
    assignment_changed := true;
  ELSE
    IF NEW.creator_user_id IS DISTINCT FROM OLD.creator_user_id
      OR NEW.creator_agent_id IS DISTINCT FROM OLD.creator_agent_id THEN
      IF NEW.creator_agent_id IS NOT NULL THEN
        NEW.creator_user_id := NULL;
      END IF;
      NEW.creator_id := NEW.creator_user_id;
    ELSIF NEW.creator_id IS DISTINCT FROM OLD.creator_id THEN
      NEW.creator_user_id := NEW.creator_id;
      NEW.creator_agent_id := NULL;
    END IF;
    assignment_changed := NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id
      OR NEW.assignee_agent_id IS DISTINCT FROM OLD.assignee_agent_id;
    IF assignment_changed THEN
      IF NEW.assignee_agent_id IS NOT NULL THEN
        NEW.assignee_user_id := NULL;
      END IF;
      NEW.assignee_id := NEW.assignee_user_id;
    ELSIF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
      NEW.assignee_user_id := NEW.assignee_id;
      NEW.assignee_agent_id := NULL;
      assignment_changed := true;
    END IF;
  END IF;
  IF assignment_changed AND NEW.owner_user_id IS NULL THEN
    NEW.owner_user_id := COALESCE(NEW.assignee_user_id, (
      SELECT owner_user_id FROM agent_identity
      WHERE id = NEW.assignee_agent_id
        AND organization_id = NEW.organization_id
        AND deleted_at IS NULL
    ));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS issue_human_actor_compat_trigger ON "issue";
--> statement-breakpoint
CREATE TRIGGER issue_human_actor_compat_trigger
BEFORE INSERT OR UPDATE OF creator_id, assignee_id, creator_user_id, creator_agent_id, assignee_user_id, assignee_agent_id ON "issue"
FOR EACH ROW EXECUTE FUNCTION sync_issue_human_actors();
