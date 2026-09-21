"""Full backend regression suite for Kwizz.
Covers: auth, onboarding, folders (color inheritance, breadcrumb), text sources,
Gemini quiz generation, EDN scoring rule, review pool grouping, review quiz,
anchor status/daily idempotency, and course chat.
"""
import requests, pytest


# ------------------------- Auth -------------------------
class TestAuth:
    def test_register_login_me(self, base_url, user_session, api_client):
        # /auth/me
        r = api_client.get(f"{base_url}/api/auth/me", headers=user_session["headers"])
        assert r.status_code == 200
        me = r.json()
        assert me["email"] == user_session["email"].lower()
        assert me["onboarded"] is True
        assert me["study_field"].lower().startswith("méd")

        # Login again
        r = api_client.post(f"{base_url}/api/auth/login",
                            json={"email": user_session["email"], "password": user_session["password"]})
        assert r.status_code == 200
        assert "token" in r.json()

    def test_login_wrong_password(self, base_url, user_session, api_client):
        r = api_client.post(f"{base_url}/api/auth/login",
                            json={"email": user_session["email"], "password": "wrong"})
        assert r.status_code == 401

    def test_register_duplicate(self, base_url, user_session, api_client):
        r = api_client.post(f"{base_url}/api/auth/register",
                            json={"email": user_session["email"], "password": "secret123"})
        assert r.status_code == 409

    def test_unauth_protected(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_show_grade_toggle(self, base_url, user_session, api_client):
        r = api_client.patch(f"{base_url}/api/auth/profile",
                             json={"show_grade": False}, headers=user_session["headers"])
        assert r.status_code == 200
        assert r.json()["show_grade"] is False
        # revert
        api_client.patch(f"{base_url}/api/auth/profile",
                         json={"show_grade": True}, headers=user_session["headers"])


# ------------------------- Folders -------------------------
@pytest.fixture(scope="session")
def topic_folder(base_url, user_session, api_client):
    r = api_client.post(f"{base_url}/api/folders",
                        json={"name": "TEST_Neurologie", "color": "#0284c7"},
                        headers=user_session["headers"])
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="session")
def sub_folder(base_url, user_session, api_client, topic_folder):
    r = api_client.post(f"{base_url}/api/folders",
                        json={"name": "TEST_Chapitre 3", "parent_id": topic_folder["id"]},
                        headers=user_session["headers"])
    assert r.status_code == 200, r.text
    return r.json()


class TestFolders:
    def test_topic_folder_color(self, topic_folder):
        assert topic_folder["color"] == "#0284c7"
        assert topic_folder["parent_id"] is None

    def test_subfolder_inherits_lighter_color(self, sub_folder, topic_folder):
        # Should be lighter than parent (higher R+G+B)
        parent_hex = topic_folder["color"].lstrip("#")
        child_hex = sub_folder["color"].lstrip("#")
        parent_sum = sum(int(parent_hex[i:i+2], 16) for i in (0, 2, 4))
        child_sum = sum(int(child_hex[i:i+2], 16) for i in (0, 2, 4))
        assert child_sum > parent_sum, f"child {child_hex} not lighter than parent {parent_hex}"
        assert sub_folder["parent_id"] == topic_folder["id"]

    def test_list_folders_with_counts(self, base_url, user_session, api_client, topic_folder):
        r = api_client.get(f"{base_url}/api/folders", headers=user_session["headers"])
        assert r.status_code == 200
        folders = r.json()
        top = next((f for f in folders if f["id"] == topic_folder["id"]), None)
        assert top is not None
        assert top["subfolder_count"] >= 1
        assert "source_count" in top

    def test_breadcrumb(self, base_url, user_session, api_client, sub_folder, topic_folder):
        r = api_client.get(f"{base_url}/api/folders/{sub_folder['id']}",
                           headers=user_session["headers"])
        assert r.status_code == 200
        data = r.json()
        assert "breadcrumb" in data
        assert len(data["breadcrumb"]) == 2
        assert data["breadcrumb"][0]["id"] == topic_folder["id"]
        assert data["breadcrumb"][1]["id"] == sub_folder["id"]

    def test_update_folder(self, base_url, user_session, api_client, sub_folder):
        r = api_client.patch(f"{base_url}/api/folders/{sub_folder['id']}",
                             json={"color": "#ff5500"}, headers=user_session["headers"])
        assert r.status_code == 200
        assert r.json()["color"] == "#ff5500"

    def test_soft_delete_folder(self, base_url, user_session, api_client):
        r = api_client.post(f"{base_url}/api/folders",
                            json={"name": "TEST_ToDelete"}, headers=user_session["headers"])
        fid = r.json()["id"]
        r = api_client.delete(f"{base_url}/api/folders/{fid}", headers=user_session["headers"])
        assert r.status_code == 200
        r = api_client.get(f"{base_url}/api/folders/{fid}", headers=user_session["headers"])
        assert r.status_code == 404


