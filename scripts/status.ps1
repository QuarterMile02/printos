<#
.SYNOPSIS
  Read-only status check for the ShopVOX capture pipeline.

.DESCRIPTION
  Reports queue progress (done/pending/failed/total, percent), whether the
  capture process is alive (pid, elapsed, RAM), current rate and estimated
  hours remaining (derived from the last two drain_progress samples in
  _memory_log.jsonl — NOT from total done over process elapsed time, which
  is wrong once `done` includes earlier runs), the last 5 memory samples,
  the last 3 supervisor log entries, and queue/current timestamps.

  This script is READ-ONLY. It never writes, restarts, or touches anything.
  queue.jsonl is opened with FileShare ReadWrite+Delete so it never blocks
  the capture process's own rename-based checkpoint writes.

.USAGE
  & "C:\printos\scripts\status.ps1"
#>

$ErrorActionPreference = 'Stop'

$root          = 'C:\printos'
$queuePath     = Join-Path $root 'scripts\queue\queue.jsonl'
$memoryLog     = Join-Path $root 'scripts\capture\_memory_log.jsonl'
$supervisorLog = Join-Path $root 'scripts\capture\_supervisor_log.jsonl'

function Read-AllLinesShared {
    param([string]$Path)

    $result = New-Object System.Collections.Generic.List[string]
    if (-not (Test-Path $Path)) { return $result }

    $fs = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        ([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
    )
    try {
        $reader = New-Object System.IO.StreamReader($fs)
        try {
            while (-not $reader.EndOfStream) {
                $line = $reader.ReadLine()
                if (-not [string]::IsNullOrWhiteSpace($line)) { $result.Add($line) }
            }
        } finally {
            $reader.Dispose()
        }
    } finally {
        $fs.Dispose()
    }
    return $result
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "== $Title ==" -ForegroundColor Cyan
}

$now = Get-Date
Write-Host "ShopVOX capture status - $now" -ForegroundColor White

# ---------------------------------------------------------------------------
# Queue counts
# ---------------------------------------------------------------------------
Write-Section "Queue (queue.jsonl)"

$done    = 0
$pending = 0
$failed  = 0
$skipped = 0
$other   = 0
$total   = 0
$queueLastWrite = $null

if (Test-Path $queuePath) {
    $queueLastWrite = (Get-Item $queuePath).LastWriteTime
    $queueLines = Read-AllLinesShared -Path $queuePath

    foreach ($line in $queueLines) {
        $total++
        if ($line -match '"status"\s*:\s*"done"') { $done++ }
        elseif ($line -match '"status"\s*:\s*"pending"') { $pending++ }
        elseif ($line -match '"status"\s*:\s*"failed"') { $failed++ }
        elseif ($line -match '"status"\s*:\s*"skipped"') { $skipped++ }
        else { $other++ }
    }

    $percent = 0
    if ($total -gt 0) { $percent = [math]::Round(($done / $total) * 100, 2) }

    Write-Host ("  done:    {0}" -f $done)
    Write-Host ("  pending: {0}" -f $pending)
    Write-Host ("  failed:  {0}" -f $failed)
    if ($skipped -gt 0) { Write-Host ("  skipped: {0}" -f $skipped) }
    if ($other -gt 0)   { Write-Host ("  other (unrecognized status): {0}" -f $other) }
    Write-Host ("  total:   {0}" -f $total)
    Write-Host ("  percent done: {0}%" -f $percent)
    Write-Host ("  queue last write: {0}" -f $queueLastWrite)
} else {
    Write-Host "  queue.jsonl not found at $queuePath" -ForegroundColor Yellow
}

Write-Host ("  current time:     {0}" -f $now)

# ---------------------------------------------------------------------------
# Capture process
# ---------------------------------------------------------------------------
Write-Section "Capture process"

$captureProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*shopvox-capture.mjs*' }

if ($captureProcs) {
    foreach ($cp in $captureProcs) {
        $proc = $null
        try { $proc = Get-Process -Id $cp.ProcessId -ErrorAction Stop } catch {}

        $startTime = $null
        if ($proc -and $proc.StartTime) { $startTime = $proc.StartTime }
        elseif ($cp.CreationDate) { $startTime = $cp.CreationDate }

        $elapsedStr = 'unknown'
        if ($startTime) {
            $elapsed = $now - $startTime
            $elapsedStr = "{0:dd}d {0:hh}h {0:mm}m {0:ss}s" -f $elapsed
        }

        $ramMb = 'unknown'
        if ($proc) { $ramMb = [math]::Round($proc.WorkingSet64 / 1MB, 1) }

        Write-Host ("  RUNNING - pid {0}, started {1}, elapsed {2}, RAM {3} MB" -f `
            $cp.ProcessId, $startTime, $elapsedStr, $ramMb) -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "  *** CAPTURE PROCESS IS NOT RUNNING ***" -ForegroundColor Red -BackgroundColor Black
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Memory log (used for both rate/ETA and the last-5-samples section)
# ---------------------------------------------------------------------------
$memoryLines = Read-AllLinesShared -Path $memoryLog

# ---------------------------------------------------------------------------
# Rate / ETA - derived from the last two drain_progress entries in
# _memory_log.jsonl. Deliberately NOT total-done-over-process-elapsed-time:
# `done` includes earlier runs, so that math would overstate the true
# current rate.
# ---------------------------------------------------------------------------
Write-Section "Rate / ETA"

if ($memoryLines.Count -gt 0) {
    $progressEntries = @()
    foreach ($l in $memoryLines) {
        try {
            $obj = $l | ConvertFrom-Json
            if ($obj.label -eq 'drain_progress') { $progressEntries += $obj }
        } catch {}
    }

    if ($progressEntries.Count -ge 2) {
        $last = $progressEntries[$progressEntries.Count - 1]
        $prev = $progressEntries[$progressEntries.Count - 2]
        $t1 = [datetime]$prev.ts
        $t2 = [datetime]$last.ts
        $dtHours    = ($t2 - $t1).TotalHours
        $dProcessed = $last.processed - $prev.processed

        if ($dtHours -gt 0 -and $dProcessed -ge 0) {
            $ratePerHour = $dProcessed / $dtHours
            Write-Host ("  rate: {0:N1} records/hour  (processed {1} -> {2}, +{3} over {4:N2} h)" -f `
                $ratePerHour, $prev.processed, $last.processed, $dProcessed, $dtHours)

            if ($ratePerHour -gt 0) {
                $hoursRemaining = $pending / $ratePerHour
                Write-Host ("  est. hours remaining: {0:N1} h  ({1} pending / rate)" -f $hoursRemaining, $pending)
            } else {
                Write-Host "  est. hours remaining: n/a (rate is zero)"
            }
        } else {
            Write-Host "  rate: n/a (insufficient time delta between last two drain_progress samples)"
        }
    } else {
        Write-Host "  rate: n/a (fewer than 2 drain_progress entries in _memory_log.jsonl)"
    }
} else {
    Write-Host "  _memory_log.jsonl not found or empty at $memoryLog" -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Last 5 memory samples
# ---------------------------------------------------------------------------
Write-Section "Last 5 memory samples (_memory_log.jsonl)"

if ($memoryLines.Count -gt 0) {
    $tail5 = $memoryLines | Select-Object -Last 5
    foreach ($l in $tail5) {
        try {
            $o = $l | ConvertFrom-Json
            Write-Host ("  {0}  {1,-15} rss={2}MB heap={3}/{4}MB processed={5} failed={6}" -f `
                $o.ts, $o.label, $o.rssMb, $o.heapUsedMb, $o.heapTotalMb, $o.processed, $o.failed)
        } catch {
            Write-Host "  $l"
        }
    }
} else {
    Write-Host "  (no memory log found)"
}

# ---------------------------------------------------------------------------
# Last 3 supervisor log entries
# ---------------------------------------------------------------------------
Write-Section "Last 3 supervisor log entries (_supervisor_log.jsonl)"

$supervisorLines = Read-AllLinesShared -Path $supervisorLog

if ($supervisorLines.Count -gt 0) {
    $tail3 = $supervisorLines | Select-Object -Last 3
    foreach ($l in $tail3) {
        Write-Host "  $l"
    }
} else {
    Write-Host "  (no supervisor log found)"
}

Write-Host ""
