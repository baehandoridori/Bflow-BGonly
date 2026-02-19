/**
 * BG 진행 현황판 — Google Apps Script 웹 앱
 *
 * ========== 설정 방법 ==========
 *
 * 1. 대상 Google 스프레드시트를 열기
 * 2. 메뉴: 확장 프로그램 → Apps Script
 * 3. 열린 에디터에서 기존 코드를 지우고 이 파일의 내용 전체를 붙여넣기
 * 4. 저장 (Ctrl+S)
 * 5. 배포 → 새 배포
 *    - 유형 선택: "웹 앱"
 *    - 실행 주체: "본인 (나)"
 *    - 액세스 권한: "모든 사용자"
 * 6. "배포" 클릭 → 권한 승인 → 배포 URL 복사
 * 7. 복사한 URL을 Electron 앱 설정 화면에 붙여넣기
 *
 * ========== 주의 ==========
 *
 * - 코드를 수정한 후에는 반드시 "새 배포"를 다시 해야 반영됩니다
 *   (기존 배포 URL은 이전 코드를 계속 실행합니다)
 * - 시트 탭 이름은 EP01_A, EP01_B, EP02_A 형식이어야 합니다
 * - 열 구조: A(No) B(씬번호) C(메모) D(스토리보드URL) E(가이드URL)
 *            F(담당자) G(LO) H(완료) I(검수) J(PNG)
 */

var EP_PATTERN = /^EP(\d+)_([A-Z])$/;

// 단계별 열 번호 (1-indexed: G=7, H=8, I=9, J=10)
var STAGE_COLUMNS = { lo: 7, done: 8, review: 9, png: 10 };

// ─── 요청 핸들러 ─────────────────────────────────────────────

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'readAll';

  try {
    switch (action) {
      case 'ping':
        return jsonResponse({ ok: true });

      case 'readAll':
        return jsonResponse({ ok: true, data: readAllEpisodes() });

      case 'updateCell':
        updateSceneStage(
          e.parameter.sheetName,
          parseInt(e.parameter.rowIndex, 10),
          e.parameter.stage,
          e.parameter.value === 'true'
        );
        return jsonResponse({ ok: true });

      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    switch (action) {
      case 'updateCell':
        updateSceneStage(body.sheetName, body.rowIndex, body.stage, body.value);
        return jsonResponse({ ok: true });

      default:
        return jsonResponse({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

// ─── JSON 응답 헬퍼 ──────────────────────────────────────────

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── 시트 탭 감지 ────────────────────────────────────────────

function getEpisodeTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var tabs = [];

  for (var i = 0; i < sheets.length; i++) {
    var title = sheets[i].getName();
    var match = title.match(EP_PATTERN);
    if (match) {
      tabs.push({
        title: title,
        episodeNumber: parseInt(match[1], 10),
        partId: match[2]
      });
    }
  }

  tabs.sort(function(a, b) {
    return a.episodeNumber !== b.episodeNumber
      ? a.episodeNumber - b.episodeNumber
      : a.partId.localeCompare(b.partId);
  });

  return tabs;
}

// ─── 시트 데이터 읽기 ────────────────────────────────────────

function parseBoolean(val) {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    var v = val.trim().toUpperCase();
    return v === 'TRUE' || v === '1' || v === 'O' || v === '\u25CB';
  }
  return false;
}

function readSheetData(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  var scenes = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[0]) continue;

    scenes.push({
      no: parseInt(row[0], 10) || (i + 1),
      sceneId: String(row[1] || ''),
      memo: String(row[2] || ''),
      storyboardUrl: String(row[3] || ''),
      guideUrl: String(row[4] || ''),
      assignee: String(row[5] || ''),
      lo: parseBoolean(row[6]),
      done: parseBoolean(row[7]),
      review: parseBoolean(row[8]),
      png: parseBoolean(row[9])
    });
  }

  return scenes;
}

// ─── 전체 에피소드 데이터 읽기 ───────────────────────────────

function readAllEpisodes() {
  var tabs = getEpisodeTabs();
  var epMap = {};

  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];

    if (!epMap[tab.episodeNumber]) {
      epMap[tab.episodeNumber] = {
        episodeNumber: tab.episodeNumber,
        title: 'EP.' + String(tab.episodeNumber).padStart(2, '0'),
        parts: []
      };
    }

    var scenes = readSheetData(tab.title);
    epMap[tab.episodeNumber].parts.push({
      partId: tab.partId,
      sheetName: tab.title,
      scenes: scenes
    });
  }

  var episodes = [];
  var keys = Object.keys(epMap).sort(function(a, b) { return Number(a) - Number(b); });
  for (var j = 0; j < keys.length; j++) {
    episodes.push(epMap[keys[j]]);
  }

  return episodes;
}

// ─── 셀 업데이트 (체크박스 토글) ─────────────────────────────

function updateSceneStage(sheetName, rowIndex, stage, value) {
  var column = STAGE_COLUMNS[stage];
  if (!column) throw new Error('Invalid stage: ' + stage);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  // rowIndex: 0-based 씬 인덱스 → +2 (헤더 1행 + 1-based)
  sheet.getRange(rowIndex + 2, column).setValue(value);
}
