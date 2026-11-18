/**
 * 설치 파일(BFLOW-Setup.exe) 크기 기준. generate-manifest.js 가 배포용 manifest 를 쓰기 전에 본다.
 *
 * 기준: 140MB (1MB = 1024×1024 바이트) — BAE경 이전 0단계(2026-11-13)에서 정한 값.
 *   v1.150.2 main 115.1MB → onnxruntime-node 1.29.0(윈도우 64비트만) + ag-psd + 4K '원본 그대로'의 onnxruntime-web
 *   WebGPU 파일 = 145.0MB → onnxruntime-node 안의 셰이더 컴파일러 둘(dxcompiler · dxil, DirectML 에 필요 없음)을 빼고 139.6MB.
 *   (진행 기록 15번 0-2 · 0-4, 계획 14 9-3. 잰 설치 파일: C:\BAE_stage0\results\size\)
 * 넘으면 거의 언제나 package.json build.files 의 제외 규칙이 빠진 것이다 — onnxruntime-node 를 통째로 담으면 수백 MB 가 된다
 * (Bflow 는 v1.129.0 에 런타임 한 벌이 앱 안에 더 담겨 192MB 가 된 적이 있다, tests/packagedAppContents.test.ts 머리말).
 * 기능이 늘어 정말 커져야 한다면 이 값을 고치고, 고친 까닭과 잰 크기를 여기에 적는다.
 */
const INSTALLER_MAX_MB = 140;
const INSTALLER_MAX_BYTES = INSTALLER_MAX_MB * 1024 * 1024;

/** @param {number} sizeBytes */
function checkInstallerSize(sizeBytes) {
  const mb = sizeBytes / 1024 / 1024;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, message: `설치 파일 크기를 알 수 없습니다 (${sizeBytes}).` };
  }
  if (sizeBytes > INSTALLER_MAX_BYTES) {
    return {
      ok: false,
      message: `설치 파일이 ${mb.toFixed(1)}MB 로 기준(${INSTALLER_MAX_MB}MB)을 넘었습니다. `
        + "package.json build.files 의 제외 규칙(onnxruntime-node 의 윈도우 64비트만 · onnxruntime-web 빼기 · '!dist/…')이 빠지지 않았는지 확인하세요.",
    };
  }
  return { ok: true, message: `설치 파일 크기 확인 — ${mb.toFixed(1)}MB (기준 ${INSTALLER_MAX_MB}MB 안)` };
}

module.exports = { INSTALLER_MAX_MB, INSTALLER_MAX_BYTES, checkInstallerSize };
