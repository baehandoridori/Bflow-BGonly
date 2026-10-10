import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENE_NAME_RULES,
  namesOtherScenes,
  readSceneNameLists,
  refKey,
  sceneFamily,
  sceneListForScene,
  sceneRefKey,
  splitSceneId,
  workFileName,
} from '../src/utils/sceneFileNameList.ts';
import type { SceneNameList, SceneNameRules } from '../src/utils/sceneFileNameList.ts';

// #85의 두 열: 'a: 1 2* … 49* 50'(50개, 양 끝만 직접 적힌 번호).
const RANGE_50 = 'a: 1 ' + Array.from({ length: 48 }, (_, i) => (i + 2) + '*').join(' ') + ' 50';

// 설계 3.7의 번호 붙은 표 144줄: [번호, 경로, sceneId, partId, 읽힌 목록 전부, 이 씬의 목록].
// 표기: 'a: 1 3 5' = 글자 a, 열쇠 1·3·5 / '∅:' = 글자 없음 / '*' = 범위로 생긴 번호 / ' ; ' = 목록이 여럿 / '(없음)' = 목록이 하나도 없다.
// #34·#80·#114·#121·#134의 경로는 코드 값이다 — 붙여 넣는 사이 보통 글자로 바뀌면 그 줄이 지키던 규칙이 조용히 풀린다.
type Row = [number, string, string, string, string, string];

