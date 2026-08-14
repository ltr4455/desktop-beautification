!include "LogicLib.nsh"

; 安装新版前强制结束旧进程，并清空旧程序目录。
; 用户数据位于 %APPDATA%\FlowDesk，不在 $INSTDIR 中，因此不会被删除。
!macro customInit
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "${APP_EXECUTABLE_FILENAME}"'
  Sleep 600

  ; 双重校验，避免在安装目录被错误配置时误删其他目录。
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${AndIf} ${FileExists} "$INSTDIR\resources\app.asar"
    DetailPrint "正在清理旧版本安装目录：$INSTDIR"
    RMDir /r "$INSTDIR"

    ; electron-builder 默认会在稍后的安装阶段调用旧卸载器。
    ; 旧目录已被完整清除，因此同时移除旧安装记录，避免再次调用已删除的卸载器。
    DeleteRegKey HKLM "${INSTALL_REGISTRY_KEY}"
    DeleteRegKey HKLM "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
    DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  ${EndIf}
!macroend
