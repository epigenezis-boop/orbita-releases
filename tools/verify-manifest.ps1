param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
if (-not ('OrbitaManifest' -as [type])) {
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OrbitaManifest {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
 [DllImport("kernel32.dll")] public static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
 [DllImport("kernel32.dll")] public static extern IntPtr LockResource(IntPtr resource);
 [DllImport("kernel32.dll")] public static extern uint SizeofResource(IntPtr module, IntPtr resource);
 [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr module);
}
'@
}
$file = (Resolve-Path $Path).Path
$h = [OrbitaManifest]::LoadLibraryEx($file, [IntPtr]::Zero, 2)
if ($h -eq [IntPtr]::Zero) { throw "Cannot read PE: $file" }
try {
 $r = [OrbitaManifest]::FindResource($h, [IntPtr]1, [IntPtr]24)
 if ($r -eq [IntPtr]::Zero) { throw 'Executable manifest is missing.' }
 $size = [OrbitaManifest]::SizeofResource($h, $r)
 $data = [OrbitaManifest]::LockResource([OrbitaManifest]::LoadResource($h, $r))
 $bytes = New-Object byte[] $size
 [Runtime.InteropServices.Marshal]::Copy($data, $bytes, 0, $size)
 $xml = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
 if ($xml -notmatch 'requestedExecutionLevel\s+level=["'']asInvoker["'']') { throw 'Executable requests elevation or has an unexpected manifest.' }
 Write-Host "Verified asInvoker: $file"
} finally { [void][OrbitaManifest]::FreeLibrary($h) }
