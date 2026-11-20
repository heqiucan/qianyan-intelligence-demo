$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($request.action -eq 'voices') {
        $voices = @($synth.GetInstalledVoices() | Where-Object Enabled | ForEach-Object {
            @{ id = $_.VoiceInfo.Name; name = $_.VoiceInfo.Name; language = $_.VoiceInfo.Culture.Name; gender = $_.VoiceInfo.Gender.ToString() }
        })
        ConvertTo-Json -InputObject $voices -Compress
    } elseif ($request.action -eq 'synthesize') {
        $synth.SelectVoice([string]$request.voice)
        $synth.Rate = [int]$request.rate
        $synth.Volume = [int]$request.volume
        $synth.SetOutputToWaveFile([string]$request.output)
        $synth.Speak([string]$request.text)
        $synth.SetOutputToNull()
        '{"ok":true}'
    } else { throw 'Unsupported action' }
} finally { $synth.Dispose() }
