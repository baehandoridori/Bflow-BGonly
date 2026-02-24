/**
 * B flow — Google Apps Script 웹 앱
 *
 * ========== 설정 방법 ==========
 *
 * 1. 대상 Google 스프레드시트를 열기
 * 2. 메뉴: 확장 프로그램 → Apps Script
 * 3. 열린 에디터에서 기존 코드를 지우고 이 파일의 내용 전체를 붙여넣기
 * 4. 저장 (Ctrl+S)
 *
 * ── appsscript.json 매니페스트 설정 (Drive 권한) ──
 * 5. 왼쪽 사이드바 ⚙ "프로젝트 설정" 클릭
 * 6. "에디터에서 'appsscript.json' 매니페스트 파일 표시" 체크
 * 7. 왼쪽 사이드바에서 appsscript.json 파일 열기
 * 8. 내용을 아래로 교체:
 *    {
 *      "timeZone": "Asia/Seoul",
 *      "dependencies": {},
 *      "webapp": { "access": "ANYONE_ANONYMOUS", "executeAs": "USER_DEPLOYING" },
 *      "exceptionLogging": "STACKDRIVER",
 *      "runtimeVersion": "V8",
 *      "oauthScopes": [
 *        "https://www.googleapis.com/auth/spreadsheets",
 *        "https://www.googleapis.com/auth/drive"
 *      ]
 *    }
 * 9. 저장 (Ctrl+S)
 *
 * ── 배포 ──
 * 10. 배포 → 새 배포
 *     - 유형 선택: "웹 앱"
 *     - 실행 주체: "본인 (나)"
 *     - 액세스 권한: "모든 사용자"
 * 11. "배포" 클릭 → 권한 승인 (Drive 접근 포함) → 배포 URL 복사
 * 12. 복사한 URL을 Electron 앱 설정 화면에 붙여넣기
 *
 * ========== 주의 ==========
 *
 * - 코드를 수정한 후에는 반드시 "새 배포"를 다시 해야 반영됩니다
 *   (기존 배포 URL은 이전 코드를 계속 실행합니다)
 * - 이미지 업로드를 위해 반드시 Drive 스코프가 포함된 appsscript.json 필요
 * - 시트 탭 이름은 EP01_A (레거시=BG), EP01_A_BG, EP01_A_ACT 형식
 * - 열 구조: A(No) B(씬번호) C(메모) D(스토리보드URL) E(가이드URL)
 *            F(담당자) G(LO) H(완료) I(검수) J(PNG) K(레이아웃)
 */

// EP01_A (레거시=BG), EP01_A_BG, EP01_A_ACT 모두 매칭
var EP_PATTERN = /^EP(\d+)_([A-Z])(?:_(BG|ACT))?$/;
// 아카이빙된 탭: AC_EP01_A_BG 등
var AC_EP_PATTERN = /^AC_EP(\d+)_([A-Z])(?:_(BG|ACT))?$/;

// 헤더 행 (새 탭 생성 시 자동 삽입)
var HEADERS = ['No', '씬번호', '메모', '스토리보드URL', '가이드URL', '담당자', 'LO', '완료', '검수', 'PNG', '레이아웃'];

// 단계별 열 번호 (1-indexed: G=7, H=8, I=9, J=10)
var STAGE_COLUMNS = { lo: 7, done: 8, review: 9, png: 10 };

// 씬 편집 가능한 필드 → 열 번호
var FIELD_COLUMNS = {
  no: 1, sceneId: 2, memo: 3, storyboardUrl: 4,
  guideUrl: 5, assignee: 6, lo: 7, done: 8, review: 9, png: 10, layoutId: 11
};

// ─── 통합 액션 디스패처 (Phase 0: 배치 + 개별 요청 공용) ────

/**
 * 단일 액션을 실행하고 결과를 반환한다.
 * doGet (개별 요청)과 doPost batch (배치 요청) 모두에서 호출된다.
 *
 * @param {string} action  액션 이름
 * @param {Object} params  파라미터 (모든 값은 문자열, URL 파라미터와 동일 형태)
 * @return {*} 액션 결과 (데이터가 없으면 null)
 */
