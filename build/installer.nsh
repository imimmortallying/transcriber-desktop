!ifndef BUILD_UNINSTALLER
  !include "${BUILD_RESOURCES_DIR}\runtime-size.nsh"
  !include FileFunc.nsh

  Var legacyInstallLocation
  Var legacyUninstallString
  Var legacyUninstaller
  Var isExistingClientInstallation
  Var isLegacyMigration
  Var asrRootDirectory
  Var runtimeDirectory
  Var runtimeStagingDirectory
  Var runtimeBackupDirectory
  Var runtimeArchivePath
  Var runtimeArchiveSize
  Var runtimeExtractorPath
  Var runtimeExtractionExitCode
  Var runtimeExtractionOutput
  Var runtimeFailureStage
  Var runtimeFailureError
  Var runtimeCleanupUninstaller
  Var runtimeCleanupExitCode
  Var runtimeCleanupStatus
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
  !macro preInit
    Call addRuntimeSpaceRequired
  !macroend
!endif

!macro customInit
  StrCpy $isExistingClientInstallation "0"
  StrCpy $isLegacyMigration "0"
  StrCpy $asrRootDirectory ""

  ${if} $hasPerMachineInstallation == "1"
    MessageBox MB_OK|MB_ICONSTOP "A legacy all-users ASR installation was found. Remove the old all-users installation first, then run this per-user setup again."
    Quit
  ${endif}

  ReadRegStr $legacyInstallLocation HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $legacyInstallLocation == ""
    Goto done
  ${endif}

  IfFileExists "$legacyInstallLocation\resources\python\python.exe" migrateLegacyLayout existingClientLayout

  migrateLegacyLayout:
    ReadRegStr $legacyUninstallString HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${if} $legacyUninstallString == ""
      MessageBox MB_OK|MB_ICONSTOP "The legacy ASR installation is incomplete and cannot be migrated automatically. Remove it manually, then run this setup again."
      Quit
    ${endif}

    StrCpy $legacyUninstaller "$legacyInstallLocation\Uninstall ${PRODUCT_FILENAME}.exe"
    IfFileExists "$legacyUninstaller" 0 legacyUninstallFailure

    InitPluginsDir
    CopyFiles /SILENT "$legacyUninstaller" "$PLUGINSDIR\legacy-uninstaller.exe"
    IfErrors legacyUninstallFailure

    ExecWait '"$PLUGINSDIR\legacy-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --updated _?=$legacyInstallLocation' $0
    ${if} $0 != 0
      Goto legacyUninstallFailure
    ${endif}

    StrCpy $isExistingClientInstallation "1"
    StrCpy $isLegacyMigration "1"
    StrCpy $asrRootDirectory "$legacyInstallLocation"
    Goto done

  legacyUninstallFailure:
    MessageBox MB_OK|MB_ICONSTOP "The legacy ASR installation could not be removed. Remove it manually, then run this setup again."
    Quit

  existingClientLayout:
    StrCpy $isExistingClientInstallation "1"
    ${GetParent} "$legacyInstallLocation" $asrRootDirectory

  done:
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE clientDirectoryPre
  !insertmacro MUI_PAGE_DIRECTORY
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE clientInstFilesPre
!macroend

