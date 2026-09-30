; Per-user Windows installer for release\AccountSwitch.exe (built by `npm run build:installer`).
; Needs no administrator rights. Uninstalling never removes %LOCALAPPDATA%\AccountSwitch: after a
; switch it holds the user's original CLI login (profiles\default-<service>).

#ifndef AppVersion
  #error Pass the version: ISCC /DAppVersion=x.y.z AccountSwitch.iss
#endif

[Setup]
AppId={{7E0F3C52-9B6A-4E0B-A7C1-3F2D8B5E6A41}
AppName=AccountSwitch
AppVersion={#AppVersion}
AppPublisher=hongikarchi
AppPublisherURL=https://github.com/hongikarchi/AccountSwitch
AppSupportURL=https://github.com/hongikarchi/AccountSwitch/issues
DefaultDirName={localappdata}\Programs\AccountSwitch
DefaultGroupName=AccountSwitch
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\release
OutputBaseFilename=AccountSwitch-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\LICENSE
UninstallDisplayIcon={app}\AccountSwitch.exe
CloseApplications=yes

[Languages]
#if FileExists(CompilerPath + "Languages\Korean.isl")
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
#endif
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\release\AccountSwitch.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\AccountSwitch"; Filename: "{app}\AccountSwitch.exe"
Name: "{group}\{cm:UninstallProgram,AccountSwitch}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\AccountSwitch"; Filename: "{app}\AccountSwitch.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\AccountSwitch.exe"; Description: "{cm:LaunchProgram,AccountSwitch}"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeUninstall(): Boolean;
begin
  Result := True;
  if not UninstallSilent() then
    Result := MsgBox(
      'AccountSwitch에서 다른 계정을 "사용" 중이라면, 삭제하기 전에 "기존 CLI 로그인"을 다시 "사용"해 원래 로그인으로 되돌리세요.' + #13#10 + #13#10 +
      '계정 데이터(%LOCALAPPDATA%\AccountSwitch)는 지우지 않고 남겨 둡니다.' + #13#10 + #13#10 +
      '계속 삭제할까요?',
      mbConfirmation, MB_YESNO) = IDYES;
end;
