
import os
import base64
import secrets
from functools import wraps

from flask import Flask, render_template, request, jsonify, session
from dotenv import load_dotenv
from supabase import create_client
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

load_dotenv()

app = Flask(__name__)

# Configuration : variables locales ou secrets Fly.io
app.secret_key = os.getenv("FLASK_SECRET_KEY") or secrets.token_hex(32)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

# Vérification claire de la configuration
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError(
        "Configuration Supabase manquante : "
        "vérifie SUPABASE_URL et SUPABASE_KEY dans les secrets Fly.io."
    )


# ==========================================
# SUPABASE ET AUTHENTIFICATION
# ==========================================

def get_client():
    token = session.get("access_token")

    if not token:
        return None

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.postgrest.auth(token)

    return client


def login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not session.get("access_token") or not session.get("user_id"):
            return jsonify({"error": "Connexion requise"}), 401

        return func(*args, **kwargs)

    return wrapper


# ==========================================
# CHIFFREMENT DES NOTES
# ==========================================

def generate_key(code, salt):
    kdf = Scrypt(
        salt=salt,
        length=32,
        n=2**14,
        r=8,
        p=1
    )

    return base64.urlsafe_b64encode(kdf.derive(code.encode()))


def encrypt_content(content, code):
    salt = os.urandom(16)
    key = generate_key(code, salt)
    encrypted = Fernet(key).encrypt(content.encode())

    return encrypted.decode(), base64.b64encode(salt).decode()


def decrypt_content(content, code, salt):
    salt_bytes = base64.b64decode(salt)
    key = generate_key(code, salt_bytes)

    return Fernet(key).decrypt(content.encode()).decode()


# ==========================================
# PAGE PRINCIPALE
# ==========================================

@app.route("/")
def index():
    return render_template("index.html")


# ==========================================
# INSCRIPTION
# ==========================================

@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json() or {}

    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not email or len(password) < 8:
        return jsonify({
            "error": "Adresse e-mail ou mot de passe invalide (8 caractères minimum)."
        }), 400

    try:
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        result = client.auth.sign_up({
            "email": email,
            "password": password
        })

        if result.session and result.user:
            session.clear()
            session["access_token"] = result.session.access_token
            session["user_id"] = result.user.id
            session["email"] = result.user.email

        return jsonify({
            "message": "Inscription envoyée. Vérifie ta boîte mail pour confirmer ton adresse."
        })

    except Exception as error:
        print("ERREUR INSCRIPTION SUPABASE :", repr(error))
        return jsonify({
            "error": "Inscription impossible. Vérifie ton adresse ou réessaie."
        }), 400


# ==========================================
# CONNEXION
# ==========================================

@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.get_json() or {}

    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "Remplis tous les champs."}), 400

    try:
        client = create_client(SUPABASE_URL, SUPABASE_KEY)

        result = client.auth.sign_in_with_password({
            "email": email,
            "password": password
        })

        if not result.session or not result.user:
            return jsonify({
                "error": "Supabase n'a pas retourné de session."
            }), 401

        session.clear()
        session["access_token"] = result.session.access_token
        session["user_id"] = result.user.id
        session["email"] = result.user.email

        return jsonify({"message": "Connexion réussie."})

    except Exception as error:
        print("ERREUR CONNEXION SUPABASE :", repr(error))
        return jsonify({
            "error": "Erreur de connexion. Consulte les journaux."
        }), 401


# ==========================================
# DECONNEXION
# ==========================================

@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"message": "Déconnexion réussie."})


# ==========================================
# INFORMATIONS DU COMPTE
# ==========================================

@app.route("/api/auth/me")
@login_required
def me():
    return jsonify({
        "authenticated": True,
        "user_id": session["user_id"],
        "email": session.get("email")
    })


# ==========================================
# PROFIL UTILISATEUR
# ==========================================

