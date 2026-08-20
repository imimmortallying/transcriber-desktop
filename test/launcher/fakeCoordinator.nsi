Unicode true
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
ShowInstDetails nevershow

!ifndef OUTPUT_PATH
  !error "OUTPUT_PATH must be defined by the launcher test."
!endif

OutFile "${OUTPUT_PATH}"

Var exitCode

Section
  ReadINIStr $exitCode "$EXEDIR\fake-coordinator.ini" "FakeCoordinator" "ExitCode"
  IfErrors fakeCoordinatorFailure
  SetErrorLevel $exitCode
  Quit

  fakeCoordinatorFailure:
    SetErrorLevel 99
SectionEnd