# ------------------------- Sources -------------------------
COURSE_TEXT = """
Sclérose en plaques (SEP)
- Maladie inflammatoire démyélinisante auto-immune du système nerveux central.
- Épidémiologie: adulte jeune, 20-40 ans, prédominance féminine (3:1).
- Physiopathologie: activation de lymphocytes T auto-réactifs contre la myéline, formation de plaques
  dans la substance blanche du cerveau et de la moelle.
- Clinique: névrite optique rétrobulbaire (BAV douloureuse), signe de Lhermitte, ataxie cérébelleuse,
  signes pyramidaux, troubles sphinctériens.
- Diagnostic: IRM cérébrale et médullaire (plaques en hypersignal T2/FLAIR),
  ponction lombaire (bandes oligoclonales dans le LCR), critères de McDonald.
- Traitement de la poussée: corticoïdes IV forte dose (méthylprednisolone 1g/j x 3-5 jours).
- Traitement de fond: interférons, acétate de glatiramère, natalizumab, ocrélizumab, fingolimod.
- Formes: rémittente-récurrente (85%), secondairement progressive, primaire progressive.
"""


@pytest.fixture(scope="session")
def text_source(base_url, user_session, api_client, sub_folder):
    r = api_client.post(f"{base_url}/api/sources/text",
                        json={"folder_id": sub_folder["id"],
                              "name": "TEST_Cours SEP",
                              "text": COURSE_TEXT},
                        headers=user_session["headers"])
    assert r.status_code == 200, r.text
    return r.json()


class TestSources:
    def test_create_text_source(self, text_source, sub_folder):
        assert text_source["kind"] == "text"
        assert text_source["folder_id"] == sub_folder["id"]

    def test_list_sources(self, base_url, user_session, api_client, sub_folder, text_source):
        r = api_client.get(f"{base_url}/api/sources",
                           params={"folder_id": sub_folder["id"]},
                           headers=user_session["headers"])
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert text_source["id"] in ids


# ------------------------- Quiz generation + scoring -------------------------
@pytest.fixture(scope="session")
def generated_quiz(base_url, user_session, api_client, topic_folder, text_source):
    """Generate against the TOPIC folder to verify descendant source pickup."""
    r = api_client.post(f"{base_url}/api/quizzes/generate",
                        json={"folder_id": topic_folder["id"], "num_questions": 5},
                        headers=user_session["headers"], timeout=120)
    assert r.status_code == 200, r.text
    return r.json()


