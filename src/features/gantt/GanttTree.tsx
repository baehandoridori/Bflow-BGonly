import { Check, ChevronRight, Circle, Diamond, Eye, EyeOff, Folder, FolderOpen, Layers, MoreHorizontal, Settings2 } from 'lucide-react';
import { isTaskComplete } from './domain';
import { orderedChildren, visibleTreeTasks } from './treeModel';
import { GanttShareTooltip } from './GanttShareTooltip';
import type { GanttProject, GanttSpace, GanttTask } from './types';
import './tree.css';

export interface GanttTreeProps {
  spaces: GanttSpace[]; projects: GanttProject[]; userId: string;
  users: Array<{id:string;name:string}>;
  selectedProject: string|null; selected: string[];
  closedSpaces: string[]; collapsed: string[]; hidden: string[];
  filter: 'all'|'active'|'completed'; search: string; worker: string;
  onToggleFolder(id:string):void; onToggleBranch(id:string):void; onToggleVisibility(id:string):void;
  onSelect(projectId:string,taskId:string|null):void;
  onFolderSettings(space:GanttSpace):void;
  onMenu(project:GanttProject,task:GanttTask|null,x:number,y:number):void;
}

export function GanttTree(props: GanttTreeProps) {
  const {spaces, projects, selected, selectedProject, collapsed, closedSpaces, hidden} = props;
  const menu = (event: React.MouseEvent, project: GanttProject, task: GanttTask|null) => {
    event.stopPropagation();const box = event.currentTarget.getBoundingClientRect();props.onMenu(project,task,box.right,box.bottom);
  };
  const rowKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
    const current = (event.target as HTMLElement).closest<HTMLElement>('.gantt-tree-row');
    if (!current) return;
    event.preventDefault();event.stopPropagation();
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('.gantt-tree-row')];
    const index = rows.indexOf(current), expanded = current.getAttribute('aria-expanded');
    if (event.key === 'ArrowRight' && expanded === 'false' || event.key === 'ArrowLeft' && expanded === 'true') current.querySelector<HTMLButtonElement>('[data-tree-toggle]')?.click();
    else if (event.key === 'ArrowLeft') current.parentElement?.parentElement?.closest('li')?.querySelector<HTMLElement>('.gantt-tree-row')?.focus();
    else rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0,Math.min(rows.length - 1,index+(event.key === 'ArrowUp' ? -1 : 1)))]?.focus();
  };
  const taskRows = (project:GanttProject, parentId:string|null, included:Set<string>, path:string):React.ReactNode =>
    orderedChildren(project,parentId).filter(task => included.has(task.id)).map(task => {
      const group = task.kind === 'group', open = !collapsed.includes(task.id);
      const done = isTaskComplete(project, task), active = selectedProject === project.id && selected.includes(task.id);
      const Icon = group ? Layers : task.kind === 'milestone' ? Diamond : Circle;
      return <li key={task.id} role="none"><div role="treeitem" tabIndex={0} aria-label={`${task.title} · ${group?'그룹':task.kind==='milestone'?'마일스톤':'작업'} · ${path}`} aria-selected={active} aria-expanded={group?open:undefined}
        className={`gantt-tree-row ${active?'selected':''} ${done?'completed':''}`} onDoubleClick={() => props.onSelect(project.id,task.id)} onKeyDown={event => {if(event.target===event.currentTarget&&event.key==='Enter')props.onSelect(project.id,task.id);}}>
        {group?<button type="button" data-tree-toggle aria-label={`${task.title} ${open?'접기':'펼치기'}`} className="gantt-tree-toggle" onClick={() => props.onToggleBranch(task.id)}><ChevronRight size={12}/></button>:<span className="gantt-tree-spacer"/>}
        <Icon size={13} className="gantt-tree-icon"/>
        <button type="button" className="gantt-tree-title" title={`${path} › ${task.title}`} onClick={() => props.onSelect(project.id,task.id)}>{task.title}</button>
        {done&&<Check size={11} aria-label="완료"/>}
        <button type="button" className="gantt-tree-menu" aria-label={`${task.title} 메뉴`} onClick={event=>menu(event,project,task)}><MoreHorizontal size={13}/></button>
      </div>{group&&open&&<ul role="group">{taskRows(project,task.id,included,`${path} › ${task.title}`)}</ul>}</li>;
    });
  return <div className="gantt-folder-tree" role="tree" aria-label="폴더·프로젝트·작업 트리" onKeyDown={rowKey}>
    {[false,true].map(shared=><div key={String(shared)} role="none"><h3>{shared?'공유 폴더':'내 폴더'}</h3><ul role="group">
      {spaces.filter(space=>space.shared===shared).map(space=>{
        const open=!closedSpaces.includes(space.id), FolderIcon=open?FolderOpen:Folder;
        return <li role="none" key={space.id}><div role="treeitem" tabIndex={0} aria-label={space.name} aria-expanded={open} className="gantt-tree-row folder">
          <button type="button" data-tree-toggle className="gantt-tree-toggle" aria-label={`${space.name} ${open?'접기':'펼치기'}`} onClick={()=>props.onToggleFolder(space.id)}><ChevronRight size={12}/></button><FolderIcon size={14} className="gantt-tree-icon"/>
          <button type="button" className="gantt-tree-title" title={space.name} onClick={()=>props.onToggleFolder(space.id)}>{space.name}</button>
          {space.shared&&<GanttShareTooltip space={space} users={props.users}/>}
          {space.ownerId===props.userId&&<button type="button" className="gantt-tree-menu" aria-label={`${space.name} 설정`} onClick={()=>props.onFolderSettings(space)}><Settings2 size={13}/></button>}
        </div>{open&&<ul role="group">{projects.filter(project=>project.spaceId===space.id).map(project=>{
          const included=visibleTreeTasks(project,props.filter,props.search,props.worker);
          if(!included.size&&((props.search&&!project.name.toLocaleLowerCase().includes(props.search.toLocaleLowerCase()))||props.worker||(props.filter==='completed'&&!project.completed)||(props.filter==='active'&&project.completed)))return null;
          const expanded=!collapsed.includes(project.id), active=selectedProject===project.id&&selected.includes(project.id), off=hidden.includes(project.id);
          return <li role="none" key={project.id}><div role="treeitem" tabIndex={0} aria-expanded={expanded} aria-selected={active} aria-label={`${project.name} · 프로젝트`} className={`gantt-tree-row project ${active?'selected':''} ${off?'off':''}`} onKeyDown={event=>{if(event.target===event.currentTarget&&event.key==='Enter')props.onSelect(project.id,null);}}>
            <button type="button" data-tree-toggle className="gantt-tree-toggle" aria-label={`${project.name} ${expanded?'접기':'펼치기'}`} onClick={()=>props.onToggleBranch(project.id)}><ChevronRight size={12}/></button><Layers size={13} className="gantt-tree-icon"/>
            <button type="button" className="gantt-tree-title" title={project.name} onClick={()=>props.onSelect(project.id,null)}>{project.name}</button>
            {project.completed&&<Check size={11} aria-label="완료"/>}
            <button type="button" className="gantt-tree-menu" aria-label={`${project.name} ${off?'차트에 표시':'차트에서 숨기기'}`} onClick={()=>props.onToggleVisibility(project.id)}>{off?<EyeOff size={12}/>:<Eye size={12}/>}</button>
            <button type="button" className="gantt-tree-menu" aria-label={`${project.name} 메뉴`} onClick={event=>menu(event,project,null)}><MoreHorizontal size={13}/></button>
          </div>{expanded&&<ul role="group">{taskRows(project,null,included,`${space.name} › ${project.name}`)}{!project.tasks.length&&<li role="none" className="gantt-tree-empty">작업이 없습니다.</li>}</ul>}</li>;
        })}</ul>}</li>;
      })}
    </ul></div>)}
  </div>;
}
