/**
 * 앱 전역 SVG 아이콘 정의. App root 에 한 번만 마운트한다.
 *
 * 화면에 보이지 않게 (position:absolute / width:0 / height:0) 두고,
 * 어디서든 <svg className="length-icon"><use href="#ic-ld" /></svg> 로 참조.
 *
 * 정의:
 *   - #ic-ld: <-> 양옆 바깥쪽 화살촉 (LD = Long Duration, 길이 늘어남)
 *   - #ic-sd: >-< 양옆 안쪽 화살촉 (SD = Short Duration, 길이 줄어듦)
 */
export function SvgIconDefs() {
  return (
    <svg
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      aria-hidden="true"
    >
      <defs>
        {/* LD: <-> 양옆 바깥쪽 화살촉 */}
        <symbol id="ic-ld" viewBox="0 0 20 10">
          <line
            x1="3" y1="5" x2="17" y2="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <polyline
            points="6,2 3,5 6,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="14,2 17,5 14,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>

        {/* SD: >-< 양옆 안쪽 화살촉 */}
        <symbol id="ic-sd" viewBox="0 0 20 10">
          <line
            x1="6" y1="5" x2="14" y2="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <polyline
            points="3,2 6,5 3,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="17,2 14,5 17,8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>
      </defs>
    </svg>
  );
}
