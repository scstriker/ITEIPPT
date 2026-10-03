Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

function Ensure-NodeInPath {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    return
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($env:ProgramFiles) {
    [void]$candidates.Add((Join-Path $env:ProgramFiles 'nodejs'))
  }
  if ($env:LOCALAPPDATA) {
    [void]$candidates.Add((Join-Path $env:LOCALAPPDATA 'nvm\nodejs'))
  }
  if ($env:USERPROFILE) {
    [void]$candidates.Add((Join-Path $env:USERPROFILE 'tools\node-v20.20.2-win-x64'))
    try {
      Get-ChildItem -Path (Join-Path $env:USERPROFILE 'tools') -Directory -Filter 'node-v*-win-x64' -ErrorAction Stop |
        ForEach-Object { [void]$candidates.Add($_.FullName) }
    } catch {
      # Ignore if tools folder does not exist.
    }
  }
  if ($env:NVM_SYMLINK) {
    [void]$candidates.Add($env:NVM_SYMLINK)
  }
  $userNvmSym = [Environment]::GetEnvironmentVariable('NVM_SYMLINK', 'User')
  if ($userNvmSym) {
    [void]$candidates.Add($userNvmSym)
  }
  if (Test-Path 'C:\nvm4w\nodejs') {
    [void]$candidates.Add('C:\nvm4w\nodejs')
  }
  $userNvmHome = [Environment]::GetEnvironmentVariable('NVM_HOME', 'User')
  if ($userNvmHome) {
    [void]$candidates.Add($userNvmHome)
  }
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($userPath) {
    foreach ($segment in ($userPath -split ';')) {
      if (-not [string]::IsNullOrWhiteSpace($segment)) {
        [void]$candidates.Add($segment.Trim())
      }
    }
  }

  $valid = $candidates |
    Where-Object {
      $_ -and
      (Test-Path $_) -and
      (Test-Path (Join-Path $_ 'node.exe'))
    } |
    Select-Object -Unique
  if ($valid -and $valid.Count -gt 0) {
    $env:Path = (($valid -join ';') + ';' + $env:Path)
  }
}

Ensure-NodeInPath

$issues = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$projectId = ''
$nodeVersion = ''
$npmVersion = ''
$firebaseVersion = ''
$firebaseCliReady = $false
$firebaseLoginReady = $false

Write-Host '[1/9] 检查 Node.js / npm 版本...'
try {
  $nodeVersion = (& node -v).Trim()
} catch {
  $issues.Add('未检测到 Node.js，请先安装 Node.js 20.x。')
}
try {
  $npmVersion = (& npm -v).Trim()
} catch {
  $issues.Add('未检测到 npm。')
}
if ($nodeVersion) {
  $nodeMajor = [int](($nodeVersion -replace '^v', '').Split('.')[0])
  if ($nodeMajor -ne 20) {
    $warnings.Add("当前 Node 版本为 $nodeVersion，functions 引擎要求 Node 20。部署前建议切换到 Node 20。")
  }
}

Write-Host '[2/9] 检查 Firebase CLI...'
$firebaseCmd = Get-Command firebase -ErrorAction SilentlyContinue
if (-not $firebaseCmd) {
  $issues.Add('未检测到 Firebase CLI，请执行 npm install -g firebase-tools。')
} else {
  try {
    $firebaseVersion = (& firebase --version).Trim()
    $firebaseCliReady = $true
  } catch {
    $issues.Add('Firebase CLI 调用失败（可能找不到 node.exe）。请确认 Node 已加入 PATH。')
  }
}

Write-Host '[3/9] 检查 Firebase 登录状态...'
if ($firebaseCliReady) {
  $loginOutput = (& firebase login:list 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $loginOutput -match 'No authorized accounts') {
    $issues.Add('Firebase 未登录。请执行 firebase login。')
  } else {
    $firebaseLoginReady = $true
  }
}

Write-Host '[4/9] 检查 .firebaserc 项目绑定...'
if (-not (Test-Path '.firebaserc')) {
  $issues.Add('缺少 .firebaserc。请从 .firebaserc.example 复制并填入真实 projectId。')
} else {
  try {
    $firebaserc = Get-Content -Raw '.firebaserc' | ConvertFrom-Json
    $projectId = [string]$firebaserc.projects.default
  } catch {
    $issues.Add('.firebaserc 不是有效 JSON。')
  }
  if ([string]::IsNullOrWhiteSpace($projectId) -or $projectId -eq '<your-firebase-project-id>') {
    $issues.Add('.firebaserc 未配置有效 default projectId。')
  }
}

