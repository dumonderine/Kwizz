import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { fonts, makeStyles, useTheme } from "@/src/theme";

type Props = {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "outline";
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  testID?: string;
  fullWidth?: boolean;
};

export function Button({
  title,
  onPress,
  variant = "primary",
  loading,
  disabled,
  icon,
  testID,
  fullWidth = true,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const bgStyle =
    variant === "primary"
      ? styles.primary
      : variant === "secondary"
      ? styles.secondary
      : styles.outline;
  const textColor =
    variant === "primary"
      ? colors.onBrandPrimary
      : variant === "secondary"
      ? colors.onBrandSecondary
      : colors.brandPrimary;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        bgStyle,
        fullWidth && { alignSelf: "stretch" },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon as any} size={18} color={textColor} /> : null}
          <Text style={[styles.text, { color: textColor }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  primary: { backgroundColor: colors.brandPrimary },
  secondary: { backgroundColor: colors.brandSecondary },
  outline: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: colors.brandPrimary },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  text: { fontSize: 16, fontFamily: fonts.bold },
}));
