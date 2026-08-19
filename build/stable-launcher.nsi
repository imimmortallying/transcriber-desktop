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
Var clientsDirectory
Var clientDirectory
Var clientName
Var clientSearchHandle
Var clientCount
Var expectedClientExecutable

!macro launchFailure exitCode message
  !ifndef ASR_LAUNCHER_TEST
    MessageBox MB_OK|MB_ICONSTOP "${message}"
  !endif
  SetErrorLevel ${exitCode}
  Quit
!macroend

Function .onInit
  StrCpy $installationRoot "$EXEDIR"
  StrCpy $clientsDirectory "$installationRoot\Clients"
  IfFileExists "$clientsDirectory\NUL" 0 noClientDirectories

  StrCpy $clientDirectory ""
  StrCpy $clientCount 0
  FindFirst $clientSearchHandle $clientName "$clientsDirectory\*"

  findClientDirectory:
    IfErrors clientDirectoriesChecked
    StrCmp $clientName "." nextClientDirectory
    StrCmp $clientName ".." nextClientDirectory
    IfFileExists "$clientsDirectory\$clientName\NUL" 0 nextClientDirectory
    IntOp $clientCount $clientCount + 1
    StrCmp $clientCount 1 recordClientDirectory multipleClientDirectories

    recordClientDirectory:
      StrCpy $clientDirectory "$clientsDirectory\$clientName"

    nextClientDirectory:
      FindNext $clientSearchHandle $clientName
      Goto findClientDirectory

  clientDirectoriesChecked:
    FindClose $clientSearchHandle
    StrCmp $clientCount 0 noClientDirectories

  StrCpy $expectedClientExecutable "$clientDirectory\local-asr-prototype.exe"
  IfFileExists "$expectedClientExecutable" expectedClientExecutableExists expectedClientExecutableMissing

  expectedClientExecutableExists:
    ${GetFileAttributes} "$expectedClientExecutable" "DIRECTORY" $0
    StrCmp $0 1 expectedClientExecutableMissing
  Return

  noClientDirectories:
    !insertmacro launchFailure 11 "ASR cannot start because no installed Client was found."

  multipleClientDirectories:
    FindClose $clientSearchHandle
    !insertmacro launchFailure 12 "ASR cannot start because multiple Client versions are installed."

  expectedClientExecutableMissing:
    !insertmacro launchFailure 13 "ASR cannot start because the installed Client is incomplete."

FunctionEnd

Section
  ClearErrors
  Exec '"$expectedClientExecutable"'
  IfErrors clientLaunchFailed
  SetErrorLevel 0
  Quit

  clientLaunchFailed:
    !insertmacro launchFailure 14 "ASR cannot start the installed Client."
SectionEnd
