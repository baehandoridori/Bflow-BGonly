/**
 * BAE경 '이 PC 점검'의 사실 모으기 (메인 전용). 줄 · 한 줄 정리는 src/shared/bae/pcCheck.ts 의 buildBaePcCheck.
 *   그래픽카드 (app.getGPUInfo + 레지스트리의 그래픽카드 메모리) · DirectML 이 되는지 (모델 일꾼이 작은 모델 하나를 돌려 봄)
 *   · 모델 받음 · 모델 폴더 드라이브의 남은 공간 · 모델 창고 · OpenAI 연결 (+ 화면이 잰 WebGPU).
 * 바깥과 닿는 일은 모두 바꿔 끼울 수 있다: 시험은 가짜 서버(127.0.0.1)와 가짜 일꾼으로 — OpenAI 를 부르지 않는다.
 * electron 을 import 하지 않는다.
 */
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import type { BaeModelState } from '../../../src/shared/bae/models';
import type { BaeWorkerProbe } from '../../../src/shared/bae/modelProtocol';
import { buildBaePcCheck, type BaePcCheck, type BaeWebGpuInfo } from '../../../src/shared/bae/pcCheck';

export interface BaePcCheckDeps {
  appVersion: string;
  pcName: string;
  /** electron app.getGPUInfo('complete') */
  gpuInfo: () => Promise<unknown>;
  /** 그래픽카드별 메모리 (윈도우 레지스트리). 모르면 [] */
  videoMemory?: () => Promise<Array<{ name: string; bytes: number }>>;
  /** 모델 일꾼의 'probe' */
  probe: () => Promise<BaeWorkerProbe>;
  models: () => Promise<BaeModelState[]>;
  /** 모델 창고 폴더 (못 찾으면 null) */
  warehouse: () => Promise<string | null> | string | null;
  modelsDir: string;
  freeBytes?: (dir: string) => Promise<number | null>;
  openaiReach: () => Promise<{ ok: boolean; status?: number }>;
  internetReach?: () => Promise<{ ok: boolean; status?: number }>;
  webgpu?: BaeWebGpuInfo | null;
  now?: () => Date;
}

/** 모델 폴더(아직 없으면 그 위 폴더)가 있는 드라이브의 남은 공간. */
export async function freeBytesOf(dir: string): Promise<number | null> {
  let d = path.resolve(dir);
  for (let i = 0; i < 6; i++) {
    try { const s = await statfs(d); return Number(s.bavail) * Number(s.bsize); }
    catch { const up = path.dirname(d); if (up === d) break; d = up; }
  }
  return null;
}

