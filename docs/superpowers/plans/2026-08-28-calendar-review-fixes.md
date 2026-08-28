# 캘린더 2차 개편 리뷰 반영 구현 계획 (2026-08-28)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캘린더 3-PR 스택(#258 v1.108 / #259 v1.109 / #260 v1.110, 최종 커밋 `a933941`)의 독립 리뷰(2026-08-28, 13앵글+5검증+2스윕)에서 확정된 결함 P1 1건·P2 15건·P3 다수를 수정한다.

**Architecture:** 수정은 스택 최상단(a933941) 위에 태스크별 커밋으로 쌓고 `claude/calendar-tg4-ics` 브랜치에 fast-forward push한다(코덱스 라운드 반영과 같은 관례). 브랜치 경계 재정리는 이 계획의 범위 밖(한솔 결정 대기).

**Tech Stack:** Electron + React 18 + TypeScript, node --test + esbuild 번들 하네스, node-ical 0.27.1, framer-motion 10.18.0.

---

## Chunk 0: 공통 컨텍스트 (반드시 먼저 읽을 것)

### 0.1 배경

이 계획의 각 태스크는 리뷰에서 **코드 근거로 확정된 결함**이다. 결함 번호(#1~#47)는 리뷰 보고서 채번이며 태스크 안에 증상·근거를 자기완결로 요약했으므로 원 보고서 없이 실행 가능하다. 줄 번호는 전부 **a933941 기준 참고값** — 수정 전 반드시 grep으로 재확인하고, 기존 이름·구조가 다르면 기존을 따르고 로직만 이식한다.

### 0.2 작업 환경 준비

- [ ] **Step 1**: 새 워크트리 생성 — **주의: 로컬 브랜치 `claude/calendar-tg4-ics`는 이미 다른 워크트리(silly-wilson)에 체크아웃돼 있어 그 브랜치명으로는 worktree add가 거절된다.** 9차 반영 커밋 a933941에서 **새 작업 브랜치**로 만든다(Git Bash 기준):

```bash
cd /c/Bflow-BGonly
git fetch origin claude/calendar-tg4-ics claude/calendar-tg2-interact
git worktree add .claude/worktrees/calendar-review-fixes a933941 -b claude/calendar-review-fixes
```

(a933941은 `origin/claude/calendar-tg2-interact`에 실려 있는, 스택 최상단 = 9차 반영 포함 최종 커밋. 이후 모든 작업은 이 워크트리 안에서. **push는 마무리 Task에서 `git push origin HEAD:claude/calendar-tg4-ics` refspec으로** — a933941이 tg4의 현재 원격 HEAD(0956aff)의 자손이라 fast-forward가 성립한다.)

- [ ] **Step 2**: base 검증 — `git merge-base --is-ancestor 0956aff HEAD && git rev-parse HEAD` → OK가 나오고 HEAD가 a933941이어야 한다. 아니면 STOP하고 한솔에게 보고(stale base / 히스토리 상이 의심 — 과거 교훈).
- [ ] **Step 3**: (별도 merge 불필요 — Step 1에서 a933941을 직접 체크아웃했으므로 9차 반영이 이미 포함돼 있다.)
- [ ] **Step 4**: `npm ci` → `npm run typecheck` → `npm run test:calendar` — **기준선: typecheck 통과, 868/868 통과**여야 한다. 다르면 STOP.
- [ ] **Step 5**: 이 계획서 파일을 워크트리의 `docs/superpowers/plans/2026-08-28-calendar-review-fixes.md`로 복사하고 첫 커밋: `"리뷰 반영 계획서 추가"`.

### 0.3 공통 규칙 (전 태스크)

- **검증 게이트**: 매 태스크 마무리마다 `npm run typecheck` + `npm run test:calendar`(+ 신규 테스트). 전체 마무리에서 `npm run test:notifications` + `npm run build:vite`.
- **커밋**: 태스크당 1커밋, 한글 메시지 `"리뷰 반영: <내용> (#결함번호)"`. 회귀 시 개별 되돌림 가능하게.
- **push**: 마무리 Task에서 `git push origin HEAD:claude/calendar-tg4-ics`(refspec, fast-forward)만. **force push·머지·G드라이브 배포 절대 금지. 다른 워크트리(silly-wilson 등) 절대 접근 금지.**
- **테스트 하네스 계약 (어기면 기존 테스트 868개가 엉뚱하게 깨진다)**:
  1. `tests/calendarMutationFailureUi.test.ts`·`tests/calendarQuickEditCapabilities.test.ts`·`tests/calendarSharedUi.test.ts`는 훅을 **슬롯 인덱스**로 흉내 낸다 → 컴포넌트에 새 `useState`는 **반드시 기존 선언들 뒤에** 추가.
  2. 하네스에서 컴포넌트에 이벤트 객체를 넘길 땐 **매 렌더 동일 객체 재사용**(새 객체를 만들면 rehydrate effect가 돌아 편집 상태가 풀린다).
  3. `electron/icsSubscriptions.ts`·`electron/icsSubscriptionIpc.ts`는 node --test가 직접 import → **'electron' top-level import 금지, `src/shared`에서는 타입만 import**(값 import는 런타임 해석 실패). IO·fetch·시계·ID는 전부 DI.
- **버전·update-notes**: 버전 변경 없음(미배포 PR 내부 수정). 단 T5.7이 "노트 정정" 분기로 가면 update-notes 1.109.0 항목 문구를 고친다(비개발자 톤 룰 준수).
- **낙관 패턴/IPC**: 데이터 변경은 기존 calendarService 경로만. 렌더러 직접 Supabase 금지.
- **진척 보고**: 청크 하나 끝날 때마다 완료 태스크·누적/잔여 규모를 보고(30분+ 작업 규칙).

### 0.4 티어와 실행 순서

- **[필수]** = P1·P2 (출시 전 반드시): T1.1~T1.4, T1.8, T2.1~T2.5, T3.1~T3.3, T4.1~T4.3, T4.5, T5.1, T5.2
- **[권장]** = 사용자 체감 P3: T1.5~T1.7, T1.9, T2.6, T3.4, T3.5, T5.3~T5.7
- **[선택]** = 정리·mock·기타: T2.7, T3.6, T5.8, Chunk 6
- 순서는 Chunk 1→6, 청크 안에서는 번호순. 시간이 모자라면 [필수] 전체 → [권장] → [선택] 순으로 끊는다. **[선택]을 건너뛰면 건너뛰었다고 보고**한다.

---

## Chunk 1: ICS 메인 프로세스 견고화 (`electron/icsSubscriptions.ts`, `electron/main.ts`, `electron/icsSubscriptionIpc.ts`)

### Task 1.1 [필수/P1] 리다이렉트 Location 파싱 크래시 방지 (#1)

**문제**: `createIcsTextFetcher`의 리다이렉트 처리에서 `new URL(location, url)`이 try 밖에 있다(icsSubscriptions.ts:593 부근). 외부 서버가 파싱 불가능한 Location(예: `http://`)을 주면 http 'response' 콜백 안 동기 throw → 메인 프로세스 uncaughtException → **앱 전체 종료**. 30분 자동 갱신이 있어 사용자 조작 없이도 터진다.

**Files:** Modify `electron/icsSubscriptions.ts`, Test `tests/icsSubscriptions.test.ts`

- [ ] **Step 1: 실패 테스트** — 기존 fetcher 테스트의 fake `deps.get` 패턴을 따라, 302 + `location: 'http://'`(new URL이 throw하는 값)를 돌려주는 응답을 만들고, fetcher promise가 **reject**(throw 전파·프로세스 크래시가 아니라)하는지 단언:

```ts
test('리다이렉트 주소가 깨져 있으면 크래시 대신 실패로 알린다', async () => {
  const fetchText = createIcsTextFetcher({
    get: (url, onResponse) => {
      queueMicrotask(() => onResponse(fakeResponse({ statusCode: 302, headers: { location: 'http://' } })));
      return fakeRequest();
    },
  });
  await assert.rejects(fetchText('https://example.com/cal.ics'));
});
```

(위 코드는 형태 예시다 — 실제 하네스는 `tests/icsSubscriptions.test.ts:376-403` 부근의 `createFetcherHarness` + `FakeResponse` 패턴이니 **그 방식을 그대로 따라** 작성한다.)

- [ ] **Step 2: 실패 확인** — `npm run test:calendar` → 새 테스트가 실패(현재는 동기 throw가 하네스를 뚫고 나오거나 unhandled rejection)임을 확인.
- [ ] **Step 3: 구현** — 리다이렉트 분기의 `const next = normalizeIcsUrl(new URL(location, url).toString());`를 try/catch로 감싼다. catch 시 `settle(() => reject(new Error(ICS_URL_ERROR)))` 후 return. 방어적으로 `deps.get(url, (response) => { ... })` 콜백 본문 전체도 try/catch(catch → settle reject)로 감싼다.
- [ ] **Step 4: PASS 확인 + 커밋** — `"리뷰 반영: 깨진 리다이렉트 주소로 앱이 꺼지지 않게 (#1)"`

### Task 1.2 [필수/P2] 파싱 실패를 '빈 성공'으로 접지 않기 (#3)

**문제**: `parseCalendar`(icsSubscriptions.ts:234 부근)가 (a) parseICS throw, (b) `BEGIN:VEVENT` 부재(=HTML 로그인 페이지 등 비-ICS 200 응답)를 전부 null로 접고, `expandIcsToEvents`가 `{events:[], truncated:false}`를 반환 → `fetchOne`이 성공으로 간주해 **기존 정상 캐시를 빈 목록으로 덮어쓰고 lastError=null·lastFetchedAt 갱신**. 네트워크 실패는 캐시를 보존하는 것과 비대칭이고, fetchOne 자신의 주석("실패해도 직전 캐시는 그대로 둔다")과도 어긋난다.

**Files:** Modify `electron/icsSubscriptions.ts`, Test `tests/icsSubscriptions.test.ts`

- [ ] **Step 1: 실패 테스트 2개** —

```ts
test('본문이 ICS가 아니면 실패로 기록하고 기존 캐시를 지키지 않는다', async () => {
  // store를 만들고 첫 fetch는 정상 ICS(일정 1건), 두 번째 fetch는 '<html>login</html>' 반환하게 DI
  // refresh 2회 후: events()에 첫 fetch의 일정이 그대로 있고, list()의 lastError가 null이 아니어야 한다
});
test('VEVENT가 하나도 없는 정상 캘린더는 빈 목록 성공이다', async () => {
  // 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' 본문 → lastError null, events 빈 배열
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 파싱을 2단계로 분리한다:
  - 새 내부 함수 `parseIcsCalendarOrThrow(icsText)`: `typeof !== 'string' || !icsText.includes('BEGIN:VCALENDAR')`이면 `throw new Error('외부 캘린더 응답이 일정 형식이 아닙니다')`. `ical.sync.parseICS` throw는 그대로 전파(메시지 부족하면 감싸기).
  - `expandIcsToEvents`는 **기존 관대한 동작 유지**(공개 계약·기존 테스트 보존): 내부에서 try/catch로 위 함수를 부르고 실패 시 기존처럼 빈 결과.
  - 새 export `expandIcsToEventsStrict(icsText, window, options)`: 파싱 실패 시 throw, 성공 시 기존 전개 로직 공유.
  - `fetchOne`은 `expandIcsToEventsStrict` 사용 → 파싱 실패가 fetch 실패와 같은 catch 경로(lastError 기록, 캐시·lastFetchedAt 보존)로 합류.
- [ ] **Step 4: PASS + 기존 테스트 전체 통과 확인 + 커밋** — `"리뷰 반영: 잘못된 응답이 구독 일정을 지우지 않게 (#3)"`

### Task 1.3 [필수/P2] 구독 파일 자가 소실 방지 (#5, #14 동반)

**문제**: ① main.ts의 `readSubscriptionsFile`이 **모든** 읽기 실패(백신 EBUSY/EPERM 포함)를 catch→null(=파일 없음)로 접고, store가 빈 목록을 확정 캐시한다. ② 앱 시작 `primeOnStartup → refresh(null)`과 30분 주기 refresh가 **대상 0건이어도 무조건 `persist()`** 하므로, 읽기 실패 한 번이면 멀쩡하던 파일이 빈 목록으로 **영구 덮어쓰기**된다. ③ 쓰기가 `fs.promises.writeFile` 직접 덮어쓰기라 크래시 시 파일 손상 → 손상 파일도 빈 목록으로 읽혀 같은 루프.

**Files:** Modify `electron/main.ts`(ICS deps 부분, :2541 부근), `electron/icsSubscriptions.ts`, Test `tests/icsSubscriptions.test.ts`

- [ ] **Step 1: 실패 테스트 3개** (store 단위, DI로 재현):

```ts
test('읽기 오류(EBUSY류)면 빈 목록을 확정하지 않고 다음 호출에서 다시 읽는다', async () => {
  // readSubscriptionsFile: 1회차 reject(new Error('EBUSY')), 2회차 정상 JSON(구독 1건)
  // list() 1회차: 빈 배열 반환은 허용하되, 2회차 list()가 구독 1건을 돌려줘야 한다(빈 목록 캐시 고착 금지)
});
test('읽기 오류 상태에서는 refresh가 파일을 덮어쓰지 않는다', async () => {
  // readSubscriptionsFile reject 상태에서 refresh(null) → writeSubscriptionsFile 호출 0회
});
test('구독이 0건이면 refresh가 persist·announce를 생략한다', async () => {
  // 정상 로드·구독 0건 → refresh(null) → writeSubscriptionsFile 0회, publishChanged 0회
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** —
  - `IcsSubscriptionStoreDeps.readSubscriptionsFile` 계약을 "파일 없음 = null, **그 외 오류 = reject**"로 주석 갱신. main.ts 구현: catch에서 `error.code === 'ENOENT'`만 null, 그 외 rethrow.
  - store `readSubscriptions`: `deps.readSubscriptionsFile()`이 reject하면 **catch하되 결과를 캐시하지 않는다** — `loadSubscriptions`에서 이 경우 `subscriptions`를 세팅하지 않고 빈 배열만 반환(다음 호출이 재시도). 구현 힌트: readSubscriptions가 `{ rows, degraded }`를 반환하게 바꾸고, degraded면 `subscriptions ??= rows` 라인을 건너뛴다. **JSON.parse 실패(파일은 읽혔는데 깨짐)는 손상**으로 보고: 빈 목록으로 시작하되 `writeSubscriptionsFile` 전에 원본을 보존할 방법이 store에는 없으므로, 손상 감지 플래그를 두고 main.ts deps에 선택적 `backupSubscriptionsFile?()`을 추가해 첫 persist 전에 `ics-subscriptions.json` → `ics-subscriptions.json.bak`로 rename하게 한다(있을 때만 호출).
  - `refresh(id)`: `targets.length === 0`이면 `persist()`·`announce()` 없이 return (#14).
  - main.ts `writeSubscriptionsFile`: `path + '.tmp'`에 쓰고 `fs.promises.rename`으로 원자 교체.
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 구독 저장 파일이 통째로 사라지는 경로 차단 (#5, #14)"`

### Task 1.4 [필수/P2] RECURRENCE-ID 오버라이드 조회 키 정합 (#4)

**문제**: `collectVevent`(icsSubscriptions.ts:218 부근)가 `overrides[occurrenceKst.date]`(KST 날짜)로 조회하지만, node-ical 0.27.1은 recurrences를 **원본 시간대의 달력 날짜** 키(`getDateKey`)로 저장하고, DATE-TIME 오버라이드는 **full ISO 키**(`recurrenceId.toISOString()`)로도 이중 저장한다(node_modules/node-ical/ical.js `storeRecurrenceOverride` 참조). 원본 TZ 날짜 ≠ KST 날짜인 회차(UTC 피드의 KST 새벽, 미국·유럽 피드의 오후~저녁)의 수정본이 통째로 무시되어 유령 회차가 표시된다.

**Files:** Modify `electron/icsSubscriptions.ts`, Test `tests/icsSubscriptions.test.ts`

- [ ] **Step 1: 실패 테스트** —

```ts
test('UTC 피드에서 KST 다음날로 넘어가는 회차의 수정본이 반영된다', () => {
  const ICS = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ov-1',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z', // KST 9/2 01:00
    'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:원본', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:ov-1', 'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z', 'DTEND:20260908T190000Z', 'SUMMARY:옮긴 회차',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const out = expandIcsToEvents(ICS, { from: '2026-08-01', to: '2026-10-01' }).events;
  const overridden = out.filter((event) => event.title === '옮긴 회차');
  assert.equal(overridden.length, 1);
  assert.equal(out.filter((event) => event.title === '원본').length, 2); // 나머지 두 회차만 원본
});
```

- [ ] **Step 2: 실패 확인** (현재는 '옮긴 회차' 0건, '원본' 3건이 나와야 실패).
- [ ] **Step 3: 구현** — 오버라이드 조회를 3단 폴백으로:
  1. `overrides[occurrence.toISOString()]` (미이동 회차의 인스턴트는 RECURRENCE-ID 인스턴트와 동일 — 가장 정확)
  2. `overrides[occurrence.toISOString().slice(0, 10)]` (UTC 날짜 키 — tz 미해석 폴백)
  3. 기존 `overrides[occurrenceKst.date]`
  dateOnly 회차(`occurrence.dateOnly === true`)는 `toDateOnlyString(occurrence)` 키를 먼저 본다. `Object.prototype.hasOwnProperty.call` 검사 유지.
- [ ] **Step 4: PASS + 기존 오버라이드 테스트 회귀 확인 + 커밋** — `"리뷰 반영: 시간대가 다른 피드의 회차 수정 반영 (#4)"`

### Task 1.5 [권장/P3] 전개 uid 유일화 (#10)

**문제**: 반복 회차 uid가 `${uid}:${fields.startDate}`인데 `fields.startDate`는 **오버라이드가 이동시킨 뒤의 날짜**다. 오버라이드로 다른 회차의 날짜 위로 옮기면 두 회차가 같은 uid → 렌더러 이벤트 id(`ics:<subId>:<uid>:<startDate>`)까지 충돌(React key 충돌).

- [ ] **Step 1: 실패 테스트** — Task 1.4의 ICS를 변형(RECURRENCE-ID 회차를 다른 회차와 같은 날로 이동)해 `new Set(out.map((event) => event.uid)).size === out.length` 단언.
- [ ] **Step 2 구현**: uid 접미를 이동 후 날짜가 아니라 **원 회차 식별자**로 — `uid: uid ? `${uid}:${occurrenceKst.date}` : occurrenceKst.date` (occurrenceKst.date는 이동 전 원 회차의 KST 날짜). **Task 1.6-②를 먼저 했다면** dateOnly 회차의 원 회차 날짜도 그쪽에서 정한 키 규칙(toDateOnlyString)을 동일하게 따른다 — uid와 오버라이드 조회가 같은 날짜 문자열을 봐야 유일성이 유지된다.
- [ ] **Step 3: PASS + 커밋** — `"리뷰 반영: 옮긴 반복 회차의 겹침 없는 식별자 (#10)"`

### Task 1.6 [권장/P3] 전개 정확도 3종 — 다일 스팬 경계·dateOnly·CANCELLED (#11, #13, #12)

**문제 3건**: ① 반복 전개 창 패딩이 1일 고정이라 2일+ 스팬 회차가 창 시작 경계에서 통째로 누락(`after = shiftDate(window.from, -1)`). ② dateOnly 회차·EXDATE는 node-ical이 "호스트 로컬 자정 + dateOnly 마커"로 주는데 `toKstFields`(인스턴트+9h)로 읽어 호스트 UTC+10 이상에서 하루 밀림 — 같은 파일의 비반복 경로(`toDateOnlyString`)와 규칙 불일치. ③ `STATUS:CANCELLED` 미확인 — 취소된 일정·회차가 정상 표시.

- [ ] **Step 1: 실패 테스트 3개** — (a) 매주 금~일 3일 종일 반복 + `from`을 그 일요일로 → 첫날 겹침 회차 존재 단언. (b) dateOnly 회차의 날짜가 `toDateOnlyString` 기준과 일치 단언(KST 호스트에선 통과할 수 있음 — 그 경우 구현만 정리하고 테스트는 로직 단위로: `occurrence.dateOnly`면 로컬 getter 사용을 확인하는 형태로 작성). (c) `STATUS:CANCELLED` 단독 VEVENT와 CANCELLED 오버라이드 회차가 결과에서 제외 단언.
- [ ] **Step 2 구현**: ① `after` 패딩을 `Math.max(0, daysBetween(base.startDate, base.endDate)) + 1`일로. ② occurrence/exdate 값이 `.dateOnly === true`면 `toDateOnlyString(value)`로 날짜를 뽑는 분기 추가(`excludedOccurrenceKeys`·회차 루프 양쪽). ③ `IcsVevent` 타입에 `status?: unknown` 추가, `readText(event.status, '')`가 대소문자 무시 'CANCELLED'면 skip — 단독 VEVENT는 collectVevent 초입에서, 오버라이드는 override 채택 시점에서(오버라이드가 CANCELLED면 그 회차 자체를 건너뜀).
- [ ] **Step 3: PASS + 커밋** — `"리뷰 반영: 반복 전개의 경계·종일·취소 처리 보강 (#11 #13 #12)"`

### Task 1.7 [권장/P3] 전송 총 시한 + 주기 갱신 재진입 가드 (#15)

**문제**: http 타임아웃 20s는 **유휴** 타임아웃이라 트리클 응답(20s 미만 간격으로 찔끔찔끔)은 영원히 안 끝난다. `runScheduledRefresh`는 진행 중 여부를 안 보고 30분마다 새 refresh를 시작 → pending refresh·소켓이 무한 누적, 겹친 refresh들이 같은 구독 객체·파일을 동시 조작.

- [ ] **Step 1: 실패 테스트** — icsSubscriptionIpc 단위: fetch가 pending인 fake store로 setInterval 핸들러를 2번 발화 → store.refresh 호출이 1회임을 단언.
- [ ] **Step 2 구현**: ① `registerIcsSubscriptionIpc`의 `runScheduledRefresh`에 in-flight 가드(`let refreshRunning = false; ... finally { refreshRunning = false; }` — 진행 중이면 skip + logWarning 선택). ② `createIcsTextFetcher.requestOnce`에 전체 시한: `const overallTimer = setTimeout(() => { request.destroy(); settle(() => reject(new Error('외부 캘린더 응답이 너무 늦습니다'))); }, 60_000);` — settle 경로 전부에서 clearTimeout. 타이머 주입이 필요하면 deps에 옵션(`overallTimeoutMs?: number`)으로 두고 테스트에서 짧게.
- [ ] **Step 3: PASS + 커밋** — `"리뷰 반영: 느려 터진 구독 서버가 갱신을 붙잡지 못하게 (#15)"`

### Task 1.8 [필수/P3·스펙 정합] 전개 창을 스펙값으로 (#8)

**문제**: 설계 SSOT(D14)는 "과거 1개월~미래 6개월"인데 구현은 `ICS_WINDOW_PAST_MONTHS = 6; ICS_WINDOW_FUTURE_MONTHS = 12`. 변경 근거가 스펙·플랜·커밋 어디에도 없고, 매일 반복 구독이 스펙 창에선 상한 500 아래인데 구현 창에선 항상 절단된다.

- [ ] **Step 1**: 상수를 `1`/`6`으로 원복. defaultWindow를 고정하는 기존 테스트가 있으면 함께 갱신.
- [ ] **Step 2**: 게이트 + 커밋 — `"리뷰 반영: 구독 전개 창을 설계값(과거 1개월~미래 6개월)으로 (#8)"`
- **참고(한솔 결정 여지)**: 더 넓은 창을 원하면 이 태스크를 뒤집는 대신 **스펙 문서 D14를 먼저 고치고** 근거를 남길 것. 기본은 스펙 우선.

### Task 1.9 [권장/P3] 상한 절단 경고 노출 (#9)

**문제**: 스펙 D14의 "상한 500 초과 시 경고 1회"가 미구현 — `truncated` 플래그가 IPC로 렌더러까지 오지만 `loadIcsEvents`가 버리고 어떤 UI도 소비하지 않는다.

- [ ] **Step 1**: 계약 확장 — `src/shared/icsApiContract.ts`의 `IcsSubscription`에 `lastFetchTruncated?: boolean`(선택 필드, 저장 파일에는 안 씀 — `sanitizeSubscription`은 무시). store `list()`가 cache의 truncated를 합성해 채운다.
- [ ] **Step 2**: `CalendarRail`의 구독 행 — `lastFetchTruncated`면 amber 정보 아이콘 + title 툴팁 `"일정이 많아 가까운 500개까지만 보여요"` (lastError 경고 아이콘과 구분되는 아이콘 사용, 예: lucide `Info`).
- [ ] **Step 3**: 테스트 — store list 합성 단위 테스트 + 레일 렌더 테스트(기존 경고 아이콘 테스트 패턴 복제).
- [ ] **Step 4**: 게이트 + 커밋 — `"리뷰 반영: 일정이 잘려 보일 때 구독 행에 안내 (#9)"`

---

## Chunk 2: ICS 렌더러·UI (`src/components/calendar/CalendarRail.tsx`, `IcsSubscribeForm.tsx`, `EventSidePanel.tsx`, `src/views/ScheduleView.tsx`, `src/views/WidgetPopup.tsx`)

### Task 2.1 [필수/P2] 구독 이름·색 폼을 제자리로 (#2)

**문제**: `renamingSubscription && <IcsSubscribeForm>` 블록이 CalendarRail.tsx:309 부근, bflow 캘린더 그룹을 그리는 `renderSection()` 헬퍼 **안**에 있다. 헬퍼가 '내 캘린더'·'팀 전체'·'나에게 공유됨' 3회 호출되므로 폼이 비어 있지 않은 섹션마다 중복으로(최대 3개) 엉뚱한 곳에 뜨고, 정작 구독 행 옆에는 없다.

- [ ] **Step 1: 실패 테스트** — `tests/calendarSharedUi.test.ts`의 레일 ICS 테스트(:6084 부근)에 이미 준비만 되고 안 쓰이던 `railSubscribeFormProps` 스캐폴딩을 실제로 사용: '이름·색 바꾸기' 메뉴 클릭 → 재렌더 → ① IcsSubscribeForm(initial 있는 편집 모드)이 **정확히 1개** ② 그 폼이 구독 섹션(트리 상 구독 행 컨테이너) 안에 있음 ③ bflow 캘린더 섹션들 안에는 없음을 단언.
- [ ] **Step 2: 실패 확인** (현재는 3개 렌더 + 위치 오류).
- [ ] **Step 3: 구현** — 해당 JSX 블록을 `renderSection`에서 **삭제**하고, 구독 섹션의 `icsSubscriptions.map` 내부에서 각 행 바로 다음에 `renamingSubscription?.id === subscription.id && <IcsSubscribeForm ... />` 형태로 렌더(키·initial·onSubmit·onCancel 기존 그대로).
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 구독 이름·색 바꾸기 폼을 그 구독 아래로 (#2)"`

### Task 2.2 [필수/P2] ICS 일정 복사를 개인 캘린더로 (#6)

**문제**: `handleDuplicateEvent`(ScheduleView.tsx:1254 부근)의 개인 캘린더 재지정이 `isCanonicalBflow && isWriteProtected`일 때만 → ICS 일정은 calendarId 없이 `addEvent`로 흘러 `addEventInternal`의 **Google primary 생성 경로**로 라우팅된다(구글 연동 시 구글 캘린더에 실제 생성, 미연동 시 조용한 실패 + unhandled rejection).

- [ ] **Step 1: 실패 테스트** — sharedUi 하네스에서 ics 이벤트(`source: 'ics'`, `sourceCalendarId: 'ics:sub-1'`, calendarId 없음)로 duplicate 경로 실행 → addEvent에 전달된 이벤트의 `calendarId`가 개인 캘린더 id이고 `source`/`sourceCalendarId`가 undefined임을 단언(개인 캘린더가 없으면 addEvent 미호출 + 경고).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 재지정 조건을 ICS로 확장: `const isIcs = event.source === 'ics' || event.sourceCalendarId?.startsWith('ics:') === true;` → `if ((isCanonicalBflow && isWriteProtected) || isIcs) { ...personal 재지정... }`. **구글 이벤트 복사 동작은 바꾸지 않는다**(기존 primary 경로 유지 — 의도된 기존 동작).
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 외부 구독 일정 복사는 내 개인 캘린더로 (#6)"`

### Task 2.3 [필수/P2] 사이드패널 ICS 라벨·시각 표시 (#7)

**문제**: ① EventSidePanel.tsx:618의 소스 라벨 폴백 체인에 ics 분기가 없어 구독 일정 상세가 **"이전 일정"**으로 표기(설계서 D14가 "반드시 고친다"고 지목한 런타임 폴백 2곳 중 미이행 1곳). ② :548의 시각 표시가 `supportsTimeEditing`(= canonical bflow || google) 게이트에 걸려 ICS 시각 일정의 시각이 안 보인다.

- [ ] **Step 1: 실패 테스트** — ics 이벤트로 패널 렌더 → ① 라벨이 구독 이름(`event.createdBy`) ② `14:00 – 15:00` 류 시각 문자열 존재 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — ① :618 체인 맨 앞에 `event.sourceCalendarId?.startsWith('ics:') ? (event.createdBy || '외부 캘린더') : ...` 분기. ② :548 표시 조건을 `(supportsTimeEditing || event.source === 'ics') && event.allDay === false && ...`로(편집 가능 여부와 표시를 분리 — 편집 게이트는 그대로).
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 구독 일정 상세에 이름과 시각을 제대로 (#7)"`

### Task 2.4 [필수/P3] IPC 오류 메시지에서 Electron 접두사 제거 (#16)

**문제**: 메인이 던진 한국어 오류가 렌더러에는 `Error invoking remote method 'ics:add': Error: 캘린더 주소는...`로 도착하는데 `IcsSubscribeForm`이 `error.message`를 그대로 인라인 노출. 프리뷰 mock은 접두사가 없어 프리뷰 검증으로는 안 보인다. 레포 전체에 unwrap 헬퍼 없음.

- [ ] **Step 1**: `src/utils/ipcErrorMessage.ts` 신설 + 단위 테스트(`tests/` 신규 파일, package.json test:calendar에 등록):

```ts
const IPC_WRAPPER = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/;
export function cleanIpcErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const cleaned = raw.replace(IPC_WRAPPER, '').trim();
  return cleaned !== '' ? cleaned : fallback;
}
```

- [ ] **Step 2**: `IcsSubscribeForm` catch에서 `setError(cleanIpcErrorMessage(submitError, '구독을 추가하지 못했습니다'))`.
- [ ] **Step 3**: 게이트 + 커밋 — `"리뷰 반영: 구독 추가 실패 문구를 사람 말로 (#16)"`

### Task 2.5 [필수/P3] ICS 재적재의 '동료 변경' 펄스 오탐 억제 (#17)

**문제**: App.tsx의 ICS 재적재가 `bflow:calendar-changed`(detail.action='ics')를 쏘는데 ScheduleView는 `action === 'optimistic-metadata'`만 하이라이트 억제 → 구독 추가·활성화·앱 시작 후 첫 적재 시 그 구독의 보이는 일정 **전부가** added로, 이름·색 변경 시 전부 changed로(changeKey에 color·createdBy 포함) 2초 펄스한다.

- [ ] **Step 1: 실패 테스트** — sharedUi의 기존 하이라이트 테스트 패턴으로, `detail: { action: 'ics' }` 이벤트 발화 후 refetch에 ics 이벤트가 추가돼도 highlightedEventIdentities가 비어 있음을 단언.
- [ ] **Step 2: 구현** — ScheduleView `handleCalendarChanged`의 suppress 조건에 `action === 'ics'` 추가(헬퍼 `isIcsCalendarRefresh(event)` 신설 또는 기존 헬퍼 확장). **의도 명시 주석**: 실시간 하이라이트는 '팀원 변경' 안내가 목적이라 외부 구독 갱신은 대상이 아니다.
- [ ] **Step 3: PASS + 커밋** — `"리뷰 반영: 구독 일정 갱신이 팀원 변경처럼 반짝이지 않게 (#17)"`

### Task 2.6 [권장/P3] 위젯 팝업 창에도 구독 일정 (#18)

**문제**: `loadIcsEvents` + `onIcsChanged` 배선이 App.tsx에만 있어, 별도 창으로 띄운 캘린더 위젯(WidgetPopup)에는 구독 일정이 전혀 안 나온다(메인 창과 표시 불일치 — 과거 lessons의 "표면 확장 시 WidgetPopup 경로 필수 점검" 그 패턴).

- [ ] **Step 1**: App.tsx의 해당 effect 로직을 `src/hooks/useIcsEventsFeed.ts`로 추출(초기 1회 `loadIcsEvents` + `onIcsChanged` 수신 시 재적재 + 성공 시 `bflow:calendar-changed` `{action:'ics'}` dispatch + cleanup). App.tsx와 WidgetPopup.tsx 양쪽에서 호출. WidgetPopup의 캘린더 위젯이 `getEvents()` 경로를 쓰는지 먼저 grep으로 확인(아니면 STOP하고 보고).
- [ ] **Step 2**: 게이트 + 프리뷰 실측(위젯 팝업 창에서 구독 일정 확인 — 프리뷰 모드: dev `?preview=1`, mock '배한솔'/pw '1234', vite-preview 포트 5190) + 커밋 — `"리뷰 반영: 위젯 팝업 창에도 구독 일정 표시 (#18)"`

### Task 2.7 [선택/P3] ICS 잔손질 묶음 (#19, #20, #21)

- [ ] **A**: CalendarRail의 구독 해제·새로고침 async IIFE에 catch(→ `console.warn` + `reloadIcsSubscriptions()` 재시도 1회) (#19).
- [ ] **B**: `ICS_CAL_PREFIX`(calendarService.ts:1063) 제거하고 shared의 `ICS_CALENDAR_ID_PREFIX`/`icsCalendarId` import로 단일화(렌더러는 shared 값 import 가능 — 금지는 electron/ 쪽만). `ICS_IPC_CHANNELS`는 preload.ts에서 실제 사용하도록 바꾸거나(preload는 값 import 가능) 삭제 — 어느 쪽이든 "죽은 상수" 상태 해소. electron/icsSubscriptionIpc.ts는 리터럴 유지 + 사유 주석(shared 값 import 금지 제약) (#20).
- [ ] **C**: IcsSubscribeForm 편집 모드 placeholder를 `"이름"`으로(빈 값 → 기존 이름 유지가 실동작), CalendarRail 툴팁 라벨 `"마지막 확인"` → `"마지막으로 받아온"` (#21).
- [ ] 게이트 + 커밋(각각 분리) — `"리뷰 반영: 구독 UI 잔손질 (#19)"` / `"(#20)"` / `"(#21)"`

---

## Chunk 3: 시간표 DnD·저장 동시성 (`src/hooks/useTimeGridDnD.ts`, `src/hooks/useCalendarDnD.ts`, `src/components/calendar/WeekTimeGridView.tsx`)

### Task 3.1 [필수/P2] 제자리 드롭(0-델타)을 no-op으로 (#32)

**문제**: 드롭 완료(`getTimeGridDragCompletion`)가 patch를 원본과 비교하지 않는다. 15분 슬롯=14px, 임계=5px이라 블록을 5~6px 흔들어 같은 슬롯에 놓는 일이 흔한데, 이 무변경 저장이 렌더러→메인→DB 어느 층에서도 걸러지지 않고 **team 캘린더면 본인 제외 전원(~20명)에게 "변경했어요" 알림을 실발송**하며(electron/calendarIpc.ts의 queueCalendarNotification이 무조건 실행) DB 알림 행 적재 + 전 클라이언트 정본 재조회 + 낡은 화면에서의 LWW 되돌림 창 확대까지 일으킨다.

- [ ] **Step 1: 실패 테스트** — `tests/timeGridDnD.test.ts`에 순수 함수 단위:

```ts
test('임계를 넘겼어도 원위치 드롭이면 완료를 만들지 않는다', () => {
  const original = { startDate: '2026-09-01', endDate: '2026-09-01', startTime: '14:00', endTime: '15:00' };
  const state = { mode: 'move', hasCrossedThreshold: true, eventId: 'e1', identity: { id: 'e1' }, original };
  const preview = { mode: 'move', eventId: 'e1', identity: { id: 'e1' }, ...original };
  assert.equal(getTimeGridDragCompletion(state as never, preview as never), null);
});
test('한 슬롯이라도 움직였으면 완료를 만든다', () => { /* startTime 14:15로 변형 → not null */ });
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `getTimeGridDragCompletion`의 event-change 분기에서, `state.original`이 있고 patch 4필드(startDate·endDate·startTime·endTime)가 전부 original과 같으면 `null` 반환. **주의**: 함수 시그니처의 `Pick<ActiveTimeGridDrag, ...>`에 `'original'`을 추가해야 한다(현재 Pick에 없음 — typecheck가 잡아준다). **주의**: endTime이 비어 있던 일정은 original.endTime이 1시간 폴백값이라 제자리 드롭 = 폴백값과 동일 patch → no-op 처리된다. 이것이 의도다(사용자가 아무것도 안 바꿨으므로 DB의 null endTime을 굳이 실체화하지 않는다) — 주석으로 명시.
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 제자리 드롭이 저장·알림을 만들지 않게 (#32)"`

### Task 3.2 [필수/P2] 저장 중 잠금을 우클릭에도 (#33)

**문제**: 9차 커밋(5511fd2)이 저장 진행 중 블록의 **좌클릭**(상세 열기)만 막고 `onContextMenu`는 안 막아, 저장 대기 중 블록을 우클릭해 퀵에디트를 열고 같은 일정을 또 저장하면 9차가 막으려던 겹침(늦게 커밋된 예전 드롭이 방금 저장을 되돌림)이 재현된다. calendarService는 겹친 저장을 직렬화하지 않고 사후 재수렴만 한다.

- [ ] **Step 1: 실패 테스트** — `tests/weekTimeGridView.test.ts`의 기존 isPersisting 클릭 차단 테스트 패턴을 복제해 onContextMenu 버전 작성(타임 블록 + 종일 바 둘 다).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — WeekTimeGridView의 타임 블록 onContextMenu(:898 부근): 핸들러 첫머리에 `if (isPersisting) return;`. 종일 바(:544 부근): `if (timeGridDnD.isPersisting(bar.event)) return;`.
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 저장 중인 블록은 우클릭 편집도 잠금 (#33)"`

### Task 3.3 [필수/P2] 드래그 Esc 전파 차단 + 보조 버튼 mouseup 무시 (#37, #38)

**문제 2건**: ① useTimeGridDnD의 Esc 취소(:435-440)가 `stopPropagation` 없이 소비돼 window에 등록된 EventSidePanel의 Esc 리스너까지 도달 → 드래그 취소와 동시에 패널이 닫히거나 **편집 중이면 abandonEdit으로 초안 폐기**(document→window 버블 순서로 반드시 함께 발화함을 검증 완료). 월간 훅(useCalendarDnD:161 부근 handleKeyDown)도 같은 패턴. ② `finish`(document mouseup)가 `event.button`을 확인하지 않아 좌클릭 드래그 중 우클릭을 눌렀다 떼면 그 mouseup(button=2)이 **드롭 확정**으로 처리되고, Windows에선 이어지는 contextmenu가 방금 저장된 블록의 퀵에디트까지 연다 — "취소" 의도의 우클릭이 저장+팝업으로 끝난다.

- [ ] **Step 1: 실패 테스트** — `tests/timeGridDnD.dom.test.ts`에: (a) 드래그 활성 중 Escape keydown 이벤트에 대해 `stopPropagation` 호출 여부(이벤트 객체 spy) 단언. (b) 임계 통과 후 `button: 2` mouseup dispatch → onEventChange 미호출 + 드래그 상태 유지(이후 button 0 mouseup으로 정상 완료) 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — ① useTimeGridDnD `cancel`: `event.stopPropagation()` 추가(드래그 존재 시에만 리스너가 붙으므로 부작용 범위는 드래그 중으로 한정 — 주석 명시). useCalendarDnD `handleKeyDown` 동일. ② `finish` 첫머리: `if (event && typeof event.button === 'number' && event.button !== 0) return;` — 드래그는 계속(좌버튼이 아직 눌려 있음).
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 드래그 취소 Esc·보조 버튼이 딴 데 새지 않게 (#37 #38)"`

### Task 3.4 [권장/P3] 드래그 중 수동 휠 스크롤 시 프리뷰 갱신 (#39)

**문제**: 드래그 중 휠 스크롤에는 프리뷰 갱신 경로가 없어(자동 가장자리 스크롤만 갱신), 스크롤 직후 포인터를 안 움직이고 놓으면 finish의 재계산이 고스트·라이브 라벨이 보여주던 것과 **다른 시각**으로 저장한다.

- [ ] **Step 1: 구현** — 드래그 활성 effect 안에서 `scrollContainerRef.current`에 `scroll` 리스너 추가: `latestPointerRef.current`가 있으면 `refreshPreview(pointer.x, pointer.y)`. cleanup에서 해제.
- [ ] **Step 2**: dom 테스트로 표현 가능하면 추가(스크롤 이벤트 dispatch → 프리뷰 갱신), 하네스가 scroll rect를 못 흉내 내면 수동 확인 항목으로 기록하고 넘어간다(기록 필수).
- [ ] **Step 3**: 게이트 + 커밋 — `"리뷰 반영: 드래그 중 휠 스크롤에도 고스트를 정직하게 (#39)"`

### Task 3.5 [권장/P3] 주 전환 시 활성 드래그 취소 (#41)

**문제**: 드래그 중 Shift+휠·키보드 ←→ 주 전환이 차단되지 않는다. create 드래그는 anchor.date가 이전 주 날짜로 고정된 채 고스트만 사라지고, 놓으면 **지난주 날짜가 프리필된 생성 창**이 열린다.

- [ ] **Step 1: 구현** — useTimeGridDnD 반환에 `cancelActiveDrag()` 추가(내부 `clearDrag` + hasCrossedThreshold였다면 finishedAtRef 마킹 — 기존 cancelDrag와 동일 동작을 외부 노출). WeekTimeGridView에서 주 식별자(weekKey 또는 dateStrings[0]) 변경 감지 effect → `timeGridDnD.cancelActiveDrag()`. 이 방식은 휠·키보드·미니 달력 등 **모든** 주 변경 경로를 한 번에 커버한다.
- [ ] **Step 2: 테스트** — dom 테스트: 드래그 활성 상태에서 주 변경 rerender → 이후 mouseup에 onCreate/onEventChange 미발화 단언.
- [ ] **Step 3**: 게이트 + 커밋 — `"리뷰 반영: 주가 바뀌면 진행 중 드래그를 취소 (#41)"`

### Task 3.6 [선택/P3] 새벽 밴드 스크롤 보정 + 리사이즈 커서 어포던스 (#40, #44)

- [ ] **A (#40)**: WeekTimeGridView 초기 스크롤 effect(:453-474 부근)의 deps에서 `dawnVisible`을 빼고(초기 진입·주 변경 시에만 now 앵커), 새벽 밴드 onToggle 핸들러에서 접힘/펼침 직후 `scroller.scrollTop ± (밴드 시간 * HOUR_PX)` 보정으로 화면상 위치 보존. 저녁 밴드와의 비대칭 해소.
- [ ] **B (#44)**: 각 타임 블록(button) 안에 하단 8px 절대배치 투명 div(`cursor: ns-resize`, `pointer-events: auto`, 자식이므로 mousedown은 기존 블록 핸들러로 버블) 추가 — 읽기 전용 블록엔 미부착. 스펙 D11의 ns-resize 어포던스.
- [ ] 게이트 + 프리뷰 실측(스크롤 보정·커서) + 커밋 분리 — `"리뷰 반영: 새벽 밴드 접기가 화면을 안 튀게 (#40)"` / `"리뷰 반영: 길이 조절 구간에 커서 안내 (#44)"`

---

## Chunk 4: 편집기 견고화 (`src/components/calendar/EventSidePanel.tsx`, `EventQuickEdit.tsx`, `EventCreateModal.tsx`, `src/views/ScheduleView.tsx`, `src/utils/calendarLocalMutation.ts`)

### Task 4.1 [필수/P2] 무관한 정본 갱신이 편집 드래프트를 지우지 않게 (#34)

**문제**: 패널·퀵에디트의 재수화 effect가 `event` **객체 참조**를 deps로 갖는데, `getEvents()`가 bflow 일정을 매번 `withBflowCalendarPresentation`으로 **새 객체**로 만들고 `applyCanonicalEvents`가 이를 panelEvent/quickEdit에 재주입한다. 결과: 팀원 누군가 **아무 일정이나** 바꿔 재조회가 돌면(20명 팀에서 상시), 내용이 그대로여도 effect가 돌아 패널은 `rehydrateFromEvent` + `setEditing(false)`(편집모드 이탈+초안 소실), 퀵에디트는 전 필드 리셋. 구글 일정은 캐시 참조가 유지돼 증상이 없다(비대칭이 방증).

**수정 지점은 컴포넌트가 아니라 공급자다** — 컴포넌트의 rehydrate 로직·훅 순서는 건드리지 않는다(하네스 계약).

- [ ] **Step 1: 실패 테스트** — `tests/calendarMutationFailureUi.test.ts`(또는 sharedUi)에: 패널 편집 중(드래프트 변경 상태) → **내용이 동일한** canonical 재적용(applyCanonicalEvents 경로 재현: 같은 필드의 새 객체) → 드래프트 유지 + editing 유지 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — ScheduleView `applyCanonicalEvents`의 `setPanelEvent`·`setQuickEdit` 갱신부에서: canonical을 찾았을 때 `calendarEventIdentityKey` 동일 && `eventContentSnapshot(canonical) === eventContentSnapshot(previous[.event])`이면 **previous(기존 객체)를 그대로 반환**해 참조 안정성을 만든다(내용이 다르면 기존대로 canonical 채택 → 동료 변경 반영 동작 불변). `eventContentSnapshot`은 `@/utils/calendarLocalMutation` export — import 추가.
- [ ] **Step 4: PASS + 기존 "저장 중 동료 변경 반영" 계열 테스트 전부 통과 확인 + 커밋** — `"리뷰 반영: 남의 일정 변경이 내 편집 초안을 지우지 않게 (#34)"`

### Task 4.2 [필수/P2] 캘린더 이동 저장 실패가 조용히 삼켜지지 않게 (#35)

**문제**: 패널 `handleSave`의 `optimisticSnapshot: directUpdateSnapshot(event, updates)`는 날짜 정규화만 하는데, 서비스의 낙관 반영은 `withBflowCalendarPresentation`으로 color·sourceCalendarId·canEdit·isReadOnly·isPrivate를 파생시킨다. changeKey에 그 필드들이 포함되므로 캘린더 이동(A→B) 실패 시 스냅샷이 반드시 불일치 → `markMutationFailed`가 오류 표시 대신 rehydrate 분기로 빠져 **실패 안내 없이 편집이 닫히고 원복**된다. ScheduleView에는 같은 목적의 파생 헬퍼 `expectedLocalUpdatePresentation`(:295 부근)이 이미 있는데 패널만 빠졌다.

- [ ] **Step 1: 실패 테스트** — calendarMutationFailureUi의 기존 "저장 실패 안내" 패턴으로, updates에 `calendarId` 변경이 포함된 저장 실패 시 `mutationError` 표시 + 드래프트 보존 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 파생 로직 공용화: `src/utils/calendarLocalMutation.ts`에 순수 함수 추가(스토어 접근 금지 — calendars를 인자로):

```ts
export function withCalendarPresentationForSnapshot(
  event: CalendarEvent,
  updates: Partial<CalendarEvent>,
  calendars: ReadonlyArray<{ id: string; color?: string; canEdit?: boolean; isPersonal?: boolean }>,
): Partial<CalendarEvent> { /* updates.calendarId가 있으면 ScheduleView.expectedLocalUpdatePresentation(:295-315)과
  동일한 파생(color·sourceCalendarId·calendarId·canEdit·isReadOnly·isPrivate)을 updates에 병합해 반환. 없으면 updates 그대로. */ }
```

  ScheduleView의 `expectedLocalUpdatePresentation`을 이 헬퍼 호출로 리팩터(동작 불변 — 기존 테스트가 지켜줌). EventSidePanel `handleSave`는 `directUpdateSnapshot(event, withCalendarPresentationForSnapshot(event, updates, calendars))`로 optimisticSnapshot 생성(패널은 이미 `calendars`를 구독 중).
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 캘린더 이동 저장 실패를 제대로 알리게 (#35)"`

### Task 4.3 [필수/P2] 일정 생성·복사 실패 안내 (#36)

**문제**: 수정·삭제에는 실패 안내가 촘촘한데 생성 계열 두 표면은 전무 — ① EventCreateModal `handleSubmit`이 async `onSave`를 fire-and-forget(저장 중 버튼 잠금도 없음): 실패 시 낙관 이벤트가 롤백돼도 모달엔 아무 표시가 없어 사용자가 닫으면 일정이 조용히 사라진다. ② 퀵에디트 '복사'(`handleDuplicate`)는 onDuplicate를 던진 채 즉시 닫는다. 전역 unhandledrejection 처리 없음.

- [ ] **Step 1: 실패 테스트** — ① 모달: onSave reject 시 오류 문구 표시 + 모달 유지 + 저장 중 버튼 disabled 단언. ② 퀵에디트: onDuplicate reject 시 `mutationError` 표시 + 팝업 유지 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — ① EventCreateModal: `saving`·`saveError` state(**기존 useState 선언들 뒤에** — 하네스 계약), handleSubmit을 `if (saving) return; setSaving(true); try { await onSave(...); } catch (e) { setSaveError('일정을 저장하지 못했어요. 다시 시도해 주세요.'); } finally { setSaving(false); }`로. 만들기 버튼 `disabled={saving}` + '저장 중…' 라벨. 성공 시 닫기는 기존 경로(ScheduleView.handleAddEvent가 닫음) 유지 — 이중 닫기 없는지 확인. ② EventQuickEdit `handleDuplicate`: `beginMutation`/`settleMutation`/`markMutationFailed` 기존 잠금 재사용 — `try { const r = onDuplicate(event); if (isPromiseLike(r)) { ... then(onClose, () => markMutationFailed(..., '일정을 복사하지 못했어요...')) } else onClose(); }` 형태(같은 파일 handleDelete 구조 복제). `onDuplicate` prop 타입을 `void | Promise<void>` 반환으로 갱신하고 ScheduleView `handleDuplicateEvent`(이미 async)를 그대로 물린다.
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 일정 만들기·복사 실패를 화면에 알리게 (#36)"`

### Task 4.4 [권장/P3] 편집기 잔손질 4건 (#42 계열, 패널 태그 칩 포함)

- [ ] **A**: 퀵에디트 exit 잔존 리스너 — `framer-motion`의 `useIsPresent()`를 도입해 outside-click·Esc 핸들러 첫머리에 `if (!isPresent) return;`(exit 중인 죽은 인스턴스가 새 팝업의 첫 클릭을 닫아버리는 150ms 경합 차단).
- [ ] **B**: 퀵에디트 저장·삭제 진행 중에는 outside-click·Esc로 닫히지 않게 — 두 핸들러에 `if (pendingMutationRef.current) return;` (닫힌 뒤 실패하면 안내가 어디에도 안 뜨는 문제의 최소 수정. 시간표 드롭의 "취소 후 늦은 안내" 기존 동작과는 별개 표면).
- [ ] **C**: 저장 중 잠금 누락 마감 — 퀵에디트 `handleCalendarChange`/`handleTagChange` 첫머리에 `if (pendingMutationRef.current) return;`, EventSidePanel 태그 칩('없음' 포함) 버튼에 `disabled={isMutating}` 추가(:587 부근).
- [ ] **D**: EntityAwareInput — `disabled`로 바뀌면 열려 있던 @멘션 드롭다운을 닫는 effect 추가(주석 "멘션 자동완성도 함께 멈춘다"를 실동작으로).
- [ ] 각각 테스트 가능한 것은 기존 패턴으로 테스트 추가, 게이트 + 커밋 분리 — `"리뷰 반영: 편집기 잠금·닫힘 경계 잔손질 (#42)"` 등.

### Task 4.5 [필수/P2] 패널 열림 중 캘린더 키보드 복원 (#24)

**문제**: 키보드 핸들러 effect 게이트(ScheduleView:978-984 부근)에 `|| panelEvent`가 들어가 **상세 패널이 열려 있는 동안 캘린더 키보드 전체(←→·T/W/M/C·?)가 죽는다**. 구 코드는 리스너를 유지하고 Esc만 패널에 위임했다. 플랜 C.4 "←→는 기존 동작 유지" 위반.

- [ ] **Step 1: 실패 테스트** — sharedUi: panelEvent 있는 상태에서 ArrowRight keydown → 주 이동 발생, Escape keydown → 주/포커스 동작 없이 통과(패널 자체 리스너가 처리) 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — effect 게이트(:978-984 부근, 리스너 등록 조건)에서 `panelEvent`만 제거하고(모달·퀵에디트·태그 관리자 게이트는 유지), 핸들러 안 기존 `role="dialog"` 가드(:987 부근) 다음에 `if (panelEvent && e.key === 'Escape') return;` 추가(구 코드 방식 복원 — 근거 diff: `git diff 7ab9fe4..ad199b7 -- src/views/ScheduleView.tsx`에서 삭제된 라인 참조). deps 배열 갱신. EventSidePanel은 `role="dialog" aria-modal`이 아니라 :987 가드에 걸리지 않음을 확인했다 — 이 수정이 실효.
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 상세 패널이 열려 있어도 키보드 이동이 되게 (#24)"`

---

## Chunk 5: 네비게이션·시각 폴리싱 (`src/views/ScheduleView.tsx`, `src/components/calendar/CalendarGrid.tsx`, `WeekScrollView.tsx`, `DayScrollView.tsx`, `WeekTimeGridView.tsx`, `TagBar.tsx`)

### Task 5.1 [필수/P2] 미니 달력 월 넘김과 본화면 분리 (#22)

**문제**: PR-D가 미니 달력을 주간·오늘 보기로 확장하면서 월간 전용이던 `onMonthChange={(d) => { setYear(...); setMonth(...) }}`를 그대로 물려줬다. 주간·오늘 보기는 `weeks = generateYearWeeks(year)`와 연 기준 절대 인덱스를 쓰므로, 미니 달력 화살표로 12월↔1월 경계를 넘기는 순간(**클릭 없이 구경만 해도**) 본화면이 약 1년 점프한다. 날짜 **클릭** 이동은 연도 경계 포함 정상(applyScheduleDateNavigation — 건드리지 말 것).

- [ ] **Step 1: 실패 테스트** — sharedUi: 주간 보기에서 MiniCalendar onMonthChange(다음 해 1월) 호출 → `weeks`/헤더 라벨/activeWeekIndex 표시가 안 바뀜 + MiniCalendar의 currentMonth만 바뀜 단언. 날짜 클릭(onDateSelect)은 기존대로 이동 단언.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — ScheduleView에 `miniCalendarBrowseMonth` state 추가(**기존 useState 선언들 뒤** — 하네스 계약): `Date | null`.
  - MiniCalendar `currentMonth`: 월간 → 기존 `new Date(year, month, 1)`; 주간·오늘 → `miniCalendarBrowseMonth ?? (보고 있는 주 첫날/활성 일 기준 월)`.
  - `onMonthChange`: 월간 → 기존 setYear/setMonth; 주간·오늘 → `setMiniCalendarBrowseMonth(d)`만.
  - `onDateSelect`(handleMiniCalendarDateSelect): 기존 동작 + `setMiniCalendarBrowseMonth(null)`.
  - 주/일 이동(activeWeekIndex·activeDayIndex·viewMode 변경) 시 browse 월 리셋 effect: `setMiniCalendarBrowseMonth(null)`.
- [ ] **Step 4: PASS + 커밋** — `"리뷰 반영: 미니 달력 넘겨보기가 본화면을 끌고 가지 않게 (#22)"`

### Task 5.2 [필수/P2] 이벤트 바 툴팁 앵커 복원 (#23)

**문제**: 툴팁을 `motion.div` + `animate={{scale}}`로 바꾸며 framer-motion 10.18.0이 transform을 자체 관리해 style의 정적 `transform: 'translate(-50%, -100%)'`를 덮어쓴다(framer 소스로 확정). 모든 바 hover에서 툴팁이 커서 위 중앙이 아니라 오른쪽 아래로 어긋난다.

- [ ] **Step 1: 구현** — CalendarGrid 툴팁(:285-297 부근): style에서 `transform` 제거, motion value로 이동 —
  `initial={reduceMotion ? false : { opacity: 0, scale: 0.96, x: '-50%', y: '-100%' }}` / `animate={{ opacity: 1, scale: 1, x: '-50%', y: '-100%' }}` (레포 내 WelcomeToast가 같은 패턴 — 참조).
- [ ] **Step 2: 테스트/실측** — sharedUi류 하네스가 motion props를 읽는다면 animate에 x/y 포함 단언 추가. **프리뷰 실측 필수**: 바 hover 시 툴팁이 커서 위 중앙(reduce 모드 포함).
- [ ] **Step 3**: 게이트 + 커밋 — `"리뷰 반영: 바 툴팁이 제자리(커서 위 중앙)에 뜨게 (#23)"`

### Task 5.3 [권장/P3] 주간 헤더 연말 라벨 모순 해소 (#25)

**문제**: 헤더가 anchor(`startWeek[3]` — 주석은 목요일이라지만 일요일 시작 주에서 index 3은 **수요일**)의 달력 연·월과 ISO 주차를 병기해, 연말 주(12.28–1.3)에서 "2025년 12월 · 1주차"처럼 연도와 주차가 다른 해를 가리킨다.

- [ ] **Step 1: 실패 테스트** — 2025-12-28(일)~2026-01-03(토) 주를 활성으로 헤더 라벨 계산 → `"2026년 1월 · 1주차 · 12.28 – 1.3"` 단언.
- [ ] **Step 2: 구현** — anchor를 `startWeek[4]`(진짜 목요일)로 바꾸고 연·월·주차를 모두 anchor 기준으로. **일요일 시작 주에서 수/목의 ISO 주차는 항상 같으므로** WeekSidebar(`week[3]`)의 주차 값과 계속 일치한다 — 근거 주석 + 일치 테스트 1개.
- [ ] **Step 3**: PASS + 커밋 — `"리뷰 반영: 연말 주간 헤더의 연도·주차 모순 해소 (#25)"`

### Task 5.4 [권장/P3] 연타 스킵 커버리지 확장 (#26)

- [ ] **A**: 월간 방향키 포커스 이동의 월 경계 분기(ScheduleView:1100-1116 부근 setFocusedDate 업데이터에서 setMonth/setMonthDir 하는 곳)에 `markPeriodNavigation()` 추가 — 꾹 누르면 스킵이 걸리게.
- [ ] **B**: WeekScrollView에 `instantScroll?: boolean` prop 추가 → 주 이동의 `scrollIntoView({ behavior: ... })`(:267 부근)를 `(reduce || instantScroll) ? 'auto' : 'smooth'`로. ScheduleView가 `skipPeriodTransition` 전달. **DayScrollView는 scrollIntoView가 없는 캐러셀 구조(activeDayIndex ± 2일 직접 렌더)이므로 일 보기는 스킵하고 완료 보고에 그 사실을 명시**한다.
- [ ] **C**: 연타 첫 반복의 exit 잔상(CalendarGrid:533)은 **수정하지 않고 기록만** — exit prop이 이전 렌더를 캡처하는 framer 특성상 저비용 해법이 없다. 완료 보고에 명시.
- [ ] 테스트: markPeriodNavigation 호출 여부는 기존 스킵 테스트 패턴, prop 전달은 렌더 단언. 게이트 + 커밋 — `"리뷰 반영: 빠른 연타 즉시 전환을 주·일 보기에도 (#26)"`

### Task 5.5 [권장/P3] 펄스 타이머 단일화 (#27)

**문제**: '오늘' 펄스 타이머(2.5s)와 미니 달력·딥링크 펄스 타이머(3s)가 서로를 정리하지 않아, 3초 안에 섞어 쓰면 앞선 타이머가 새 펄스를 조기 소등.

- [ ] **Step 1: 구현** — 단일 헬퍼 `startPulse(dateStr, ms)`: 기존 두 타이머 ref를 하나로 통합(모든 경로에서 기존 타이머 clear 후 set). `goToToday`와 `applyScheduleDateNavigation` 모두 이 헬퍼 사용(후자의 persistedDateRange 3초 해제는 별도 유지).
- [ ] **Step 2**: 테스트(fake clock으로 today→2초 뒤 미니 달력 이동 → 3초 유지 단언) + 게이트 + 커밋 — `"리뷰 반영: 이동 펄스가 서로를 꺼뜨리지 않게 (#27)"`

### Task 5.6 [권장/P3] 필터 페이드 opacity 고착 해제 (#28)

**문제**: 페이드 effect가 서명 갱신 후 `if (reduce) return`하는 구조라, 120ms 딥 도중 OS '동작 줄이기'가 켜지면 cleanup이 복구 타이머를 지운 뒤 재실행이 조기 반환 → 컨테이너 opacity 0.55 고착.

- [ ] **Step 1: 구현** — effect의 reduce 분기를 `if (reduce) { setFilterFadeOpacity(1); return; }`로.
- [ ] **Step 2**: 게이트 + 커밋 — `"리뷰 반영: 동작 줄이기 전환 중 화면이 반투명으로 굳지 않게 (#28)"`

### Task 5.7 [권장/P3] 시간표에도 '오늘'/이동 펄스 (#29 + 죽은 테스트 #47a)

**문제**: 릴리스 노트 1.109.0이 "이동 안내 표시를 주간 시간표…까지 넓혔어요"라고 안내하지만 WeekTimeGridView에는 pulseDate가 전달되지 않고 렌더 코드도 없다. 게다가 `tests/calendarSharedUi.test.ts:5972` 부근의 '오늘 펄스' 테스트가 '주간 시간표' 케이스를 **정의해 놓고 `slice(0, 2)`로 제외**했고, 켜도 월 그리드 스텁을 읽는 죽은 검증이다.

- [ ] **Step 1: 실패 테스트** — slice(0,2) 제거 + 세 번째 케이스의 read를 `scheduleTimeGridProps`(시간표 스텁, 같은 파일 :323 부근) 기준으로 수정 → 실패 확인.
- [ ] **Step 2: 구현** — WeekTimeGridView에 `pulseDate?: string | null` prop 추가, 요일 헤더의 해당 날짜 셀에 WeekScrollView(:305-322 부근)와 동일한 펄스 오버레이(motion.div, reduce 가드 포함) 렌더. ScheduleView에서 전달.
- [ ] **Step 3**: PASS + 프리뷰 실측(시간표 모드에서 '오늘' 클릭) + 커밋 — `"리뷰 반영: 시간표 보기에도 이동 펄스 표시 (#29)"`
- **대안**: 구현이 예상 밖으로 커지면(30분+) 중단하고, update-notes 1.109.0 문구에서 "주간 시간표" 언급을 빼는 정정 + 테스트 케이스 삭제로 축소한 뒤 보고.

### Task 5.8 [선택/P3] 소소 3건 (#30, #31, #43)

- [ ] **A (#30)**: 월 빈 상태 안내 — 안내 div를 `z-10`으로 올리고(pointer-events-none 유지), ScheduleView에서 이벤트 초기 로드 완료 여부 prop(`eventsLoaded`)을 CalendarGrid에 내려 로드 전에는 빈 상태 안내를 렌더하지 않는다(진입 직후 오탐 제거).
- [ ] **B (#31)**: TagBar 칩 motion.button에 `initial={false}` 추가 — 마운트 시 일제 pop 제거, 토글 시에만 재생(기존 테스트의 animate 단언은 유지됨 — 확인).
- [ ] **C (#43)**: 캘린더 단축키 keydown(ScheduleView:1002 부근, 현재 `const key = e.key.toLowerCase();`)에 한글 IME 폴백을 추가 — e.key가 't'/'w'/'m'/'c'가 아니고 `e.code`가 `KeyT/KeyW/KeyM/KeyC`면 code 기반으로 매핑. 구현 형태는 자유지만 **한글 모드에서 T/W/M/C 동작 + 영문 모드 기존 동작 불변 + 입력 필드 가드 유지**가 요건. 테스트: `e.key='Process', e.code='KeyT'` 케이스.
- [ ] 게이트 + 커밋 분리.

---

## Chunk 6 [선택]: 프리뷰 mock·테스트 정리

### Task 6.1 [선택/P3-mock] 멤버-only UPDATE 봉투의 행 되돌림 (#45)

**문제**: 멤버만 바꾼(changedFields 빈) 캘린더 UPDATE 봉투가 수신 창에서 행 전체 upsert로 처리되어(`src/mocks/devElectronAPI.ts:706` 부근 `changedFields.length > 0` 분기의 else 경로), 동시에 진행된 상대 창의 이름·색·공개범위 수정을 송신자의 낡은 스냅샷으로 되돌린다. 9차 하이드레이션 필드 병합이 이 실시간 경로에는 미적용.

- [ ] **Step 1: 실패 테스트** — 두 스토어 시뮬레이션: A창 이름 수정 → B창 멤버 추가(빈 changedFields 봉투) 순서로 수신 → A의 이름 수정이 보존됨 단언(이 테스트가 수용 항목 "늦은 합류 하이드레이션 병합 회귀 테스트 부재"의 인접 커버리지도 겸한다).
- [ ] **Step 2: 구현** — UPDATE 봉투에서 changedFields가 비어 있고 로컬에 행이 이미 있으면 full upsert 대신 **membersChanged 처리만** 수행(9차 하이드레이션의 "이미 있는 행은 필드 항목이 채운다" 원칙과 동일).
- [ ] **Step 3**: PASS + 커밋 — `"리뷰 반영(프리뷰): 멤버 변경이 상대 창 수정을 되돌리지 않게 (#45)"`

### Task 6.2 [선택/P3-mock] mock 관대함 축소 (#46)

- [ ] mock `icsAdd`에 `new URL` 파싱 기반 검증 + `parsed.toString()` 정규화(운영 normalizeIcsUrl과 동일 규칙 — shared로 못 옮기는 제약 탓에 mock 내 복제, 출처 주석). 나머지(calendar 생성·수정 검증, 이벤트 키 계약, 로그인 전 비대칭)는 **수정하지 않고 완료 보고에 목록만** 남긴다(별도 라운드).
- [ ] 게이트 + 커밋 — `"리뷰 반영(프리뷰): 구독 주소 검증을 운영과 맞춤 (#46 일부)"`

---

## 마무리 Task: 전체 게이트 + 보고

- [ ] `npm run typecheck` && `npm run test:calendar` && `npm run test:notifications` && `npm run build:vite` 전부 통과.
- [ ] `git push origin HEAD:claude/calendar-tg4-ics` (**refspec으로 fast-forward push** — 로컬 작업 브랜치 이름과 무관하게 원격 tg4를 갱신한다. force 금지. non-fast-forward로 거절되면 원격이 그새 움직인 것이니 STOP하고 보고).
- [ ] PR #260에 코멘트: 반영한 결함 번호별 커밋 매핑 표 + 건너뛴 [선택] 항목 + 수동 확인 필요 목록(프리뷰 실측 못 한 것).
- [ ] 완료 보고에 반드시 포함: ① 티어별 완료/스킵 현황 ② 테스트 수 변화(868 → N) ③ 계획과 다르게 구현한 지점과 사유 ④ 아래 "이 계획의 범위 밖" 목록 재전달.

## 이 계획의 범위 밖 (수정 금지 — 보고만 전달)

1. **벽시계 절충 재설계**: 반복 전개가 "날짜만 취하고 시각은 원본 DTSTART 유지"하는 보정은 node-ical 0.27.1(rrule-temporal)에서는 전제가 사라져 DST 시간대 피드에 능동적 오차를 만든다 — 그러나 하루 2회+ 접힘 정책 재결정과 얽혀 있어 **한솔 결정 후 별도 태스크**. 이번 라운드에서 건드리지 말 것.
2. 스택 브랜치 경계 정리(tg2에 딸려 들어간 커밋들) — 한솔 결정 대기.
3. 머지·G드라이브 배포 — 한솔 명시 지시 전 금지.
4. mock 관대함 잔여분(#46 나머지), CalendarGrid exit 잔상(#26-C).
