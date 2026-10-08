import { useState } from 'react';
import { FileImage, FileText, FolderOpen, Link2, RefreshCw, Unlink } from 'lucide-react';
import { chooseWorkFile, openWorkPath } from '@/services/sceneWorkLinkService';
import { backgroundFileName } from './fileLinks';

function FileLink({ kind, path, canEdit, disabled, onConnect, onDisconnect, onChooseImage, onRefresh, onError }: {
  kind: 'work' | 'image'; path: string; canEdit: boolean; disabled: boolean;
  onConnect: (path: string) => Promise<void> | void;
  onDisconnect: () => void; onChooseImage?: () => void; onRefresh?: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false), [value, setValue] = useState(path), [choosing, setChoosing] = useState(false);
  const label = kind === 'work' ? '작업파일' : '이미지파일';
  const Icon = kind === 'work' ? FileText : FileImage;
  const blocked = disabled || choosing;
  const connect = async (next: string) => {
    if (!canEdit || blocked || !next.trim()) return;
    setChoosing(true); onError('');
    try { await onConnect(next.trim()); setEditing(false); } catch (error) { onError(error instanceof Error ? error.message : '파일을 연결하지 못했습니다.'); }
    finally { setChoosing(false); }
  };
  const pickWorkFile = async () => {
    setChoosing(true); onError('');
    try { const selected = await chooseWorkFile(); if (selected) { await onConnect(selected); setEditing(false); } }
    catch (error) { onError(error instanceof Error ? error.message : '파일을 선택하지 못했습니다.'); }
    finally { setChoosing(false); }
  };
  const open = async () => {
    onError('');
    try { const result = await openWorkPath(path); if (!result.ok) throw new Error(result.error || '경로를 확인해 주세요.'); }
    catch { onError(`${label}을 열지 못했습니다. 파일 위치와 공유 드라이브 연결을 확인해 주세요.`); }
  };
  return <section className="bg-file-link" aria-label={`${label} 연결`}>
    <div className="bg-file-link-heading"><Icon size={17} /><div><strong>{label}</strong><span title={path || undefined}>{backgroundFileName(path)}</span></div></div>
    <div className="bg-file-link-actions">
      {canEdit && <>
        <button type="button" disabled={blocked} onClick={kind === 'image' ? onChooseImage : () => void pickWorkFile()}><Link2 size={13} />{path ? '파일 변경' : '파일 연결'}</button>
        <button type="button" disabled={blocked} onClick={() => { setValue(path); setEditing(!editing); }}>{editing ? '접기' : '경로 입력'}</button>
      </>}
      {path && <button type="button" disabled={blocked} onClick={() => void open()}><FolderOpen size={13} />열기</button>}
      {canEdit && path && <>
        {onRefresh && <button type="button" disabled={blocked} onClick={onRefresh}><RefreshCw size={13} />이미지 갱신</button>}
        <button type="button" disabled={blocked} onClick={() => { onDisconnect(); setEditing(false); }}><Unlink size={13} />연결 해제</button>
      </>}
    </div>
    {editing && canEdit && <div className="bg-file-path-editor">
      <input aria-label={`${label} 경로`} maxLength={4096} value={value} disabled={blocked} placeholder={kind === 'image' ? '예: G:\\배경\\교실_낮.png' : '예: G:\\배경\\교실_낮.psd'} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void connect(value); } }} />
      <button type="button" className="bg-primary" disabled={blocked || !value.trim()} onClick={() => void connect(value)}>{choosing ? '연결 중…' : '연결'}</button>
    </div>}
  </section>;
}

export function BackgroundFileLinks({ workPath, imagePath, canEdit, disabled, onWorkPath, onImagePath, onDisconnectImage, onChooseImage, onRefreshImage, onError }: {
  workPath: string; imagePath: string; canEdit: boolean; disabled: boolean;
  onWorkPath: (path: string) => void;
  onImagePath: (path: string) => Promise<void>;
  onDisconnectImage: () => void; onChooseImage: () => void; onRefreshImage: () => void;
  onError: (message: string) => void;
}) {
  return <div className="bg-file-links">
    <FileLink kind="work" path={workPath} canEdit={canEdit} disabled={disabled} onConnect={onWorkPath} onDisconnect={() => onWorkPath('')} onError={onError} />
    <FileLink kind="image" path={imagePath} canEdit={canEdit} disabled={disabled} onConnect={onImagePath} onDisconnect={onDisconnectImage} onChooseImage={onChooseImage} onRefresh={onRefreshImage} onError={onError} />
    <p className="bg-note">작업파일은 현재 변형에, 이미지파일은 선택한 수정본에 연결됩니다. 이미지 갱신은 새 수정본으로 남기며 연결 해제는 원본 파일을 지우지 않습니다.</p>
  </div>;
}
