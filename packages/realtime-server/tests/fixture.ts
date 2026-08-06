import { db, eq, schema } from '@orbit/db';
import { randomUUIDv7 } from '@orbit/shared/utils';
import type { ConnectionPrincipal } from '../src/auth.ts';

export interface SeededWorkspace {
  readonly organizationId: string;
  readonly adminUserId: string;
  readonly readerUserId: string;
  readonly strangerUserId: string;
  readonly teamCore: string;
  readonly teamOther: string;
  readonly stateId: string;
  readonly issueOnCore: string;
  readonly issueOnOther: string;
  readonly projectWithoutTeams: string;
  readonly projectOnOther: string;
  readonly workspaceDoc: string;
  readonly privateDoc: string;
  readonly docGrantedToReader: string;
  readonly docGrantedToCore: string;
  readonly docGrantedToOther: string;
}

const created: string[] = [];

function id(prefix: string): string {
  return `${prefix}_${randomUUIDv7()}`;
}

async function insertUser(name: string): Promise<string> {
  const userId = id('usr');
  const handle = `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}${userId.slice(-8)}`;
  await db.insert(schema.user).values({
    id: userId,
    name,
    email: `${handle}@orbit.test`,
    handle,
    emailVerified: true,
  });
  return userId;
}

export async function seedWorkspace(name: string): Promise<SeededWorkspace> {
  const organizationId = id('org');
  created.push(organizationId);
  await db.insert(schema.organization).values({
    id: organizationId,
    name,
    slug: organizationId.toLowerCase(),
  });

  const adminUserId = await insertUser('Ada Admin');
  const readerUserId = await insertUser('Rin Reader');
  const strangerUserId = await insertUser('Sam Stranger');

  await db.insert(schema.member).values([
    { id: id('mem'), organizationId, userId: adminUserId, role: 'admin' },
    { id: id('mem'), organizationId, userId: readerUserId, role: 'member' },
    { id: id('mem'), organizationId, userId: strangerUserId, role: 'member' },
  ]);

  const teamCore = id('team');
  const teamOther = id('team');
  await db.insert(schema.team).values([
    { id: teamCore, organizationId, name: 'Core', key: `C${teamCore.slice(-4)}` },
    { id: teamOther, organizationId, name: 'Other', key: `O${teamOther.slice(-4)}` },
  ]);
  await db
    .insert(schema.teamMember)
    .values([{ id: id('tm'), teamId: teamCore, userId: readerUserId }]);

  const stateId = id('state');
  await db.insert(schema.workflowState).values({
    id: stateId,
    organizationId,
    teamId: teamCore,
    name: 'Todo',
    category: 'unstarted',
    color: '#888888',
  });
  const otherStateId = id('state');
  await db.insert(schema.workflowState).values({
    id: otherStateId,
    organizationId,
    teamId: teamOther,
    name: 'Todo',
    category: 'unstarted',
    color: '#888888',
  });

  const issueOnCore = id('iss');
  const issueOnOther = id('iss');
  await db.insert(schema.issue).values([
    {
      id: issueOnCore,
      organizationId,
      teamId: teamCore,
      number: 1,
      identifier: `C-${issueOnCore.slice(-6)}`,
      title: 'On the core team',
      stateId,
      creatorId: adminUserId,
    },
    {
      id: issueOnOther,
      organizationId,
      teamId: teamOther,
      number: 1,
      identifier: `O-${issueOnOther.slice(-6)}`,
      title: 'On the other team',
      stateId: otherStateId,
      creatorId: adminUserId,
    },
  ]);

  const projectWithoutTeams = id('prj');
  const projectOnOther = id('prj');
  await db.insert(schema.project).values([
    {
      id: projectWithoutTeams,
      organizationId,
      name: 'Unowned',
      slug: projectWithoutTeams.toLowerCase(),
    },
    { id: projectOnOther, organizationId, name: 'Owned', slug: projectOnOther.toLowerCase() },
  ]);
  await db
    .insert(schema.projectTeam)
    .values([{ id: id('pt'), projectId: projectOnOther, teamId: teamOther }]);

  const workspaceDoc = id('doc');
  const privateDoc = id('doc');
  const docGrantedToReader = id('doc');
  const docGrantedToCore = id('doc');
  const docGrantedToOther = id('doc');
  await db.insert(schema.doc).values([
    {
      id: workspaceDoc,
      organizationId,
      title: 'Everyone',
      authorId: adminUserId,
      visibility: 'workspace',
    },
    {
      id: privateDoc,
      organizationId,
      title: 'Locked',
      authorId: adminUserId,
      visibility: 'private',
    },
    {
      id: docGrantedToReader,
      organizationId,
      title: 'Shared with a person',
      authorId: adminUserId,
      visibility: 'private',
    },
    {
      id: docGrantedToCore,
      organizationId,
      title: 'Shared with core',
      authorId: adminUserId,
      visibility: 'private',
    },
    {
      id: docGrantedToOther,
      organizationId,
      title: 'Shared with other',
      authorId: adminUserId,
      visibility: 'private',
    },
  ]);
  await db.insert(schema.docAccess).values([
    {
      id: id('acc'),
      organizationId,
      docId: docGrantedToReader,
      subjectType: 'user',
      subjectId: readerUserId,
    },
    {
      id: id('acc'),
      organizationId,
      docId: docGrantedToCore,
      subjectType: 'team',
      subjectId: teamCore,
    },
    {
      id: id('acc'),
      organizationId,
      docId: docGrantedToOther,
      subjectType: 'team',
      subjectId: teamOther,
    },
  ]);

  return {
    organizationId,
    adminUserId,
    readerUserId,
    strangerUserId,
    teamCore,
    teamOther,
    stateId,
    issueOnCore,
    issueOnOther,
    projectWithoutTeams,
    projectOnOther,
    workspaceDoc,
    privateDoc,
    docGrantedToReader,
    docGrantedToCore,
    docGrantedToOther,
  };
}

export async function dropSeededWorkspaces(): Promise<void> {
  for (const organizationId of created.splice(0)) {
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId));
  }
}

export function principalFor(
  workspace: SeededWorkspace,
  overrides: Partial<ConnectionPrincipal> = {},
): ConnectionPrincipal {
  return {
    userId: workspace.readerUserId,
    sessionId: id('ses'),
    name: 'Rin Reader',
    image: null,
    organizationId: workspace.organizationId,
    role: 'member',
    teamIds: [workspace.teamCore],
    ...overrides,
  };
}

export async function insertSession(
  userId: string,
  expiresAt: Date,
): Promise<{ sessionId: string; token: string }> {
  const sessionId = id('ses');
  const token = id('tok');
  await db.insert(schema.session).values({ id: sessionId, userId, token, expiresAt });
  return { sessionId, token };
}
