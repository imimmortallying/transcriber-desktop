Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

!ifndef OUTPUT_PATH
  !error "OUTPUT_PATH must be defined by the Coordinator SEA test."
!endif

OutFile "${OUTPUT_PATH}"

Function .onInit
  SetSilent silent
FunctionEnd

Section
  FileOpen $0 "$EXEDIR\CLIENT_LAUNCHED.txt" w
  IfErrors markerWriteFailed
  FileWrite $0 "selected Client launched$\r$\n"
  FileClose $0
  SetErrorLevel 0
  Quit

  markerWriteFailed:
    SetErrorLevel 1
SectionEnd
