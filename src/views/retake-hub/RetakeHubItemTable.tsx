/**
 * RetakeHubItemTable — 시안 B 그리드 테이블 (리테이크 허브 5단계).
 *
 * 컬럼: [좌측 색막대(상태색) | re# | 내용 | 담당 | 진행]. 행 클릭 → 인라인 확장.
 * 자동취합 탭(파트/담당자/진행상태/씬순) 기준으로 그룹/정렬. '전반'(sceneKey 없음)은 별도 그룹.
 *
 * 인라인 확장은 RevisionPanel(시안 A)의 담당 워크플로우와 동일하게
 * revision/* 컴포넌트(AssigneeChipRow/CompletionNoteInput/FinalResolveBar/ReassignInline)를 재사용한다.
 *
 * 부서(BG/ACT) 라벨 텍스트는 표시하지 않는다(메모리 규칙). 상태 색·내부 그룹만 사용.
 */

import { useMemo } from 'react';
import type { CompRevision, AppUser } from '@/types';
import { STATUS_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { sideBarColorClass } from '@/utils/revisionCardView';
import { RetakeHubItemRow } from './RetakeHubItemRow';

export type HubTab = 'part' | 'assignee' | 'status' | 'scene';

interface Props {
  items: CompRevision[];
  tab: HubTab;
  allUsers: AppUser[];
}

interface GroupBucket {
  key: string;
  label: string;
  /** 정렬 순서용 정수(작을수록 위). */
  order: number;
  items: CompRevision[];
}

/** sceneKey `EP01:A:1` → 파트 letter('A'). '전반'(빈/형식밖)은 null. */
function partOf(sceneKey: string): string | null {
  const parts = (sceneKey || '').split(':');
  if (parts.length < 2) return null;
  const p = parts[1]?.trim();
  return p ? p.toUpperCase() : null;
}

/** '전반' 항목 — 대상 씬에 매이지 않음(sceneKey 비었거나 ep:part 형식 밖). */
function isGeneralItem(r: CompRevision): boolean {
  return partOf(r.sceneKey) == null;
}

const GENERAL_GROUP_KEY = '__general__';

// 진행상태별 탭 그룹 순서/라벨 — open/in_progress/assignee_done/resolved.
const STATUS_ORDER: CompRevision['status'][] = ['open', 'in_progress', 'assignee_done', 'resolved'];

/** sceneKey 의 씬 번호 토큰(숫자) — 씬순 정렬용. 없으면 0. */
function sceneNumOf(sceneKey: string): number {
  const last = (sceneKey || '').split(':').pop() ?? '';
  const m = last.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function buildGroups(
  items: CompRevision[],
  tab: HubTab,
  allUsers: AppUser[],
): GroupBucket[] {
  // '전반' 항목은 항상 별도 그룹으로 모은다(스펙 §9.2).
  const general: CompRevision[] = [];
  const scoped: CompRevision[] = [];
  for (const r of items) {
    (isGeneralItem(r) ? general : scoped).push(r);
  }

  const buckets = new Map<string, GroupBucket>();
  const nameOf = (id: string) => allUsers.find((u) => u.id === id)?.name ?? id;

  const push = (key: string, label: string, order: number, r: CompRevision) => {
    let b = buckets.get(key);
    if (!b) {
      b = { key, label, order, items: [] };
      buckets.set(key, b);
    }
    b.items.push(r);
  };

  for (const r of scoped) {
    if (tab === 'part') {
      const p = partOf(r.sceneKey) ?? '?';
      push(`part:${p}`, `파트 ${p}`, p.charCodeAt(0), r);
    } else if (tab === 'assignee') {
      const ids = r.assigneeIds ?? [];
      if (ids.length === 0) {
        push('assignee:__none__', '담당 미지정', 9999, r);
      } else {
        // 다중 담당자는 각 담당자 그룹에 모두 노출.
        for (const id of ids) push(`assignee:${id}`, nameOf(id), 0, r);
      }
    } else if (tab === 'status') {
      const idx = STATUS_ORDER.indexOf(r.status);
      push(`status:${r.status}`, STATUS_CONFIG[r.status].label, idx < 0 ? 99 : idx, r);
    } else {
      // 씬 순 — 에피소드:파트 단위로 묶고 그 안에서 씬 번호 정렬은 group 내 sort 가 처리.
      const segs = (r.sceneKey || '').split(':');
      const epPart = `${segs[0] ?? ''}:${segs[1] ?? ''}`;
      push(`scene:${epPart}`, epPart, 0, r);
    }
  }

  let groups = Array.from(buckets.values());

  // 그룹 정렬: order asc, 동률은 label.
  groups.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));

  // 그룹 내부 정렬: 씬순 탭은 씬 번호, 그 외는 re# (revisionNo) 오름차순.
  for (const g of groups) {
    if (tab === 'scene') {
      g.items.sort((x, y) => sceneNumOf(x.sceneKey) - sceneNumOf(y.sceneKey) || x.revisionNo - y.revisionNo);
    } else {
      g.items.sort((x, y) => x.revisionNo - y.revisionNo);
    }
  }

  // '전반' 그룹은 항상 마지막.
  if (general.length > 0) {
    general.sort((x, y) => x.revisionNo - y.revisionNo);
    groups = [
      ...groups,
      { key: GENERAL_GROUP_KEY, label: '전반 (대상 씬 없음)', order: Number.MAX_SAFE_INTEGER, items: general },
    ];
  }

  return groups;
}

export function RetakeHubItemTable({ items, tab, allUsers }: Props) {
  const groups = useMemo(() => buildGroups(items, tab, allUsers), [items, tab, allUsers]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-text-secondary/50">
        <p className="text-sm">이 세트에 아직 리테이크 항목이 없습니다.</p>
        <p className="text-[11px] mt-1 text-text-secondary/40">
          씬 상세창의 리테이크 탭에서 등록하거나, 기존 리테이크를 가져와 세트에 담을 수 있어요.
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 py-4 space-y-5">
      {groups.map((group) => (
        <div key={group.key}>
          {/* 그룹 헤더 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] font-bold text-text-secondary uppercase tracking-wider">
              {group.label}
            </span>
            <span className="text-[11px] text-text-secondary/50">{group.items.length}</span>
            <span className="flex-1 h-px bg-bg-border/50" />
          </div>

          {/* 컬럼 헤더 (시안 B) */}
          <div className="grid grid-cols-[4px_56px_1fr_auto_auto] items-center gap-2 px-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-secondary/45">
            <span aria-hidden />
            <span>re#</span>
            <span>내용</span>
            <span className="text-right">담당</span>
            <span className="text-right pr-1">진행</span>
          </div>

          <div className="space-y-1">
            {group.items.map((rev) => (
              <RetakeHubItemRow
                key={`${group.key}:${rev.id}`}
                revision={rev}
                allUsers={allUsers}
                sideBarClass={sideBarColorClass(rev.status)}
                reLabel={revisionNoToLabel(rev.revisionNo)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
