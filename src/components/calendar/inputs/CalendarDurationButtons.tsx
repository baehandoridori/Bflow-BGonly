import { addCalendarDuration } from './calendarInputModel';
import './calendarInputs.css';
export function CalendarDurationButtons({ startDate, startTime, onChange, disabled = false }: {
  startDate: string; startTime: string; onChange(value: { endDate: string; endTime: string }): void; disabled?: boolean;
}) {
  return <div className="calendar-duration-buttons" role="group" aria-label="일정 길이"><span>빠른 길이</span>{[30,60,120].map((minutes)=><button key={minutes} type="button" disabled={disabled||!addCalendarDuration(startDate,startTime,minutes)} onClick={()=>{if(disabled)return;const result=addCalendarDuration(startDate,startTime,minutes);if(result)onChange(result);}}>{minutes<60?`${minutes}분`:`${minutes/60}시간`}</button>)}</div>;
}
