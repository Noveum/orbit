begin;

update public.issue
set
  creator_user_id = creator_id,
  assignee_user_id = assignee_id,
  owner_user_id = assignee_id
where creator_user_id is null
  and creator_agent_id is null;

update public.issue_activity
set principal_user_id = actor_id, principal_name = actor_name
where actor_type = 'user'
  and (principal_user_id is null or principal_name is null);

update public.audit_log
set principal_user_id = actor_id, principal_name = actor_name
where actor_type = 'user'
  and (principal_user_id is null or principal_name is null);

update public.notification
set principal_user_id = actor_id, principal_name = actor_name
where actor_type = 'user'
  and (principal_user_id is null or principal_name is null);

update public.mcp_grant
set principal_name_snapshot = coalesce(public."user".name, 'Former member')
from public."user"
where public."user".id = public.mcp_grant.user_id
  and public.mcp_grant.principal_name_snapshot is null;

update public.mcp_grant
set principal_name_snapshot = 'Former member'
where principal_name_snapshot is null;

update public.mcp_grant
set revoked_at = now(), revoke_reason = 'agent_identity_required'
where agent_identity_id is null
  and revoked_at is null;

delete from public.oauth_access_token
where mcp_grant_id is null
   or mcp_grant_id in (
     select id from public.mcp_grant where agent_identity_id is null
   );

commit;
