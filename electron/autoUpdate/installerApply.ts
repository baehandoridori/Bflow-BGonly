/**
 * v1.22.14 installer 기반 업데이트 적용.
 *
 * 기존 directory swap은 Windows/Defender가 실행 폴더를 잡는 순간 rename/copy가 느려지거나
 * 실패했다. 이제는 로컬 캐시에 받아둔 NSIS installer를 앱 종료 후 실행한다.
 */
import { spawn } from 'child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  promises as fsp,
  writeFileSync,
} from 'fs';
import path from 'path';
import os from 'os';
import {
  localBackupDir,
  localBflowExe,
  localInstallerAttemptedMarker,
  localInstallerExePath,
  localInstallerManifestPath,
  localInstallerPendingDir,
  localInstallerReadyMarker,
  localRoot,
  localSwapSuppressedMarker,
  getOwnVersion,
} from './paths';
import { compareVersions, readManifest } from './manifest';

export interface InstallerUpdateHelperOptions {
  /** true면 installer 완료 후 BFLOW를 다시 실행한다. */
  relaunch: boolean;
  /** helper가 installer 실행 전 기다릴 현재 앱 PID. 기본값은 호출 프로세스 PID. */
  parentPid?: number;
}

function escapePs(s: string): string {
  return s.replace(/'/g, "''");
}

function logUpdate(line: string): void {
  try {
    const root = localRoot();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    appendFileSync(path.join(root, 'swap.log'), `${new Date().toISOString()} [installer-main] ${line}\n`, 'utf-8');
  } catch {
    /* best effort */
  }
}

function standardNsisBflowExe(): string {
  const localAppData = process.env.LOCALAPPDATA
    || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  return path.join(localAppData, 'Programs', 'BFLOW', 'BFLOW.exe');
}

export async function hasPendingInstallerUpdate(currentVersion = getOwnVersion()): Promise<boolean> {
  if (!existsSync(localInstallerReadyMarker())) return false;
  if (!existsSync(localInstallerExePath())) {
    await cleanupInstallerPending('installer missing');
    return false;
  }

  const suppressionMarker = localSwapSuppressedMarker();
  if (existsSync(suppressionMarker)) {
    try {
      const recordedVersion = (await fsp.readFile(suppressionMarker, 'utf-8')).trim();
      if (recordedVersion === currentVersion) {
        logUpdate(`installer skip: suppression active (current=${currentVersion})`);
        return false;
      }
      await fsp.unlink(suppressionMarker);
    } catch {
      /* ignore */
    }
  }

  const manifest = await readManifest(localInstallerManifestPath());
  if (!manifest || compareVersions(manifest.version, currentVersion) <= 0) {
    await cleanupInstallerPending(`stale installer (${manifest?.version ?? 'unknown'})`);
    return false;
  }
  return true;
}

export function spawnInstallerUpdateHelper(opts: InstallerUpdateHelperOptions): void {
  const root = escapePs(localRoot());
  const installer = escapePs(localInstallerExePath());
  const pendingDir = escapePs(localInstallerPendingDir());
  const readyMarker = escapePs(localInstallerReadyMarker());
  const manifestPath = escapePs(localInstallerManifestPath());
  const attemptedMarker = escapePs(localInstallerAttemptedMarker());
  const suppressedMarker = escapePs(localSwapSuppressedMarker());
  const bflowExe = escapePs(localBflowExe());
  const nsisBflowExe = escapePs(standardNsisBflowExe());
  const backupDir = escapePs(localBackupDir());
  const currentVersion = escapePs(getOwnVersion());
  const relaunchFlag = opts.relaunch ? '$true' : '$false';
  const parentPid = Number.isFinite(opts.parentPid) ? Math.trunc(opts.parentPid as number) : process.pid;

  const psScript = `
$ErrorActionPreference = 'Continue'
$root = '${root}'
$installer = '${installer}'
$pendingDir = '${pendingDir}'
$readyMarker = '${readyMarker}'
$manifestPath = '${manifestPath}'
$attemptedMarker = '${attemptedMarker}'
$suppressedMarker = '${suppressedMarker}'
$bflowExe = '${bflowExe}'
$nsisBflowExe = '${nsisBflowExe}'
$backupDir = '${backupDir}'
$currentVersion = '${currentVersion}'
$relaunch = ${relaunchFlag}
$parentPid = ${parentPid}

function Write-UpdateLog($msg) {
  try {
    if (-not (Test-Path $root)) { New-Item -ItemType Directory -Force -Path $root | Out-Null }
    Add-Content -Path (Join-Path $root 'swap.log') -Value "$(Get-Date -Format 'o') [installer] $msg"
  } catch {}
}

function Cleanup-SuccessMarkers {
  try { Remove-Item -Path $pendingDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
  try { Remove-Item -Path $attemptedMarker -Force -ErrorAction SilentlyContinue } catch {}
  try { Remove-Item -Path $suppressedMarker -Force -ErrorAction SilentlyContinue } catch {}
  try { Remove-Item -Path $backupDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
}

function Mark-Failure {
  try { Set-Content -Path $suppressedMarker -Value $currentVersion -Force -ErrorAction SilentlyContinue } catch {}
}

function Resolve-BflowExe {
  if (Test-Path $nsisBflowExe) { return $nsisBflowExe }
  return $bflowExe
}

function Start-BflowIfNeeded {
  if (-not $relaunch) { return }
  try {
    Start-Sleep -Milliseconds 500
    $alive = Get-Process -Name BFLOW -ErrorAction SilentlyContinue
    $targetExe = Resolve-BflowExe
    if (-not $alive -and (Test-Path $targetExe)) {
      Start-Process -FilePath $targetExe
      Write-UpdateLog "BFLOW relaunched: $targetExe"
    } elseif ($alive) {
      Write-UpdateLog "BFLOW already running after installer"
    } else {
      Write-UpdateLog "BFLOW relaunch skipped — exe missing: $targetExe"
    }
  } catch {
    Write-UpdateLog "BFLOW relaunch failed: $($_.Exception.Message)"
  }
}

function Wait-ForParentExit {
  if ($parentPid -le 0) { return $true }
  Write-UpdateLog "waiting for parent pid=$parentPid"
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    try {
      $parent = Get-Process -Id $parentPid -ErrorAction SilentlyContinue
      if (-not $parent) {
        Write-UpdateLog "parent exited"
        return $true
      }
      Start-Sleep -Milliseconds 250
    } catch {
      Write-UpdateLog "parent check ended: $($_.Exception.Message)"
      return $true
    }
  }
  Write-UpdateLog "parent wait timeout pid=$parentPid"
  return $false
}

function Wait-ForBflowExit {
  Write-UpdateLog "waiting for BFLOW processes to exit"
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    try {
      $alive = @(Get-Process -Name BFLOW -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID })
      if ($alive.Count -eq 0) {
        Write-UpdateLog "BFLOW processes all exited"
        return $true
      }
      Start-Sleep -Milliseconds 300
    } catch {
      Write-UpdateLog "BFLOW process check ended: $($_.Exception.Message)"
      return $true
    }
  }
  try {
    $ids = @(Get-Process -Name BFLOW -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) -join ','
    Write-UpdateLog "BFLOW wait timeout ids=$ids"
  } catch {
    Write-UpdateLog "BFLOW wait timeout"
  }
  return $false
}

function Show-ProgressWindowUntilExit($proc) {
  try {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
    $detailText = if ($relaunch) { '설치가 끝나면 앱이 자동으로 다시 열립니다.' } else { '설치가 끝나면 다음 실행부터 새 버전으로 열립니다.' }
    [xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="B flow 업데이트"
        Width="440"
        Height="230"
        ResizeMode="NoResize"
        WindowStartupLocation="CenterScreen"
        Background="#1A1D27"
        Foreground="#E8E8EE"
        Topmost="True">
  <Border Padding="24" Background="#1A1D27" BorderBrush="#2D3041" BorderThickness="1">
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto" />
        <RowDefinition Height="Auto" />
        <RowDefinition Height="Auto" />
        <RowDefinition Height="Auto" />
      </Grid.RowDefinitions>
      <TextBlock Grid.Row="0" Text="B flow 업데이트 적용 중" FontSize="20" FontWeight="Bold" Foreground="#E8E8EE" />
      <TextBlock Grid.Row="1" Margin="0,10,0,0" Text="$detailText" FontSize="13" Foreground="#A7A9BE" TextWrapping="Wrap" />
      <ProgressBar Grid.Row="2" Margin="0,22,0,0" Height="10" IsIndeterminate="True" Foreground="#6C5CE7" Background="#2D3041" />
      <TextBlock Grid.Row="3" Margin="0,16,0,0" Text="창을 닫지 말고 잠시만 기다려 주세요." FontSize="12" Foreground="#8B8DA3" />
    </Grid>
  </Border>
</Window>
"@
    $reader = New-Object System.Xml.XmlNodeReader $xaml
    $window = [Windows.Markup.XamlReader]::Load($reader)
    $timer = New-Object Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(500)
    $timer.Add_Tick({
      if ($proc.HasExited) {
        $timer.Stop()
        $window.Close()
      }
    })
    $timer.Start()
    $window.ShowDialog() | Out-Null
  } catch {
    Write-UpdateLog "progress window unavailable: $($_.Exception.Message)"
    try { $proc.WaitForExit() | Out-Null } catch {}
  }
}

Write-UpdateLog "installer helper start — relaunch=$relaunch"
try { Set-Content -Path $attemptedMarker -Value (Get-Date -Format 'o') -Force -ErrorAction SilentlyContinue } catch {}
try {
  if (-not (Test-Path $installer)) {
    Write-UpdateLog "installer missing: $installer"
    Mark-Failure
    Start-BflowIfNeeded
    exit 1
  }

  if (-not (Wait-ForParentExit)) {
    Mark-Failure
    Start-BflowIfNeeded
    exit 1
  }
  if (-not (Wait-ForBflowExit)) {
    Mark-Failure
    Start-BflowIfNeeded
    exit 1
  }

  $proc = Start-Process -FilePath $installer -ArgumentList '/S' -PassThru -ErrorAction Stop
  Write-UpdateLog "installer started — pid=$($proc.Id)"
  Show-ProgressWindowUntilExit $proc
  if (-not $proc.HasExited) { $proc.WaitForExit() | Out-Null }
  $exitCode = $proc.ExitCode
  Write-UpdateLog "installer exited — code=$exitCode"

  if ($exitCode -eq 0) {
    Cleanup-SuccessMarkers
    Start-BflowIfNeeded
    Write-UpdateLog "installer apply OK"
    if ($PSCommandPath) { try { Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {} }
    exit 0
  }

  Mark-Failure
  Start-BflowIfNeeded
  Write-UpdateLog "installer apply FAIL"
  if ($PSCommandPath) { try { Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {} }
  exit 1
} catch {
  Write-UpdateLog "installer helper exception: $($_.Exception.Message)"
  Mark-Failure
  Start-BflowIfNeeded
  if ($PSCommandPath) { try { Remove-Item -Path $PSCommandPath -Force -ErrorAction SilentlyContinue } catch {} }
  exit 1
}
`;

  try {
    const helperPs1 = path.join(os.tmpdir(), `bflow-installer-${process.pid}-${Date.now()}.ps1`);
    writeFileSync(helperPs1, '\uFEFF' + psScript, 'utf-8');
    logUpdate(`installer helper .ps1 written to ${helperPs1}`);

    const cmdArgs = [
      '/c', 'start', '/B', '""',
      'powershell.exe',
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-Sta',
      '-File', helperPs1,
    ];
    const child = spawn('cmd.exe', cmdArgs, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('spawn', () => {
      logUpdate(`installer helper cmd wrapper spawn OK — child pid=${child.pid}, helper file=${helperPs1}`);
    });
    child.once('error', (err) => {
      logUpdate(`installer helper cmd wrapper spawn ERROR — ${err.message}`);
    });
    child.unref();
  } catch (err) {
    logUpdate(`installer helper spawn exception — ${(err as Error).message}`);
  }
}

async function cleanupInstallerPending(reason: string): Promise<void> {
  try {
    logUpdate(`installer pending cleanup (${reason})`);
    await fsp.rm(localInstallerPendingDir(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
