# gkbench 命令行工具的安装脚本（Windows PowerShell）。
#
#   irm https://hiro.matto.top/gkbench/install.ps1 | iex
#
# 把 gkbench.exe 下载到 %USERPROFILE%\.local\bin，核对 SHA-256，并把这个目录加进当前用户的 PATH。
$ErrorActionPreference = 'Stop'
$base = if ($env:GKBENCH_SERVER) { $env:GKBENCH_SERVER.TrimEnd('/') } else { 'https://hiro.matto.top/gkbench' }
$dir = if ($env:GKBENCH_INSTALL_DIR) { $env:GKBENCH_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.local\bin' }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$name = "gkbench-windows-$arch.exe"

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$tmp = Join-Path $env:TEMP "gkbench-$PID.exe"
Write-Host "下载 $base/cli/$name"
Invoke-WebRequest -UseBasicParsing "$base/cli/$name" -OutFile $tmp
$sums = (Invoke-WebRequest -UseBasicParsing "$base/cli/SHA256SUMS").Content
$want = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($name))\s*$" }) -replace '\s.*$', ''
$got = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
if ($want -and $got -ne $want.Trim().ToLower()) {
    Remove-Item $tmp
    throw "校验和对不上，没有安装（下载到的 $got，应是 $want）"
}
Move-Item -Force $tmp (Join-Path $dir 'gkbench.exe')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $dir) {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$dir", 'User')
    $env:Path = "$env:Path;$dir"
    Write-Host "已把 $dir 加进用户 PATH（新开的终端生效）"
}
Write-Host "装好了：$(Join-Path $dir 'gkbench.exe')（$(& (Join-Path $dir 'gkbench.exe') version)）"
Write-Host '下一步：gkbench login'