function executeAction(action, params) {
  switch (action) {
    case 'ping':
      return { pong: true };

    case 'readAll':
      return readAllEpisodes();

    case 'readArchived':
      return readArchivedEpisodes();

    case 'updateCell':
      updateSceneStage(
        params.sheetName,
        parseInt(params.rowIndex, 10),
        params.stage,
        params.value === 'true' || params.value === true
      );
      return null;

    case 'addEpisode':
      return addEpisode(
        parseInt(params.episodeNumber, 10),
        params.department || 'bg'
      );

    case 'addPart':
      return addPart(
        parseInt(params.episodeNumber, 10),
        params.partId,
        params.department || 'bg'
      );

    case 'addScene':
      addScene(
        params.sheetName,
        params.sceneId || '',
        params.assignee || '',
        params.memo || ''
      );
      return null;

    case 'addScenes':
      addScenes(params.sheetName, params.scenesJson);
      return null;

    case 'deleteScene':
      deleteScene(params.sheetName, parseInt(params.rowIndex, 10));
      return null;

    case 'updateSceneField':
      updateSceneField(
        params.sheetName,
        parseInt(params.rowIndex, 10),
        params.field,
        params.value
      );
      return null;

    case 'readMetadata':
      return readMetadata(params.type, params.key);

    case 'writeMetadata':
      writeMetadata(params.type, params.key, params.value || '');
      return null;

    case 'softDeletePart':
      softDeletePart(params.sheetName);
      return null;

    case 'softDeleteEpisode':
      softDeleteEpisode(parseInt(params.episodeNumber, 10));
      return null;

    case 'archiveEpisode':
      archiveEpisode(parseInt(params.episodeNumber, 10));
      return null;

    case 'unarchiveEpisode':
      unarchiveEpisode(parseInt(params.episodeNumber, 10));
      return null;

    case 'debugImages':
      return debugImageCells();

    // Phase 0-2: _REGISTRY 관련 액션
    case 'readRegistry':
      return readRegistry();

    case 'updateRegistryEntry':
      updateRegistryEntry(params.sheetName, {
        status: params.status,
        title: params.title,
        archivedAt: params.archivedAt,
        archivedBy: params.archivedBy,
        archiveMemo: params.archiveMemo,
      });
      return null;

    case 'archiveEpisodeViaRegistry':
      archiveEpisodeViaRegistry(
        parseInt(params.episodeNumber, 10),
        params.archivedBy || '',
        params.archiveMemo || ''
      );
      return null;

    case 'unarchiveEpisodeViaRegistry':
      unarchiveEpisodeViaRegistry(parseInt(params.episodeNumber, 10));
      return null;

    // Phase 0-3: _COMMENTS 관련 액션
    case 'readComments':
      return readComments(params.sheetName);

    case 'addComment':
      addCommentToSheet(
        params.commentId, params.sheetName, params.sceneId,
        params.userId, params.userName, params.text,
        params.mentions ? params.mentions.split(',') : [],
        params.createdAt
      );
      return null;

    case 'editComment':
      editCommentInSheet(
        params.commentId, params.text,
        params.mentions ? params.mentions.split(',') : []
      );
      return null;

    case 'deleteComment':
      deleteCommentFromSheet(params.commentId);
      return null;

    // Phase 0-4: _USERS 관련 액션
    case 'readUsers':
      return readUsers();

    case 'addUser':
      addUserToSheet(
        params.userId, params.name, params.role, params.password,
        params.slackId, params.hireDate, params.birthday,
        params.isInitialPassword === 'true', params.createdAt
      );
      return null;

    case 'updateUser':
      updateUserInSheet(params.userId, {
        name: params.name,
        role: params.role,
        password: params.password,
        slackId: params.slackId,
        hireDate: params.hireDate,
        birthday: params.birthday,
        isInitialPassword: params.isInitialPassword,
      });
      return null;

    case 'deleteUser':
      deleteUserFromSheet(params.userId);
      return null;

    default:
      throw new Error('Unknown action: ' + action);
  }
}

// ─── 요청 핸들러 ─────────────────────────────────────────────

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'readAll';

  try {
    var result = executeAction(action, e.parameter || {});
    if (result === null || result === undefined) {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    switch (action) {
      // ─── 배치 요청 (Phase 0) ────────────────────────
      case 'batch': {
        if (!body.actions || !Array.isArray(body.actions)) {
          return jsonResponse({ ok: false, error: 'batch requires actions array' });
        }
        if (body.actions.length === 0) {
          return jsonResponse({ ok: true, results: [] });
        }
        if (body.actions.length > 20) {
          return jsonResponse({ ok: false, error: 'batch max 20 actions' });
        }

        var results = [];
        for (var i = 0; i < body.actions.length; i++) {
          var op = body.actions[i];
          try {
            var batchResult = executeAction(op.action, op.params || {});
            results.push({ ok: true, data: batchResult });
          } catch (err) {
            // 실패 즉시 중단 (fail-fast)
            return jsonResponse({
              ok: false,
              error: err.toString(),
              failedAt: i,
              failedAction: op.action,
              completedResults: results
            });
          }
        }
        return jsonResponse({ ok: true, results: results });
      }

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

      // Phase 0-5: 대량 씬 추가 (POST — scenesJson이 크므로 GET 불가)
      case 'addScenes':
        addScenes(body.sheetName, body.scenesJson);
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
      // match[3]: 'BG' | 'ACT' | undefined (레거시 = 'bg')
      var dept = match[3] === 'ACT' ? 'acting' : 'bg';
      tabs.push({
        title: title,
        episodeNumber: parseInt(match[1], 10),
        partId: match[2],
        department: dept
      });
    }
  }

  tabs.sort(function(a, b) {
    if (a.episodeNumber !== b.episodeNumber) return a.episodeNumber - b.episodeNumber;
    if (a.partId !== b.partId) return a.partId.localeCompare(b.partId);
    // 같은 EP+파트면 부서 순 (bg → acting)
    return a.department.localeCompare(b.department);
  });

  return tabs;
}

// ─── 셀 이미지 추출 ─────────────────────────────────────────

/**
 * 셀 값에서 이미지 URL을 추출한다.
 *
 * - 문자열(URL): 그대로 반환
 * - CellImage 객체 (시트에 직접 붙여넣은 이미지):
 *   1. getUrl()로 원본 URL 확인
 *   2. 없으면 getContentUrl()로 이미지 데이터를 가져와 Drive에 업로드
 *   3. 셀을 Drive URL로 갱신 후 반환
 *
 * @param {*} val          getValues()가 반환한 셀 값
 * @param {Sheet} sheet    현재 시트
 * @param {number} rowNum  시트 행 번호 (1-based)
 * @param {number} colNum  시트 열 번호 (1-based)
 * @param {string} sheetName  시트 이름
 * @param {string} sceneId    씬 ID
 * @param {string} imageType  'storyboard' 또는 'guide'
 * @return {string} 이미지 URL 또는 빈 문자열
 */
