; HUKM Windows Controller one-time installer.
; Purpose: remove the need to manually unpack the inner controller ZIP.
; IMPORTANT: currently unsigned. Distribute only after real Windows testing
; and code signing. No silent autostart or uncontrolled auto-update.
#define HUKM_VERSION "1.9.5"

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
Source: "RESTORE_PREVIOUS.cmd"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\HUKM AI\Controller Status"; Filename: "{app}\hukm-controller.exe"; Parameters: "status"
Name: "{userprograms}\HUKM AI\Pair or Start Controller"; Filename: "{app}\hukm-controller.exe"
Name: "{userprograms}\HUKM AI\Restore Previous Controller"; Filename: "{app}\RESTORE_PREVIOUS.cmd"

[Run]
; Only an interactive owner installation can offer controller restart. Silent
; isolated CI smoke tests never launch a connected live controller.
Filename: "{app}\hukm-controller.exe"; Parameters: "run"; Description: "Start HUKM Windows Controller"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  CurrentExe, PreviousExe: String;
  ResultCode: Integer;
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
  if CurStep = ssPostInstall then begin
    CurrentExe := ExpandConstant('{app}\hukm-controller.exe');
    PreviousExe := ExpandConstant('{app}\hukm-controller.previous.exe');
    if (not Exec(CurrentExe, '--version', ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then begin
      if FileExists(PreviousExe) then begin
        if FileCopy(PreviousExe, CurrentExe, False) then
          Log('Version startup check failed; attempted restore of previous executable')
        else
          Log('Automatic executable restore failed; previous backup retained');
      end;
      MsgBox('Controller startup check failed. Do not start the new controller. Use local Restore Previous Controller if a backup is available. Pairing data was not intentionally changed.', mbError, MB_OK);
      Abort;
    end;
  end;
end;
