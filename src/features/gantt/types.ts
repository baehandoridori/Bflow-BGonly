export interface GanttMember { userId: string; canEdit: boolean }
export interface GanttSpace {
  id: string; name: string; ownerId: string; shared: boolean;
  members: GanttMember[]; revision: number;
}
export interface GanttSceneLink {
  episodeNumber: number; sheetName: string; sceneId: string; department: 'bg' | 'acting';
}
export interface GanttTask {
  id: string; parentId: string | null; kind: 'task' | 'group' | 'milestone';
  title: string; memo: string; startDate: string; endDate: string;
  allDay: boolean; startTime: string; endTime: string;
  mode: 'auto' | 'manual'; predecessorId: string | null;
  progress: number; progressMode: 'manual' | 'scenes'; sceneLinks: GanttSceneLink[];
  workers: string[]; attendees: string[]; color: string | null;
  calendarId: string | null; calendarEventId: string | null;
  completed: boolean; sortOrder: number;
}
export interface GanttProject {
  id: string; spaceId: string; ownerId: string; name: string; memo: string;
  color: string; completed: boolean; revision: number;
  memberIds: string[] | null; editorIds: string[] | null;
  linkedEpisode: number | null; tasks: GanttTask[];
}
export interface GanttSnapshot { spaces: GanttSpace[]; projects: GanttProject[] }
export type GanttCommand =
  | { type: 'saveSpace'; space: GanttSpace; expectedRevision: number | null }
  | { type: 'saveProject'; project: GanttProject; expectedRevision: number | null }
  | { type: 'deleteProject'; projectId: string; expectedRevision: number }
  | { type: 'deleteSpace'; spaceId: string; expectedRevision: number; requireEmpty?: boolean };
export interface GanttRequest { requestId: string; command: GanttCommand }
export interface GanttGateway {
  read(): Promise<GanttSnapshot>;
  execute(request: GanttRequest): Promise<GanttSnapshot>;
  subscribe?(listener: () => void): () => void;
}