function extractImageUrl(val, sheet, rowNum, colNum, sheetName, sceneId, imageType) {
  // 문자열이면 그대로 반환
  if (typeof val === 'string') return val;

  // falsy 값
  if (!val) return '';

  // CellImage 객체 처리
  if (typeof val === 'object') {
    try {
      // 1. 원본 URL이 있으면 (URL 기반 이미지) 그대로 사용
      if (typeof val.getUrl === 'function') {
        var sourceUrl = val.getUrl();
        if (sourceUrl) {
          sheet.getRange(rowNum, colNum).setValue(sourceUrl);
          return sourceUrl;
        }
      }

      // 2. 붙여넣기 이미지: contentUrl로 이미지 데이터를 가져와 Drive에 업로드
      if (typeof val.getContentUrl === 'function') {
        var contentUrl = val.getContentUrl();
        if (contentUrl) {
          var response = UrlFetchApp.fetch(contentUrl);
          var blob = response.getBlob();

          var folder = getOrCreateImageFolder();
          var typeSuffix = imageType === 'storyboard' ? 'sb' : 'guide';
          var fileName = sheetName + '_' + (sceneId || 'unknown') + '_' + typeSuffix + '.jpg';

          // 기존 동일 파일명 삭제 (덮어쓰기)
          var existing = folder.getFilesByName(fileName);
          while (existing.hasNext()) {
            existing.next().setTrashed(true);
          }

          blob.setName(fileName);
          var file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

          var driveUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();

          // 셀을 영구 Drive URL로 갱신
          sheet.getRange(rowNum, colNum).setValue(driveUrl);

          return driveUrl;
        }
      }
    } catch (e) {
      Logger.log('CellImage 처리 실패 (' + sheetName + ' ' + sceneId + ' ' + imageType + '): ' + e.toString());
    }
  }

  return '';
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

  // 오버레이 이미지 수집 (Ctrl+V로 시트에 직접 붙여넣은 이미지)
  var overlayMap = {};
  try {
    var images = sheet.getImages();
    for (var img = 0; img < images.length; img++) {
      var image = images[img];
      var anchor = image.getAnchorCell();
      var anchorRow = anchor.getRow();   // 1-based
      var anchorCol = anchor.getColumn(); // 1-based
      // D열(4)=스토리보드, E열(5)=가이드 위에 있는 이미지만
      if ((anchorCol === 4 || anchorCol === 5) && anchorRow >= 2) {
        overlayMap[anchorRow + '_' + anchorCol] = image;
      }
    }
  } catch (e) {
    Logger.log('오버레이 이미지 감지 실패: ' + e.toString());
  }

  var scenes = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    // No와 씬번호가 모두 비어있는 행만 건너뜀 (No=0인 행도 씬번호가 있으면 포함)
    if (!row[0] && !row[1]) continue;

    var rowNum = i + 2;
    var sceneId = String(row[1] || '');

    var sbUrl = extractImageUrl(row[3], sheet, rowNum, 4, sheetName, sceneId, 'storyboard');
    var guideUrl = extractImageUrl(row[4], sheet, rowNum, 5, sheetName, sceneId, 'guide');

    // 오버레이 이미지 처리: 셀 값이 비어있고 오버레이가 있으면 Drive로 업로드
    if (!sbUrl) {
      sbUrl = tryUploadOverlayImage(overlayMap[rowNum + '_4'], sheetName, sceneId, 'storyboard', sheet, rowNum, 4);
    }
    if (!guideUrl) {
      guideUrl = tryUploadOverlayImage(overlayMap[rowNum + '_5'], sheetName, sceneId, 'guide', sheet, rowNum, 5);
    }

    scenes.push({
      no: parseInt(row[0], 10) || (i + 1),
      sceneId: sceneId,
      memo: String(row[2] || ''),
      storyboardUrl: sbUrl,
      guideUrl: guideUrl,
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

/**
 * 오버레이 이미지(시트에 Ctrl+V로 붙여넣은 이미지)를 Drive에 업로드한다.
 * OverGridImage에는 getBlob()이 없으므로 getUrl()이 있는 경우만 처리 가능.
 * 직접 붙여넣은 이미지(getUrl()=null)는 처리 불가 → 빈 문자열 반환.
 */
function tryUploadOverlayImage(image, sheetName, sceneId, imageType, sheet, rowNum, colNum) {
  if (!image) return '';

  try {
    var url = image.getUrl();
    if (url) {
      // URL 기반 오버레이 이미지 → 그 URL을 셀에 기록
      sheet.getRange(rowNum, colNum).setValue(url);
      return url;
    }

    // 직접 붙여넣기 이미지: UrlFetchApp으로 접근 시도
    // (일부 환경에서 내부 URL을 통해 가능할 수 있음)
    Logger.log('오버레이 이미지 URL 없음 (' + sheetName + ' ' + sceneId + ' ' + imageType + ') — 앱의 이미지 업로드 기능을 사용해주세요');
  } catch (e) {
    Logger.log('오버레이 이미지 처리 실패: ' + e.toString());
  }

  return '';
}

// ─── 이미지 진단 (디버그용) ─────────────────────────────────

/**
 * 이미지 셀 진단 — Apps Script 에디터에서 직접 실행하거나
 * ?action=debugImages 로 호출 가능.
 * 각 이미지 셀의 데이터 타입과 값을 반환한다.
 */
function debugImageCells() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = getEpisodeTabs();
  var results = [];

  for (var t = 0; t < tabs.length; t++) {
    var sheet = ss.getSheetByName(tabs[t].title);
    if (!sheet) continue;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;

    var data = sheet.getRange(2, 1, lastRow - 1, 11).getValues();

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[1]) continue;

      var sbInfo = analyzeValue(row[3]);
      var guideInfo = analyzeValue(row[4]);

      if (sbInfo.type !== 'empty' || guideInfo.type !== 'empty') {
        results.push({
          sheet: tabs[t].title,
          scene: String(row[1] || ''),
          row: i + 2,
          sb: sbInfo,
          guide: guideInfo
        });
      }
    }

    // 오버레이 이미지 확인
    try {
      var images = sheet.getImages();
      for (var j = 0; j < images.length; j++) {
        var img = images[j];
        var anchor = img.getAnchorCell();
        results.push({
          sheet: tabs[t].title,
          overlayImage: true,
          anchorRow: anchor.getRow(),
          anchorCol: anchor.getColumn(),
          url: img.getUrl(),
          width: img.getWidth(),
          height: img.getHeight()
        });
      }
    } catch (e) {
      results.push({ sheet: tabs[t].title, overlayError: e.toString() });
    }
  }

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}

