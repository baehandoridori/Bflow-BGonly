export type RevisionSlashContext = 'bg' | 'acting' | 'all';

export interface RevisionSlashCommandParseResult {
  isRevisionCommand: boolean;
  description: string;
}

interface RevisionSlashUser {
  id: string;
  name: string;
}

export interface RevisionSlashRecipientInput {
  context: RevisionSlashContext;
  bgAssignee?: string | null;
  actingAssignee?: string | null;
  allUsers: readonly RevisionSlashUser[];
  excludeUserId?: string | null;
}

const REVISION_SLASH_RE = /^\/re(?:\s+([\s\S]*))?$/;

export function parseRevisionSlashCommand(input: string): RevisionSlashCommandParseResult {
  const trimmed = input.trim();
  const match = trimmed.match(REVISION_SLASH_RE);
  if (!match) {
    return { isRevisionCommand: false, description: '' };
  }

  return {
    isRevisionCommand: true,
    description: (match[1] ?? '').trim(),
  };
}

function parseAssigneeNames(assignee: string | null | undefined): string[] {
  if (!assignee) return [];
  return assignee
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

export function getDefaultRevisionSlashRecipientIds({
  context,
  bgAssignee,
  actingAssignee,
  allUsers,
  excludeUserId,
}: RevisionSlashRecipientInput): string[] {
  const names =
    context === 'bg'
      ? parseAssigneeNames(bgAssignee)
      : context === 'acting'
        ? parseAssigneeNames(actingAssignee)
        : [...parseAssigneeNames(bgAssignee), ...parseAssigneeNames(actingAssignee)];

  const wantedNames = new Set(names);
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const user of allUsers) {
    if (!wantedNames.has(user.name)) continue;
    if (!user.id || user.id === excludeUserId || seen.has(user.id)) continue;
    ids.push(user.id);
    seen.add(user.id);
  }

  return ids;
}
