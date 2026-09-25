import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { FolderFormModal, FolderJConfig } from "@/src/components/folder-form-modal";
import { JSchedule, JScheduleModal } from "@/src/components/j-schedule-modal";
import { seriesLabel } from "@/src/components/j-series-picker";
import { useToast } from "@/src/components/toast";
import { shortDate } from "@/src/dates";
import { requestReminderPermission, syncReminders } from "@/src/notifications";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const MAX_QUESTIONS = 100;

type Folder = {
  id: string;
  name: string;
  color?: string;
  j_enabled?: boolean | null;
  j_offsets?: number[] | null;
  breadcrumb: { id: string; name: string }[];
};
type SubFolder = { id: string; name: string; color?: string; subfolder_count: number; source_count: number };
type Source = { id: string; name: string; kind: string };
type Quiz = { id: string; title: string; kind: string; question_count: number };
type GenJob = {
  id: string;
  status: "pending" | "running" | "done" | "error";
  step?: string;
  num_questions: number;
  quiz_id?: string | null;
  error?: string | null;
};

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
  const [showJ, setShowJ] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [customCount, setCustomCount] = useState("");
  const [textName, setTextName] = useState("");
  const [textBody, setTextBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showAnnale, setShowAnnale] = useState(false);

  const folderQ = useQuery({ queryKey: ["folder", id], queryFn: () => apiFetch<Folder>(`/folders/${id}`) });
  const subsQ = useQuery({ queryKey: ["folders", id], queryFn: () => apiFetch<SubFolder[]>(`/folders?parent_id=${id}`) });
  const srcQ = useQuery({ queryKey: ["sources", id], queryFn: () => apiFetch<Source[]>(`/sources?folder_id=${id}`) });
  const quizQ = useQuery({ queryKey: ["quizzes", id], queryFn: () => apiFetch<Quiz[]>(`/quizzes?folder_id=${id}`) });
  const schedQ = useQuery({ queryKey: ["j-schedule", id], queryFn: () => apiFetch<JSchedule | null>(`/j/schedules/${id}`) });

  const folderColor = folderQ.data?.color || DEFAULT_FOLDER_COLOR;
  const isTopLevel = (folderQ.data?.breadcrumb?.length ?? 0) <= 1;
  const combineQuizzes = useMutation({
    mutationFn: () => apiFetch<Quiz>("/quizzes/combine", { body: { folder_id: id } }),
    onSuccess: (q) => router.push(`/quiz/play?quizId=${q.id}`),
    onError: (e: any) => toast.show(e.message || "Aucun QCM à regrouper", "error"),
  });
  const derivedSubColor = lighten(folderColor);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["folders", id] });
    qc.invalidateQueries({ queryKey: ["sources", id] });
    qc.invalidateQueries({ queryKey: ["quizzes", id] });
    qc.invalidateQueries({ queryKey: ["folder", id] });
    qc.invalidateQueries({ queryKey: ["folders", null] });
  };

  const invalidateJ = () => {
    qc.invalidateQueries({ queryKey: ["j-schedule", id] });
    qc.invalidateQueries({ queryKey: ["j-schedules"] });
    qc.invalidateQueries({ queryKey: ["j-events"] });
  };

  const createSub = useMutation({
    mutationFn: (v: { name: string; color: string; j: FolderJConfig }) =>
      apiFetch("/folders", { body: { name: v.name, color: v.color, parent_id: id, ...v.j } }),
    onSuccess: () => {
      invalidate();
      toast.show("Sous-dossier créé", "success");
    },
    onError: (e: any) => toast.show(e.message, "error"),
  });

  const editFolder = useMutation({
    mutationFn: (v: { name: string; color: string; j: FolderJConfig }) =>
      apiFetch(`/folders/${id}`, { method: "PATCH", body: { name: v.name, color: v.color, ...v.j } }),
    onSuccess: () => {
      invalidate();
      invalidateJ();
      syncReminders();
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
    mutationFn: (num: number) => apiFetch<GenJob>("/quizzes/generate", { body: { folder_id: id, num_questions: num } }),
    onSuccess: (job) => {
      setJobId(job.id);
      setCustomCount("");
      qc.invalidateQueries({ queryKey: ["gen-jobs", id] });
    },
    onError: (e: any) => {
      setShowGen(false);
      toast.show(e.message, "error");
    },
  });

  // Poll the background job while it runs (also survives navigating away: see jobsQ).
  const jobQ = useQuery({
    queryKey: ["gen-job", jobId],
    queryFn: () => apiFetch<GenJob>(`/quizzes/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ["pending", "running"].includes(q.state.data.status) ? 2500 : false),
  });
  const jobsQ = useQuery({
    queryKey: ["gen-jobs", id],
    queryFn: () => apiFetch<GenJob[]>(`/quizzes/jobs?folder_id=${id}`),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status !== "error") ? 3000 : false),
  });

  useEffect(() => {
    const job = jobQ.data;
    if (!job || job.id !== jobId) return;
    if (job.status === "done" && job.quiz_id) {
      setJobId(null);
      setShowGen(false);
      qc.invalidateQueries({ queryKey: ["quizzes", id] });
      qc.invalidateQueries({ queryKey: ["gen-jobs", id] });
      invalidateJ();
      requestReminderPermission().then(() => syncReminders());
      router.push(`/quiz/play?quizId=${job.quiz_id}`);
    } else if (job.status === "error") {
      setJobId(null);
      setShowGen(false);
      qc.invalidateQueries({ queryKey: ["gen-jobs", id] });
      toast.show(job.error || "La génération a échoué", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobQ.data?.status, jobQ.data?.id]);

  const dismissJob = useMutation({
    mutationFn: (jid: string) => apiFetch(`/quizzes/jobs/${jid}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["gen-jobs", id] }),
  });

  // Background jobs finished while we were away → refresh the quiz list.
  const activeJobs = jobsQ.data?.filter((j) => j.status !== "error").length ?? 0;
  useEffect(() => {
    if (activeJobs === 0) {
      qc.invalidateQueries({ queryKey: ["quizzes", id] });
      qc.invalidateQueries({ queryKey: ["j-schedule", id] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobs]);

  const generating = !!jobId || generate.isPending;

  const generateCustom = () => {
    const n = parseInt(customCount.replace(/\D/g, ""), 10);
    if (!n || n < 3) {
      toast.show("Minimum 3 questions", "error");
      return;
    }
    generate.mutate(Math.min(n, MAX_QUESTIONS));
  };

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
  const doUploadAnnale = async (uri: string, name: string, type: string) => {
    setShowAnnale(false);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("folder_id", id!);
      form.append("file", { uri, name, type } as any);
      const job = await apiFetch<GenJob>("/quizzes/generate-annale", { method: "POST", body: form });
      setJobId(job.id);
      qc.invalidateQueries({ queryKey: ["gen-jobs", id] });
    } catch (e: any) {
      toast.show(e.message || "Échec de l'envoi", "error");
    } finally {
      setUploading(false);
    }
  };

  const pickAnnalePdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    await doUploadAnnale(a.uri, a.name || "annale.pdf", a.mimeType || "application/pdf");
  };

  const pickAnnaleImage = async () => {
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
    await doUploadAnnale(a.uri, a.fileName || "annale.jpg", a.mimeType || "image/jpeg");
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
            <Text style={styles.sectionTitle}>
              {isTopLevel ? "Annales" : "Sources (cours & annales)"}
            </Text>
            <Pressable
              onPress={() => (isTopLevel ? setShowAnnale(true) : setShowAdd(true))}
              testID="add-source"
              hitSlop={8}
            >
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
            <Text style={styles.hint}>
              {isTopLevel
                ? "Dépose ton annale corrigée (avec les bonnes réponses cochées) et refais-la ici, sans changer une seule question."
                : "Ajoutez vos cours (PDF, photos ou texte) pour générer des QCM."}
            </Text>
          )}
        </View>

        {/* Quizzes */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>QCM générés</Text>
          </View>
          {jobsQ.data && jobsQ.data.length > 0 ? (
            <View style={{ gap: 10 }}>
              {jobsQ.data.map((j) => (
                <View key={j.id} style={[styles.row, { borderLeftColor: j.status === "error" ? colors.error : folderColor }]} testID={`gen-job-${j.id}`}>
                  <View style={[styles.iconWell, { backgroundColor: j.status === "error" ? colors.errorSurface : tintBg(folderColor) }]}>
                    {j.status === "error" ? (
                      <Ionicons name="alert-circle" size={22} color={colors.error} />
                    ) : (
                      <ActivityIndicator color={folderColor} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {j.status === "error" ? "Génération échouée" : `Génération de ${j.num_questions} QCM…`}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={2}>
                      {j.status === "error" ? j.error || "Réessayez" : j.step || "L'IA rédige vos questions"}
                    </Text>
                  </View>
                  {j.status === "error" ? (
                    <Pressable onPress={() => dismissJob.mutate(j.id)} hitSlop={8} testID={`dismiss-job-${j.id}`}>
                      <Ionicons name="close-circle-outline" size={22} color={colors.muted} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
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

        {isTopLevel ? (
          <Pressable
            style={styles.chatBtn}
            onPress={() => combineQuizzes.mutate()}
            disabled={combineQuizzes.isPending}
            testID="review-all-quizzes"
          >
            <Ionicons name="layers-outline" size={20} color={colors.brandPrimary} />
            <Text style={styles.chatText}>
              {combineQuizzes.isPending ? "Préparation…" : "Revoir tous les QCM"}
            </Text>
          </Pressable>
        ) : null}
        
        {/* Méthode des J */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Méthode des J</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.row, { borderLeftColor: folderColor }, pressed && styles.pressed]}
            onPress={() => setShowJ(true)}
            testID="j-card"
          >
            <View style={[styles.iconWell, { backgroundColor: tintBg(folderColor) }]}>
              <Ionicons name="alarm" size={22} color={folderColor} />
            </View>
            <View style={{ flex: 1 }}>
              {schedQ.data ? (
                <>
                  <Text style={styles.rowTitle}>J0 le {shortDate(schedQ.data.j0)}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {seriesLabel(schedQ.data.offsets)}
                  </Text>
                </>
              ) : folderQ.data?.j_enabled === false ? (
                <>
                  <Text style={styles.rowTitle}>Rappels désactivés</Text>
                  <Text style={styles.rowMeta}>Touchez pour activer la méthode des J</Text>
                </>
              ) : (
                <>
                  <Text style={styles.rowTitle}>Rappels en attente</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    J0 sera fixé au 1er QCM généré · {seriesLabel(folderQ.data?.j_offsets ?? [1, 3, 7, 15, 30])}
                  </Text>
                </>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
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
        onSubmit={(name, color, j) => createSub.mutateAsync({ name, color, j })}
        title="Nouveau sous-dossier"
        defaultColor={derivedSubColor}
      />
      <FolderFormModal
        visible={showEdit}
        onClose={() => setShowEdit(false)}
        onSubmit={(name, color, j) => editFolder.mutateAsync({ name, color, j })}
        title="Modifier le dossier"
        defaultColor={folderColor}
        initialName={folderQ.data?.name}
        initialJ={folderQ.data ? { j_enabled: folderQ.data.j_enabled, j_offsets: folderQ.data.j_offsets } : undefined}
        submitLabel="Enregistrer"
      />
      <JScheduleModal
        visible={showJ}
        onClose={() => setShowJ(false)}
        folderId={id!}
        folderName={folderQ.data?.name || ""}
        schedule={schedQ.data ?? null}
        defaultOffsets={folderQ.data?.j_offsets}
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

      {/* Add annale options */}
      <Modal visible={showAnnale} transparent animationType="slide" onRequestClose={() => setShowAnnale(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowAnnale(false)} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Ajouter une annale</Text>
          <Text style={[styles.hint, { marginBottom: 16 }]}>
            Dépose ton annale corrigée (avec les bonnes réponses cochées) et refais-la ici, sans
            changer une seule question.
          </Text>
          <Pressable style={styles.opt} onPress={pickAnnalePdf} testID="add-annale-pdf">
            <Ionicons name="document-text" size={24} color={colors.brandPrimary} />
            <Text style={styles.optText}>Importer un PDF corrigé</Text>
          </Pressable>
          <Pressable style={styles.opt} onPress={pickAnnaleImage} testID="add-annale-photo">
            <Ionicons name="image" size={24} color={colors.brandPrimary} />
            <Text style={styles.optText}>Photo d'une annale corrigée</Text>
          </Pressable>
          <Pressable onPress={() => setShowAnnale(false)} style={{ marginTop: 4 }}>
            <Text style={styles.cancel}>Annuler</Text>
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
      <Modal visible={showGen} transparent animationType="fade" onRequestClose={() => !generating && setShowGen(false)}>
        <View style={styles.centerModal}>
          <View style={styles.genCard}>
            {generating ? (
              <View style={{ alignItems: "center", gap: 16, paddingVertical: 8 }}>
                <ActivityIndicator size="large" color={colors.brandPrimary} />
                <Text style={styles.genTitle}>Génération du QCM…</Text>
                <Text style={[styles.hint, { textAlign: "center" }]}>
                  {jobQ.data?.step || "L'IA analyse vos cours."} Cela peut prendre du temps.
                </Text>
                <Button
                  title="Continuer en arrière-plan"
                  variant="outline"
                  onPress={() => setShowGen(false)}
                  testID="gen-background"
                />
                <Text style={[styles.hint, { textAlign: "center", fontSize: 12 }]}>
                  Le QCM apparaîtra dans la liste dès qu'il sera prêt.
                </Text>
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
                <View style={styles.customRow}>
                  <TextInput
                    style={styles.customInput}
                    value={customCount}
                    onChangeText={(v) => setCustomCount(v.replace(/\D/g, "").slice(0, 3))}
                    placeholder={`Autre (max ${MAX_QUESTIONS})`}
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    onSubmitEditing={generateCustom}
                    testID="gen-count-custom"
                  />
                  <Pressable
                    style={[styles.customGo, !customCount && { opacity: 0.5 }]}
                    onPress={generateCustom}
                    disabled={!customCount}
                    testID="gen-count-custom-go"
                  >
                    <Ionicons name="sparkles" size={20} color={colors.onBrandPrimary} />
                  </Pressable>
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
  customRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  customInput: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fonts.semibold,
    color: colors.onSurface,
  },
  customGo: { width: 50, height: 50, borderRadius: 14, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  cancel: { textAlign: "center", fontSize: 15, fontFamily: fonts.semibold, color: colors.muted },
}));