function analyzeValue(val) {
  if (val === '' || val === null || val === undefined) {
    return { type: 'empty' };
  }
  if (typeof val === 'string') {
    return { type: 'string', value: val.substring(0, 200), length: val.length };
  }
  if (typeof val === 'object') {
    var info = { type: 'object' };
    try { info.stringified = String(val).substring(0, 100); } catch (e) { info.stringifyError = e.toString(); }
    try { info.hasGetUrl = typeof val.getUrl === 'function'; } catch (e) {}
    try { info.hasGetContentUrl = typeof val.getContentUrl === 'function'; } catch (e) {}
    if (info.hasGetUrl) {
      try { info.getUrlResult = val.getUrl(); } catch (e) { info.getUrlError = e.toString(); }
    }
    if (info.hasGetContentUrl) {
      try {
        var cu = val.getContentUrl();
        info.getContentUrlResult = cu ? String(cu).substring(0, 100) : null;
      } catch (e) { info.getContentUrlError = e.toString(); }
    }
    return info;
  }
  return { type: typeof val, value: String(val).substring(0, 100) };
}

// ─── 전체 에피소드 데이터 읽기 ───────────────────────────────

function readAllEpisodes() {
  // _REGISTRY를 사용하여 활성 탭만 필터링
  var registry = readRegistry();
  var deletedItems = getDeletedItems();

  // _REGISTRY가 있으면 활성 항목만, 없으면 기존 방식 폴백
  var activeSheets = {};  // sheetName → { episodeNumber, partId, department, title }
  var registryTitles = {}; // episodeNumber → title (from registry)

  if (registry.length > 0) {
    for (var r = 0; r < registry.length; r++) {
      var entry = registry[r];
      if (entry.status === 'active') {
        activeSheets[entry.sheetName] = entry;
        if (entry.title) registryTitles[String(entry.episodeNumber)] = entry.title;
      }
    }
  }

  var tabs = getEpisodeTabs();
  var epMap = {};

  for (var i = 0; i < tabs.length; i++) {
    var tab = tabs[i];

    // 소프트 삭제된 파트 건너뛰기
    if (deletedItems[tab.title]) continue;

    // _REGISTRY가 있으면 활성 항목만 (archived/deleted 제외)
    if (registry.length > 0 && !activeSheets[tab.title]) continue;

    if (!epMap[tab.episodeNumber]) {
      var epTitle = registryTitles[String(tab.episodeNumber)]
        || ('EP.' + String(tab.episodeNumber).padStart(2, '0'));
      epMap[tab.episodeNumber] = {
        episodeNumber: tab.episodeNumber,
        title: epTitle,
        parts: []
      };
    }

    var scenes = readSheetData(tab.title);
    epMap[tab.episodeNumber].parts.push({
      partId: tab.partId,
      department: tab.department, // 'bg' | 'acting'
      sheetName: tab.title,
      scenes: scenes
    });
  }

  var episodes = [];
  var keys = Object.keys(epMap).sort(function(a, b) { return Number(a) - Number(b); });
  for (var j = 0; j < keys.length; j++) {
    // 파트가 모두 삭제된 에피소드도 건너뛰기
    if (epMap[keys[j]].parts.length > 0) {
      episodes.push(epMap[keys[j]]);
    }
  }

  return episodes;
}

// ─── 아카이빙된 에피소드 목록 읽기 ─────────────────────────────

