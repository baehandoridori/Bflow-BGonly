import type { RevisionStatus, RevisionPriority } from '@/types';

export const STATUS_CONFIG: Record<RevisionStatus, { label: string; color: string; bg: string }> = {
  open: { label: '대기', color: '#FDCB6E', bg: 'rgba(253, 203, 110, 0.15)' },
  in_progress: { label: '진행중', color: '#74B9FF', bg: 'rgba(116, 185, 255, 0.15)' },
  resolved: { label: '해결', color: '#00B894', bg: 'rgba(0, 184, 148, 0.15)' },
};

export const PRIORITY_CONFIG: Record<RevisionPriority, { label: string; color: string; bg: string }> = {
  urgent: { label: '긴급', color: '#FF6B6B', bg: 'rgba(255, 107, 107, 0.15)' },
  high: { label: '높음', color: '#E17055', bg: 'rgba(225, 112, 85, 0.15)' },
  normal: { label: '보통', color: '#74B9FF', bg: 'rgba(116, 185, 255, 0.15)' },
};