const ROWS: Row[] = [
  [1, 'a 001,003,005,007.moho', 'a001', 'A', 'a: 1 3 5 7', 'a: 1 3 5 7'],
  [2, 'a001,003,005.moho', 'a001', 'A', 'a: 1 3 5', 'a: 1 3 5'],
  [3, 'a001 003 005.moho', 'a001', 'A', 'a: 1 3 5', 'a: 1 3 5'],
  [4, 'a001_003_005.moho', 'a001', 'A', 'a: 1 3 5', 'a: 1 3 5'],
  [5, '001,003,005.moho', 'a001', 'A', '∅: 1 3 5', '∅: 1 3 5'],
  [6, 'ep2-a 001,003.moho', 'a001', 'A', 'ep: 2 ; a: 1 3', 'a: 1 3'],
  [7, 'b030-피드백.moho', 'b030', 'B', 'b: 30', 'b: 30'],
  [8, 'a012.moho', 'a012', 'A', 'a: 12', 'a: 12'],
  [9, 'b 001,003.moho', 'a001', 'A', 'b: 1 3', 'null'],
  [10, 'a001~005.moho', 'a003', 'A', 'a: 1 2* 3* 4* 5', 'a: 1 2* 3* 4* 5'],
  [11, 'a001-005.moho', 'a001', 'A', 'a: 1 ; ∅: 5', 'a: 1'],
  [12, 'a001-005.moho', 'a005', 'A', 'a: 1 ; ∅: 5', 'null'],
  [13, 'b030.moho', 'b030', 'B', 'b: 30', 'b: 30'],
  [14, 'B030-피드백.MOHO', 'b030', 'B', 'b: 30', 'b: 30'],
  [15, 'b031-다시.moho', 'b031', 'B', 'b: 31', 'b: 31'],
  [16, 'ep2-b030-retake.moho', 'b030', 'B', 'ep: 2 ; b: 30', 'b: 30'],
  [17, 'a012.mohoproj', 'a012', 'A', 'a: 12', 'a: 12'],
  [18, '[드라마 퀄리티] 한솔 SWver12.moho', 'a012', 'A', 'swver: 12', 'null'],
  [19, '윤서준.moho', 'a001', 'A', '(없음)', 'null'],
  [20, 'main.psd', 'a014', 'A', '(없음)', 'null'],
  [21, 'G:\\act\\A_014\\main.clip', 'a014', 'A', '(없음)', 'null'],
  [22, 'G:\\show\\EP2\\B030.moho', 'b030', 'B', 'b: 30', 'b: 30'],
  [23, 'G:/공유 드라이브/JBBJ/a 001,003.moho', 'a003', 'A', 'a: 1 3', 'a: 1 3'],
  [24, 'a001,a003,a005.moho', 'a001', 'A', 'a: 1 3 5', 'a: 1 3 5'],
  [25, 'A_001,003.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [26, 'a001, 003 , 005.moho', 'a001', 'A', 'a: 1 3 5', 'a: 1 3 5'],
  [27, 'a001+003&005.moho', 'a001', 'A', 'a: 1 3 5', 'a: 1 3 5'],
  [28, 'a001 a 003.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [29, 'a001,002 a003,004.moho', 'a003', 'A', 'a: 1 2 3 4', 'a: 1 2 3 4'],
  [30, 'a001,003,003,001.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [31, 'a 001,003 .moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [32, 'a001,003.backup.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [33, 'a001,003', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [34, String.fromCharCode(0xFF21, 0x3000, 0xFF10, 0xFF10, 0xFF11, 0xFF0C, 0xFF10, 0xFF10, 0xFF13) + '.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [35, 'a001,003수정.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [36, 'a001·003.moho', 'a001', 'A', 'a: 1 ; ∅: 3', 'a: 1'],
  [37, 'a001,,003.moho', 'a001', 'A', 'a: 1 ; ∅: 3', 'a: 1'],
  [38, 'a001 b002.moho', 'a001', 'A', 'a: 1 ; b: 2', 'a: 1'],
  [39, 'G:\\show\\a001,003\\', 'a001', 'A', '(없음)', 'null'],
  [40, '', 'a001', 'A', '(없음)', 'null'],
  [41, 'a001,003_v3.moho', 'a001', 'A', 'a: 1 3 ; v: 3', 'a: 1 3'],
  [42, 'a001,003_0325.moho', 'a001', 'A', 'a: 1 3 ; ∅: 325', 'a: 1 3'],
  [43, '0325_a001,003.moho', 'a001', 'A', '∅: 325 ; a: 1 3', 'a: 1 3'],
  [44, '20261010_001,003.moho', 'a001', 'A', '∅: 1 3', '∅: 1 3'],
  [45, '1010,1011 a001.moho', 'a001', 'A', '∅: 1010 1011 ; a: 1', 'a: 1'],
  [46, 'a001_2.moho', 'a001', 'A', 'a: 1 ; ∅: 2', 'a: 1'],
  [47, 'a001,003 (2).moho', 'a001', 'A', 'a: 1 3 ; ∅: 2', 'a: 1 3'],
  [48, 'a001,3.moho', 'a001', 'A', 'a: 1 ; ∅: 3', 'a: 1'],
  [49, 'a1,3,5.moho', 'a001', 'A', 'a: 1 3 5', 'a: 1 3 5'],
  [50, 'a00001,00003.moho', 'a001', 'A', '(없음)', 'null'],
  [51, 'ep2-001,003.moho', 'a001', 'A', 'ep: 2 ; ∅: 1 3', '∅: 1 3'],
  [52, 'ep02_001_002.moho', 'a001', 'A', 'ep: 2 ; ∅: 1 2', '∅: 1 2'],
  [53, 'take 001,002.moho', 'a001', 'A', 'take: 1 2', 'null'],
  [54, 'v2a001,003.moho', 'a001', 'A', 'v: 2 ; ∅: 3', 'null'],
  [55, 'a001,003retake.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [56, 'a001,003v2.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [57, 'a001,003fix.moho', 'a001', 'A', 'a: 1 3FIX', 'a: 1 3FIX'],
  [58, 'a001A,003.moho', 'a001A', 'A', 'a: 1A 3', 'a: 1A 3'],
  [59, 'a001A,003.moho', 'a001', 'A', 'a: 1A 3', 'a: 1A 3'],
  [60, 'a001,003.moho', 'a001A', 'A', 'a: 1 3', 'a: 1 3'],
  [61, 'a001,003.moho', 'a005', 'A', 'a: 1 3', 'a: 1 3'],
  [62, 'a 001,003,005,007.moho', 'a002', 'A', 'a: 1 3 5 7', 'a: 1 3 5 7'],
  [63, 'a001,003.moho', 'ac001', 'A', 'a: 1 3', 'a: 1 3'],
  [64, 'ac 001,003.moho', 'ac001', 'A', 'ac: 1 3', 'ac: 1 3'],
  [65, 'ac 001,003.moho', 'a001', 'A', 'ac: 1 3', 'null'],
  [66, 'sc 001,003.moho', 'sc001', 'A', 'sc: 1 3', 'sc: 1 3'],
  [67, 'a 001,003.moho', 'sc001', 'A', 'a: 1 3', 'null'],
  [68, 'a 001,003.moho', 'b001', 'A', 'a: 1 3', 'null'],
  [69, 'b 001,003.moho', 'b001', 'A', 'b: 1 3', 'b: 1 3'],
  [70, '001,003.moho', '001', 'A', '∅: 1 3', '∅: 1 3'],
  [71, 'a 001,003.moho', '001', 'A', 'a: 1 3', 'a: 1 3'],
  [72, 'A 001,003.MOHO', 'A001', 'a', 'a: 1 3', 'a: 1 3'],
  [73, 'D001,003.moho', 'd001', 'D', 'd: 1 3', 'd: 1 3'],
  [74, 'a001,003.moho', 'v2a001', 'A', 'a: 1 3', 'null'],
  [75, 'a001,003.moho', 'b018_act', 'B', 'a: 1 3', 'null'],
  [76, 'a001~005.moho', 'a003', 'A', 'a: 1 2* 3* 4* 5', 'a: 1 2* 3* 4* 5'],
  [77, 'a001~005.moho', 'a001', 'A', 'a: 1 2* 3* 4* 5', 'a: 1 2* 3* 4* 5'],
  [78, 'a001 ~ 005.moho', 'a002', 'A', 'a: 1 2* 3* 4* 5', 'a: 1 2* 3* 4* 5'],
  [79, 'a001~a005.moho', 'a002', 'A', 'a: 1 2* 3* 4* 5', 'a: 1 2* 3* 4* 5'],
  [80, 'a001' + String.fromCharCode(0x301C) + '003.moho', 'a002', 'A', 'a: 1 2* 3', 'a: 1 2* 3'],
  [81, 'a001~003,007.moho', 'a007', 'A', 'a: 1 2* 3 7', 'a: 1 2* 3 7'],
  [82, 'a 001, 003~005, 009.moho', 'a004', 'A', 'a: 1 3 4* 5 9', 'a: 1 3 4* 5 9'],
  [83, 'a003,002~004.moho', 'a003', 'A', 'a: 3 2 4', 'a: 3 2 4'],
  [84, 'a001~002.moho', 'a002', 'A', 'a: 1 2', 'a: 1 2'],
  [85, 'a001~050.moho', 'a001', 'A', RANGE_50, RANGE_50],
  [86, 'a001~060.moho', 'a001', 'A', 'a: 1', 'a: 1'],
  [87, 'a005~001.moho', 'a005', 'A', 'a: 5', 'a: 5'],
  [88, 'a001~001.moho', 'a001', 'A', 'a: 1', 'a: 1'],
  [89, 'a001A~005.moho', 'a001A', 'A', 'a: 1A', 'a: 1A'],
  [90, 'a001~005A.moho', 'a001', 'A', 'a: 1', 'a: 1'],
  [91, 'a001~003~005.moho', 'a001', 'A', 'a: 1 2* 3', 'a: 1 2* 3'],
  [92, 'a0001~0003.moho', 'a002', 'A', 'a: 1 2* 3', 'a: 1 2* 3'],
  [93, '24_10_12 a012,013.moho', 'a012', 'A', '∅: 24 10 12 ; a: 12 13', 'a: 12 13'],
  [94, '10_12 수정.moho', 'a012', 'A', '∅: 10 12', 'null'],
  [95, '5화_a 005,007.moho', 'a005', 'A', '∅: 5 ; a: 5 7', 'a: 5 7'],
  [96, '05 a 001,005.moho', 'a005', 'A', '∅: 5 ; a: 1 5', 'a: 1 5'],
  [97, '005_006 a 005,007.moho', 'a005', 'A', '∅: 5 6 ; a: 5 7', 'a: 5 7'],
  [98, '2화 002,005.moho', 'a002', 'A', '∅: 2 ; ∅: 2 5', '∅: 2 5'],
  [99, 'e2_e002,005.moho', 'e002', 'E', 'e: 2 ; e: 2 5', 'e: 2 5'],
  [100, '1,3,5.moho', 'a001', 'A', '∅: 1 3 5', 'null'],
  [101, '1,3,5.moho', 'a1', 'A', '∅: 1 3 5', '∅: 1 3 5'],
  [102, 'a001-2.moho', 'a002', 'A', 'a: 1 ; ∅: 2', 'null'],
  [103, 'b-002,005.moho', 'a002', 'A', 'b: 2 5', 'null'],
  [104, 'a-001,003.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [105, 'bg-001,003.moho', 'a001', 'A', 'bg: 1 3', 'null'],
  [106, 'A파트 001,003.moho', 'b001', 'B', '∅: 1 3', '∅: 1 3'],
  [107, 'b.001,003.moho', 'a001', 'A', '∅: 1 3', '∅: 1 3'],
  [108, 'a 8,9,10,11.moho', 'a008', 'A', 'a: 8 9 ; ∅: 10 11', 'a: 8 9'],
  [109, 'a 8,9,10,11.moho', 'a010', 'A', 'a: 8 9 ; ∅: 10 11', 'a: 8 9'],
  [110, 'a001,3,5,7.moho', 'a003', 'A', 'a: 1 ; ∅: 3 5 7', 'null'],
  [111, 'a001,003test.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [112, 'a001__003.moho', 'a001', 'A', 'a: 1 ; ∅: 3', 'a: 1'],
  [113, 'a001.003.moho', 'a001', 'A', 'a: 1 ; ∅: 3', 'a: 1'],
  [114, 'a' + '  ' + '001,003.moho', 'a001', 'A', 'a: 1 3', 'a: 1 3'],
  [115, 'a001~5.moho', 'a001', 'A', 'a: 1', 'a: 1'],
  [116, 'a001~005,003.moho', 'a003', 'A', 'a: 1 2* 3 4* 5', 'a: 1 2* 3 4* 5'],
  [117, 'a001~005retake.moho', 'a003', 'A', 'a: 1', 'null'],
  [118, 'a001~b005.moho', 'a001', 'A', 'a: 1', 'a: 1'],
  [119, 'a001~051.moho', 'a001', 'A', 'a: 1', 'a: 1'],
  [120, 'a001~001,003.moho', 'a003', 'A', 'a: 1', 'null'],
  [121, 'a001' + String.fromCharCode(0x223C) + '003.moho', 'a002', 'A', 'a: 1 2* 3', 'a: 1 2* 3'],
  [122, 'a001~003,005~007.moho', 'a006', 'A', 'a: 1 2* 3 5 6* 7', 'a: 1 2* 3 5 6* 7'],
  [123, 'a001~003~005,007.moho', 'a007', 'A', 'a: 1 2* 3', 'a: 1 2* 3'],
  [124, 'a001~005A,007.moho', 'a007', 'A', 'a: 1', 'null'],
  [125, '0325~0326 a001,003.moho', 'a001', 'A', '∅: 325 326 ; a: 1 3', 'a: 1 3'],
  [126, '005_006 a 005,007.moho', 'a006', 'A', '∅: 5 6 ; a: 5 7', 'a: 5 7'],
  [127, 'a001,003-005,007.moho', 'a001', 'A', 'a: 1 3 ; ∅: 5 7', 'a: 1 3'],
  [128, 'a001,003-005,007.moho', 'a005', 'A', 'a: 1 3 ; ∅: 5 7', 'a: 1 3'],
  [129, 'b001,003-005,007.moho', 'a005', 'A', 'b: 1 3 ; ∅: 5 7', 'null'],
  [130, 'b001-003,005.moho', 'a003', 'A', 'b: 1 ; ∅: 3 5', '∅: 3 5'],
  [131, 'E05_001,003.moho', 'e001', 'E', 'e: 5 ; ∅: 1 3', '∅: 1 3'],
  [132, 'a001,003 수정 a001,005.moho', 'a001', 'A', 'a: 1 3 ; a: 1 5', 'a: 1 3'],
  [133, 'a001;003.moho', 'a001', 'A', 'a: 1 ; ∅: 3', 'a: 1'],
  [134, 'a001' + String.fromCharCode(0x3001) + '003.moho', 'a001', 'A', 'a: 1 ; ∅: 3', 'a: 1'],
  [135, '001~a005.moho', 'a001', 'A', '∅: 1', '∅: 1'],
  [136, '001,003.moho', 'a1', 'A', '∅: 1 3', '∅: 1 3'],
  [137, '01,03.moho', 'a1', 'A', '∅: 1 3', 'null'],
  [138, 'a003_001.moho', 'a003', 'A', 'a: 3 1', 'a: 3 1'],
  [139, 'a001_010~020.moho', 'a001', 'A', 'a: 1 10 11* 12* 13* 14* 15* 16* 17* 18* 19* 20', 'a: 1 10 11* 12* 13* 14* 15* 16* 17* 18* 19* 20'],
  [140, 'A_BG_001,003.moho', 'a001', 'A', 'bg: 1 3', 'null'],
  [141, 'EP05_A_ACT_001,003.moho', 'a001', 'A', 'ep: 5 ; act: 1 3', 'null'],
  [142, 'sc 001,003.moho', 'a001', 'A', 'sc: 1 3', 'null'],
  [143, 'ac001,003.moho', 'a001', 'A', 'ac: 1 3', 'null'],
  [144, 'ep005_001,003.moho', 'a001', 'A', 'ep: 5 1 3', 'null'],
];

// 설계 15.1 "P1을 끄면" 표의 열아홉 줄: 번호 → [읽힌 목록 전부, 이 씬의 목록].
const P1_OFF: Record<number, [string, string]> = {
  10: ['a: 1', 'null'],
  76: ['a: 1', 'null'],
  77: ['a: 1', 'a: 1'],
  78: ['a: 1', 'null'],
  79: ['a: 1', 'null'],
  80: ['a: 1', 'null'],
  81: ['a: 1', 'null'],
  82: ['a: 1 3', 'a: 1 3'],
  83: ['a: 3 2', 'a: 3 2'],
  84: ['a: 1', 'null'],
  85: ['a: 1', 'a: 1'],
  91: ['a: 1', 'a: 1'],
  92: ['a: 1', 'null'],
  116: ['a: 1', 'null'],
  121: ['a: 1', 'null'],
  122: ['a: 1', 'null'],
  123: ['a: 1', 'null'],
  125: ['∅: 325 ; a: 1 3', 'a: 1 3'],
  139: ['a: 1 10', 'a: 1 10'],
};

// 설계 15.1 "P4를 켜면" 표의 여덟 줄: 이 씬의 목록이 null이 된다(글자가 맞고 번호가 둘 이상인데 자기 번호가 없는 목록).
const P4_ON = [59, 60, 61, 62, 109, 123, 126, 128];

// 설계 3.7의 "다른 씬들의 목록인가" 표 스무 줄: [경로, sceneId, partId, 결과].
type OtherRow = [string, string, string, boolean];

const OTHERS: OtherRow[] = [
  ['b 001,003.moho', 'a001', 'A', true],
  ['a 001,003.moho', 'a005', 'A', false],
  ['a001~005.moho', 'a007', 'A', false],
  ['a001,003.moho', 'v2a001', 'A', true],
  ['take 001,002.moho', 'a001', 'A', true],
  ['a 001,003.moho', 'a001', 'A', false],
  ['a001,003 b002,004.moho', 'a001', 'A', false],
  ['b030.moho', 'a001', 'A', false],
  ['a012.moho', 'a005', 'A', false],
  ['main_v01_02.psd', 'a001', 'A', false],
  ['001,003.moho', 'a005', 'A', false],
  ['[드라마 퀄리티] 한솔 SWver12.moho', 'a012', 'A', false],
  ['main.psd', 'a014', 'A', false],
  ['005_006 a 005,007.moho', 'a006', 'A', false],
  ['a001,003-005,007.moho', 'a005', 'A', false],
  ['b001,003-005,007.moho', 'a005', 'A', true],
  ['A_BG_001,003.moho', 'a001', 'A', true],
  ['sc 001,003.moho', 'a001', 'A', true],
  ['b001-003,005.moho', 'a003', 'A', false],
  ['a001-005.moho', 'a005', 'A', false],
];

const row = (number: number): Row => ROWS[number - 1];

const show = (list: SceneNameList): string => (
  (list.prefix || '∅') + ': ' + list.refs.map((ref) => refKey(ref) + (ref.ranged ? '*' : '')).join(' ')
);
const showAll = (lists: SceneNameList[]): string => (lists.length > 0 ? lists.map(show).join(' ; ') : '(없음)');
const showOne = (list: SceneNameList | null): string => (list ? show(list) : 'null');
const directNumbers = (list: SceneNameList): number[] => list.refs.filter((ref) => !ref.ranged).map((ref) => ref.number);

// 그 줄의 씬 번호에서 글자와 숫자 자릿수를 따 만든 씬 서른 개(a001 → a001~a030, a1 → a1~a30, 001 → 001~030. 접미는 뗀다).
const thirtyScenes = (sceneId: string): string[] => {
  const match = /^([a-z]*)(\d+)/i.exec(sceneId);
  assert.ok(match, sceneId);
  return Array.from({ length: 30 }, (_, i) => match[1] + String(i + 1).padStart(match[2].length, '0'));
};

// 서른 씬에서 돌려 나온 번호 둘 이상의 결과를 '글자: 열쇠들'(범위 표시 없이)로 모은다.
const listsAcrossScenes = (path: string, sceneId: string, partId: string, rules?: SceneNameRules): string[] => {
  const found = new Set<string>();
  for (const id of thirtyScenes(sceneId)) {
    const list = sceneListForScene(path, { sceneId: id, partId }, rules);
    if (list && list.refs.length > 1) found.add((list.prefix || '∅') + ': ' + list.refs.map((ref) => refKey(ref)).join(' '));
  }
  return [...found].sort();
};

// 빈 경로(#40)와 씬 번호를 가를 수 없는 줄(#74·#75)은 서른 씬을 만들 수 없다.
const SAME_LIST_SKIP = [40, 74, 75];

test('자료: 144줄이고 번호가 1부터 144까지 차례다', () => {
  assert.equal(ROWS.length, 144);
  ROWS.forEach((entry, index) => assert.equal(entry[0], index + 1, `#${index + 1}`));
});

test('자료: 코드 값으로 쓴 다섯 줄의 경로는 보통 글자가 아니다', () => {
  assert.doesNotMatch(row(34)[1].split('.moho')[0], /[A0-9,]/, '#34');
  assert.equal(row(80)[1].includes('~'), false, '#80');
  assert.equal(row(121)[1].includes('~'), false, '#121');
  assert.equal(row(114)[1].includes('  '), true, '#114');
  assert.equal(row(134)[1].includes(','), false, '#134');
});

test('readSceneNameLists: 설계 3.7의 144줄 — 읽힌 목록 전부', () => {
  for (const [number, path, , , all] of ROWS) {
    assert.equal(showAll(readSceneNameLists(path)), all, `#${number}`);
  }
});

test('readSceneNameLists: #85 — 50개로 펼쳐지고 양 끝만 직접 적힌 번호다', () => {
  const [list] = readSceneNameLists('a001~050.moho');
  assert.equal(list.refs.length, 50);
  assert.deepEqual(directNumbers(list), [1, 50]);
});

test('readSceneNameLists: P1을 끄면(tildeRange: false) 15.1의 열아홉 줄만 달라진다', () => {
  assert.equal(Object.keys(P1_OFF).length, 19);
  const rules = { ...SCENE_NAME_RULES, tildeRange: false };
  for (const [number, path, , , all] of ROWS) {
    assert.equal(showAll(readSceneNameLists(path, rules)), P1_OFF[number]?.[0] ?? all, `#${number}`);
  }
});

test('readSceneNameLists: 넘긴 손잡이를 듣는다 — maxRangeCount, maxDigits', () => {
  const [list] = readSceneNameLists(row(86)[1], { ...SCENE_NAME_RULES, maxRangeCount: 60 });
  assert.equal(list.refs.length, 60, '#86');
  assert.deepEqual(directNumbers(list), [1, 60], '#86');
  assert.equal(showAll(readSceneNameLists(row(50)[1], { ...SCENE_NAME_RULES, maxDigits: 5 })), 'a: 1 3', '#50');
});

test('readSceneNameLists: width는 맨 앞 숫자의 자릿수다', () => {
  assert.equal(readSceneNameLists('a 001,003.moho')[0].width, 3);
  assert.equal(readSceneNameLists('a1,3,5.moho')[0].width, 1);
  assert.equal(readSceneNameLists('a0001~0003.moho')[0].width, 4);
});

// 보탬 자료(설계 3.7의 표 밖): 3.3이 글로 정한 규칙 다섯을 그럴듯한 틀린 구현과 가른다. ROWS에는 넣지 않는다 — ROWS의 출처는 3.7의 표뿐이다.
test('readSceneNameLists: 3.3의 규칙 다섯 — 틈은 하나, 중복은 번호와 접미 둘 다, 괄호는 구분자가 아니다, 범위와 항목의 글자는 머리의 글자와 같다', () => {
  const read = (name: string): string => showAll(readSceneNameLists(name));
  // 틈: 빈칸·밑줄·하이픈이 하나일 때만 그 글자가 번호의 글자다.
  assert.equal(read('a__001,003.moho'), '∅: 1 3');
  assert.equal(read('a - 001,003.moho'), '∅: 1 3');
  // 중복: 번호와 접미가 모두 같아야 같은 항목이다.
  assert.equal(read('a001,001A,003.moho'), 'a: 1 1A 3');
  // 구분자가 아닌 것: 괄호(3.5의 예).
  assert.equal(read('a001,003 (005,007 제외).moho'), 'a: 1 3 ; ∅: 5 7');
  // 범위: 오른쪽의 글자는 바로 앞 번호의 글자가 아니라 머리의 글자와 견준다.
  assert.equal(read('a001,003~a005.moho'), 'a: 1 3 4* 5');
  // 항목의 글자: 첫 글자만이 아니라 글자 전체가 머리와 같아야 한다.
  assert.equal(read('a001,ac003.moho'), 'a: 1 ; ac: 3');
});

test('sceneListForScene: 설계 3.7의 144줄 — 이 씬의 목록', () => {
  for (const [number, path, sceneId, partId, , own] of ROWS) {
    assert.equal(showOne(sceneListForScene(path, { sceneId, partId })), own, `#${number}`);
  }
});

test('sceneListForScene: #85 — 50개이고 양 끝만 직접 적힌 번호다', () => {
  const [, path, sceneId, partId] = row(85);
  const list = sceneListForScene(path, { sceneId, partId });
  assert.ok(list, '#85');
  assert.equal(list.refs.length, 50);
  assert.deepEqual(directNumbers(list), [1, 50]);
});

test('sceneListForScene: P1을 끄면(tildeRange: false) 15.1의 열아홉 줄만 달라진다', () => {
  const rules = { ...SCENE_NAME_RULES, tildeRange: false };
  for (const [number, path, sceneId, partId, , own] of ROWS) {
    assert.equal(showOne(sceneListForScene(path, { sceneId, partId }, rules)), P1_OFF[number]?.[1] ?? own, `#${number}`);
  }
});

test('sceneListForScene: P4를 켜면(requireOwnNumber: true) 15.1의 여덟 줄만 null이 된다', () => {
  assert.equal(P4_ON.length, 8);
  // 끈 값(정해진 값)에서 그 여덟 줄이 읽히는 목록 — 15.1의 표 아래 줄.
  assert.deepEqual(
    P4_ON.map((number) => row(number)[5]),
    ['a: 1A 3', 'a: 1 3', 'a: 1 3', 'a: 1 3 5 7', 'a: 8 9', 'a: 1 2* 3', 'a: 5 7', 'a: 1 3'],
  );
  const rules = { ...SCENE_NAME_RULES, requireOwnNumber: true };
  for (const [number, path, sceneId, partId, , own] of ROWS) {
    assert.equal(
      showOne(sceneListForScene(path, { sceneId, partId }, rules)),
      P4_ON.includes(number) ? 'null' : own,
      `#${number}`,
    );
  }
});

test('sceneListForScene: 번호가 하나뿐인 이름과 글자 없는 목록은 정해진 값에서도 자기 번호가 있어야 한다', () => {
  assert.equal(sceneListForScene('a012.moho', { sceneId: 'a005', partId: 'A' }), null);
  assert.equal(sceneListForScene('b030-피드백.moho', { sceneId: 'b031', partId: 'B' }), null);
  assert.equal(sceneListForScene('ep2-b030-retake.moho', { sceneId: 'b012', partId: 'B' }), null);
  assert.equal(sceneListForScene('001,003,005.moho', { sceneId: 'a007', partId: 'A' }), null);
});

test('sceneListForScene: 넘긴 손잡이를 듣는다 — minSceneDigits, maxRangeCount, maxDigits', () => {
  const own = (number: number, rules: SceneNameRules): SceneNameList | null => {
    const [, path, sceneId, partId] = row(number);
    return sceneListForScene(path, { sceneId, partId }, rules);
  };
  assert.equal(showOne(own(94, { ...SCENE_NAME_RULES, minSceneDigits: 2 })), '∅: 10 12', '#94');
  // 보탬 자료(설계 11.1의 값 밖): 글자 붙은 씬 목록이 따로 있는지(3.4의 5-2)를 볼 때도 넘긴 minSceneDigits를 듣는다 — 두 자리 'e: 5'가 씬 목록이 되어 글자 없는 조각을 읽지 않는다(정해진 값에서는 '∅: 1 3').
  assert.equal(showOne(own(131, { ...SCENE_NAME_RULES, minSceneDigits: 2 })), 'null', '#131');
  const ranged = own(86, { ...SCENE_NAME_RULES, maxRangeCount: 60 });
  assert.ok(ranged, '#86');
  assert.equal(ranged.refs.length, 60, '#86');
  assert.deepEqual(directNumbers(ranged), [1, 60], '#86');
  assert.equal(showOne(own(50, { ...SCENE_NAME_RULES, maxDigits: 5 })), 'a: 1 3', '#50');
});

test('sceneListForScene: 같은 파일은 어느 씬에서 연결해도 같은 목록이다 — 정해진 값에서는 예외가 없다', () => {
  for (const [number, path, sceneId, partId] of ROWS) {
    if (SAME_LIST_SKIP.includes(number)) continue;
    const found = listsAcrossScenes(path, sceneId, partId);
    assert.ok(found.length <= 1, `#${number}: ${found.join(' / ')}`);
  }
  const [, path, sceneId, partId] = row(132);
  assert.deepEqual(listsAcrossScenes(path, sceneId, partId), ['a: 1 3'], '#132');
});

test('sceneListForScene: P4를 켜면 같은 가족의 목록을 둘 적은 #132의 이름에서만 둘로 갈린다', () => {
  const rules = { ...SCENE_NAME_RULES, requireOwnNumber: true };
  for (const [number, path, sceneId, partId] of ROWS) {
    if (SAME_LIST_SKIP.includes(number) || number === 132) continue;
    const found = listsAcrossScenes(path, sceneId, partId, rules);
    assert.ok(found.length <= 1, `#${number}: ${found.join(' / ')}`);
  }
  const [, path, sceneId, partId] = row(132);
  assert.deepEqual(listsAcrossScenes(path, sceneId, partId, rules), ['a: 1 3', 'a: 1 5'], '#132');
});

// 보탬 자료(설계 3.7의 표 밖): 3.4가 글로 정한 규칙 넷을 그럴듯한 틀린 구현과 가른다. ROWS에는 넣지 않는다 — ROWS의 출처는 3.7의 표뿐이다.
test('sceneListForScene: 3.4의 규칙 넷 — 관문은 가족 전체이거나 첫 글자 하나, 글자 없는 맞는 목록도 번호가 여럿인 것 먼저·왼쪽 것, 번호가 하나뿐인 목록끼리도 왼쪽 것, 번호가 여럿인 목록끼리는 번호가 더 많은 것이 아니라 왼쪽 것', () => {
  const own = (name: string, sceneId: string): string => showOne(sceneListForScene(name, { sceneId, partId: 'A' }));
  // 관문(3.4의 4): 글자가 가족과 같거나 가족의 첫 글자다. 가족의 앞부분('abc'의 'ab')은 지나지 못한다.
  assert.equal(own('a 001,003.moho', 'abc001'), 'a: 1 3');
  assert.equal(own('ab 001,003.moho', 'abc001'), 'null');
  // 글자 없는 맞는 목록(3.4의 5-3): 번호가 둘 이상인 것 먼저, 그래도 여럿이면 왼쪽 것.
  assert.equal(own('002 수정 002,005.moho', 'a002'), '∅: 2 5');
  assert.equal(own('001,003 수정 001,005.moho', 'a001'), '∅: 1 3');
  // 번호가 하나뿐인 맞는 목록끼리(3.4의 5-1): 왼쪽 것.
  assert.equal(own('a001 ac001.moho', 'ac001'), 'a: 1');
  // 번호가 둘 이상인 맞는 목록끼리(3.4의 5-1): 번호가 더 많은 것이 아니라 왼쪽 것. #132의 두 목록은 길이가 같아 이 둘을 가르지 못한다.
  assert.equal(own('a001,003 수정 a001,005,007.moho', 'a001'), 'a: 1 3');
});

test('자료: "다른 씬들의 목록인가" 표는 스무 줄이고 참이 여섯이다', () => {
  assert.equal(OTHERS.length, 20);
  assert.equal(OTHERS.filter(([, , , expected]) => expected).length, 6);
});

test('namesOtherScenes: 설계 3.7의 "다른 씬들의 목록인가" 표 스무 줄', () => {
  for (const [path, sceneId, partId, expected] of OTHERS) {
    assert.equal(namesOtherScenes(path, { sceneId, partId }), expected, `'${path}' (${sceneId} / ${partId})`);
  }
});

test('namesOtherScenes: 넘긴 손잡이를 듣는다 — requireOwnNumber, tildeRange, minSceneDigits', () => {
  const ownNumber = { ...SCENE_NAME_RULES, requireOwnNumber: true };
  assert.equal(namesOtherScenes('a 001,003.moho', { sceneId: 'a005', partId: 'A' }, ownNumber), true);
  assert.equal(namesOtherScenes('a001~005.moho', { sceneId: 'a007', partId: 'A' }, ownNumber), true);
  assert.equal(namesOtherScenes('005_006 a 005,007.moho', { sceneId: 'a006', partId: 'A' }, ownNumber), true);
  assert.equal(namesOtherScenes('a001,003-005,007.moho', { sceneId: 'a005', partId: 'A' }, ownNumber), true);
  assert.equal(namesOtherScenes('b 001,003.moho', { sceneId: 'a001', partId: 'A' }, ownNumber), true);
  assert.equal(namesOtherScenes('b001,003-005,007.moho', { sceneId: 'a005', partId: 'A' }, ownNumber), true);
  const noTilde = { ...SCENE_NAME_RULES, tildeRange: false };
  assert.equal(namesOtherScenes('a001~005.moho', { sceneId: 'a007', partId: 'A' }, noTilde), false);
  // 보탬 자료(설계 11.1의 값 밖): 씬 번호처럼 쓴 숫자인지 볼 때도 넘긴 minSceneDigits를 듣는다 — 정해진 값에서는 거짓이다(3.7의 표: 두 자리).
  const twoDigits = { ...SCENE_NAME_RULES, minSceneDigits: 2 };
  assert.equal(namesOtherScenes('main_v01_02.psd', { sceneId: 'a001', partId: 'A' }, twoDigits), true);
});

test('workFileName: 경로의 마지막 조각, 폴더 경로와 빈 경로는 빈 글자', () => {
  assert.equal(workFileName('G:\\show\\EP2\\B030.moho'), 'B030.moho');
  assert.equal(workFileName('G:/a/b/c.psd'), 'c.psd');
  assert.equal(workFileName('  G:\\x\\y.moho  '), 'y.moho');
  assert.equal(workFileName('G:\\x\\folder\\'), '');
  assert.equal(workFileName('G:/x/folder/'), '');
  assert.equal(workFileName(''), '');
  assert.equal(workFileName('   '), '');
});

test('splitSceneId: 씬 번호를 글자·숫자·접미사로 가른다', () => {
  assert.deepEqual(splitSceneId('a001'), { letters: 'a', number: 1, suffix: '' });
  assert.deepEqual(splitSceneId('A001'), { letters: 'a', number: 1, suffix: '' });
  assert.equal(splitSceneId('001')?.letters, '');
  assert.equal(splitSceneId('ac001')?.letters, 'ac');
  assert.deepEqual(splitSceneId('sc012'), { letters: 'sc', number: 12, suffix: '' });
  assert.equal(splitSceneId('a001A')?.suffix, 'A');
  assert.equal(splitSceneId('a001abc')?.suffix, 'ABC');
  assert.deepEqual(splitSceneId(' a7 '), { letters: 'a', number: 7, suffix: '' });
  for (const sceneId of ['a001abcd', 'v2a001', 'bg3-001', 'b018_act', '', null]) {
    assert.equal(splitSceneId(sceneId), null, String(sceneId));
  }
});

test('sceneFamily: 씬 번호 자신의 글자, 없으면 파트의 첫 글자', () => {
  assert.equal(sceneFamily('a001', 'A'), 'a');
  assert.equal(sceneFamily('ac001', 'A'), 'ac');
  assert.equal(sceneFamily('sc012', 'A'), 'sc');
  assert.equal(sceneFamily('001', 'A'), 'a');
  assert.equal(sceneFamily('001', ' A '), 'a');
  assert.equal(sceneFamily('001', ''), '');
  assert.equal(sceneFamily('v2a001', 'A'), null);
  // 보탬 자료(설계 11.1의 일곱 밖): 파트 글자는 첫 글자 하나만 쓰고, 파트가 없으면(null) 빈 글자다(3.4의 2).
  assert.equal(sceneFamily('001', 'AB'), 'a');
  assert.equal(sceneFamily('001', null), '');
});

test('sceneRefKey: 설계 3.4 끝의 표 — 씬 번호 열하나 × 가족 넷', () => {
  const families = ['a', 'ac', 'sc', ''];
  const table: Array<[string, Array<string | null>]> = [
    ['a003', ['3', '3', null, null]],
    ['A003', ['3', '3', null, null]],
    ['ac003', ['3', '3', null, null]],
    ['003', ['3', '3', '3', '3']],
    ['3', ['3', '3', '3', '3']],
    ['sc003', [null, null, '3', null]],
    ['b003', [null, null, null, null]],
    ['a003A', ['3A', '3A', null, null]],
    ['a003a', ['3A', '3A', null, null]],
    ['v2a001', [null, null, null, null]],
    ['b018_act', [null, null, null, null]],
  ];
  assert.equal(table.length, 11);
  for (const [sceneId, expected] of table) {
    families.forEach((family, index) => {
      assert.equal(sceneRefKey(sceneId, family), expected[index], `sceneRefKey('${sceneId}', '${family}')`);
    });
  }
});

test('SCENE_NAME_RULES: 정해진 값', () => {
  assert.deepEqual(SCENE_NAME_RULES, {
    tildeRange: true,
    maxRangeCount: 50,
    maxDigits: 4,
    minSceneDigits: 3,
    requireOwnNumber: false,
  });
});
