import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import ColorPicker, { HueSlider, Panel1, Preview } from "reanimated-color-picker";
import Ionicons from "@react-native-vector-icons/ionicons";

import { Button } from "@/src/components/button";
import { DEFAULT_J_OFFSETS, JSeriesPicker } from "@/src/components/j-series-picker";
import { FOLDER_PALETTE } from "@/src/colors";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export type FolderJConfig = { j_enabled: boolean; j_offsets: number[] };

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string, color: string, j: FolderJConfig) => Promise<void> | void;
  title: string;
  defaultColor: string;
  initialName?: string;
  initialJ?: { j_enabled?: boolean | null; j_offsets?: number[] | null };
  submitLabel?: string;
};

export function FolderFormModal({
  visible,
  onClose,
  onSubmit,
  title,
  defaultColor,
  initialName = "",
  initialJ,
  submitLabel = "Créer",
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(defaultColor);
  const [customOpen, setCustomOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jEnabled, setJEnabled] = useState(initialJ?.j_enabled !== false);
  const [jOffsets, setJOffsets] = useState<number[]>(initialJ?.j_offsets ?? DEFAULT_J_OFFSETS);

  useEffect(() => {
    if (visible) {
      setName(initialName);
      setColor(defaultColor);
      setCustomOpen(false);
      setJEnabled(initialJ?.j_enabled !== false);
      setJOffsets(initialJ?.j_offsets ?? DEFAULT_J_OFFSETS);
    }
  }, [visible, initialName, defaultColor, initialJ]);

  const submit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onSubmit(name.trim(), color, { j_enabled: jEnabled, j_offsets: jOffsets });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const palette = Array.from(new Set([defaultColor, ...FOLDER_PALETTE]));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} testID="folder-form-close" hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Nom</Text>
          <TextInput
            testID="folder-name-input"
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Ex : Neurologie"
            placeholderTextColor={colors.muted}
          />

          <View style={styles.labelRow}>
            <Text style={styles.label}>Couleur</Text>
            <View style={[styles.currentSwatch, { backgroundColor: color }]} />
          </View>

          <View style={styles.palette}>
            {palette.map((c) => (
              <Pressable
                key={c}
                testID={`folder-color-${c}`}
                onPress={() => setColor(c)}
                style={[styles.swatch, { backgroundColor: c }, color.toLowerCase() === c.toLowerCase() && styles.swatchActive]}
              >
                {color.toLowerCase() === c.toLowerCase() ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
              </Pressable>
            ))}
          </View>

          <Pressable style={styles.customToggle} onPress={() => setCustomOpen((v) => !v)} testID="custom-color-toggle">
            <Ionicons name="color-palette-outline" size={18} color={colors.brandPrimary} />
            <Text style={styles.customToggleText}>
              {customOpen ? "Masquer le nuancier" : "Couleur personnalisée (nuancier)"}
            </Text>
            <Ionicons name={customOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.brandPrimary} />
          </Pressable>

          {customOpen ? (
            <View style={styles.pickerWrap} testID="color-picker">
              <ColorPicker
                value={color}
                sliderThickness={22}
                thumbSize={26}
                onComplete={({ hex }) => setColor(hex)}
                style={{ gap: 16 }}
              >
                <Preview hideInitialColor style={styles.preview} textStyle={{ fontFamily: fonts.bold }} />
                <Panel1 style={styles.panel} />
                <HueSlider style={styles.hue} />
              </ColorPicker>
            </View>
          ) : null}

          <View style={styles.jRow}>
            <View style={styles.jIcon}>
              <Ionicons name="alarm-outline" size={20} color={colors.brandPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.jTitle}>Méthode des J</Text>
              <Text style={styles.jSub}>Rappels J1, J3… à partir du 1er QCM généré</Text>
            </View>
            <Switch
              value={jEnabled}
              onValueChange={setJEnabled}
              trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }}
              testID="folder-j-switch"
            />
          </View>
          {jEnabled ? (
            <View style={{ marginTop: 12 }}>
              <JSeriesPicker value={jOffsets} onChange={setJOffsets} />
            </View>
          ) : null}

          <View style={{ height: 16 }} />
          <Button title={submitLabel} onPress={submit} loading={loading} testID="folder-submit-button" />
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
    maxHeight: "88%",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  title: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.onSurface },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginBottom: 8, marginTop: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  currentSwatch: { width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  input: {
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.onSurface,
  },
  palette: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 4 },
  swatch: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  swatchActive: { borderWidth: 3, borderColor: colors.onSurface },
  customToggle: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 16 },
  customToggleText: { flex: 1, fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary },
  pickerWrap: { gap: 12 },
  preview: { height: 40, borderRadius: 12 },
  panel: { borderRadius: 16, height: 200 },
  hue: { borderRadius: 12 },
  jRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  jIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  jTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  jSub: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 2 },
}));
