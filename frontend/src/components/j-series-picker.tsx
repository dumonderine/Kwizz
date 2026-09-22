import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch } from "@/src/api";
import { useAuth } from "@/src/auth";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export const DEFAULT_J_OFFSETS = [1, 3, 7, 15, 30];

export function seriesLabel(offsets: number[]): string {
  return offsets.map((o) => `J${o}`).join(" · ");
}

function sameSeries(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type Props = {
  value: number[];
  onChange: (offsets: number[]) => void;
  allowSave?: boolean;
};

// Chips of J offsets + reusable series (presets saved in Profil, series already
// used on other chapters, and the default one).
export function JSeriesPicker({ value, onChange, allowSave = true }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { user, refreshUser } = useAuth();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [presetName, setPresetName] = useState("");

  const schedQ = useQuery({
    queryKey: ["j-schedules"],
    queryFn: () => apiFetch<{ offsets: number[] }[]>("/j/schedules"),
  });

  const savePreset = useMutation({
    mutationFn: () => apiFetch("/j/presets", { body: { name: presetName.trim() || seriesLabel(value), offsets: value } }),
    onSuccess: async () => {
      await refreshUser();
      setSaving(false);
      setPresetName("");
    },
  });

  const presets = user?.j_presets ?? [];
  const previous: number[][] = [];
  for (const s of schedQ.data ?? []) {
    if (!previous.some((p) => sameSeries(p, s.offsets)) && !presets.some((p) => sameSeries(p.offsets, s.offsets))) {
      previous.push(s.offsets);
    }
  }
  const series: { key: string; name: string; offsets: number[] }[] = [
    ...presets.map((p) => ({ key: p.id, name: p.name, offsets: p.offsets })),
    ...previous.slice(0, 4).map((o, i) => ({ key: `prev-${i}`, name: "Déjà utilisée", offsets: o })),
  ];
  if (!series.some((s) => sameSeries(s.offsets, DEFAULT_J_OFFSETS))) {
    series.push({ key: "default", name: "Par défaut", offsets: DEFAULT_J_OFFSETS });
  }

  const add = () => {
    const n = parseInt(draft.replace(/\D/g, ""), 10);
    if (!n || n <= 0 || n > 365) return;
    if (!value.includes(n)) onChange([...value, n].sort((a, b) => a - b));
    setDraft("");
  };

  const remove = (n: number) => onChange(value.filter((v) => v !== n));

  return (
    <View style={{ gap: 12 }} testID="j-series-picker">
      <View style={styles.chips}>
        <View style={[styles.chip, styles.chipJ0]}>
          <Text style={[styles.chipText, { color: colors.onSurfaceSecondary }]}>J0</Text>
        </View>
        {value.map((n) => (
          <Pressable key={n} style={styles.chip} onPress={() => remove(n)} testID={`j-chip-${n}`} hitSlop={4}>
            <Text style={styles.chipText}>J{n}</Text>
            <Ionicons name="close" size={14} color={colors.onBrandTertiary} />
          </Pressable>
        ))}
        <View style={styles.addWrap}>
          <Text style={styles.addPrefix}>J</Text>
          <TextInput
            style={styles.addInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="+"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={add}
            onBlur={add}
            testID="j-add-input"
          />
        </View>
      </View>
      <Text style={styles.hint}>Touchez un J pour le retirer · tapez un nombre puis Entrée pour ajouter</Text>

      <Text style={styles.label}>Séries réutilisables</Text>
      <View style={styles.seriesList}>
        {series.map((s) => {
          const active = sameSeries(s.offsets, value);
          return (
            <Pressable
              key={s.key}
              style={[styles.seriesRow, active && styles.seriesActive]}
              onPress={() => onChange([...s.offsets])}
              testID={`j-series-${s.key}`}
            >
              <Ionicons
                name={active ? "checkmark-circle" : "ellipse-outline"}
                size={20}
                color={active ? colors.brandPrimary : colors.muted}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.seriesName}>{s.name}</Text>
                <Text style={styles.seriesOffsets}>{seriesLabel(s.offsets)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {allowSave ? (
        saving ? (
          <View style={styles.saveRow}>
            <TextInput
              style={styles.nameInput}
              value={presetName}
              onChangeText={setPresetName}
              placeholder="Nom de la série (ex : Ma méthode)"
              placeholderTextColor={colors.muted}
              autoFocus
              testID="preset-name-input"
            />
            <Pressable style={styles.saveBtn} onPress={() => savePreset.mutate()} testID="preset-save-confirm">
              <Ionicons name="checkmark" size={20} color={colors.onBrandPrimary} />
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => setSaving(false)} hitSlop={6}>
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.saveLink} onPress={() => setSaving(true)} testID="preset-save-toggle">
            <Ionicons name="bookmark-outline" size={16} color={colors.brandPrimary} />
            <Text style={styles.saveLinkText}>Enregistrer cette série pour la réutiliser</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandTertiary,
  },
  chipJ0: { backgroundColor: colors.surfaceTertiary },
  chipText: { fontSize: 14, fontFamily: fonts.bold, color: colors.onBrandTertiary },
  addWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.brandPrimary,
    borderStyle: "dashed",
    paddingLeft: 12,
    paddingRight: 6,
  },
  addPrefix: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary },
  addInput: { width: 44, fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary, paddingVertical: 0, height: 34 },
  hint: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginTop: 4 },
  seriesList: { gap: 8 },
  seriesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  seriesActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  seriesName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onSurface },
  seriesOffsets: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  saveLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  saveLinkText: { fontSize: 13, fontFamily: fonts.bold, color: colors.brandPrimary },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nameInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: colors.onSurface,
  },
  saveBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  cancelBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
}));
