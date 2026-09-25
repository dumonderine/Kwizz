import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const API = `${BASE}/api`;
export const TOKEN_KEY = "edn_auth_token";

export async function getToken(): Promise<string | null> {
  return storage.secureGet<string>(TOKEN_KEY, "");
}

type Options = {
  method?: string;
  body?: any;
  isForm?: boolean;
};

export async function apiFetch<T = any>(path: string, opts: Options = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (opts.body && !opts.isForm) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${API}${path}`, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers,
    body,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = (data && data.detail) || "Une erreur est survenue";
    throw new Error(typeof detail === "string" ? detail : "Une erreur est survenue");
  }
  return data as T;
}

// Authenticated file URL (token in query so <Image> works on web + native).
export async function fileUrl(storagePath: string): Promise<string> {
  const token = await getToken();
  return `${API}/files/${storagePath}?token=${token}`;
}

// Multipart upload — different body shape on web vs native.
export async function uploadSource(
  folderId: string,
  file: { uri: string; name: string; type: string },
  Platform: { OS: string },
): Promise<any> {
  const token = await getToken();
  const form = new FormData();
  form.append("folder_id", folderId);
  if (Platform.OS === "web") {
    const blob = await (await fetch(file.uri)).blob();
    form.append("file", blob, file.name);
  } else {
    form.append("file", { uri: file.uri, name: file.name, type: file.type } as any);
  }
  const res = await fetch(`${API}/sources/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.detail) || "Échec de l'envoi");
  return data;
  
export async function uploadAnnale(
  folderId: string,
  file: { uri: string; name: string; type: string },
  Platform: { OS: string },
): Promise<any> {
  const token = await getToken();
  const form = new FormData();
  form.append("folder_id", folderId);
  if (Platform.OS === "web") {
    const blob = await (await fetch(file.uri)).blob();
    form.append("file", blob, file.name);
  } else {
    form.append("file", { uri: file.uri, name: file.name, type: file.type } as any);
  }
  const res = await fetch(`${API}/quizzes/generate-annale`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.detail) || "Échec de l'envoi");
  return data;
}
}