@app.route("/api/profile", methods=["GET"])
@login_required
def get_profile():
    try:
        client = get_client()
        user_id = session["user_id"]

        result = (
            client.table("profiles")
            .select("id, username, avatar_url, created_at")
            .eq("id", user_id)
            .execute()
        )

        if result.data:
            profile = result.data[0]
        else:
            created = client.table("profiles").insert({
                "id": user_id,
                "username": None,
                "avatar_url": None
            }).execute()

            if not created.data:
                raise Exception("Impossible de créer le profil.")

            profile = created.data[0]

        return jsonify({
            "id": profile["id"],
            "username": profile.get("username"),
            "avatar_url": profile.get("avatar_url"),
            "created_at": profile.get("created_at"),
            "email": session.get("email")
        })

    except Exception as error:
        print("ERREUR PROFIL :", repr(error))
        return jsonify({
            "error": "Impossible de récupérer le profil."
        }), 500


@app.route("/api/profile", methods=["PUT"])
@login_required
def update_profile():
    data = request.get_json() or {}

    username = data.get("username")
    avatar_url = data.get("avatar_url")

    if username is not None:
        username = username.strip()

        if len(username) < 3 or len(username) > 24:
            return jsonify({
                "error": "Le pseudo doit contenir entre 3 et 24 caractères."
            }), 400

        if not all(c.isalnum() or c in "_-" for c in username):
            return jsonify({
                "error": "Utilise uniquement des lettres, chiffres, _ ou -."
            }), 400

    if avatar_url is not None:
        avatar_url = avatar_url.strip()

        if avatar_url and (
            not avatar_url.startswith("https://")
            or len(avatar_url) > 500
        ):
            return jsonify({
                "error": "L'URL de l'avatar doit être une adresse HTTPS valide."
            }), 400

    updates = {}

    if username is not None:
        updates["username"] = username

    if avatar_url is not None:
        updates["avatar_url"] = avatar_url or None

    if not updates:
        return jsonify({"error": "Aucune modification reçue."}), 400

    try:
        client = get_client()
        user_id = session["user_id"]

        existing = (
            client.table("profiles")
            .select("id")
            .eq("id", user_id)
            .execute()
        )

        if existing.data:
            result = (
                client.table("profiles")
                .update(updates)
                .eq("id", user_id)
                .execute()
            )
        else:
            result = client.table("profiles").insert({
                "id": user_id,
                **updates
            }).execute()

        if not result.data:
            return jsonify({
                "error": "Aucune modification enregistrée."
            }), 400

        return jsonify({
            "message": "Profil mis à jour.",
            "profile": result.data[0]
        })

    except Exception as error:
        print("ERREUR MODIFICATION PROFIL :", repr(error))
        return jsonify({
            "error": "Impossible de modifier le profil. Vérifie que le pseudo est disponible."
        }), 400


# ==========================================
# NOTES : AFFICHAGE
# ==========================================

@app.route("/api/notes", methods=["GET"])
@login_required
def get_notes():
    try:
        client = get_client()

        result = client.table("notes").select("*").order(
            "updated_at", desc=True
        ).execute()

        notes = []

        for note in result.data:
            item = dict(note)

            if item["locked"]:
                item["content"] = "Note verrouillée"

            notes.append(item)

        return jsonify(notes)

    except Exception as error:
        print("ERREUR CHARGEMENT NOTES :", repr(error))
        return jsonify({
            "error": "Impossible de charger les notes."
        }), 500


# ==========================================
# CREER UNE NOTE
# ==========================================

@app.route("/api/notes", methods=["POST"])
@login_required
def create_note():
    data = request.get_json() or {}

    title = data.get("title", "").strip()
    content = data.get("content", "")
    locked = bool(data.get("locked", False))
    code = data.get("code", "")

    if not title or not content:
        return jsonify({
            "error": "Titre et contenu obligatoires."
        }), 400

    if len(title) > 120:
        return jsonify({"error": "Titre trop long."}), 400

    salt = None

    if locked:
        if len(code) < 6:
            return jsonify({
                "error": "Code de 6 caractères minimum."
            }), 400

        content, salt = encrypt_content(content, code)

    try:
        client = get_client()

        result = client.table("notes").insert({
            "user_id": session["user_id"],
            "title": title,
            "content": content,
            "locked": locked,
            "salt": salt
        }).execute()

        return jsonify(result.data[0]), 201

    except Exception as error:
        print("ERREUR CREATION NOTE :", repr(error))
        return jsonify({
            "error": "Impossible de créer la note."
        }), 500


# ==========================================
# RECUPERER UNE NOTE
# ==========================================

