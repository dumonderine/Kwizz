import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Switch, Text, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { Button } from "@/src/components/button";
import { DatePicker } from "@/src/components/date-picker";
import { DEFAULT_J_OFFSETS, JSeriesPicker } from "@/src/components/j-series-picker";
import { useToast } from "@/src/components/toast";
import { addDays, parseYmd, shortDate, ymd } from "@/src/dates";
import { requestReminderPermission, syncReminders } from "@/src/notifications";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type JSchedule = {
  id: string;
  folder_id: string;
  j0: string;
  offsets: number[];
  folder_name: string;
  topic_name: string;
  color: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  folderId: string;
  folderName: string;
  schedule: JSchedule | null;
  defaultOffsets?: number[] | null;
};

// Edit the J schedule of a chapter: on/off, J0 date, J series.
export function JScheduleModal({ visible, onClose, folderId, folderName, schedule, defaultOffsets }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(!!schedule);
  const [j0, setJ0] = useState(schedule?.j0 ?? ymd(new Date()));
  const [offsets, setOffsets] = useState<number[]>(schedule?.offsets ?? defaultOffsets ?? DEFAULT_J_OFFSETS);
  const [pickDate, setPickDate] = useState(false);

  useEffect(() => {
    if (visible) {
      setEnabled(!!schedule);
      setJ0(schedule?.j0 ?? ymd(new Date()));
      setOffsets(schedule?.offsets ?? defaultOffsets ?? DEFAULT_J_OFFSETS);
      setPickDate(false);
    }
  }, [visible, schedule, defaultOffsets]);

  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/j/schedules/${folderId}`, {
        method: "PUT",
        body: enabled ? { j0, offsets, enabled: true } : { enabled: false },
      }),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ["j-schedule", folderId] });
      qc.invalidateQueries({ queryKey: ["j-schedules"] });
      qc.invalidateQueries({ queryKey: ["j-events"] });
      qc.invalidateQueries({ queryKey: ["folder", folderId] });
      onClose();
      toast.show(enabled ? "Rappels J enregistrés" : "Rappels J désactivés", "success");
      if (enabled) await requestReminderPermission();
      syncReminders();
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const j0Date = parseYmd(j0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Méthode des J</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {folderName}
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} testID="j-modal-close">
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16 }}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Rappels J activés</Text>
              <Text style={styles.toggleSub}>Notification et affichage dans le calendrier</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={setEnabled}
              trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
              testID="j-enabled-switch"
            />
          </View>

          {enabled ? (
            <>
              <View>
                <Text style={styles.label}>J0 — jour de départ</Text>
                <Pressable style={styles.dateBtn} onPress={() => setPickDate((v) => !v)} testID="j0-date-button">
                  <Ionicons name="calendar-outline" size={20} color={colors.brandPrimary} />
                  <Text style={styles.dateText}>{shortDate(j0)}</Text>
                  <Ionicons name={pickDate ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                </Pressable>
                {pickDate ? (
                  <View style={{ marginTop: 8 }}>
                    <DatePicker
                      value={j0}
                      onChange={(v) => {
                        setJ0(v);
                        setPickDate(false);
                      }}
                    />
                  </View>
                ) : null}
              </View>

              <View>
                <Text style={styles.label}>Série de J</Text>
                <JSeriesPicker value={offsets} onChange={setOffsets} />
              </View>

              {offsets.length > 0 ? (
                <View style={styles.preview}>
                  {offsets.map((o) => (
                    <View key={o} style={styles.previewRow}>
                      <Text style={styles.previewJ}>J{o}</Text>
                      <Text style={styles.previewDate}>{shortDate(ymd(addDays(j0Date, o)))}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          <Button
            title="Enregistrer"
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={enabled && offsets.length === 0}
            testID="j-schedule-save"
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    maxHeight: "90%",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 12 },
  title: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.onSurface },
  subtitle: { fontSize: 13, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  toggleSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginBottom: 8 },
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateText: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  preview: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  previewRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  previewJ: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary },
  previewDate: { fontSize: 14, fontFamily: fonts.regular, color: colors.onSurfaceSecondary },
}));
