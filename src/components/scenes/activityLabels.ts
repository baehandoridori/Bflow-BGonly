import {
  Plus,
  Trash2,
  Check,
  Square,
  MessageSquare,
  Film,
  Sparkles,
  Pencil,
  UserCog,
  Hash,
  ImagePlus,
  type LucideIcon,
} from 'lucide-react';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { Activity, Stage } from '@/types';

/**
 * activity_log 의 actionType + detail 을 사람 읽을 수 있는 라벨 + 아이콘 + 톤 으로 변환.
 *
 * 단계 토글 — 부서별 라벨 매핑 (BG의 stage_lo = "LO", ACT의 stage_lo = "1원화") + 취소 구분.
 * detail.value === false 면 "취소", true 또는 미정 이면 "완료".
 */
export interface ActivityVisual {
  Icon: LucideIcon;
  /** "LO 완료" / "1원화 취소" / "메모 변경" 등 — user 이름은 별도 prefix */
  text: string;
  /** 아이콘/뱃지 색 (hex 또는 css var()) */
  tone: string;
  /** 진행 단계 토글이 'on' 인 경우 강조 (취소는 false) */
  isPositive?: boolean;
}

const TONE = {
  progress: 'rgb(var(--color-accent-sub))',
  cancel:   'rgb(var(--color-text-secondary))',
  memo:     '#FFB74D',
  comment:  'rgb(var(--color-accent))',
  scene:    '#5DD89C',
  scenedel: '#FF7A8A',
  revision: '#FFB74D',
  resolved: '#5DD89C',
  meta:     'rgb(var(--color-text-secondary))',
};

/** stage_<lo|done|review|png> → Stage 키로 (DEPARTMENT_CONFIGS 인덱싱용) */
function stageKeyFromAction(action: string): Stage | null {
  const m = action.match(/^stage_(lo|done|review|png)$/);
  return m ? (m[1] as Stage) : null;
}

export function describeActivity(activity: Activity): ActivityVisual {
  const { actionType, department, detail } = activity;
  const value = readDetailBool(detail, 'value');

  // 단계 토글 — 부서별 라벨
  const stageKey = stageKeyFromAction(actionType);
  if (stageKey) {
    const dep = department && (department === 'bg' || department === 'acting') ? department : 'bg';
    const stageLabel = DEPARTMENT_CONFIGS[dep].stageLabels[stageKey];
    const off = value === false;
    return {
      Icon: off ? Square : Check,
      text: `${stageLabel} ${off ? '취소' : '완료'}`,
      tone: off ? TONE.cancel : TONE.progress,
      isPositive: !off,
    };
  }

  switch (actionType) {
    case 'memo_update':
      return { Icon: Pencil, text: '메모 변경', tone: TONE.memo };
    case 'comment_add':
      return { Icon: MessageSquare, text: '댓글 작성', tone: TONE.comment };
    case 'revision_add': {
      // v1.24.0: 차수(re#N) + description 멘트 (앞 30자). 차수는 detail.revisionNumber 가 있을 때만.
      const desc = readDetailString(detail, 'descriptionPreview');
      const num = readDetailNumber(detail, 'revisionNumber');
      const prefix = num ? `re#${num}` : '리비전';
      return {
        Icon: Film,
        text: desc ? `${prefix} 등록 — “${trimText(desc, 30)}”` : `${prefix} 등록`,
        tone: TONE.revision,
      };
    }
    case 'revision_in_progress': {
      const num = readDetailNumber(detail, 'revisionNumber');
      const desc = readDetailString(detail, 'descriptionPreview');
      const prefix = num ? `re#${num}` : '리비전';
      return {
        Icon: Film,
        text: desc ? `${prefix} 진행중 — “${trimText(desc, 30)}”` : `${prefix} 진행중`,
        tone: TONE.progress,
      };
    }
    case 'revision_resolve': {
      // v1.24.0: 차수(re#N) + resolvedNote 또는 description 멘트.
      const note = readDetailString(detail, 'resolvedNote') || readDetailString(detail, 'descriptionPreview');
      const num = readDetailNumber(detail, 'revisionNumber');
      const prefix = num ? `re#${num} ✓` : '리비전';
      return {
        Icon: Sparkles,
        text: note ? `${prefix} 해결 — “${trimText(note, 30)}”` : `${prefix} 해결`,
        tone: TONE.resolved,
      };
    }
    case 'revision_delete': {
      const num = readDetailNumber(detail, 'revisionNumber');
      return { Icon: Trash2, text: num ? `re#${num} 삭제` : '리비전 삭제', tone: TONE.scenedel };
    }
    case 'scene_add':
      return { Icon: Plus, text: '씬 생성', tone: TONE.scene };
    case 'scene_delete':
      return { Icon: Trash2, text: '씬 삭제', tone: TONE.scenedel };
    case 'assignee_change':
      return { Icon: UserCog, text: '담당자 변경', tone: TONE.meta };
    case 'layout_change':
      return { Icon: Hash, text: '레이아웃 변경', tone: TONE.meta };
    case 'image_upload_storyboard':
      return { Icon: ImagePlus, text: '스토리보드 업로드', tone: TONE.meta };
    case 'image_upload_guide':
      return { Icon: ImagePlus, text: '가이드 업로드', tone: TONE.meta };
    default:
      return { Icon: Pencil, text: actionType, tone: TONE.meta };
  }
}

/** 부서 표시용 prefix (히스토리 탭에서 "BG · LO 완료" 식으로) */
export function deptPrefix(dept: 'bg' | 'acting' | null | undefined): string {
  return dept === 'bg' ? 'BG · ' : dept === 'acting' ? 'ACT · ' : '';
}

/* ── detail 안전 접근 helper ─────────────────────────────── */

function readDetailString(detail: Activity['detail'], key: string): string | undefined {
  if (!detail || typeof detail !== 'object') return undefined;
  const v = (detail as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function readDetailBool(detail: Activity['detail'], key: string): boolean | undefined {
  if (!detail || typeof detail !== 'object') return undefined;
  const v = (detail as Record<string, unknown>)[key];
  return typeof v === 'boolean' ? v : undefined;
}
function readDetailNumber(detail: Activity['detail'], key: string): number | undefined {
  if (!detail || typeof detail !== 'object') return undefined;
  const v = (detail as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function trimText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
