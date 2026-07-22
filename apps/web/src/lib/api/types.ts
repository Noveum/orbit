import type {
  ActivityRow,
  CommentRow,
  CycleRow,
  IssueRow,
  LabelRow,
  ProjectRow,
  ReactionRow,
  TeamRow,
  WorkflowStateRow,
} from '@orbit/core';

export type Serialized<T> = {
  [K in keyof T]: T[K] extends Date
    ? string
    : T[K] extends Date | null
      ? string | null
      : T[K] extends Date | undefined
        ? string | undefined
        : T[K];
};

export type Issue = Serialized<IssueRow> & { readonly labelIds: readonly string[] };
export type WorkflowState = Serialized<WorkflowStateRow>;
export type Label = Serialized<LabelRow>;
export type Team = Serialized<TeamRow>;
export type Project = Serialized<ProjectRow>;
export type Cycle = Serialized<CycleRow>;
export type Activity = Serialized<ActivityRow>;
export type Reaction = Serialized<ReactionRow>;

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly handle: string | null;
  readonly role: string;
}

export interface Comment {
  readonly comment: Serialized<CommentRow>;
  readonly bodyHtml: string;
  readonly reactions: readonly Reaction[];
}

export interface Bootstrap {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: string;
  readonly teams: readonly Team[];
  readonly activeTeamId: string | null;
  readonly states: readonly WorkflowState[];
  readonly labels: readonly Label[];
  readonly members: readonly Member[];
  readonly projects: readonly Project[];
  readonly cycles: readonly Cycle[];
  readonly issues: readonly Issue[];
}

export interface IssueDetail {
  readonly issue: Issue;
  readonly descriptionHtml: string;
  readonly activity: readonly Activity[];
  readonly subIssues: readonly Issue[];
  readonly subscribed: boolean;
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}
