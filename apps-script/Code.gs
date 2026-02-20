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
 *            F(담당자) G(LO) H(완료) I(검수) J(PNG) K(레이아웃)
 */

var EP_PATTERN = /^EP(\d+)_([A-Z])$/;

// 헤더 행 (새 탭 생성 시 자동 삽입)
var HEADERS = ['No', '씬번호', '메모', '스토리보드URL', '가이드URL', '담당자', 'LO', '완료', '검수', 'PNG', '레이아웃'];

// 단계별 열 번호 (1-indexed: G=7, H=8, I=9, J=10)
var STAGE_COLUMNS = { lo: 7, done: 8, review: 9, png: 10 };

// 씬 편집 가능한 필드 → 열 번호
var FIELD_COLUMNS = {
  no: 1, sceneId: 2, memo: 3, storyboardUrl: 4,
  guideUrl: 5, assignee: 6, lo: 7, done: 8, review: 9, png: 10, layoutId: 11
};

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

      case 'addEpisode':
        var result = addEpisode(parseInt(e.parameter.episodeNumber, 10));
        return jsonResponse({ ok: true, data: result });

      case 'addPart':
        var result2 = addPart(
          parseInt(e.parameter.episodeNumber, 10),
          e.parameter.partId
        );
        return jsonResponse({ ok: true, data: result2 });

      case 'addScene':
        addScene(
          e.parameter.sheetName,
          e.parameter.sceneId || '',
          e.parameter.assignee || '',
          e.parameter.memo || ''
        );
        return jsonResponse({ ok: true });

      case 'deleteScene':
        deleteScene(
          e.parameter.sheetName,
          parseInt(e.parameter.rowIndex, 10)
        );
        return jsonResponse({ ok: true });

      case 'updateSceneField':
        updateSceneField(
          e.parameter.sheetName,
          parseInt(e.parameter.rowIndex, 10),
          e.parameter.field,
          e.parameter.value
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

      case 'uploadImage':
        var url = uploadImageToDrive(
          body.base64,
          body.sheetName,
          body.sceneId,
          body.imageType,
          body.mimeType || 'image/jpeg'
        );
        return jsonResponse({ ok: true, url: url });

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

  var data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();
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
      png: parseBoolean(row[9]),
      layoutId: String(row[10] || '')
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

// ─── 헤더가 있는 새 시트 탭 생성 ─────────────────────────────

function createSheetTab(tabName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 이미 존재하면 에러
  if (ss.getSheetByName(tabName)) {
    throw new Error('이미 존재하는 탭: ' + tabName);
  }

  var sheet = ss.insertSheet(tabName);

  // 헤더 행 설정
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);

  // 헤더 스타일
  var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#E8EAF6');

  // 열 너비 조정
  sheet.setColumnWidth(1, 40);   // No
  sheet.setColumnWidth(2, 80);   // 씬번호
  sheet.setColumnWidth(3, 150);  // 메모
  sheet.setColumnWidth(4, 120);  // 스토리보드URL
  sheet.setColumnWidth(5, 120);  // 가이드URL
  sheet.setColumnWidth(6, 80);   // 담당자
  sheet.setColumnWidth(7, 50);   // LO
  sheet.setColumnWidth(8, 50);   // 완료
  sheet.setColumnWidth(9, 50);   // 검수
  sheet.setColumnWidth(10, 50);  // PNG
  sheet.setColumnWidth(11, 80);  // 레이아웃

  return sheet;
}

// ─── 에피소드 추가 ───────────────────────────────────────────

function addEpisode(episodeNumber) {
  if (!episodeNumber || episodeNumber < 1) {
    throw new Error('유효하지 않은 에피소드 번호');
  }

  var tabName = 'EP' + String(episodeNumber).padStart(2, '0') + '_A';
  createSheetTab(tabName);

  return { sheetName: tabName, episodeNumber: episodeNumber, partId: 'A' };
}

// ─── 파트 추가 ───────────────────────────────────────────────

