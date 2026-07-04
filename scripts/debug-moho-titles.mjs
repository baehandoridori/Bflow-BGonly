// scripts/debug-moho-titles.mjs
// 사용: node scripts/debug-moho-titles.mjs   (Moho를 켜둔 상태에서)
import { spawn } from 'child_process';
const args = [
  '-NoProfile', '-NonInteractive', '-Command',
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Process -Name *moho* -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, MainWindowTitle | Format-Table -AutoSize",
];
const ps = spawn('powershell.exe', args, { windowsHide: true });
let out = '';
ps.stdout.setEncoding('utf8');
ps.stdout.on('data', (d) => { out += d; });
ps.stderr.on('data', (d) => process.stderr.write(d));
ps.on('close', () => {
  console.log('=== Get-Process *moho* ===');
  console.log(out.trim() || '(실행 중 Moho 프로세스 없음)');
});
