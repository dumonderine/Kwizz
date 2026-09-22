import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { addMonths, isSameDay, MONTHS_FR, monthGrid, parseYmd, WEEKDAYS_FR, ymd } from "@/src/dates";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Props = { value: string; onChange: (ymd: string) => void };

// Compact month grid to pick a single day (used for J0).
export function DatePicker({ value, onChange }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const selected = parseYmd(value);
  const [month, setMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const today = new Date();

  return (
    <View style={styles.wrap} testID="date-picker">
      <View style={styles.nav}>
        <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={10} testID="dp-prev">
          <Ionicons name="chevron-back" size={22} color={colors.brandPrimary} />
        </Pressable>
        <Text style={styles.month}>
          {MONTHS_FR[month.getMonth()]} {month.getFullYear()}
        </Text>
        <Pressable onPress={() => setMonth(addMonths(month, 1))} hitSlop={10} testID="dp-next">
          <Ionicons name="chevron-forward" size={22} color={colors.brandPrimary} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {WEEKDAYS_FR.map((w) => (
          <Text key={w} style={styles.weekday}>
            {w[0].toUpperCase()}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week, i) => (
        <View key={i} style={styles.row}>
          {week.map((d) => {
            const inMonth = d.getMonth() === month.getMonth();
            const sel = isSameDay(d, selected);
            const isToday = isSameDay(d, today);
            return (
              <Pressable
                key={ymd(d)}
                style={[styles.day, sel && styles.daySel]}
                onPress={() => onChange(ymd(d))}
                testID={`dp-day-${ymd(d)}`}
              >
                <Text
                  style={[
                    styles.dayText,
                    !inMonth && { color: colors.borderStrong },
                    isToday && !sel && { color: colors.brandPrimary, fontFamily: fonts.extrabold },
                    sel && { color: colors.onBrandPrimary },
                  ]}
                >
                  {d.getDate()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { backgroundColor: colors.surfaceSecondary, borderRadius: 14, padding: 8, borderWidth: 1, borderColor: colors.border },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 6 },
  month: { fontSize: 15, fontFamily: fonts.bold, color: colors.onSurface, textTransform: "capitalize" },
  row: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 11, fontFamily: fonts.bold, color: colors.muted, paddingVertical: 4 },
  day: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 999, maxHeight: 40 },
  daySel: { backgroundColor: colors.brandPrimary },
  dayText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
}));