@app.route("/api/notes/<note_id>", methods=["GET"])
@login_required
def get_note(note_id):
    try:
        client = get_client()

        result = client.table("notes").select("*").eq(
            "id", note_id
        ).single().execute()

        note = result.data

        if note["locked"]:
            return jsonify({
                "error": "Cette note est verrouillée."
            }), 403

        return jsonify(note)

    except Exception as error:
        print("ERREUR RECUPERATION NOTE :", repr(error))
        return jsonify({"error": "Note introuvable."}), 404


# ==========================================
# DEVERROUILLER UNE NOTE
# ==========================================

@app.route("/api/notes/<note_id>/unlock", methods=["POST"])
@login_required
def unlock_note(note_id):
    data = request.get_json() or {}
    code = data.get("code", "")

    try:
        client = get_client()

        result = client.table("notes").select("*").eq(
            "id", note_id
        ).single().execute()

        note = result.data

        if not note["locked"]:
            return jsonify(note)

        content = decrypt_content(
            note["content"], code, note["salt"]
        )

        note["content"] = content
        return jsonify(note)

    except Exception as error:
        print("ERREUR DEVERROUILLAGE :", repr(error))
        return jsonify({
            "error": "Code incorrect ou note introuvable."
        }), 403


# ==========================================
# MODIFIER UNE NOTE
# ==========================================

@app.route("/api/notes/<note_id>", methods=["PUT"])
@login_required
def update_note(note_id):
    data = request.get_json() or {}

    title = data.get("title", "").strip()
    content = data.get("content", "")

    if not title or not content or len(title) > 120:
        return jsonify({
            "error": "Titre ou contenu invalide."
        }), 400

    try:
        client = get_client()

        result = client.table("notes").update({
            "title": title,
            "content": content
        }).eq("id", note_id).eq(
            "locked", False
        ).execute()

        if not result.data:
            return jsonify({
                "error": "Note introuvable ou verrouillée."
            }), 404

        return jsonify(result.data[0])

    except Exception as error:
        print("ERREUR MODIFICATION NOTE :", repr(error))
        return jsonify({
            "error": "Modification impossible."
        }), 500


# ==========================================
# MODIFIER UNE NOTE VERROUILLEE
# ==========================================

@app.route("/api/notes/<note_id>/edit-locked", methods=["PUT"])
@login_required
def edit_locked_note(note_id):
    data = request.get_json() or {}

    code = data.get("code", "")
    title = data.get("title", "").strip()
    content = data.get("content", "")

    if not title or not content or len(title) > 120:
        return jsonify({
            "error": "Titre ou contenu invalide."
        }), 400

    try:
        client = get_client()

        result = client.table("notes").select("*").eq(
            "id", note_id
        ).single().execute()

        note = result.data

        if not note["locked"]:
            return jsonify({
                "error": "Cette note n'est pas verrouillée."
            }), 400

        decrypt_content(note["content"], code, note["salt"])
        encrypted, salt = encrypt_content(content, code)

        updated = client.table("notes").update({
            "title": title,
            "content": encrypted,
            "salt": salt
        }).eq("id", note_id).execute()

        return jsonify(updated.data[0])

    except Exception as error:
        print("ERREUR MODIFICATION NOTE VERROUILLEE :", repr(error))
        return jsonify({
            "error": "Code incorrect ou modification impossible."
        }), 403


# ==========================================
# SUPPRIMER UNE NOTE
# ==========================================

@app.route("/api/notes/<note_id>", methods=["DELETE"])
@login_required
def delete_note(note_id):
    data = request.get_json(silent=True) or {}
    code = data.get("code", "")

    try:
        client = get_client()

        result = client.table("notes").select("*").eq(
            "id", note_id
        ).single().execute()

        note = result.data

        if note["locked"]:
            decrypt_content(note["content"], code, note["salt"])

        client.table("notes").delete().eq(
            "id", note_id
        ).execute()

        return jsonify({"message": "Note supprimée."})

    except Exception as error:
        print("ERREUR SUPPRESSION NOTE :", repr(error))
        return jsonify({
            "error": "Code incorrect ou suppression impossible."
        }), 403


# ==========================================
# DEMARRAGE
# ==========================================

if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5001)),
        debug=False
    )