function addPart(episodeNumber, partId) {
  if (!episodeNumber || !partId) {
    throw new Error('에피소드 번호와 파트 ID 필요');
  }

  // partId 유효성 (A-Z)
  if (!/^[A-Z]$/.test(partId)) {
    throw new Error('파트 ID는 A-Z 대문자 1글자여야 합니다');
  }

  var tabName = 'EP' + String(episodeNumber).padStart(2, '0') + '_' + partId;
  createSheetTab(tabName);

  return { sheetName: tabName, episodeNumber: episodeNumber, partId: partId };
}

// ─── 씬 추가 ─────────────────────────────────────────────────

function addScene(sheetName, sceneId, assignee, memo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  // 다음 No 계산 (마지막 행의 No + 1)
  var lastRow = sheet.getLastRow();
  var nextNo = 1;
  if (lastRow >= 2) {
    var lastNo = sheet.getRange(lastRow, 1).getValue();
    nextNo = (parseInt(lastNo, 10) || lastRow - 1) + 1;
  }

  // 새 행 추가 (K열: 레이아웃 — 빈 값)
  var newRow = [nextNo, sceneId || '', memo || '', '', '', assignee || '', false, false, false, false, ''];
  sheet.appendRow(newRow);
}

// ─── 씬 삭제 ─────────────────────────────────────────────────

function deleteScene(sheetName, rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  // rowIndex: 0-based 씬 인덱스 → +2 (헤더 + 1-based)
  var sheetRow = rowIndex + 2;

  if (sheetRow < 2 || sheetRow > sheet.getLastRow()) {
    throw new Error('유효하지 않은 행 인덱스: ' + rowIndex);
  }

  sheet.deleteRow(sheetRow);
}

// ─── 씬 필드 업데이트 ────────────────────────────────────────

function updateSceneField(sheetName, rowIndex, field, value) {
  var column = FIELD_COLUMNS[field];
  if (!column) throw new Error('Invalid field: ' + field);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  var sheetRow = rowIndex + 2;

  // 불리언 필드는 boolean으로 변환
  var actualValue = value;
  if (field === 'lo' || field === 'done' || field === 'review' || field === 'png') {
    actualValue = (value === 'true' || value === true);
  } else if (field === 'no') {
    actualValue = parseInt(value, 10) || 0;
  }

  sheet.getRange(sheetRow, column).setValue(actualValue);
}

// ─── 이미지 Drive 업로드 ────────────────────────────────────

var IMAGE_FOLDER_NAME = 'Bflow-BGonly Images';

/**
 * base64 이미지 데이터를 Google Drive에 저장하고 공개 URL을 반환
 *
 * @param {string} base64Data  순수 base64 문자열 (data: prefix 없이)
 * @param {string} sheetName   시트 이름 (EP01_A 등)
 * @param {string} sceneId     씬 ID (a001 등)
 * @param {string} imageType   'storyboard' 또는 'guide'
 * @param {string} mimeType    'image/jpeg' 등
 * @return {string} 공개 접근 가능한 이미지 URL
 */
function uploadImageToDrive(base64Data, sheetName, sceneId, imageType, mimeType) {
  // 이미지 폴더 가져오기 (없으면 생성)
  var folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(IMAGE_FOLDER_NAME);

  // 파일명 생성
  var typeSuffix = imageType === 'storyboard' ? 'sb' : 'guide';
  var ext = mimeType === 'image/png' ? '.png' : '.jpg';
  var fileName = sheetName + '_' + (sceneId || 'unknown') + '_' + typeSuffix + ext;

  // base64 디코딩 → Blob
  var decoded = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decoded, mimeType, fileName);

  // 기존 동일 파일명 삭제 (덮어쓰기 시뮬레이션)
  var existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }

  // 파일 생성 & 공유 설정
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // 뷰어 URL 반환 (이미지 직접 표시 가능)
  return 'https://drive.google.com/uc?export=view&id=' + file.getId();
}