function readArchivedEpisodes() {
  // _REGISTRY 기반: archived 상태인 에피소드 목록
  var registry = readRegistry();
  var epMap = {};

  if (registry.length > 0) {
    // _REGISTRY에서 archived 항목 수집
    for (var r = 0; r < registry.length; r++) {
      var entry = registry[r];
      if (entry.status === 'archived') {
        var epNum = entry.episodeNumber;
        if (!epMap[epNum]) {
          epMap[epNum] = {
            episodeNumber: epNum,
            title: entry.title || ('EP.' + String(epNum).padStart(2, '0')),
            partCount: 0,
            archivedBy: entry.archivedBy || '',
            archivedAt: entry.archivedAt || '',
            archiveMemo: entry.archiveMemo || ''
          };
        }
        epMap[epNum].partCount++;
      }
    }
  } else {
    // 폴백: 기존 AC_ 접두사 방식
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();

    for (var i = 0; i < sheets.length; i++) {
      var sheetTitle = sheets[i].getName();
      var match = sheetTitle.match(AC_EP_PATTERN);
      if (match) {
        var acEpNum = parseInt(match[1], 10);
        if (!epMap[acEpNum]) {
          epMap[acEpNum] = {
            episodeNumber: acEpNum,
            title: 'EP.' + String(acEpNum).padStart(2, '0'),
            partCount: 0
          };
        }
        epMap[acEpNum].partCount++;
      }
    }
  }

  var result = [];
  var keys = Object.keys(epMap).sort(function(a, b) { return Number(a) - Number(b); });
  for (var j = 0; j < keys.length; j++) {
    result.push(epMap[keys[j]]);
  }
  return result;
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

function addEpisode(episodeNumber, department) {
  if (!episodeNumber || episodeNumber < 1) {
    throw new Error('유효하지 않은 에피소드 번호');
  }

  var dept = department || 'bg';
  var deptSuffix = dept === 'acting' ? '_ACT' : '_BG';
  var tabName = 'EP' + String(episodeNumber).padStart(2, '0') + '_A' + deptSuffix;
  createSheetTab(tabName);

  // _REGISTRY에 등록
  addRegistryEntry(tabName, episodeNumber, 'A', dept, '');

  return { sheetName: tabName, episodeNumber: episodeNumber, partId: 'A', department: dept };
}

// ─── 파트 추가 ───────────────────────────────────────────────

function addPart(episodeNumber, partId, department) {
  if (!episodeNumber || !partId) {
    throw new Error('에피소드 번호와 파트 ID 필요');
  }

  // partId 유효성 (A-Z)
  if (!/^[A-Z]$/.test(partId)) {
    throw new Error('파트 ID는 A-Z 대문자 1글자여야 합니다');
  }

  var dept = department || 'bg';
  var deptSuffix = dept === 'acting' ? '_ACT' : '_BG';
  var tabName = 'EP' + String(episodeNumber).padStart(2, '0') + '_' + partId + deptSuffix;
  createSheetTab(tabName);

  // _REGISTRY에 등록
  addRegistryEntry(tabName, episodeNumber, partId, dept, '');

  return { sheetName: tabName, episodeNumber: episodeNumber, partId: partId, department: dept };
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

// ─── 대량 씬 추가 (Phase 0-5) ───────────────────────────────

/**
 * 여러 씬을 한 번에 추가한다 (setValues 사용 — 70개도 1~2초).
 * @param {string} sheetName  시트 이름
 * @param {string} scenesJson  JSON 문자열: [{ sceneId, assignee, memo }, ...]
 */
function addScenes(sheetName, scenesJson) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);

  var scenes;
  try { scenes = JSON.parse(scenesJson); } catch (e) { throw new Error('Invalid scenes JSON'); }
  if (!scenes || scenes.length === 0) return;

  // 다음 No 계산
  var lastRow = sheet.getLastRow();
  var nextNo = 1;
  if (lastRow >= 2) {
    var lastNo = sheet.getRange(lastRow, 1).getValue();
    nextNo = (parseInt(lastNo, 10) || lastRow - 1) + 1;
  }

  // 전체 행 데이터 배열 생성
  var rows = [];
  for (var i = 0; i < scenes.length; i++) {
    var s = scenes[i];
    rows.push([
      nextNo + i,
      s.sceneId || '',
      s.memo || '',
      '', '', // storyboardUrl, guideUrl
      s.assignee || '',
      false, false, false, false, // lo, done, review, png
      '' // layoutId
    ]);
  }

  // setValues로 한 번에 기록 (appendRow x N 대비 극적으로 빠름)
  sheet.getRange(lastRow + 1, 1, rows.length, 11).setValues(rows);
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
 * 이미지 폴더를 가져온다 (없으면 생성 시도).
 * testDrivePermission()을 먼저 실행했다면 폴더가 이미 존재한다.
 */
function getOrCreateImageFolder() {
  var folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();

  // 폴더 생성 시도 (권한 없으면 상세 안내 포함 오류)
  try {
    return DriveApp.createFolder(IMAGE_FOLDER_NAME);
  } catch (e) {
    throw new Error(
      'Drive 폴더 생성 권한 없음. Apps Script 에디터에서 testDrivePermission 함수를 실행하여 권한을 승인한 뒤 "새 배포"를 다시 해주세요. (' + e.message + ')'
    );
  }
}

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
  var folder = getOrCreateImageFolder();

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

// ─── 권한 테스트 (에디터에서 실행) ────────────────────────────

/**
 * Apps Script 에디터에서 이 함수를 실행하면:
 * 1. Drive 접근 권한 승인 대화상자 표시
 * 2. 이미지 저장용 폴더가 없으면 미리 생성
 *
 * 실행 후 반드시 "배포 → 새 배포"를 해야 웹 앱에도 반영됩니다.
 */
function testDrivePermission() {
  // 1) Drive 접근 확인
  var root = DriveApp.getRootFolder();
  Logger.log('Drive 루트 접근 OK: ' + root.getName());

  // 2) 이미지 폴더 미리 생성 (이후 uploadImage에서 createFolder 불필요)
  var folders = DriveApp.getFoldersByName(IMAGE_FOLDER_NAME);
  if (folders.hasNext()) {
    Logger.log('이미지 폴더 이미 존재: ' + IMAGE_FOLDER_NAME);
  } else {
    var newFolder = DriveApp.createFolder(IMAGE_FOLDER_NAME);
    Logger.log('이미지 폴더 생성 완료: ' + newFolder.getName() + ' (ID: ' + newFolder.getId() + ')');
  }

  Logger.log('=== 모든 Drive 권한 OK — 이제 "새 배포"를 해주세요 ===');
}

// ─── _METADATA 시트 관리 ──────────────────────────────────────

var METADATA_SHEET_NAME = '_METADATA';
var METADATA_HEADERS = ['type', 'key', 'value', 'updatedAt'];

/**
 * _METADATA 시트를 가져온다 (없으면 생성).
 */
function ensureMetadataSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(METADATA_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(METADATA_SHEET_NAME);
  sheet.getRange(1, 1, 1, METADATA_HEADERS.length).setValues([METADATA_HEADERS]);
  sheet.getRange(1, 1, 1, METADATA_HEADERS.length).setFontWeight('bold').setBackground('#F3E5F5');
  sheet.hideSheet();
  return sheet;
}

/**
 * 메타데이터를 읽는다.
 * @param {string} type  메타데이터 유형 (예: 'part-memo', 'deleted', 'episode-memo')
 * @param {string} key   키 (예: sheetName 또는 episodeNumber)
 * @return {{ type: string, key: string, value: string, updatedAt: string } | null}
 */
function readMetadata(type, key) {
  var sheet = ensureMetadataSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === type && String(data[i][1]) === key) {
      return { type: String(data[i][0]), key: String(data[i][1]), value: String(data[i][2]), updatedAt: String(data[i][3]) };
    }
  }
  return null;
}

/**
 * 메타데이터를 쓴다 (기존 값이 있으면 업서트).
 * @param {string} type  메타데이터 유형
 * @param {string} key   키
 * @param {string} value 값
 */
