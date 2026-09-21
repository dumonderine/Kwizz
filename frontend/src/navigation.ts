import { Platform } from "react-native";

// iOS 26+ gets the native Liquid Glass tab bar; everything else uses the
// classic JS <Tabs>. Defined once and imported by the tabs layout + screens.
export const usesNativeTabs =
  Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;
