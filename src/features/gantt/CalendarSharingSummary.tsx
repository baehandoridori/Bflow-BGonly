import type { BflowCalendar } from '@/types/calendar';

export function CalendarSharingSummary({ calendar, users }: { calendar: Pick<BflowCalendar, 'ownerId' | 'visibility' | 'members' | 'isAdminOverview'>; users: Array<{ id: string; name: string }> }) {
  const name = (id: string) => users.find((user) => user.id === id)?.name || '이름 미등록';
  return <div className="calendar-import-audience">
    <p><strong>원본 캘린더의 공유 설정</strong> · {calendar.visibility === 'team' ? '팀 전체 보기' : calendar.visibility === 'members' ? '선택한 멤버에게 공유' : '소유자만 보기'}</p>
    <p>{name(calendar.ownerId)} · 소유자</p>
    {calendar.members.filter((member) => member.userId !== calendar.ownerId).map((member) => <p key={member.userId}>{name(member.userId)} · {member.canEdit ? '편집 가능' : '보기 전용'}</p>)}
    {calendar.isAdminOverview && <p>배한솔 관리자 확인용 · 원본 공유 대상은 늘어나지 않아요.</p>}
    <p>공유 대상과 편집 권한은 원본 캘린더의 변경을 자동으로 따라갑니다.</p>
  </div>;
}