/** 윈도우: 디스플레이 어댑터 클래스 키의 HardwareInformation.qwMemorySize (64비트 크기) 와 DriverDesc. 읽기만 한다. */
export function readVideoMemoryWindows(run: (args: string[]) => Promise<string> = regQuery): Promise<Array<{ name: string; bytes: number }>> {
  const KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';
  const parse = (text: string, value: string) => {
    const out = new Map<string, string>(); let cur = '';
    for (const line of text.split(/\r?\n/)) {
      if (/^HKEY_/i.test(line.trim())) { cur = line.trim(); continue; }
      const m = line.match(new RegExp(`^\\s+${value.replace(/\./g, '\\.')}\\s+REG_\\w+\\s+(.*)$`));
      if (m && cur) out.set(cur, m[1].trim());
    }
    return out;
  };
  return Promise.all([run(['query', KEY, '/s', '/v', 'HardwareInformation.qwMemorySize']), run(['query', KEY, '/s', '/v', 'DriverDesc'])])
    .then(([memText, nameText]) => {
      const mem = parse(memText, 'HardwareInformation.qwMemorySize'), names = parse(nameText, 'DriverDesc');
      const out: Array<{ name: string; bytes: number }> = [];
      for (const [k, v] of mem) { const n = Number(v.startsWith('0x') ? BigInt(v) : v); if (Number.isFinite(n) && n > 0) out.push({ name: names.get(k) ?? '', bytes: n }); }
      return out;
    })
    .catch(() => []);
}
function regQuery(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve(''); return; }
    execFile('reg', args, { windowsHide: true, timeout: 5000, encoding: 'latin1', maxBuffer: 1 << 20 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

/** OpenAI 에 닿나: 키 없이 /models 를 불러 본다 (401 이어도 닿은 것). 시험은 가짜 서버 주소를 넣는다. */
export async function reachUrl(url: string, opts: { method?: string; timeoutMs?: number; fetch?: typeof fetch } = {}): Promise<{ ok: boolean; status?: number }> {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 9000);
  try {
    const r = await (opts.fetch ?? fetch)(url, { method: opts.method ?? 'GET', redirect: 'manual', signal: ac.signal, cache: 'no-store' } as RequestInit);
    try { await r.body?.cancel(); } catch { /* ignore */ }
    return { ok: r.status > 0 && r.status < 500, status: r.status };
  } catch { return { ok: false }; }
  finally { clearTimeout(t); }
}

interface GpuDevice { vendorId?: number; deviceId?: number; active?: boolean; driverVendor?: string; driverVersion?: string; deviceString?: string; vendorString?: string }
const VENDORS: Record<number, string> = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel', 0x1414: 'Microsoft', 0x5143: 'Qualcomm' };

/** app.getGPUInfo('complete') 에서 쓰는 그래픽카드 (active 우선) 와 소프트웨어 그리기 여부. */
export function pickGpu(info: unknown): { name: string | null; vendor: string | null; driver: string | null; software: boolean } {
  const i = (info && typeof info === 'object' ? info : {}) as { gpuDevice?: GpuDevice[]; auxAttributes?: Record<string, unknown> };
  const list = Array.isArray(i.gpuDevice) ? i.gpuDevice : [];
  const d = list.find((x) => x && x.active) ?? list[0] ?? null;
  const vendor = d ? (d.vendorString || (typeof d.vendorId === 'number' ? VENDORS[d.vendorId] : '') || null) : null;
  const name = d ? (d.deviceString || null) : null;
  const software = !d || d.vendorId === 0x1414 || /swiftshader|software|llvmpipe|basic render/i.test(`${name ?? ''} ${d?.driverVendor ?? ''}`) || i.auxAttributes?.softwareRendering === true;
  return { name, vendor, driver: d?.driverVersion ?? null, software };
}

export async function runBaePcCheck(deps: BaePcCheckDeps): Promise<BaePcCheck> {
  const safe = async <T>(p: () => Promise<T> | T, fallback: T): Promise<T> => { try { return await p(); } catch { return fallback; } };
  const [gpuInfo, vram, probe, models, wh, free, openai, internet] = await Promise.all([
    safe(deps.gpuInfo, null),
    safe(deps.videoMemory ?? (async () => []), [] as Array<{ name: string; bytes: number }>),
    safe(deps.probe, { dml: { ok: false, ms: 0, error: '모델 일꾼에 닿지 못했어요' }, cpu: { ok: false, ms: 0, error: '모델 일꾼에 닿지 못했어요' } } as BaeWorkerProbe),
    safe(deps.models, [] as BaeModelState[]),
    safe(deps.warehouse, null as string | null),
    safe(() => (deps.freeBytes ?? freeBytesOf)(deps.modelsDir), null as number | null),
    safe(deps.openaiReach, { ok: false } as { ok: boolean; status?: number }),
    deps.internetReach ? safe(deps.internetReach, { ok: false } as { ok: boolean; status?: number }) : Promise.resolve(null),
  ]);
  const g = pickGpu(gpuInfo);
  // 메모리는 이름이 맞는 카드, 없으면 가장 큰 것 (외장 그래픽카드가 DirectML 의 첫 장치인 경우가 많다)
  const byName = g.name ? vram.find((v) => v.name && g.name && v.name.toLowerCase().includes(g.name.toLowerCase().replace(/\s*\(.*$/, ''))) : null;
  const biggest = vram.slice().sort((a, b) => b.bytes - a.bytes)[0] ?? null;
  const pickV = byName ?? biggest;
  return buildBaePcCheck({
    appVersion: deps.appVersion,
    pcName: deps.pcName,
    gpu: { name: g.name ?? pickV?.name ?? null, vendor: g.vendor, driver: g.driver, vramMB: pickV ? Math.round(pickV.bytes / 1048576) : null, software: g.software },
    dml: probe.dml, cpu: probe.cpu,
    webgpu: deps.webgpu ?? null,
    models, warehouse: !!wh, internet: internet ? internet.ok : null,
    freeBytes: free, openai,
  }, deps.now ? deps.now() : new Date());
}
