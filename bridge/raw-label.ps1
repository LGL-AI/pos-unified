param([Parameter(Mandatory=$true)][string]$Printer, [Parameter(Mandatory=$true)][string]$File)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LotusRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr handle, int level, ref DOCINFO doc);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr handle, byte[] data, int count, out int written);
}
'@
$handle = [IntPtr]::Zero
if (-not [LotusRawPrinter]::OpenPrinter($Printer,[ref]$handle,[IntPtr]::Zero)) { throw "Không mở được máy in tem trong Windows: $Printer" }
$started = $false
$page = $false
try {
  $doc = New-Object LotusRawPrinter+DOCINFO
  $doc.pDocName = 'Lotus POS tem món'
  $doc.pDatatype = 'RAW'
  if ([LotusRawPrinter]::StartDocPrinter($handle,1,[ref]$doc) -le 0) { throw 'Spooler từ chối phiếu in tem RAW' }
  $started = $true
  if (-not [LotusRawPrinter]::StartPagePrinter($handle)) { throw 'Không bắt đầu được trang in tem' }
  $page = $true
  $bytes = [System.IO.File]::ReadAllBytes($File)
  $written = 0
  if (-not [LotusRawPrinter]::WritePrinter($handle,$bytes,$bytes.Length,[ref]$written) -or $written -ne $bytes.Length) { throw 'Spooler chưa nhận hết dữ liệu tem' }
  if (-not [LotusRawPrinter]::EndPagePrinter($handle)) { throw 'Spooler chưa hoàn tất trang tem' }
  $page = $false
  if (-not [LotusRawPrinter]::EndDocPrinter($handle)) { throw 'Spooler chưa hoàn tất công việc tem' }
  $started = $false
  Write-Output 'QUEUED'
} finally {
  if ($page) { [void][LotusRawPrinter]::EndPagePrinter($handle) }
  if ($started) { [void][LotusRawPrinter]::EndDocPrinter($handle) }
  [void][LotusRawPrinter]::ClosePrinter($handle)
}
