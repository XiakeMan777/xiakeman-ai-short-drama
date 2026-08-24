export const BUILD_INFO = {
  version: __APP_VERSION__,
  buildTime: __BUILD_TIME__,
  buildLabel: __BUILD_LABEL__,
  buildTimeShort: __BUILD_TIME__.slice(5),
} as const
