Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

!include FileFunc.nsh

!ifndef OUTPUT_PATH
  !error "OUTPUT_PATH must be defined by the launcher build."
!endif

Name "ASR launcher"
OutFile "${OUTPUT_PATH}"

Var installationRoot
Var coordinatorDirectory
Var coordinatorExecutable
Var coordinatorExitCode

!macro launchFailure exitCode message
  !ifndef ASR_LAUNCHER_TEST
    MessageBox MB_OK|MB_ICONSTOP "${message}"
  !endif
  SetErrorLevel ${exitCode}
  Quit
!macroend

Function .onInit
  StrCpy $installationRoot "$EXEDIR"
  StrCpy $coordinatorDirectory "$installationRoot\Coordinator"
  StrCpy $coordinatorExecutable "$coordinatorDirectory\asr-coordinator.exe"

  IfFileExists "$installationRoot\NUL" rootDirectoryExists coordinatorMissing

  rootDirectoryExists:
    ClearErrors
    ${GetFileAttributes} "$installationRoot" "DIRECTORY" $0
    IfErrors coordinatorTargetUnsafe
    StrCmp $0 1 rootDirectoryTypeValid coordinatorTargetUnsafe

  rootDirectoryTypeValid:
    ClearErrors
    ${GetFileAttributes} "$installationRoot" "REPARSE_POINT" $0
    IfErrors coordinatorTargetUnsafe
    StrCmp $0 1 coordinatorTargetUnsafe coordinatorDirectoryCheck

  coordinatorDirectoryCheck:
    IfFileExists "$coordinatorDirectory" coordinatorDirectoryExists coordinatorMissing

  coordinatorDirectoryExists:
    ClearErrors
    ${GetFileAttributes} "$coordinatorDirectory" "DIRECTORY" $0
    IfErrors coordinatorTargetUnsafe
    StrCmp $0 1 coordinatorDirectoryTypeValid coordinatorTargetUnsafe

  coordinatorDirectoryTypeValid:
    ClearErrors
    ${GetFileAttributes} "$coordinatorDirectory" "REPARSE_POINT" $0
    IfErrors coordinatorTargetUnsafe
    StrCmp $0 1 coordinatorTargetUnsafe coordinatorExecutableCheck

  coordinatorExecutableCheck:
    IfFileExists "$coordinatorExecutable" coordinatorExecutableExists coordinatorMissing

  coordinatorExecutableExists:
    ClearErrors
    ${GetFileAttributes} "$coordinatorExecutable" "DIRECTORY" $0
    IfErrors coordinatorTargetUnsafe
    StrCmp $0 1 coordinatorTargetUnsafe coordinatorExecutableTypeValid

  coordinatorExecutableTypeValid:
    ClearErrors
    ${GetFileAttributes} "$coordinatorExecutable" "REPARSE_POINT" $0
    IfErrors coordinatorTargetUnsafe
    StrCmp $0 1 coordinatorTargetUnsafe coordinatorTargetValidated

  coordinatorTargetValidated:
  Return

  coordinatorMissing:
    !insertmacro launchFailure 20 "ASR cannot start because its Coordinator is missing or incomplete."

  coordinatorTargetUnsafe:
    !insertmacro launchFailure 21 "ASR cannot start because its Coordinator location cannot be used safely."

FunctionEnd

Section
  ClearErrors
  ExecWait '"$coordinatorExecutable"' $coordinatorExitCode
  IfErrors coordinatorLaunchFailed
  StrCmp $coordinatorExitCode "0" coordinatorLaunchSucceeded
  StrCmp $coordinatorExitCode "10" coordinatorInvalidGeometry
  StrCmp $coordinatorExitCode "11" coordinatorStateAbsent
  StrCmp $coordinatorExitCode "12" coordinatorNoRecoverableState
  StrCmp $coordinatorExitCode "13" coordinatorUnsupportedState
  StrCmp $coordinatorExitCode "14" coordinatorUninspectableState
  StrCmp $coordinatorExitCode "15" coordinatorAmbiguousState
  StrCmp $coordinatorExitCode "16" selectedClientUnavailable
  StrCmp $coordinatorExitCode "17" selectedClientUnsafe
  StrCmp $coordinatorExitCode "18" selectedClientProcessFailed
  StrCmp $coordinatorExitCode "19" coordinatorUnexpectedFailure
  !insertmacro launchFailure 23 "ASR cannot start because its Coordinator returned an unknown result."

  coordinatorLaunchSucceeded:
    SetErrorLevel 0
    Quit

  coordinatorInvalidGeometry:
    !insertmacro launchFailure 10 "ASR launch infrastructure is invalid. Restore or reinstall ASR."

  coordinatorStateAbsent:
    !insertmacro launchFailure 11 "ASR installation state is missing. Run Full Setup to repair ASR."

  coordinatorNoRecoverableState:
    !insertmacro launchFailure 12 "ASR installation state cannot identify a usable Client. Run Full Setup to repair ASR."

  coordinatorUnsupportedState:
    !insertmacro launchFailure 13 "ASR installation state requires a matching or newer Full Setup."

  coordinatorUninspectableState:
    !insertmacro launchFailure 14 "ASR installation state cannot be inspected safely. Restore ASR from a trusted installation."

  coordinatorAmbiguousState:
    !insertmacro launchFailure 15 "ASR installation state is conflicting. Run Full Setup to repair ASR."

  selectedClientUnavailable:
    !insertmacro launchFailure 16 "The selected ASR Client is missing or incomplete. Restore it with the matching Full Setup."

  selectedClientUnsafe:
    !insertmacro launchFailure 17 "The selected ASR Client cannot be used safely. Do not launch another Client manually."

  selectedClientProcessFailed:
    !insertmacro launchFailure 18 "The selected ASR Client could not be started. Try again or restore ASR with Full Setup."

  coordinatorUnexpectedFailure:
    !insertmacro launchFailure 19 "ASR Coordinator failed unexpectedly. Try again or restore ASR with Full Setup."

  coordinatorLaunchFailed:
    !insertmacro launchFailure 22 "ASR cannot start its Coordinator."
SectionEnd