function writeMetadata(type, key, value) {
  var sheet = ensureMetadataSheet();
  var lastRow = sheet.getLastRow();
  var now = new Date().toISOString();

  // 기존 행 찾기
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === type && String(data[i][1]) === key) {
        // 업서트: 기존 행 갱신
        sheet.getRange(i + 2, 3).setValue(value);
        sheet.getRange(i + 2, 4).setValue(now);
        // _REGISTRY에도 제목 동기화
        if (type === 'episode-title') {
          syncTitleToRegistry(parseInt(key, 10), value);
        }
        return;
      }
    }
  }

  // 새 행 추가
  sheet.appendRow([type, key, value, now]);

  // _REGISTRY에도 제목 동기화
  if (type === 'episode-title') {
    syncTitleToRegistry(parseInt(key, 10), value);
  }
}

/**
 * 파트를 소프트 삭제한다 (_METADATA에 기록).
 * @param {string} sheetName 시트 이름
 */
function softDeletePart(sheetName) {
  writeMetadata('deleted', sheetName, 'true');
}

/**
 * 에피소드를 소프트 삭제한다 (해당 에피소드의 모든 파트를 삭제 마킹).
 * @param {number} episodeNumber 에피소드 번호
 */
function softDeleteEpisode(episodeNumber) {
  var tabs = getEpisodeTabs();
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].episodeNumber === episodeNumber) {
      softDeletePart(tabs[i].title);
    }
  }
  // 에피소드 자체도 삭제 마킹
  writeMetadata('deleted-episode', String(episodeNumber), 'true');
}

/**
 * 에피소드를 아카이빙한다 — 해당 에피소드의 모든 파트 시트 이름에 AC_ 접두사를 붙인다.
 * @param {number} episodeNumber 에피소드 번호
 */
function archiveEpisode(episodeNumber) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabs = getEpisodeTabs();
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].episodeNumber === episodeNumber) {
      var sheet = ss.getSheetByName(tabs[i].title);
      if (sheet && !tabs[i].title.startsWith('AC_')) {
        sheet.setName('AC_' + tabs[i].title);
      }
    }
  }
  // 아카이빙 메타데이터 기록
  writeMetadata('archived-episode', String(episodeNumber), 'true');
}

/**
 * 에피소드 아카이빙을 해제한다 — AC_ 접두사를 제거한다.
 * @param {number} episodeNumber 에피소드 번호
 */
function unarchiveEpisode(episodeNumber) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var epPrefix = 'AC_EP' + String(episodeNumber).padStart(2, '0');
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.startsWith(epPrefix)) {
      sheets[i].setName(name.replace(/^AC_/, ''));
    }
  }
  // 아카이빙 메타데이터 제거
  writeMetadata('archived-episode', String(episodeNumber), '');
}

/**
 * 삭제된 항목 목록을 가져온다.
 * @return {Set<string>} 삭제된 sheetName 세트
 */
function getDeletedItems() {
  var sheet;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    sheet = ss.getSheetByName(METADATA_SHEET_NAME);
  } catch (e) {
    return {};
  }

  if (!sheet) return {};

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var deleted = {};
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === 'deleted' && String(data[i][2]) === 'true') {
      deleted[String(data[i][1])] = true;
    }
  }
  return deleted;
}

// ─── _REGISTRY 시트 관리 (Phase 0-2) ──────────────────────────

/**
 * 에피소드 제목을 _REGISTRY의 모든 관련 행에 동기화한다.
 */
function syncTitleToRegistry(episodeNumber, title) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var regSheet = ss.getSheetByName('_REGISTRY');
    if (!regSheet) return; // 아직 _REGISTRY가 없으면 무시

    var lastRow = regSheet.getLastRow();
    if (lastRow < 2) return;

    var data = regSheet.getRange(2, 1, lastRow - 1, REGISTRY_HEADERS.length).getValues();
    var now = new Date().toISOString();
    for (var i = 0; i < data.length; i++) {
      if (parseInt(data[i][1], 10) === episodeNumber) {
        regSheet.getRange(i + 2, 6).setValue(title);  // title 열
        regSheet.getRange(i + 2, 10).setValue(now);     // updatedAt 열
      }
    }
  } catch (e) {
    // 레지스트리 동기화 실패는 무시 (메타데이터가 primary)
    Logger.log('syncTitleToRegistry error: ' + e.toString());
  }
}

var REGISTRY_SHEET_NAME = '_REGISTRY';
var REGISTRY_HEADERS = ['sheetName', 'episodeNumber', 'partId', 'department', 'status', 'title', 'archivedAt', 'archivedBy', 'archiveMemo', 'updatedAt'];

/**
 * _REGISTRY 시트를 가져온다 (없으면 생성 + 기존 데이터 마이그레이션).
 */
function ensureRegistrySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(REGISTRY_SHEET_NAME);
  if (sheet) return sheet;

  // _REGISTRY 신규 생성
  sheet = ss.insertSheet(REGISTRY_SHEET_NAME);
  sheet.getRange(1, 1, 1, REGISTRY_HEADERS.length).setValues([REGISTRY_HEADERS]);
  sheet.getRange(1, 1, 1, REGISTRY_HEADERS.length).setFontWeight('bold').setBackground('#E8F5E9');

  // 기존 데이터 마이그레이션
  migrateToRegistry(ss, sheet);

  return sheet;
}

/**
 * 기존 탭 이름 + _METADATA에서 _REGISTRY로 마이그레이션한다.
 */
