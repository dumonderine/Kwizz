import { useRouter } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/button";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const FIELDS = [
  { label: "Médecine (PASS/LAS/EDN)", value: "Médecine", icon: "medkit" },
  { label: "Droit", value: "Droit", icon: "briefcase" },
  { label: "Licence", value: "Licence", icon: "school" },
  { label: "BTS", value: "BTS", icon: "construct" },
  { label: "Prépa", value: "Prépa", icon: "library" },
  { label: "Lycée", value: "Lycée", icon: "book" },
];

export default function Onboarding() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { updateProfile } = useAuth();
  const toast = useToast();

  const [selected, setSelected] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);

  const value = custom.trim() || selected;

  const submit = async () => {
    if (!value) {
      toast.show("Choisissez ou saisissez votre domaine", "error");
      return;
    }
    setLoading(true);
    try {
      await updateProfile({ study_field: value });
      router.replace("/(tabs)");
    } catch (e: any) {
      toast.show(e.message || "Erreur", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.h1}>Quelles études suivez-vous ?</Text>
          <Text style={styles.sub}>
            On adapte le style des QCM à votre filière. En médecine, ils suivent le format EDN/PASS.
          </Text>

          <View style={styles.grid}>
            {FIELDS.map((f) => {
              const active = !custom.trim() && selected === f.value;
              return (
                <Pressable
                  key={f.value}
                  testID={`field-${f.value}`}
                  style={[styles.tile, active && styles.tileActive]}
                  onPress={() => {
                    setSelected(f.value);
                    setCustom("");
                  }}
                >
                  <Ionicons name={f.icon as any} size={26} color={active ? colors.onBrandPrimary : colors.brandPrimary} />
                  <Text style={[styles.tileText, active && { color: colors.onBrandPrimary }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.orLabel}>Ou saisissez votre domaine</Text>
          <TextInput
            style={styles.input}
            value={custom}
            onChangeText={(t) => {
              setCustom(t);
              if (t) setSelected("");
            }}
            placeholder="Ex : Pharmacie, Kiné, STAPS…"
            placeholderTextColor={colors.muted}
            testID="field-custom-input"
          />
        </ScrollView>
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
          <Button title="Continuer" onPress={submit} loading={loading} testID="onboarding-submit" />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  h1: { fontSize: 26, fontFamily: fonts.extrabold, color: colors.onSurface },
  sub: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginTop: 8, marginBottom: 24, lineHeight: 22 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: {
    width: "47%",
    flexGrow: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 2,
    borderColor: colors.border,
  },
  tileActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  tileText: { fontSize: 14, fontFamily: fonts.bold, color: colors.onSurface },
  orLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.muted, marginTop: 24, marginBottom: 8 },
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
  bottomBar: { paddingHorizontal: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
}));
