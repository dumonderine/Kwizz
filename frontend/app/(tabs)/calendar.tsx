import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { addDays, addMonths, isSameDay, longDate, MONTHS_FR, monthGrid, WEEKDAYS_FR, weekDays, ymd } from "@/src/dates";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type JEvent = {
  id: string;
  date: string;
  offset: number;
  label: string;
  folder_id: string;
  folder_name: string;
  topic_name: string;
  color: string;
};

type Mode = "month" | "week";

export default function CalendarScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<Mode>("month");
  const [anchor, setAnchor] = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [selected, setSelected] = useState<Date>(today);

  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const week = useMemo(() => weekDays(anchor), [anchor]);
  const rangeStart = mode === "month" ? grid[0][0] : week[0];
  const rangeEnd = mode === "month" ? grid[5][6] : week[6];

  const eventsQ = useQuery({
    queryKey: ["j-events", ymd(rangeStart), ymd(rangeEnd)],
    queryFn: () => apiFetch<JEvent[]>(`/j/events?start=${ymd(rangeStart)}&end=${ymd(rangeEnd)}`),
  });
  const schedulesQ = useQuery({
    queryKey: ["j-schedules"],
    queryFn: () => apiFetch<{ id: string }[]>("/j/schedules"),
  });

  const byDay = useMemo(() => {
    const m: Record<string, JEvent[]> = {};
    for (const e of eventsQ.data ?? []) (m[e.date] ||= []).push(e);
    return m;
  }, [eventsQ.data]);

  const dayEvents = byDay[ymd(selected)] ?? [];
  const maxRows = isTablet ? 5 : 3;
  const cellH = isTablet ? 128 : 84;

  const go = (dir: -1 | 1) => {
    setAnchor(mode === "month" ? addMonths(anchor, dir) : addDays(anchor, dir * 7));
  };
  const goToday = () => {
    setAnchor(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    setSelected(today);
  };

  const title =
    mode === "month"
      ? `${MONTHS_FR[anchor.getMonth()]} ${anchor.getFullYear()}`
      : `${week[0].getDate()} – ${week[6].getDate()} ${MONTHS_FR[week[6].getMonth()]} ${week[6].getFullYear()}`;

  const EventLine = ({ e, big }: { e: JEvent; big?: boolean }) => (
    <View style={styles.evLine}>
      <View style={[styles.evBar, { backgroundColor: e.color }]} />
      <Text style={[styles.evText, big && styles.evTextBig]} numberOfLines={big ? 2 : 1}>
        <Text style={styles.evLabel}>{e.label} </Text>
        {e.folder_name}
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.eyebrow}>MÉTHODE DES J</Text>
            <Text style={styles.h1}>Calendrier</Text>
          </View>
          <View style={styles.segment} testID="calendar-mode-segment">
            {(["month", "week"] as Mode[]).map((m) => (
              <Pressable
                key={m}
                style={[styles.segBtn, mode === m && styles.segBtnActive]}
                onPress={() => setMode(m)}
                testID={`calendar-mode-${m}`}
              >
                <Text style={[styles.segText, mode === m && styles.segTextActive]}>{m === "month" ? "Mois" : "Semaine"}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.nav}>
          <Pressable onPress={() => go(-1)} hitSlop={10} style={styles.navBtn} testID="calendar-prev">
            <Ionicons name="chevron-back" size={22} color={colors.brandPrimary} />
          </Pressable>
          <Text style={styles.navTitle} testID="calendar-title">
            {title}
          </Text>
          <Pressable onPress={() => go(1)} hitSlop={10} style={styles.navBtn} testID="calendar-next">
            <Ionicons name="chevron-forward" size={22} color={colors.brandPrimary} />
          </Pressable>
          <Pressable onPress={goToday} style={styles.todayBtn} testID="calendar-today">
            <Text style={styles.todayText}>Aujourd'hui</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomChrome + 40 }}
        refreshControl={<RefreshControl refreshing={eventsQ.isRefetching} onRefresh={eventsQ.refetch} tintColor={colors.brandPrimary} />}
      >
        {/* Weekday header */}
        <View style={styles.weekHead}>
          {WEEKDAYS_FR.map((w, i) => (
            <Text key={w} style={[styles.weekHeadText, i >= 5 && { color: colors.muted }]}>
              {w}
            </Text>
          ))}
        </View>

        {mode === "month" ? (
          <View style={styles.grid} testID="calendar-month-grid">
            {grid.map((row, ri) => (
              <View key={ri} style={styles.gridRow}>
                {row.map((d) => {
                  const key = ymd(d);
                  const evs = byDay[key] ?? [];
                  const inMonth = d.getMonth() === anchor.getMonth();
                  const isToday = isSameDay(d, today);
                  const isSel = isSameDay(d, selected);
                  return (
                    <Pressable
                      key={key}
                      style={[styles.cell, { minHeight: cellH }, isSel && styles.cellSel]}
                      onPress={() => setSelected(d)}
                      testID={`calendar-day-${key}`}
                    >
                      <View style={styles.cellHead}>
                        <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
                          <Text
                            style={[
                              styles.dayNumText,
                              !inMonth && { color: colors.borderStrong },
                              isToday && { color: colors.onBrandPrimary },
                            ]}
                          >
                            {d.getDate()}
                          </Text>
                        </View>
                      </View>
                      {evs.slice(0, maxRows).map((e) => (
                        <EventLine key={e.id} e={e} />
                      ))}
                      {evs.length > maxRows ? <Text style={styles.more}>+{evs.length - maxRows} autres</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        ) : (
          <View style={[styles.grid, styles.gridRow]} testID="calendar-week-grid">
            {week.map((d) => {
              const key = ymd(d);
              const evs = byDay[key] ?? [];
              const isToday = isSameDay(d, today);
              const isSel = isSameDay(d, selected);
              return (
                <Pressable
                  key={key}
                  style={[styles.cell, { minHeight: isTablet ? 420 : 300 }, isSel && styles.cellSel]}
                  onPress={() => setSelected(d)}
                  testID={`calendar-day-${key}`}
                >
                  <View style={[styles.cellHead, { justifyContent: "center", marginBottom: 6 }]}>
                    <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
                      <Text style={[styles.dayNumText, isToday && { color: colors.onBrandPrimary }]}>{d.getDate()}</Text>
                    </View>
                  </View>
                  {evs.map((e) => (
                    <EventLine key={e.id} e={e} big />
                  ))}
                </Pressable>
              );
            })}
          </View>
        )}

        {/* Selected day details */}
        <View style={styles.details}>
          <Text style={styles.detailsTitle} testID="calendar-selected-title">
            {longDate(selected)}
          </Text>
          {eventsQ.isLoading ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : dayEvents.length > 0 ? (
            dayEvents.map((e) => (
              <Pressable
                key={e.id}
                style={({ pressed }) => [styles.evCard, { borderLeftColor: e.color }, pressed && { opacity: 0.7 }]}
                onPress={() => router.push(`/folder/${e.folder_id}`)}
                testID={`calendar-event-${e.id}`}
              >
                <View style={[styles.evBadge, { backgroundColor: e.color }]}>
                  <Text style={styles.evBadgeText}>{e.label}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.evCardTitle} numberOfLines={1}>
                    {e.folder_name}
                  </Text>
                  <Text style={styles.evCardMeta} numberOfLines={1}>
                    {e.topic_name} · {e.offset === 0 ? "QCM généré ce jour" : "Revoir le cours"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))
          ) : (
            <Text style={styles.hint}>
              {schedulesQ.data && schedulesQ.data.length === 0
                ? "Aucun rappel programmé. Activez la méthode des J sur un chapitre (icône ⏰) pour voir vos J ici."
                : "Aucun rappel ce jour."}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12 },
  eyebrow: { fontSize: 12, fontFamily: fonts.bold, color: colors.muted, letterSpacing: 1 },
  h1: { fontSize: 30, fontFamily: fonts.extrabold, color: colors.onSurface },
  segment: { flexDirection: "row", backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 3 },
  segBtn: { paddingHorizontal: 14, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  segBtnActive: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.muted },
  segTextActive: { color: colors.onSurface },
  nav: { flexDirection: "row", alignItems: "center", gap: 4 },
  navBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  navTitle: { flex: 1, textAlign: "center", fontSize: 18, fontFamily: fonts.extrabold, color: colors.onSurface, textTransform: "capitalize" },
  todayBtn: { paddingHorizontal: 12, height: 36, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  todayText: { fontSize: 13, fontFamily: fonts.bold, color: colors.onBrandTertiary },
  weekHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 },
  weekHeadText: { flex: 1, textAlign: "center", fontSize: 12, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary },
  grid: { borderLeftWidth: 1, borderLeftColor: colors.divider },
  gridRow: { flexDirection: "row" },
  cell: {
    flex: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.divider,
    padding: 3,
    gap: 2,
    backgroundColor: colors.surface,
  },
  cellSel: { backgroundColor: colors.surfaceSecondary },
  cellHead: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 2 },
  dayNum: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  dayNumToday: { backgroundColor: colors.brandPrimary },
  dayNumText: { fontSize: 13, fontFamily: fonts.bold, color: colors.onSurface },
  evLine: { flexDirection: "row", alignItems: "center", gap: 3 },
  evBar: { width: 3, alignSelf: "stretch", borderRadius: 2, minHeight: 12 },
  evText: { flex: 1, fontSize: 10, fontFamily: fonts.regular, color: colors.onSurface, lineHeight: 13 },
  evTextBig: { fontSize: 11, lineHeight: 14 },
  evLabel: { fontFamily: fonts.bold },
  more: { fontSize: 10, fontFamily: fonts.semibold, color: colors.muted, paddingLeft: 6 },
  details: { padding: 16, gap: 10, backgroundColor: colors.surfaceSecondary, flexGrow: 1, minHeight: 180 },
  detailsTitle: { fontSize: 16, fontFamily: fonts.extrabold, color: colors.onSurface, textTransform: "capitalize", marginBottom: 2 },
  evCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
  },
  evBadge: { minWidth: 44, height: 32, borderRadius: 8, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  evBadgeText: { fontSize: 13, fontFamily: fonts.extrabold, color: "#ffffff" },
  evCardTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  evCardMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  hint: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, lineHeight: 20 },
}));