function migrateToRegistry(ss, registrySheet) {
  var sheets = ss.getSheets();
  var metaSheet = ss.getSheetByName(METADATA_SHEET_NAME);
  var now = new Date().toISOString();

  // 1. _METADATA에서 에피소드 제목/아카이브 정보 수집
  var titles = {};      // episodeNumber → title
  var archiveInfos = {}; // episodeNumber → { by, at, memo }

  if (metaSheet) {
    var metaLastRow = metaSheet.getLastRow();
    if (metaLastRow >= 2) {
      var metaData = metaSheet.getRange(2, 1, metaLastRow - 1, 4).getValues();
      for (var m = 0; m < metaData.length; m++) {
        var mType = String(metaData[m][0]);
        var mKey = String(metaData[m][1]);
        var mVal = String(metaData[m][2]);
        if (mType === 'episode-title' && mVal) {
          titles[mKey] = mVal;
        }
        if (mType === 'archive-info' && mVal) {
          try { archiveInfos[mKey] = JSON.parse(mVal); } catch (e) {}
        }
      }
    }
  }

  // 2. 활성 탭 (EP_) 등록
  var rows = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();

    // 활성 에피소드 탭
    var match = name.match(EP_PATTERN);
    if (match) {
      var epNum = parseInt(match[1], 10);
      var dept = match[3] === 'ACT' ? 'acting' : 'bg';
      rows.push([
        name, epNum, match[2], dept, 'active',
        titles[String(epNum)] || '', '', '', '', now
      ]);
      continue;
    }

    // 아카이빙된 탭 (AC_EP_)
    var acMatch = name.match(AC_EP_PATTERN);
    if (acMatch) {
      var acEpNum = parseInt(acMatch[1], 10);
      var acDept = acMatch[3] === 'ACT' ? 'acting' : 'bg';
      var info = archiveInfos[String(acEpNum)] || {};
      rows.push([
        name, acEpNum, acMatch[2], acDept, 'archived',
        titles[String(acEpNum)] || '', info.at || '', info.by || '', info.memo || '', now
      ]);
    }
  }

  if (rows.length > 0) {
    registrySheet.getRange(2, 1, rows.length, REGISTRY_HEADERS.length).setValues(rows);
  }
}

/**
 * _REGISTRY에서 전체 데이터를 읽는다.
 * @return {Array<Object>} 레지스트리 항목 배열
 */
function readRegistry() {
  var sheet = ensureRegistrySheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, REGISTRY_HEADERS.length).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    result.push({
      sheetName: String(data[i][0]),
      episodeNumber: parseInt(data[i][1], 10),
      partId: String(data[i][2]),
      department: String(data[i][3]),
      status: String(data[i][4]),
      title: String(data[i][5]),
      archivedAt: String(data[i][6]),
      archivedBy: String(data[i][7]),
      archiveMemo: String(data[i][8]),
      updatedAt: String(data[i][9])
    });
  }
  return result;
}

/**
 * _REGISTRY에서 특정 시트의 항목을 업데이트한다.
 * @param {string} sheetName  시트 이름
 * @param {Object} updates    업데이트할 필드 (status, title, archivedAt, archivedBy, archiveMemo)
 */
function updateRegistryEntry(sheetName, updates) {
  var sheet = ensureRegistrySheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('레지스트리가 비어있습니다');

  var data = sheet.getRange(2, 1, lastRow - 1, REGISTRY_HEADERS.length).getValues();
  var now = new Date().toISOString();

  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === sheetName) {
      var row = i + 2;
      if (updates.status !== undefined) sheet.getRange(row, 5).setValue(updates.status);
      if (updates.title !== undefined) sheet.getRange(row, 6).setValue(updates.title);
      if (updates.archivedAt !== undefined) sheet.getRange(row, 7).setValue(updates.archivedAt);
      if (updates.archivedBy !== undefined) sheet.getRange(row, 8).setValue(updates.archivedBy);
      if (updates.archiveMemo !== undefined) sheet.getRange(row, 9).setValue(updates.archiveMemo);
      sheet.getRange(row, 10).setValue(now);
      return;
    }
  }
  throw new Error('레지스트리에 없는 시트: ' + sheetName);
}

/**
 * _REGISTRY에 새 항목을 추가한다.
 * @param {string} sheetName  시트 이름
 * @param {number} episodeNumber  에피소드 번호
 * @param {string} partId  파트 ID
 * @param {string} department  부서
 * @param {string} title  에피소드 제목
 */
function addRegistryEntry(sheetName, episodeNumber, partId, department, title) {
  var sheet = ensureRegistrySheet();
  var now = new Date().toISOString();
  sheet.appendRow([sheetName, episodeNumber, partId, department, 'active', title || '', '', '', '', now]);
}

/**
 * _REGISTRY 기반 에피소드 아카이빙 (Phase 0-2)
 * 탭 이름은 바꾸지 않고, _REGISTRY의 status만 'archived'로 변경
 * @param {number} episodeNumber
 * @param {string} archivedBy
 * @param {string} archiveMemo
 */
function archiveEpisodeViaRegistry(episodeNumber, archivedBy, archiveMemo) {
  var sheet = ensureRegistrySheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, REGISTRY_HEADERS.length).getValues();
  var now = new Date().toLocaleDateString('ko-KR');
  var isoNow = new Date().toISOString();

  for (var i = 0; i < data.length; i++) {
    if (parseInt(data[i][1], 10) === episodeNumber && String(data[i][4]) === 'active') {
      var row = i + 2;
      sheet.getRange(row, 5).setValue('archived');
      sheet.getRange(row, 7).setValue(now);
      sheet.getRange(row, 8).setValue(archivedBy || '');
      sheet.getRange(row, 9).setValue(archiveMemo || '');
      sheet.getRange(row, 10).setValue(isoNow);
    }
  }
}

/**
 * _REGISTRY 기반 에피소드 아카이빙 해제 (Phase 0-2)
 * @param {number} episodeNumber
 */
