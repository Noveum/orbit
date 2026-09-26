import { Avatar } from '@/components/ui/avatar.tsx';

interface IssueCreatorMetaProps {
  readonly creator: { readonly name: string; readonly image: string | null } | undefined;
  readonly creatorAgentId: string | null | undefined;
  readonly showCreator: boolean;
}

export function IssueCreatorMeta({ creator, creatorAgentId, showCreator }: IssueCreatorMetaProps) {
  if (creatorAgentId !== undefined && creatorAgentId !== null) {
    return (
      <span
        data-testid="issue-creator-agent"
        className="rounded-sm bg-surface-2 px-1 text-2xs text-faint"
        title="Created by an agent"
      >
        Agent
      </span>
    );
  }
  if (!showCreator || creator === undefined) return null;
  return <Avatar name={creator.name} src={creator.image} size="xs" />;
}