!ifndef BUILD_UNINSTALLER
  Function addRuntimeSpaceRequired
    ; electron-builder's only install section has index 0.
    SectionGetSize 0 $0
    IntOp $0 $0 + ${RUNTIME_UNPACKED_SIZE}
    SectionSetSize 0 $0
  FunctionEnd

  Function checkRuntimeArchiveSpace
    ClearErrors
    ${DriveSpace} "$PLUGINSDIR" "/D=F /S=K" $0
    IfErrors runtimeArchiveSpaceUnknown
    IntCmp $0 ${RUNTIME_ARCHIVE_SIZE} runtimeArchiveSpaceAvailable runtimeArchiveSpaceInsufficient runtimeArchiveSpaceAvailable

    runtimeArchiveSpaceUnknown:
      StrCpy $runtimeFailureStage "archive-space preflight"
      StrCpy $runtimeFailureError "Unable to determine free space on the system temporary drive for the bundled ASR Runtime."
      SetErrors
      Return

    runtimeArchiveSpaceInsufficient:
      StrCpy $runtimeFailureStage "archive-space preflight"
      StrCpy $runtimeFailureError "The system temporary drive does not have enough free space for the bundled ASR Runtime archive."
      SetErrors
      Return

    runtimeArchiveSpaceAvailable:
      ClearErrors
  FunctionEnd

  Function checkRuntimeStagingSpace
    ClearErrors
    ${DriveSpace} "$asrRootDirectory" "/D=F /S=K" $0
    IfErrors runtimeStagingSpaceUnknown
    IntCmp $0 ${RUNTIME_UNPACKED_SIZE} runtimeStagingSpaceAvailable runtimeStagingSpaceInsufficient runtimeStagingSpaceAvailable

    runtimeStagingSpaceUnknown:
      StrCpy $runtimeFailureStage "staging-space preflight"
      StrCpy $runtimeFailureError "Unable to determine free space on the selected installation drive for the ASR Runtime."
      SetErrors
      Return

    runtimeStagingSpaceInsufficient:
      StrCpy $runtimeFailureStage "staging-space preflight"
      StrCpy $runtimeFailureError "The selected installation drive does not have enough free space to stage the ASR Runtime. Reinstall requires free space for a second Runtime copy."
      SetErrors
      Return

    runtimeStagingSpaceAvailable:
      ClearErrors
  FunctionEnd

  Function cleanupFailedClientInstall
    StrCpy $runtimeCleanupStatus "Compensating Client cleanup completed. Electron user data was kept."
    SetOutPath "$PLUGINSDIR"
    StrCpy $runtimeCleanupUninstaller "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
    IfFileExists "$runtimeCleanupUninstaller" 0 runtimeCleanupUninstallerMissing

    CopyFiles /SILENT "$runtimeCleanupUninstaller" "$PLUGINSDIR\runtime-failure-uninstaller.exe"
    IfErrors runtimeCleanupCopyFailure

    ClearErrors
    ExecWait '"$PLUGINSDIR\runtime-failure-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --updated _?=$INSTDIR' $runtimeCleanupExitCode
    IfErrors runtimeCleanupLaunchFailure
    StrCmp $runtimeCleanupExitCode "0" +2
      Goto runtimeCleanupUninstallFailure
    Return

    runtimeCleanupUninstallerMissing:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller is missing."
      Return

    runtimeCleanupCopyFailure:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller could not be copied to temporary storage."
      Return

    runtimeCleanupLaunchFailure:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller could not be started."
      Return

    runtimeCleanupUninstallFailure:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller exited with code $runtimeCleanupExitCode."
  FunctionEnd

  Function clientDirectoryPre
    StrCmp $isLegacyMigration "1" 0 existingClientDirectory
    StrCpy $INSTDIR "$asrRootDirectory\Client"
    Abort

    existingClientDirectory:
    StrCmp $isExistingClientInstallation "1" 0 +2
    Abort
  FunctionEnd

  Function clientInstFilesPre
    StrCmp $asrRootDirectory "" 0 asrRootResolved
    StrCpy $asrRootDirectory "$INSTDIR"

    asrRootResolved:
    StrCpy $INSTDIR "$asrRootDirectory\Client"
  FunctionEnd
!endif