class TestQuiz:
    def test_quiz_shape(self, generated_quiz, topic_folder):
        assert generated_quiz["folder_id"] == topic_folder["id"]
        qs = generated_quiz["questions"]
        assert 3 <= len(qs) <= 30
        for q in qs:
            assert set(q["options"].keys()) == {"A", "B", "C", "D", "E"}
            assert q["correct"]
            assert all(c in {"A", "B", "C", "D", "E"} for c in q["correct"])
            assert q["explanation"]
            # origin metadata (used for anchor->per question review grouping)
            assert q.get("origin_folder_id") == topic_folder["id"]

    def test_submit_perfect_score(self, base_url, user_session, api_client, generated_quiz):
        # answer every question perfectly
        answers = {q["id"]: q["correct"] for q in generated_quiz["questions"]}
        r = api_client.post(f"{base_url}/api/quizzes/submit",
                            json={"quiz_id": generated_quiz["id"], "answers": answers},
                            headers=user_session["headers"])
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["grade_on_20"] == 20.0
        assert data["review_added"] == 0
        for res in data["results"]:
            assert res["points"] == 1.0
            assert res["discordance"] == 0

    def test_submit_edn_partial_scoring(self, base_url, user_session, api_client, generated_quiz):
        """Introduce 1 discordant on q0, 2 on q1, 3 on q2 and check points 0.5/0.2/0.0."""
        answers = {}
        qs = generated_quiz["questions"]
        letters = ["A", "B", "C", "D", "E"]
        for idx, q in enumerate(qs):
            correct = set(q["correct"])
            wrong_letters = [l for l in letters if l not in correct]
            sel = set(correct)
            flips = min(idx, len(letters))
            for i in range(flips):
                l = letters[i]
                if l in sel:
                    sel.discard(l)
                else:
                    sel.add(l)
            answers[q["id"]] = sorted(sel)

        r = api_client.post(f"{base_url}/api/quizzes/submit",
                            json={"quiz_id": generated_quiz["id"], "answers": answers},
                            headers=user_session["headers"])
        assert r.status_code == 200
        data = r.json()
        expected_pts = {0: 1.0, 1: 0.5, 2: 0.2, 3: 0.0, 4: 0.0}
        for idx, res in enumerate(data["results"]):
            assert res["discordance"] == idx or (idx >= 3 and res["discordance"] >= 3), \
                f"q{idx} discordance={res['discordance']}"
            assert res["points"] == expected_pts.get(min(idx, 4)), \
                f"q{idx} points={res['points']} discordance={res['discordance']}"
        # imperfect answers should have added review items
        assert data["review_added"] >= min(len(qs) - 1, 3)


# ------------------------- Review pool -------------------------
class TestReview:
    def test_review_topics_grouping(self, base_url, user_session, api_client, topic_folder):
        r = api_client.get(f"{base_url}/api/review/topics", headers=user_session["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["total"] >= 1
        # Should find at least the topic_folder group with label starting with topic name
        labels = [t["label"] for t in data["topics"]]
        assert any("TEST_Neurologie" in l for l in labels), f"labels={labels}"

    def test_review_quiz_build(self, base_url, user_session, api_client, topic_folder):
        r = api_client.post(f"{base_url}/api/review/quiz",
                            json={"folder_id": topic_folder["id"], "num_questions": 5},
                            headers=user_session["headers"])
        assert r.status_code == 200, r.text
        quiz = r.json()
        assert quiz["kind"] == "review"
        assert quiz["questions"], "review quiz must have questions"


# ------------------------- Anchor -------------------------
class TestAnchor:
    def test_anchor_status_has_pool(self, base_url, user_session, api_client):
        r = api_client.get(f"{base_url}/api/anchor/status", headers=user_session["headers"])
        assert r.status_code == 200
        data = r.json()
        assert data["available"] is True
        assert data["pool_size"] >= 3

    def test_anchor_daily_idempotent(self, base_url, user_session, api_client):
        r1 = api_client.post(f"{base_url}/api/anchor/daily", headers=user_session["headers"])
        assert r1.status_code == 200, r1.text
        q1 = r1.json()
        assert q1["kind"] == "anchor"
        assert 3 <= len(q1["questions"]) <= 40

        r2 = api_client.post(f"{base_url}/api/anchor/daily", headers=user_session["headers"])
        assert r2.status_code == 200
        q2 = r2.json()
        # Same daily quiz returned
        assert q2["id"] == q1["id"]
        assert q2["anchor_date"] == q1["anchor_date"]


# ------------------------- Chat -------------------------
class TestChat:
    def test_chat_answer(self, base_url, user_session, api_client, topic_folder):
        r = api_client.post(f"{base_url}/api/chat",
                            json={"folder_id": topic_folder["id"],
                                  "question": "Quels sont les traitements de fond de la SEP ?"},
                            headers=user_session["headers"], timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "answer" in data
        assert len(data["answer"]) > 20
