; HUKM Windows Controller one-time installer.
; Purpose: remove the need to manually unpack the inner controller ZIP.
; IMPORTANT: currently unsigned. Distribute only after real Windows testing
; and code signing. No silent autostart or uncontrolled auto-update.
#define HUKM_VERSION "1.8.4"

[Setup]
AppId=HUKM.AI.Personal.WindowsController
AppName=HUKM AI Windows Controller
AppVersion={#HUKM_VERSION}
AppVerName=HUKM AI Controller v{#HUKM_VERSION}
UninstallDisplayName=HUKM AI Windows Controller
DefaultDirName={localappdata}\HUKM AI\Controller
DefaultGroupName=HUKM AI
DisableDirPage=yes
DisableProgramGroupPage=yes
UsePreviousAppDir=no
PrivilegesRequired=lowest
OutputDir=..\..\..
OutputBaseFilename=HUKM-Setup-v{#HUKM_VERSION}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
RestartApplications=no
CloseApplications=yes
Uninstallable=yes

[Files]
Source: "..\dist\hukm-controller.exe"; DestDir: "{app}"; DestName: "hukm-controller.exe"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\HUKM AI\Controller Status"; Filename: "{app}\hukm-controller.exe"; Parameters: "status"
Name: "{userprograms}\HUKM AI\Pair Controller"; Filename: "{app}\hukm-controller.exe"; Parameters: "pair"

[Run]
; Only an interactive owner installation can offer controller restart. Silent
; isolated CI smoke tests never launch a connected live controller.
Filename: "{app}\hukm-controller.exe"; Parameters: "run"; Description: "Start HUKM Windows Controller"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  CurrentExe, PreviousExe: String;
begin
  if CurStep = ssInstall then begin
    CurrentExe := ExpandConstant('{app}\hukm-controller.exe');
    PreviousExe := ExpandConstant('{app}\hukm-controller.previous.exe');
    if FileExists(CurrentExe) then begin
      if not FileCopy(CurrentExe, PreviousExe, False) then begin
        MsgBox('Please close the HUKM Controller before updating. The previous executable could not be backed up, so installation will stop.', mbError, MB_OK);
        Abort;
      end;
    end;
  end;
end;