function unarchiveEpisodeViaRegistry(episodeNumber) {
  var sheet = ensureRegistrySheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, REGISTRY_HEADERS.length).getValues();
  var isoNow = new Date().toISOString();

  for (var i = 0; i < data.length; i++) {
    if (parseInt(data[i][1], 10) === episodeNumber && String(data[i][4]) === 'archived') {
      var row = i + 2;
      sheet.getRange(row, 5).setValue('active');
      sheet.getRange(row, 7).setValue('');
      sheet.getRange(row, 8).setValue('');
      sheet.getRange(row, 9).setValue('');
      sheet.getRange(row, 10).setValue(isoNow);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase 0-3: _COMMENTS 탭 — 댓글 동기화
// ═══════════════════════════════════════════════════════════════

var COMMENTS_SHEET_NAME = '_COMMENTS';
var COMMENTS_HEADERS = ['commentId', 'sheetName', 'sceneId', 'userId', 'userName', 'text', 'mentions', 'createdAt', 'editedAt'];

/**
 * _COMMENTS 시트를 가져온다 (없으면 생성).
 */
function ensureCommentsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(COMMENTS_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(COMMENTS_SHEET_NAME);
  sheet.getRange(1, 1, 1, COMMENTS_HEADERS.length).setValues([COMMENTS_HEADERS]);
  sheet.getRange(1, 1, 1, COMMENTS_HEADERS.length).setFontWeight('bold').setBackground('#E3F2FD');
  return sheet;
}

/**
 * 특정 파트(sheetName)의 댓글을 읽는다 — 파트별 지연 로딩용.
 * @param {string} sheetName  시트 이름 (예: EP01_A_BG)
 * @return {Array<Object>} 댓글 배열
 */
function readComments(sheetName) {
  var sheet = ensureCommentsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, COMMENTS_HEADERS.length).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][1]) === sheetName) {
      result.push({
        commentId: String(data[i][0]),
        sheetName: String(data[i][1]),
        sceneId: String(data[i][2]),
        userId: String(data[i][3]),
        userName: String(data[i][4]),
        text: String(data[i][5]),
        mentions: String(data[i][6]) ? String(data[i][6]).split(',') : [],
        createdAt: String(data[i][7]),
        editedAt: String(data[i][8]) || ''
      });
    }
  }
  return result;
}

/**
 * 댓글을 추가한다.
 */
function addCommentToSheet(commentId, sheetName, sceneId, userId, userName, text, mentions, createdAt) {
  var sheet = ensureCommentsSheet();
  sheet.appendRow([
    commentId, sheetName, sceneId, userId, userName, text,
    (mentions || []).join(','),
    createdAt || new Date().toISOString(),
    ''
  ]);
}

/**
 * 댓글을 수정한다.
 */
function editCommentInSheet(commentId, text, mentions) {
  var sheet = ensureCommentsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('댓글을 찾을 수 없습니다');

  var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === commentId) {
      var row = i + 2;
      sheet.getRange(row, 6).setValue(text);
      sheet.getRange(row, 7).setValue((mentions || []).join(','));
      sheet.getRange(row, 9).setValue(new Date().toISOString());
      return;
    }
  }
  throw new Error('댓글을 찾을 수 없습니다: ' + commentId);
}

/**
 * 댓글을 삭제한다.
 */
function deleteCommentFromSheet(commentId) {
  var sheet = ensureCommentsSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === commentId) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase 0-4: _USERS 탭 — 사용자 계정 동기화
// ═══════════════════════════════════════════════════════════════

var USERS_SHEET_NAME = '_USERS';
var USERS_HEADERS = ['userId', 'name', 'role', 'password', 'slackId', 'hireDate', 'birthday', 'isInitialPassword', 'createdAt'];

/**
 * _USERS 시트를 가져온다 (없으면 생성).
 */
function ensureUsersSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(USERS_SHEET_NAME);
  sheet.getRange(1, 1, 1, USERS_HEADERS.length).setValues([USERS_HEADERS]);
  sheet.getRange(1, 1, 1, USERS_HEADERS.length).setFontWeight('bold').setBackground('#FFF3E0');
  return sheet;
}

/**
 * 전체 사용자 목록을 읽는다.
 */
function readUsers() {
  var sheet = ensureUsersSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var pw = String(data[i][3]);
    // Base64 디코딩
    var decodedPw = '';
    try { decodedPw = Utilities.newBlob(Utilities.base64Decode(pw)).getDataAsString(); } catch (e) { decodedPw = pw; }
    result.push({
      id: String(data[i][0]),
      name: String(data[i][1]),
      role: String(data[i][2]) || 'user',
      password: decodedPw,
      slackId: String(data[i][4]),
      hireDate: String(data[i][5]),
      birthday: String(data[i][6]),
      isInitialPassword: String(data[i][7]) === 'true',
      createdAt: String(data[i][8])
    });
  }
  return result;
}

/**
 * 사용자를 추가한다.
 */
function addUserToSheet(userId, name, role, password, slackId, hireDate, birthday, isInitialPassword, createdAt) {
  var sheet = ensureUsersSheet();
  // Base64 인코딩
  var encodedPw = Utilities.base64Encode(password || '1234');
  sheet.appendRow([
    userId, name, role || 'user', encodedPw, slackId || '',
    hireDate || '', birthday || '',
    isInitialPassword ? 'true' : 'false',
    createdAt || new Date().toISOString()
  ]);
}

/**
 * 사용자 정보를 업데이트한다.
 */
function updateUserInSheet(userId, updates) {
  var sheet = ensureUsersSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('사용자를 찾을 수 없습니다');

  var data = sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === userId) {
      var row = i + 2;
      if (updates.name !== undefined) sheet.getRange(row, 2).setValue(updates.name);
      if (updates.role !== undefined) sheet.getRange(row, 3).setValue(updates.role);
      if (updates.password !== undefined) {
        sheet.getRange(row, 4).setValue(Utilities.base64Encode(updates.password));
      }
      if (updates.slackId !== undefined) sheet.getRange(row, 5).setValue(updates.slackId);
      if (updates.hireDate !== undefined) sheet.getRange(row, 6).setValue(updates.hireDate);
      if (updates.birthday !== undefined) sheet.getRange(row, 7).setValue(updates.birthday);
      if (updates.isInitialPassword !== undefined) sheet.getRange(row, 8).setValue(updates.isInitialPassword);
      return;
    }
  }
  throw new Error('사용자를 찾을 수 없습니다: ' + userId);
}

/**
 * 사용자를 삭제한다.
 */
function deleteUserFromSheet(userId) {
  var sheet = ensureUsersSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = data.length - 1; i >= 0; i--) {
    if (String(data[i][0]) === userId) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}