!macro customInstall
  StrCpy $runtimeDirectory "$asrRootDirectory\Runtime"
  StrCpy $runtimeStagingDirectory "$asrRootDirectory\Runtime.staging"
  StrCpy $runtimeBackupDirectory "$asrRootDirectory\Runtime.previous"

  RMDir /r "$runtimeStagingDirectory"
  RMDir /r "$runtimeBackupDirectory"

  Call checkRuntimeArchiveSpace
  IfErrors runtimeArchivePreflightFailure
  SetOutPath "$PLUGINSDIR"
  SetCompress off
  File /oname=runtime.7z "${BUILD_RESOURCES_DIR}\runtime.7z"
  File /oname=runtime-7za.exe "${BUILD_RESOURCES_DIR}\runtime-7za.exe"
  SetCompress auto

  StrCpy $runtimeArchivePath "$PLUGINSDIR\runtime.7z"
  StrCpy $runtimeExtractorPath "$PLUGINSDIR\runtime-7za.exe"
  IfFileExists "$runtimeArchivePath" 0 runtimeArchiveMissing
  IfFileExists "$runtimeExtractorPath" 0 runtimeExtractorMissing
  StrCpy $runtimeArchiveSize "${RUNTIME_ARCHIVE_SIZE}"

  Call checkRuntimeStagingSpace
  IfErrors runtimeStagingPreflightFailure
  SetOutPath "$runtimeStagingDirectory"
  IfFileExists "$runtimeStagingDirectory\NUL" 0 runtimeStagingMissing
  nsExec::ExecToStack /OEM '"$runtimeExtractorPath" x -y "-o$runtimeStagingDirectory" "$runtimeArchivePath"'
  Pop $runtimeExtractionExitCode
  Pop $runtimeExtractionOutput
  ${if} $runtimeExtractionExitCode != "0"
    Goto runtimeExtractionFailure
  ${endif}
  IfFileExists "$runtimeStagingDirectory\runtime-manifest.json" runtimeExtracted runtimePostExtractionValidationFailure

  runtimeArchivePreflightFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime installation failed.$\r$\nStage: $runtimeFailureStage$\r$\nError: $runtimeFailureError$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeStagingPreflightFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime installation failed.$\r$\nStage: $runtimeFailureStage$\r$\nError: $runtimeFailureError$\r$\n$runtimeCleanupStatus"
    Quit

  runtimePostExtractionValidationFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime post-extraction validation failed.$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\n7za.exe exit code: $runtimeExtractionExitCode$\r$\n7za.exe output: $runtimeExtractionOutput$\r$\nThe staging directory was kept for diagnostics.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeArchiveMissing:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: archive materialization$\r$\nArchive path: $runtimeArchivePath$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: runtime.7z is missing before extraction.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeExtractorMissing:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: extractor materialization$\r$\nArchive path: $runtimeArchivePath$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: bundled 7za.exe is missing before extraction.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeStagingMissing:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: staging directory creation$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: Runtime.staging was not created before extraction.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeExtractionFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime extraction failed.$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\n7za.exe exit code: $runtimeExtractionExitCode$\r$\n7za.exe output: $runtimeExtractionOutput$\r$\nThe staging directory was kept for diagnostics.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeExtracted:
    ; Runtime.staging is the current output directory after extraction. Move
    ; outside both Runtime directories before any rename or cleanup operation.
    SetOutPath "$PLUGINSDIR"
    IfFileExists "$runtimeDirectory\*.*" replaceExistingRuntime installStagedRuntime

  replaceExistingRuntime:
    Rename "$runtimeDirectory" "$runtimeBackupDirectory"
    IfErrors runtimeBackupFailure

  installStagedRuntime:
    Rename "$runtimeStagingDirectory" "$runtimeDirectory"
    IfErrors runtimeStagingPromotionFailure
    RMDir /r "$runtimeBackupDirectory"
    Goto runtimeInstalled

  runtimeStagingPromotionFailure:
    IfFileExists "$runtimeBackupDirectory\*.*" 0 runtimeStagingPromotionCleanFailure
    Rename "$runtimeBackupDirectory" "$runtimeDirectory"
    IfErrors runtimeRestoreFailure

    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed. The previous Runtime was restored.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeBackupFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed before staging activation. The existing Runtime was left unchanged.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeStagingPromotionCleanFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed while activating the staged Runtime.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeRestoreFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed and the previous Runtime could not be restored automatically.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\nPrevious Runtime backup: $runtimeBackupDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeInstalled:
!macroend
