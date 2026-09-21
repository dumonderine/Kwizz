import { Tabs } from "expo-router";
import { Platform, useWindowDimensions } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { usesNativeTabs } from "@/src/navigation";
import { fonts, useTheme } from "@/src/theme";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // On iPad / large screens the navigation lives on the LEFT as a side rail.
  if (usesNativeTabs && !isTablet) {
    const { NativeTabs } = require("expo-router/unstable-native-tabs");
    return (
      <NativeTabs>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon sf="folder.fill" />
          <NativeTabs.Trigger.Label>Dossiers</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="review">
          <NativeTabs.Trigger.Icon sf="arrow.clockwise.circle.fill" />
          <NativeTabs.Trigger.Label>À revoir</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile">
          <NativeTabs.Trigger.Icon sf="person.fill" />
          <NativeTabs.Trigger.Label>Profil</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarPosition: isTablet ? "left" : "bottom",
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderRightColor: colors.border,
          ...(Platform.OS === "web" && !isTablet ? { height: 64 } : {}),
          ...(isTablet ? { width: 240 } : {}),
        },
        tabBarItemStyle: isTablet ? undefined : { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: isTablet ? 14 : 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dossiers",
          tabBarIcon: ({ color, size }) => <Ionicons name="folder" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: "À revoir",
          tabBarIcon: ({ color, size }) => <Ionicons name="refresh-circle" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profil",
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
