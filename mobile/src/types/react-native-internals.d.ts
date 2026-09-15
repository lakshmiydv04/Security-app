/**
 * React Native ships no public API for "where is the Metro dev server?", but
 * getDevServer is what RN itself uses internally (LogBox, DevSettings) and it
 * reads the TurboModule spec, so it works under the new architecture where the
 * legacy NativeModules.SourceCode proxy does not exist.
 */
declare module 'react-native/Libraries/Core/Devtools/getDevServer' {
  interface DevServerInfo {
    /** Dev server URL with a trailing slash, e.g. "http://192.168.0.5:8081/". */
    url: string;
    fullBundleUrl: string | null;
    /** False when running from a packaged bundle rather than Metro. */
    bundleLoadedFromServer: boolean;
  }
  const getDevServer: () => DevServerInfo;
  export default getDevServer;
}
