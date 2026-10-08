import { Bell, MessageSquare, MessageSquareWarning, RefreshCw, Award, AtSign, UserPlus, CalendarDays, type LucideIcon } from 'lucide-react';
import type { NotificationType } from '../stores/useNotificationStore';

/**
 * 알림 종류별 아이콘·색·이름 — 알림 창 줄과 오른쪽 아래 알림 카드가 같은 표를 쓴다(움직임 폴리싱 18번).
 * 알림 카드의 왼쪽 색 막대 색은 motion-comments-notify.css 의 .bflow-toast--<종류> 가 같은 색으로 정한다.
 */
export interface NotificationTypeVisual {
  icon: LucideIcon;
  color: string;
  label: string;
}

export function notificationTypeVisual(type: NotificationType): NotificationTypeVisual {
  switch (type) {
    case 'scene_change': return { icon: RefreshCw, color: '#74B9FF', label: '씬 변경' };
    case 'comment': return { icon: MessageSquare, color: '#8B8DA3', label: '댓글' };
    // v1.24.0: 멘션 — '@' 아이콘 + accent 색상. 댓글과 명확히 구분.
    case 'mention': return { icon: AtSign, color: 'rgb(var(--color-accent))', label: '멘션' };
    case 'milestone': return { icon: Award, color: '#00B894', label: '마일스톤' };
    case 'system': return { icon: Bell, color: '#8B8DA3', label: '시스템' };
    // v1.18.0: 리테이크 알림 — MessageSquareWarning 아이콘 + accent 색상.
    case 'revision': return { icon: MessageSquareWarning, color: 'rgb(var(--color-accent))', label: '리테이크' };
    // v1.25.5: 액팅 피드백 요청 — 검수 요청 (강한 톤, mention 시각 처리와 동일).
    case 'acting_feedback': return { icon: MessageSquareWarning, color: '#FDCB6E', label: '피드백' };
    // v1.25.8: 씬 담당자 배정 — 본인이 새 담당자 (강한 톤, mention 동일 시각 처리).
    case 'scene_assignment': return { icon: UserPlus, color: 'rgb(var(--color-accent))', label: '배정' };
    case 'calendar': return { icon: CalendarDays, color: '#74B9FF', label: '일정' };
    // v1.29.0: 댓글 이모지 반응 — 차분 톤(comment 동등). 아이콘은 알림 창 줄에서 metadata.reactionEmojis 의
    //   마지막 원소(또는 fallback 💬) 로 덮어 그리므로 여기 icon 값은 placeholder.
    case 'comment_reaction': return { icon: MessageSquare, color: '#8B8DA3', label: '반응' };
  }
}
