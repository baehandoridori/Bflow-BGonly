# 자동업데이트 helper swap 미해결 — 코덱스 핸드오프 컨텍스트

> **상태**: helper swap 시스템이 한솔 PC에서 단 한 번도 작동 안 함. 진단 정보 풍부하지만 root cause 미확정.
>
> **현재 main**: `4e1a213` 이후 v1.22.4 ~ v1.22.9까지 6번의 fix 시도 (PR #70~75 모두 머지). 그래도 안 됨.
>
> **권장 시작 worktree**: `claude/v1.22.9-swap-log-rotation` (또는 `main` 위에 새 브랜치).

---

## 1. 현재 상황 한 줄 요약

자동업데이트 시스템: 토스트는 뜸 → "지금 재시작" 클릭 → BFLOW 종료 → swap 적용 안 됨 → 다시 켜면 옛 버전 그대로 + dialog "자동 업데이트 적용 실패" 띄움.

## 2. 핵심 미스터리

**`swap.log`에 `[main]` 진단 로그조차 0건**. v1.22.6에 추가한 helper spawn 직전·직후 sync 로그(`earlyLog`)가 한솔 PC에서 한 번도 작성 안 됨.

```
2026-05-08T01:51:35  [diag-detached] after sleep OK   ← 우리 진단 직접 실행
2026-05-08T02:47:42  [helper-test-direct] ...          ← 우리 진단 직접 실행
(자동업데이트 cycle의 [main]/[helper] 로그: 0건)
```

즉:
- main process가 spawn 호출 자체를 안 했거나
- earlyLog의 sync write 자체가 silent fail (try/catch swallow)
- 아니면 hasPending이 false라 spawnSwapHelper 분기 진입 안 함

## 3. 알려진 사실

### 3.1 PowerShell 자체는 정상

한솔 PC PowerShell 7.5.5 (powershell.exe = 5.1, pwsh = 7). 직접 `& powershell.exe -NoProfile -EncodedCommand <base64>` 실행 시 swap.log에 정상 작성. detached spawn 패턴(`ProcessStartInfo + UseShellExecute=false + CreateNoWindow=true`)도 정상.

### 3.2 옛 helper.ps1 잔존 분석으로 v1.22.4 helper script syntax 에러 발견 + fix

v1.22.6 cmd wrapper가 만든 잔존 `bflow-helper-*.ps1` 직접 실행 시:
```
Variable reference is not valid. ':' was not followed by a valid variable name character.
At ... 133:22  Write-SwapLog "$stepName: rename try ..."
... (5개 위치)
Unexpected token '}' — ParserError
```

PowerShell이 `$stepName:`을 scope-qualified 변수로 파싱 시도 → script 전체 파싱 실패 → PowerShell 시작도 못 함 → swap.log에 [helper] 0건.

**v1.22.8에서 fix**: `${stepName}:` (5개 위치) + UTF-8 BOM (`'﻿' + psScript`).

### 3.3 v1.22.8 fix가 main.js에 적용된 것 확인

```
fixed pattern matches: 5
old pattern matches: 0
```

근데도 한솔 PC v1.22.8 → v1.22.9 자동업데이트 cycle에서 helper 로그 0건.

## 4. 코드 위치

| 파일 | 역할 |
|---|---|
| `electron/autoUpdate/helperSwap.ts` | PowerShell helper 스크립트 inline + spawn (direct + cmd wrapper) |
| `electron/autoUpdate/swapper.ts` | 옛 in-process swap (현재 not called from main) |
| `electron/autoUpdate/checker.ts` | 백그라운드 manifest 비교 + fetch (시작 즉시 호출) |
| `electron/autoUpdate/paths.ts` | 동적 경로 (NSIS / v1.21.x self-installer 자동 인식) |
| `electron/main.ts` | `before-quit` hook에서 hasPending 체크 → spawnSwapHelper 호출 |

핵심 함수:
- `main.ts:2905~2920` — before-quit hook의 swap 트리거
- `helperSwap.ts:50~90` — earlyLog (진단 로그)
- `helperSwap.ts:170~280` — spawnSwapHelper (direct + cmd wrapper)

## 5. 한솔 PC 환경

- Windows 11 Pro 26200
- PowerShell 7.5.5 + Windows PowerShell 5.1 (둘 다 사용 가능)
- BFLOW 설치: NSIS oneClick (`%LOCALAPPDATA%\Programs\bflow\`)
- 자동업데이트 마커: `%LOCALAPPDATA%\Bflow-BGonly\`
- swap.log 위치: `%LOCALAPPDATA%\Bflow-BGonly\swap.log`

## 6. 검증된 동작

- ✅ 토스트 표시 (renderer + IPC)
- ✅ NSIS Setup 첫 설치 + 강제 재설치
- ✅ Drive Desktop fetch (manifest + win-unpacked diff)
- ✅ before-quit hook 발화 (콘솔 로그 자체로 확인은 못 했지만, `.swap-suppressed` 마커가 v1.22.3 dialog 후 작성되는 걸로 발화 추정)

## 7. 검증 안 되는 동작

- ❌ helper 실제 swap (한 번도 성공 X)
- ❌ swap.log에 [main]/[helper] 로그 작성
- ❌ swap이 실패한 경우의 정확한 단계 추적

## 8. 추천 다음 시도 (코덱스에게)

1. **earlyLog static import 변경**: `helperSwap.ts:241~254`에 `require('fs')` dynamic. helperSwap.ts 위쪽에 이미 `import { writeFileSync, existsSync, mkdirSync } from 'fs'` 정적 import 있음. earlyLog의 dynamic require가 production build에서 silent fail하는지 의심.

2. **before-quit hook의 helper 호출 직전에 console.error 또는 sync log 추가**: 정확히 어디까지 도달하는지 확인.

3. **simpler approach**: helper PowerShell 패턴 폐기 + Windows native installer pattern 채용 검토 (electron-updater + NSIS auto-update).

## 9. 현재 worktree 정리

작업 worktree 후보:
- `C:\Bflow-BGonly\.claude\worktrees\v1.22.9-rotation` (현재 head v1.22.9, helperSwap 상태 좋음)
- 또는 `main`에 새 브랜치 (clean start)

현재 main HEAD: `2ed623a` (v1.22.9 swap.log rotation)

## 10. 한솔 PC 현재 상태 (2026-05-08 02:50 KST 시점)

- bflow: v1.22.9 (방금 NSIS install로 강제 갱신)
- pending/backup/markers: 모두 정리됨

## 11. 권장 진행 순서

1. **재현 환경**: 어떤 OS/PC에서 같은 fail 일어나는지 확인. 한솔 PC에 직접 access는 PowerShell tool로 가능.
2. **로그 진단 강화**: earlyLog가 안 작성되는 원인부터. main process가 정말 spawnSwapHelper 호출하는지 확인.
3. **검증 사이클**: v1.22.X push → 한솔 PC에서 자동업데이트 cycle → swap.log 결과로 다음 단계 결정.

## 12. 코덱스 머지/배포 권한

- 머지/빌드/G드라이브 배포는 한솔 명시 동의 시에만 (메모리 규칙 `feedback_pr_merge_gate.md`, `feedback_deploy_gate.md`).
- PR 생성까지는 자동 OK.