Write-Host '[5/9] 检查 firebase.json 关键配置...'
if (-not (Test-Path 'firebase.json')) {
  $issues.Add('缺少 firebase.json。')
} else {
  try {
    $firebaseJson = Get-Content -Raw 'firebase.json' | ConvertFrom-Json

    if (-not $firebaseJson.functions -or $firebaseJson.functions.source -ne 'functions') {
      $issues.Add('firebase.json: functions.source 必须是 "functions"。')
    }

    if (-not $firebaseJson.hosting -or $firebaseJson.hosting.public -ne 'src/dist') {
      $issues.Add('firebase.json: hosting.public 必须是 "src/dist"。')
    }

    $hasApiRewrite = $false
    foreach ($rule in @($firebaseJson.hosting.rewrites)) {
      if ($rule.source -eq '/api/**' -and $rule.function -eq 'api') {
        $hasApiRewrite = $true
        break
      }
    }
    if (-not $hasApiRewrite) {
      $issues.Add('firebase.json: 缺少 "/api/** -> function api" rewrite。')
    }
  } catch {
    $issues.Add('firebase.json 不是有效 JSON。')
  }
}

Write-Host '[6/9] 检查后端入口与环境模板...'
if (-not (Test-Path 'functions/src/index.ts')) {
  $issues.Add('缺少 functions/src/index.ts。')
} else {
  $hasApiExport = Select-String -Path 'functions/src/index.ts' -Pattern 'export\s+const\s+api\s*=\s*onRequest' -Quiet
  if (-not $hasApiExport) {
    $issues.Add('functions/src/index.ts 未发现 "export const api = onRequest(...)"。')
  }
}
if (-not (Test-Path 'functions/.env.example')) {
  $issues.Add('缺少 functions/.env.example。')
}
if (-not (Test-Path 'functions/.env')) {
  $warnings.Add('缺少 functions/.env；将使用平台默认环境变量。')
} else {
  $envContent = Get-Content -Raw 'functions/.env'
  if ($envContent -notmatch '^\s*GENERATION_JOB_BUCKET\s*=' -and $envContent -notmatch '\n\s*GENERATION_JOB_BUCKET\s*=') {
    $warnings.Add('functions/.env 未配置 GENERATION_JOB_BUCKET，异步任务结果将写入默认 bucket（可能未初始化）。')
  }
}

Write-Host '[7/9] 前端构建检查（src）...'
if (-not (Test-Path 'src/package.json')) {
  $issues.Add('缺少 src/package.json。')
} else {
  Push-Location 'src'
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    $issues.Add('src 构建失败（npm run build）。')
  }
  Pop-Location
}

Write-Host '[8/9] 后端构建检查（functions）...'
if (-not (Test-Path 'functions/package.json')) {
  $issues.Add('缺少 functions/package.json。')
} else {
  Push-Location 'functions'
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    $issues.Add('functions 构建失败（npm run build）。')
  }
  Pop-Location
}

Write-Host '[9/9] 检查 GEMINI_API_KEY Secret...'
if ($firebaseCliReady -and $firebaseLoginReady -and -not [string]::IsNullOrWhiteSpace($projectId)) {
  $secretOutput = (& firebase functions:secrets:list --project $projectId 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    $warnings.Add('无法读取 Functions Secret 列表，请确认账号权限和项目配置。')
  } elseif ($secretOutput -notmatch 'GEMINI_API_KEY') {
    $issues.Add('目标项目未检测到 Secret: GEMINI_API_KEY。')
  }
}

Write-Host ''
Write-Host '====== Firebase 云端部署预检查结果 ======'
Write-Host ("Repo: " + $repoRoot)
if ($nodeVersion) { Write-Host ("Node: " + $nodeVersion) }
if ($npmVersion) { Write-Host ("npm: " + $npmVersion) }
if ($firebaseVersion) { Write-Host ("Firebase CLI: " + $firebaseVersion) }
if ($projectId) { Write-Host ("Firebase Project: " + $projectId) }

if ($warnings.Count -gt 0) {
  Write-Host ''
  Write-Host '警告：'
  foreach ($warning in $warnings) {
    Write-Host ("- " + $warning)
  }
}

if ($issues.Count -gt 0) {
  Write-Host ''
  Write-Host '未通过项：'
  foreach ($issue in $issues) {
    Write-Host ("- " + $issue)
  }
  Write-Host ''
  Write-Host '状态：NOT READY（请先修复以上问题再执行 firebase deploy）'
  exit 1
}

Write-Host ''
Write-Host '状态：READY（可执行 firebase deploy --only hosting,functions）'
exit 0
