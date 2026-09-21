import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { useAuth } from "@/src/auth";
import { Button } from "@/src/components/button";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function Register() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();
  const toast = useToast();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      toast.show("Email valide et mot de passe (6 caractères min)", "error");
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, name.trim() || undefined);
      router.replace("/(auth)/onboarding");
    } catch (e: any) {
      toast.show(e.message || "Inscription impossible", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logo}>
            <Ionicons name="school" size={26} color={colors.onBrandPrimary} />
          </View>
          <Text style={styles.h1}>Créer un compte</Text>
          <Text style={styles.sub}>Commencez à générer vos QCM</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Prénom (optionnel)</Text>
            <TextInput
              testID="register-name-input"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Votre prénom"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              testID="register-email-input"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="vous@exemple.fr"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Mot de passe</Text>
            <TextInput
              testID="register-password-input"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="6 caractères minimum"
              placeholderTextColor={colors.muted}
              secureTextEntry
            />
          </View>

          <View style={{ height: 8 }} />
          <Button title="Créer mon compte" onPress={submit} loading={loading} testID="register-submit-button" />

          <View style={styles.footer}>
            <Text style={styles.footerText}>Déjà inscrit ? </Text>
            <Link href="/(auth)/login" style={styles.link} testID="go-login-link">
              Se connecter
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 40 },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  h1: { fontSize: 26, fontFamily: fonts.extrabold, color: colors.onSurface },
  sub: { fontSize: 15, fontFamily: fonts.regular, color: colors.muted, marginBottom: 24 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onSurfaceSecondary, marginBottom: 8 },
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
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 24 },
  footerText: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
  link: { fontSize: 14, fontFamily: fonts.bold, color: colors.brandPrimary },
}));
