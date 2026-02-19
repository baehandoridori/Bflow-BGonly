# BG 진행 현황판 — Lessons Learned

> 작업 중 배운 패턴, 실수, 개선사항을 기록한다.
> 세션 시작 시 반드시 검토할 것.

---

## 프로젝트 설정

### 2026-02-19: 초기 세팅

- **핵심 콘셉트는 "띄워놓고 작업"**: 슬랙 캔버스처럼 항상 켜두고 실시간 협업
  - Google Sheets가 단일 진실의 원천 (Single Source of Truth)
  - 체크박스 토글 → 낙관적 업데이트 → Sheets API → 다른 사용자 폴링으로 반영

- **데이터 저장 2층 구조**:
  - 작업 데이터 (체크박스, 씬, 에피소드): **Google Sheets** — 모든 사용자 공유
  - 개인 설정 (레이아웃, 테마): **%APPDATA%/Bflow-BGonly/** — 각 PC 로컬
  - ~~공유 드라이브에 users/ 폴더 만들기~~ → 불필요, AppData로 충분

- **AppData 활용**: Electron의 `app.getPath('userData')` 사용
  - Windows: `C:\Users\{사용자}\AppData\Roaming\Bflow-BGonly\`
  - `app.name = 'Bflow-BGonly'` 설정 필수

- **한글 경로 처리**: 배포 경로에 한글이 포함됨
  - `G:\공유 드라이브\JBBJ 자료실\한솔이의 두근두근 실험실\Bflow-BGonly`
  - Node.js `path` 모듈 사용, 하드코딩 피하기, `{ encoding: 'utf-8' }` 명시

- **Bflow 원본**: 절대 수정하지 말 것. 참고 전용.
  - 위젯 시스템 참고: `react-grid-layout`, `ResponsiveGridLayout`
  - 상태 관리 참고: Zustand persist 패턴 (localStorage → AppData 파일로 교체)

---

## 규칙

1. **브런치명은 반드시 한글로** — 영어 브런치명 금지 (필수 요건)
2. **Bflow 원본 레포 수정 금지** — 읽기/참고만 가능
3. **작업 데이터는 Google Sheets에만** — 로컬에 작업 데이터 캐시하지 않음 (Sheets가 원본)
4. **개인 설정은 AppData에** — 공유 드라이브에 개인 데이터 저장하지 않음
5. **커밋 메시지 한글** — 변경 내용을 명확히 한글로 기술

---

## 실수 방지 체크리스트

- [ ] 작업 데이터를 로컬에 영구 저장하려 하진 않는가? (Google Sheets가 원본)
- [ ] 개인 설정을 공유 드라이브에 저장하려 하진 않는가? (AppData 사용)
- [ ] Google Sheets API 호출 시 에러 핸들링 있는가?
- [ ] 네트워크 실패 시 오프라인 큐잉 동작하는가?
- [ ] 낙관적 업데이트 실패 시 롤백 로직이 있는가?
- [ ] 폴링 간격이 적절한가? (30초~1분)
