import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@react-native-vector-icons/ionicons";

import { apiFetch, uploadSource } from "@/src/api";
import { DEFAULT_FOLDER_COLOR, lighten, tintBg } from "@/src/colors";
import { Button } from "@/src/components/button";
import { FolderFormModal } from "@/src/components/folder-form-modal";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Folder = { id: string; name: string; color?: string; breadcrumb: { id: string; name: string }[] };
type SubFolder = { id: string; name: string; color?: string; subfolder_count: number; source_count: number };
type Source = { id: string; name: string; kind: string };
type Quiz = { id: string; title: string; kind: string; question_count: number };

const SRC_ICON: Record<string, string> = { pdf: "document-text", image: "image", text: "reader", file: "document" };

export default function FolderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [showSub, setShowSub] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showText, setShowText] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [textName, setTextName] = useState("");
  const [textBody, setTextBody] = useState("");
  const [uploading, setUploading] = useState(false);

  const folderQ = useQuery({ queryKey: ["folder", id], queryFn: () => apiFetch<Folder>(`/folders/${id}`) });
  const subsQ = useQuery({ queryKey: ["folders", id], queryFn: () => apiFetch<SubFolder[]>(`/folders?parent_id=${id}`) });
  const srcQ = useQuery({ queryKey: ["sources", id], queryFn: () => apiFetch<Source[]>(`/sources?folder_id=${id}`) });
  const quizQ = useQuery({ queryKey: ["quizzes", id], queryFn: () => apiFetch<Quiz[]>(`/quizzes?folder_id=${id}`) });

  const folderColor = folderQ.data?.color || DEFAULT_FOLDER_COLOR;
  const derivedSubColor = lighten(folderColor);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["folders", id] });
    qc.invalidateQueries({ queryKey: ["sources", id] });
    qc.invalidateQueries({ queryKey: ["quizzes", id] });
    qc.invalidateQueries({ queryKey: ["folder", id] });
    qc.invalidateQueries({ queryKey: ["folders", null] });
  };

  const createSub = useMutation({
    mutationFn: (v: { name: string; color: string }) =>
      apiFetch("/folders", { body: { name: v.name, color: v.color, parent_id: id } }),
    onSuccess: () => {
      invalidate();
      toast.show("Sous-dossier créé", "success");
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const editFolder = useMutation({
    mutationFn: (v: { name: string; color: string }) =>
      apiFetch(`/folders/${id}`, { method: "PATCH", body: { name: v.name, color: v.color } }),
    onSuccess: () => {
      invalidate();
      toast.show("Dossier mis à jour", "success");
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const addText = useMutation({
    mutationFn: () => apiFetch("/sources/text", { body: { folder_id: id, name: textName, text: textBody } }),
    onSuccess: () => {
      invalidate();
      setShowText(false);
      setTextName("");
      setTextBody("");
      toast.show("Texte ajouté", "success");
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const delSource = useMutation({
    mutationFn: (sid: string) => apiFetch(`/sources/${sid}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources", id] }),
  });

  const delQuiz = useMutation({
    mutationFn: (qid: string) => apiFetch(`/quizzes/${qid}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quizzes", id] }),
  });

  const generate = useMutation({
    mutationFn: (num: number) => apiFetch<{ id: string }>("/quizzes/generate", { body: { folder_id: id, num_questions: num } }),
    onSuccess: (quiz) => {
      qc.invalidateQueries({ queryKey: ["quizzes", id] });
      setShowGen(false);
      router.push(`/quiz/play?quizId=${quiz.id}`);
    },
    onError: (e: any) => {
      setShowGen(false);
      toast.show(e.message, "error");
    },
  });

  const pickPdf = async () => {
    setShowAdd(false);
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUpload(a.uri, a.name || "cours.pdf", a.mimeType || "application/pdf");
  };

  const pickImage = async () => {
    setShowAdd(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        toast.show("Autorisez l'accès aux photos dans les réglages", "error");
        Linking.openSettings();
      } else {
        toast.show("Accès aux photos refusé", "error");
      }
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUpload(a.uri, a.fileName || "photo.jpg", a.mimeType || "image/jpeg");
  };

  const doUpload = async (uri: string, name: string, type: string) => {
    setUploading(true);
    try {
      await uploadSource(id!, { uri, name, type }, Platform);
      invalidate();
      toast.show("Source ajoutée", "success");
    } catch (e: any) {
      toast.show(e.message || "Échec de l'envoi", "error");
    } finally {
      setUploading(false);
    }
  };

  const bottomBar = 88 + insets.bottom;

  return (
    <View style={styles.container}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: folderColor }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} testID="folder-back">
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </Pressable>
          <Pressable onPress={() => setShowEdit(true)} hitSlop={10} testID="folder-edit">
            <Ionicons name="color-palette-outline" size={24} color="#fff" />
          </Pressable>
        </View>
        <Text style={styles.crumb} numberOfLines={1}>
          {folderQ.data?.breadcrumb?.map((b) => b.name).join("  ›  ")}
        </Text>
        <Text style={styles.headerTitle}>{folderQ.data?.name || "Dossier"}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomBar + 24, gap: 24 }}>
        {/* Sous-dossiers */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Sous-dossiers</Text>
            <Pressable onPress={() => setShowSub(true)} testID="add-subfolder" hitSlop={8}>
              <Ionicons name="add-circle" size={26} color={folderColor} />
            </Pressable>
          </View>
          {subsQ.data && subsQ.data.length > 0 ? (
            <View style={{ gap: 10 }}>
              {subsQ.data.map((s) => {
                const c = s.color || derivedSubColor;
                return (
                  <Pressable
                    key={s.id}
                    testID={`subfolder-${s.id}`}
                    style={({ pressed }) => [styles.row, { borderLeftColor: c }, pressed && styles.pressed]}
                    onPress={() => router.push(`/folder/${s.id}`)}
                  >
                    <View style={[styles.iconWell, { backgroundColor: tintBg(c) }]}>
                      <Ionicons name="folder" size={20} color={c} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{s.name}</Text>
                      <Text style={styles.rowMeta}>{s.source_count} source(s)</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.hint}>Aucun sous-dossier. Ajoutez un chapitre.</Text>
          )}
        </View>

        {/* Sources */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Sources (cours & annales)</Text>
            <Pressable onPress={() => setShowAdd(true)} testID="add-source" hitSlop={8}>
              <Ionicons name="add-circle" size={26} color={folderColor} />
            </Pressable>
          </View>
          {uploading ? (
            <View style={styles.row}>
              <ActivityIndicator color={folderColor} />
              <Text style={styles.rowTitle}>Envoi en cours…</Text>
            </View>
          ) : null}
          {srcQ.data && srcQ.data.length > 0 ? (
            <View style={{ gap: 10 }}>
              {srcQ.data.map((s) => (
                <View key={s.id} style={styles.row} testID={`source-${s.id}`}>
                  <View style={[styles.iconWell, { backgroundColor: colors.surfaceTertiary }]}>
                    <Ionicons name={(SRC_ICON[s.kind] || "document") as any} size={20} color={colors.onSurfaceSecondary} />
                  </View>
                  <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Pressable onPress={() => delSource.mutate(s.id)} hitSlop={8} testID={`del-source-${s.id}`}>
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.hint}>Ajoutez vos cours (PDF, photos ou texte) pour générer des QCM.</Text>
          )}
        </View>

        {/* Quizzes */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>QCM générés</Text>
          </View>
          {quizQ.data && quizQ.data.length > 0 ? (
            <View style={{ gap: 10 }}>
              {quizQ.data.map((q) => (
                <Pressable
                  key={q.id}
                  testID={`quiz-${q.id}`}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  onPress={() => router.push(`/quiz/play?quizId=${q.id}`)}
                >
                  <View style={[styles.iconWell, { backgroundColor: colors.brandTertiary }]}>
                    <Ionicons name="help-circle" size={22} color={colors.brandPrimary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {q.title}
                    </Text>
                    <Text style={styles.rowMeta}>{q.question_count} questions</Text>
                  </View>
                  <Pressable onPress={() => delQuiz.mutate(q.id)} hitSlop={8} testID={`del-quiz-${q.id}`}>
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </Pressable>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.hint}>Aucun QCM. Générez-en un à partir de vos sources.</Text>
          )}
        </View>

        <Pressable style={styles.chatBtn} onPress={() => router.push(`/chat?folderId=${id}`)} testID="open-chat">
          <Ionicons name="chatbubbles-outline" size={20} color={colors.brandPrimary} />
          <Text style={styles.chatText}>Poser une question à l'IA sur ce cours</Text>
        </Pressable>
      </ScrollView>

      {/* Sticky generate CTA */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <Button
          title="Générer un QCM"
          icon="sparkles"
          onPress={() => setShowGen(true)}
          testID="generate-quiz-button"
        />
      </View>

      {/* Modals */}
      <FolderFormModal
        visible={showSub}
        onClose={() => setShowSub(false)}
        onSubmit={(name, color) => createSub.mutateAsync({ name, color })}
        title="Nouveau sous-dossier"
        defaultColor={derivedSubColor}
      />
      <FolderFormModal
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        onSubmit={(name, color) => editFolder.mutateAsync({ name, color })}
        title="Modifier le dossier"
        defaultColor={folderColor}
        initialName={folderQ.data?.name}
        submitLabel="Enregistrer"
      />

      {/* Add source options */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowAdd(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Ajouter une source</Text>
          <Pressable style={styles.opt} onPress={pickPdf} testID="add-pdf">
            <Ionicons name="document-text" size={24} color={colors.brandPrimary} />
            <Text style={styles.optText}>Importer un PDF (cours / annales)</Text>
          </Pressable>
          <Pressable style={styles.opt} onPress={pickImage} testID="add-photo">
            <Ionicons name="image" size={24} color={colors.brandPrimary} />
            <Text style={styles.optText}>Photo d'un cours</Text>
          </Pressable>
          <Pressable
            style={styles.opt}
            onPress={() => {
              setShowAdd(false);
              setShowText(true);
            }}
            testID="add-text"
          >
            <Ionicons name="create" size={24} color={colors.brandPrimary} />
            <Text style={styles.optText}>Coller du texte</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Text source modal */}
      <Modal visible={showText} transparent animationType="slide" onRequestClose={() => setShowText(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowText(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Coller du texte</Text>
          <TextInput
            style={styles.input}
            value={textName}
            onChangeText={setTextName}
            placeholder="Titre (ex : Résumé cours 1)"
            placeholderTextColor={colors.muted}
            testID="text-source-name"
          />
          <TextInput
            style={[styles.input, styles.textarea]}
            value={textBody}
            onChangeText={setTextBody}
            placeholder="Collez ici le contenu du cours…"
            placeholderTextColor={colors.muted}
            multiline
            testID="text-source-body"
          />
          <View style={{ height: 8 }} />
          <Button
            title="Ajouter"
            onPress={() => textBody.trim() && addText.mutate()}
            loading={addText.isPending}
            testID="text-source-submit"
          />
        </View>
      </Modal>

      {/* Generate modal */}
      <Modal visible={showGen} transparent animationType="fade" onRequestClose={() => !generate.isPending && setShowGen(false)}>
        <View style={styles.centerModal}>
          <View style={styles.genCard}>
            {generate.isPending ? (
              <View style={{ alignItems: "center", gap: 16, paddingVertical: 16 }}>
                <ActivityIndicator size="large" color={colors.brandPrimary} />
                <Text style={styles.genTitle}>Génération du QCM…</Text>
                <Text style={styles.hint}>L'IA analyse vos cours. Cela peut prendre 20-40 s.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.genTitle}>Combien de questions ?</Text>
                <View style={styles.countRow}>
                  {[5, 10, 15, 20, 30].map((n) => (
                    <Pressable
                      key={n}
                      style={styles.countChip}
                      onPress={() => generate.mutate(n)}
                      testID={`gen-count-${n}`}
                    >
                      <Text style={styles.countText}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable onPress={() => setShowGen(false)} style={{ marginTop: 12 }}>
                  <Text style={styles.cancel}>Annuler</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { paddingHorizontal: 16, paddingBottom: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  crumb: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontFamily: fonts.semibold },
  headerTitle: { color: "#fff", fontSize: 26, fontFamily: fonts.extrabold, marginTop: 2 },
  section: { gap: 12 },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.onSurface },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    borderLeftColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  iconWell: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onSurface },
  rowMeta: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, marginTop: 1 },
  hint: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted },
  chatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.brandTertiary,
    borderRadius: 14,
    padding: 14,
  },
  chatText: { fontSize: 14, fontFamily: fonts.bold, color: colors.onBrandTertiary, flex: 1 },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontFamily: fonts.extrabold, color: colors.onSurface, marginBottom: 16 },
  opt: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.divider },
  optText: { fontSize: 16, fontFamily: fonts.semibold, color: colors.onSurface },
  input: {
    borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.onSurface,
    marginBottom: 12,
  },
  textarea: { minHeight: 160, textAlignVertical: "top" },
  centerModal: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)", alignItems: "center", justifyContent: "center", padding: 24 },
  genCard: { backgroundColor: colors.surface, borderRadius: 20, padding: 24, width: "100%", maxWidth: 420 },
  genTitle: { fontSize: 18, fontFamily: fonts.extrabold, color: colors.onSurface, textAlign: "center", marginBottom: 16 },
  countRow: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 12 },
  countChip: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 18, fontFamily: fonts.bold, color: colors.brandPrimary },
  cancel: { textAlign: "center", fontSize: 15, fontFamily: fonts.semibold, color: colors.muted },
}));
