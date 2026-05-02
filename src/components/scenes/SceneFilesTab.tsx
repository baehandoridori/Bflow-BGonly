import { useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, MessageSquare, Film, Download } from 'lucide-react';
import { cn } from '@/utils/cn';
import { formatStamp } from '@/utils/formatTime';
import { getComments } from '@/services/commentService';
import { getRevisions } from '@/services/revisionService';
import type { Scene, CompRevision } from '@/types';

/**
 * 씬 상세 모달 — 파일 탭.
 *
 * 데이터:
 *  - 스토리보드 / 가이드 (BG scene 의 storyboardUrl, guideUrl)
 *  - 리비전 첨부 (revision.imageUrl 가 있는 항목)
 *  - 댓글 첨부 (comment.images[])
 *
 * 모두 시간순 (등록 시각 또는 createdAt) 정렬.
 *
 * 디자인 톤:
 *  - 다크 카드 grid
 *  - 출처 배지 (BG / 리비전 / 댓글) + accent / coral / 텍스트 무드
 *  - 호버 시 다운로드 아이콘
 */

type FileItem = {
  id: string;
  url: string;
  source: 'storyboard' | 'guide' | 'revision' | 'comment';
  authorName?: string;
  at?: string;       // ISO
  context?: string;  // 부가 설명 (예: "Rev.3 — LO 재패스")
};

const SOURCE_META: Record<FileItem['source'], { label: string; tone: string; Icon: typeof ImageIcon }> = {
  storyboard: { label: '스토리보드', tone: 'rgb(var(--color-accent-sub))',         Icon: ImageIcon },
  guide:      { label: '가이드',     tone: 'rgb(var(--color-accent))',             Icon: ImageIcon },
  revision:   { label: '리비전',     tone: '#FFB74D',                              Icon: Film },
  comment:    { label: '댓글',       tone: 'rgb(var(--color-text-secondary))',     Icon: MessageSquare },
};

export interface SceneFilesTabProps {
  bgScene: Scene | null;
  primaryCommentKey: string;
  secondaryCommentKey?: string;
  /**
   * 리비전 fetch 용 정규화된 key — 반드시 modal 에서 buildSceneKey() 로 만든 결과 전달.
   * raw `${sheetName}:${sceneId}` 사용 시 revisionService 의 alias/normalization 통과 못 해 누락 발생.
   * (Codex P1 2026-05-03)
   */
  revisionSceneKey: string;
}

export function SceneFilesTab({
  bgScene,
  primaryCommentKey,
  secondaryCommentKey,
  revisionSceneKey,
}: SceneFilesTabProps) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const collect = async () => {
      const out: FileItem[] = [];

      // 1) 스토리보드 / 가이드 (BG scene 기준)
      if (bgScene?.storyboardUrl) {
        out.push({
          id: 'sb',
          url: bgScene.storyboardUrl,
          source: 'storyboard',
          at: bgScene.createdAt,
          authorName: bgScene.assignee,
        });
      }
      if (bgScene?.guideUrl) {
        out.push({
          id: 'gd',
          url: bgScene.guideUrl,
          source: 'guide',
          at: bgScene.createdAt,
          authorName: bgScene.assignee,
        });
      }

      // 2) 리비전 첨부 — modal 이 buildSceneKey 로 정규화한 sceneKey 사용
      try {
        const revs: CompRevision[] = revisionSceneKey ? await getRevisions(revisionSceneKey) : [];
        for (const r of revs) {
          if (r.imageUrl) {
            out.push({
              id: `rev:${r.id}`,
              url: r.imageUrl,
              source: 'revision',
              authorName: r.requesterName,
              at: r.createdAt,
              context: `Rev.${r.revisionNo} — ${r.description.slice(0, 28)}${r.description.length > 28 ? '…' : ''}`,
            });
          }
        }
      } catch (err) {
        console.warn('[FilesTab] 리비전 로드 실패', err);
      }

      // 3) 댓글 첨부 (primary + secondary)
      const commentKeys = [primaryCommentKey, secondaryCommentKey].filter(Boolean) as string[];
      for (const key of commentKeys) {
        try {
          const comments = await getComments(key);
          for (const c of comments) {
            const imgs = c.images ?? [];
            imgs.forEach((url, i) => {
              out.push({
                id: `cm:${c.id}:${i}`,
                url,
                source: 'comment',
                authorName: c.userName,
                at: c.createdAt,
                context: c.text ? c.text.slice(0, 28) + (c.text.length > 28 ? '…' : '') : undefined,
              });
            });
          }
        } catch (err) {
          console.warn('[FilesTab] 댓글 로드 실패', err);
        }
      }

      if (cancelled) return;
      // 시간순 (오래된 → 최신)
      out.sort((a, b) => {
        const ta = a.at ? new Date(a.at).getTime() : 0;
        const tb = b.at ? new Date(b.at).getTime() : 0;
        return ta - tb;
      });
      setItems(out);
      setLoading(false);
    };

    void collect();
    return () => { cancelled = true; };
  }, [bgScene, primaryCommentKey, secondaryCommentKey, revisionSceneKey]);

  const totalCount = items.length;

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11.5px] text-text-secondary">
          {loading ? '불러오는 중…' : `총 ${totalCount}개 파일`}
        </span>
      </div>

      {!loading && totalCount === 0 && (
        <div className="py-14 text-center text-xs text-text-secondary/50">
          첨부된 파일이 없습니다
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((it) => (
          <FileCard key={it.id} item={it} />
        ))}
      </div>
    </div>
  );
}

function FileCard({ item }: { item: FileItem }) {
  const meta = SOURCE_META[item.source];
  const Icon = meta.Icon;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      download
      className={cn(
        'group relative block rounded-xl overflow-hidden border border-bg-border/50',
        'bg-white/[0.025] hover:bg-white/[0.04] transition-colors duration-200',
        'cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50',
      )}
      aria-label={`${meta.label} 파일 — ${item.authorName ?? '알 수 없음'}`}
    >
      <div className="relative aspect-[4/3] bg-black/20">
        <img
          src={item.url}
          alt={meta.label}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        {/* 호버 그라디언트 + 다운로드 아이콘 */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <span className="inline-flex w-7 h-7 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm">
            <Download size={14} aria-hidden />
          </span>
        </div>
      </div>

      {/* 메타 */}
      <div className="px-2.5 py-2 flex items-start gap-2">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{
            color: meta.tone,
            background: `color-mix(in oklab, ${meta.tone} 15%, transparent)`,
          }}
        >
          <Icon size={10} aria-hidden />
          {meta.label}
        </span>
        <div className="min-w-0 flex-1">
          {item.context && (
            <p className="text-[11px] text-text-primary truncate" title={item.context}>
              {item.context}
            </p>
          )}
          <p className="text-[10px] text-text-secondary/60 tabular-nums truncate">
            {item.authorName ? `${item.authorName} · ` : ''}
            {item.at ? formatStamp(item.at) : '—'}
          </p>
        </div>
      </div>
    </a>
  );
}
