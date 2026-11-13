
const $ = id => document.getElementById(id);

let notes = [];
let favorites = JSON.parse(localStorage.getItem("favorites") || "[]");
let currentFilter = "all";
let authMode = "login";
let isLoggedIn = false;
let currentProfile = null;

// ==========================
// API
// ==========================

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Une erreur est survenue.");
    }

    return data;
}

function notify(text) {
    alert(text);
}

function openModal(id) {
    $(id)?.classList.add("active");
}

function closeModal(id) {
    $(id)?.classList.remove("active");
}

// ==========================
// ETAT DU COMPTE
// ==========================

function updateAccountButtons() {
    const authButton = $("open-auth");
    const profileButton = $("open-profile");

    if (authButton) {
        authButton.hidden = isLoggedIn;
        authButton.style.display = isLoggedIn ? "none" : "inline-flex";
    }

    if (profileButton) {
        profileButton.hidden = !isLoggedIn;
        profileButton.style.display = isLoggedIn ? "inline-flex" : "none";
    }
}

// ==========================
// CHARGEMENT DES NOTES
// ==========================

async function loadNotes() {
    try {
        notes = await api("/api/notes");
        renderNotes();
    } catch (error) {
        notes = [];
        renderNotes();

        if (error.message.toLowerCase().includes("connexion")) {
            isLoggedIn = false;
            currentProfile = null;
            updateAccountButtons();
            openAuth();
        } else {
            notify(error.message);
        }
    }
}

// ==========================
// AFFICHAGE DES NOTES
// ==========================

function renderNotes() {
    const container = $("notes-list");
    if (!container) return;

    const search = $("search")?.value.toLowerCase() || "";

    const filtered = notes.filter(note => {
        const matchesSearch =
            (note.title || "").toLowerCase().includes(search);

        const matchesFilter =
            currentFilter === "all" ||
            (currentFilter === "favorites" &&
                favorites.includes(note.id)) ||
            (currentFilter === "locked" && note.locked);

        return matchesSearch && matchesFilter;
    });

    container.innerHTML = "";

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Aucune note trouvée</h3>
                <p>Crée ta première note pour commencer.</p>
            </div>
        `;
    }

    filtered.forEach(note => {
        const card = document.createElement("div");
        card.className = "note-card";

        const title = document.createElement("h3");
        title.textContent = note.title;

        const content = document.createElement("p");
        content.textContent = note.locked
            ? "🔒 Note protégée par un code"
            : note.content;

        const actions = document.createElement("div");
        actions.className = "note-actions";

        const favorite = document.createElement("button");
        favorite.textContent =
            favorites.includes(note.id) ? "★ Favori" : "☆ Favori";
        favorite.onclick = () => toggleFavorite(note.id);

        const edit = document.createElement("button");
        edit.textContent = "✏️ Modifier";
        edit.onclick = () => editNote(note);

        const remove = document.createElement("button");
        remove.textContent = "🗑️ Supprimer";
        remove.onclick = () => deleteNote(note);

        actions.append(favorite, edit, remove);
        card.append(title, content, actions);

        container.appendChild(card);
    });

    if ($("note-count")) {
        $("note-count").textContent =
            `${filtered.length} note${filtered.length > 1 ? "s" : ""}`;
    }
}

// ==========================
// FAVORIS
// ==========================

function toggleFavorite(id) {
    if (favorites.includes(id)) {
        favorites = favorites.filter(item => item !== id);
    } else {
        favorites.push(id);
    }

    localStorage.setItem("favorites", JSON.stringify(favorites));
    renderNotes();
}

// ==========================
// CREATION DE NOTE
// ==========================

async function createNote() {
    const title = $("note-title")?.value.trim();
    const content = $("note-content")?.value || "";
    const locked = $("note-locked")?.checked || false;
    const code = $("note-code")?.value || "";

    if (!title || !content.trim()) {
        return notify("Remplis le titre et le contenu.");
    }

    if (locked && code.length < 6) {
        return notify("Ton code doit contenir au moins 6 caractères.");
    }

    try {
        await api("/api/notes", {
            method: "POST",
            body: JSON.stringify({ title, content, locked, code })
        });

        if ($("note-title")) $("note-title").value = "";
        if ($("note-content")) $("note-content").value = "";
        if ($("note-code")) $("note-code").value = "";
        if ($("note-locked")) $("note-locked").checked = false;

        closeModal("note-modal");
        await loadNotes();

        notify("Note créée avec succès !");
    } catch (error) {
        notify(error.message);
    }
}

// ==========================
// MODIFICATION DE NOTE
// ==========================

async function editNote(note) {
    let code = "";
    let content = note.content;

    if (note.locked) {
        code = prompt("Entre le code de cette note :");
        if (!code) return;

        try {
            const result = await api(`/api/notes/${note.id}/unlock`, {
                method: "POST",
                body: JSON.stringify({ code })
            });

            content = result.content;
        } catch (error) {
            return notify(error.message);
        }
    }

    const title = prompt("Nouveau titre :", note.title);
    if (title === null) return;

    const newContent = prompt("Nouveau contenu :", content);
    if (newContent === null) return;

    if (!title.trim() || !newContent.trim()) {
        return notify("Le titre et le contenu sont obligatoires.");
    }

    try {
        const url = note.locked
            ? `/api/notes/${note.id}/edit-locked`
            : `/api/notes/${note.id}`;

        const body = note.locked
            ? { title, content: newContent, code }
            : { title, content: newContent };

        await api(url, {
            method: "PUT",
            body: JSON.stringify(body)
        });

        await loadNotes();
        notify("Note modifiée !");
    } catch (error) {
        notify(error.message);
    }
}

// ==========================
// SUPPRESSION DE NOTE
// ==========================

async function deleteNote(note) {
    if (!confirm(`Supprimer la note "${note.title}" ?`)) return;

    let code = "";

    if (note.locked) {
        code = prompt("Entre le code de cette note :");
        if (!code) return;
    }

    try {
        await api(`/api/notes/${note.id}`, {
            method: "DELETE",
            body: JSON.stringify({ code })
        });

        favorites = favorites.filter(id => id !== note.id);
        localStorage.setItem("favorites", JSON.stringify(favorites));

        await loadNotes();
        notify("Note supprimée !");
    } catch (error) {
        notify(error.message);
    }
}

// ==========================
// INSCRIPTION ET CONNEXION
// ==========================

function openAuth() {
    authMode = "login";
    updateAuthModal();
    openModal("auth-modal");
}

function updateAuthModal() {
    if ($("auth-title")) {
        $("auth-title").textContent =
            authMode === "login" ? "Connexion" : "Créer un compte";
    }

    if ($("auth-description")) {
        $("auth-description").textContent =
            authMode === "login"
                ? "Connecte-toi pour retrouver tes notes."
                : "Crée ton compte NoteLock.";
    }

    if ($("auth-submit")) {
        $("auth-submit").textContent =
            authMode === "login" ? "Se connecter" : "S'inscrire";
    }

    if ($("auth-switch")) {
        $("auth-switch").textContent =
            authMode === "login"
                ? "Pas encore de compte ? S'inscrire"
                : "Déjà un compte ? Se connecter";
    }

    if ($("auth-message")) $("auth-message").textContent = "";
}

async function submitAuth() {
    const email = $("auth-email")?.value.trim() || "";
    const password = $("auth-password")?.value || "";

    if (!email || !password) {
        if ($("auth-message")) {
            $("auth-message").textContent = "Remplis tous les champs.";
        }
        return;
    }

    if (authMode === "register" && password.length < 8) {
        $("auth-message").textContent =
            "Le mot de passe doit contenir 8 caractères minimum.";
        return;
    }

    const button = $("auth-submit");

    try {
        if (button) button.disabled = true;

        const endpoint = authMode === "login"
            ? "/api/auth/login"
            : "/api/auth/register";

        const result = await api(endpoint, {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        if ($("auth-message")) {
            $("auth-message").textContent = result.message;
        }

        if (authMode === "login") {
            isLoggedIn = true;
            updateAccountButtons();

            closeModal("auth-modal");

            await loadProfile();
            await loadNotes();

            notify("Bienvenue sur NoteLock !");
        }
    } catch (error) {
        if ($("auth-message")) {
            $("auth-message").textContent = error.message;
        }
    } finally {
        if (button) button.disabled = false;
    }
}

// ==========================
// PROFIL UTILISATEUR
// ==========================

function updateAvatarPreview(url) {
    const preview = $("profile-avatar-preview");
    if (!preview) return;

    preview.replaceChildren();

    if (url) {
        const image = document.createElement("img");
        image.src = url;
        image.alt = "Avatar du profil";
        image.referrerPolicy = "no-referrer";

        image.onerror = () => {
            preview.textContent = "👤";
        };

        preview.appendChild(image);
    } else {
        preview.textContent = "👤";
    }
}

async function loadProfile() {
    try {
        const profile = await api("/api/profile");
        currentProfile = profile;

        const username = $("profile-username");
        const avatar = $("profile-avatar-url");
        const email = $("profile-email");

        if (username) username.value = profile.username || "";
        if (avatar) avatar.value = profile.avatar_url || "";

        if (email) {
            email.value = profile.email || "";
            email.textContent = profile.email || "";
        }

        updateAvatarPreview(profile.avatar_url || "");

        return profile;
    } catch (error) {
        console.error("Erreur de chargement du profil :", error);
        notify("Impossible de charger ton profil : " + error.message);
        return null;
    }
}

async function saveProfile() {
    const usernameField = $("profile-username");
    const avatarField = $("profile-avatar-url");
    const message = $("profile-message");
    const button = $("save-profile");

    if (!usernameField || !avatarField || !message || !button) {
        return notify("Certains éléments du profil sont absents du HTML.");
    }

    const username = usernameField.value.trim();
    const avatarUrl = avatarField.value.trim();

    message.textContent = "";

    if (username.length < 3 || username.length > 24) {
        message.textContent =
            "Ton pseudo doit contenir entre 3 et 24 caractères.";
        return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        message.textContent =
            "Utilise uniquement des lettres, chiffres, tirets et underscores.";
        return;
    }

    if (avatarUrl) {
        try {
            const url = new URL(avatarUrl);

            if (url.protocol !== "https:") {
                message.textContent =
                    "L'avatar doit utiliser une adresse HTTPS.";
                return;
            }
        } catch {
            message.textContent = "L'adresse de ton avatar est invalide.";
            return;
        }
    }

    try {
        button.disabled = true;
        button.textContent = "Enregistrement...";

        await api("/api/profile", {
            method: "PUT",
            body: JSON.stringify({
                username,
                avatar_url: avatarUrl || null
            })
        });

        await loadProfile();

        message.textContent = "Profil enregistré avec succès !";
    } catch (error) {
        message.textContent = error.message;
    } finally {
        button.disabled = false;
        button.textContent = "Enregistrer le profil";
    }
}

function openProfile() {
    if (!isLoggedIn) return openAuth();

    if ($("profile-message")) {
        $("profile-message").textContent = "";
    }

    openModal("profile-modal");
    loadProfile();
}

// ==========================
// DECONNEXION
// ==========================

async function logout() {
    if (!confirm("Veux-tu vraiment te déconnecter ?")) return;

    try {
        await api("/api/auth/logout", { method: "POST" });

        isLoggedIn = false;
        currentProfile = null;
        notes = [];

        updateAccountButtons();
        renderNotes();

        closeModal("profile-modal");
        openAuth();
    } catch (error) {
        notify(error.message);
    }
}

// ==========================
// PARAMETRES
// ==========================

function setupSettings() {
    const theme = $("theme-setting");
    const fontSize = $("font-size-setting");
    const fontFamily = $("font-family-setting");
    const defaultLocked = $("default-locked");

    if (theme) {
        theme.value = localStorage.getItem("theme") || "dark";
        document.body.dataset.theme = theme.value;

        theme.onchange = () => {
            localStorage.setItem("theme", theme.value);
            document.body.dataset.theme = theme.value;
        };
    }

    if (fontSize) {
        fontSize.value = localStorage.getItem("fontSize") || "medium";

        const sizes = {
            small: "14px",
            medium: "16px",
            large: "19px"
        };

        document.documentElement.style.fontSize =
            sizes[fontSize.value] || "16px";

        fontSize.onchange = () => {
            localStorage.setItem("fontSize", fontSize.value);
            document.documentElement.style.fontSize =
                sizes[fontSize.value] || "16px";
        };
    }

    if (fontFamily) {
        fontFamily.value = localStorage.getItem("fontFamily") || "Arial";
        document.body.style.fontFamily = fontFamily.value;

        fontFamily.onchange = () => {
            localStorage.setItem("fontFamily", fontFamily.value);
            document.body.style.fontFamily = fontFamily.value;
        };
    }

    if (defaultLocked) {
        defaultLocked.checked =
            localStorage.getItem("defaultLocked") === "true";

        defaultLocked.onchange = () => {
            localStorage.setItem("defaultLocked", defaultLocked.checked);

            if ($("note-locked")) {
                $("note-locked").checked = defaultLocked.checked;
            }
        };
    }
}

// ==========================
// EVENEMENTS
// ==========================

function setupEvents() {
    $("add-note")?.addEventListener("click", () => {
        if ($("note-title")) $("note-title").value = "";
        if ($("note-content")) $("note-content").value = "";
        if ($("note-code")) $("note-code").value = "";

        if ($("note-locked")) {
            $("note-locked").checked =
                localStorage.getItem("defaultLocked") === "true";
        }

        openModal("note-modal");
    });

    $("close-modal")?.addEventListener("click", () =>
        closeModal("note-modal")
    );

    $("save-note")?.addEventListener("click", createNote);

    $("search")?.addEventListener("input", renderNotes);

    $("open-auth")?.addEventListener("click", openAuth);

    $("open-profile")?.addEventListener("click", openProfile);

    $("close-profile")?.addEventListener("click", () =>
        closeModal("profile-modal")
    );

    $("save-profile")?.addEventListener("click", saveProfile);

    $("profile-logout")?.addEventListener("click", logout);

    $("profile-avatar-url")?.addEventListener("input", event => {
        updateAvatarPreview(event.target.value.trim());
    });

    $("close-auth")?.addEventListener("click", () =>
        closeModal("auth-modal")
    );

    $("auth-submit")?.addEventListener("click", submitAuth);

    $("auth-switch")?.addEventListener("click", () => {
        authMode = authMode === "login" ? "register" : "login";
        updateAuthModal();
    });

    $("auth-password")?.addEventListener("keydown", event => {
        if (event.key === "Enter") submitAuth();
    });

    $("open-settings")?.addEventListener("click", () =>
        openModal("settings-modal")
    );

    $("close-settings")?.addEventListener("click", () =>
        closeModal("settings-modal")
    );

    $("favorites-filter")?.addEventListener("click", () => {
        currentFilter = "favorites";
        renderNotes();
    });

    $("locked-filter")?.addEventListener("click", () => {
        currentFilter = "locked";
        renderNotes();
    });

    document.querySelectorAll('[data-filter="all"]').forEach(button => {
        button.addEventListener("click", () => {
            currentFilter = "all";
            renderNotes();
        });
    });
}

// ==========================
// DEMARRAGE
// ==========================

async function startApp() {
    setupEvents();
    setupSettings();
    updateAccountButtons();

    try {
        const account = await api("/api/auth/me");

        isLoggedIn = account.authenticated === true;
        updateAccountButtons();

        if (isLoggedIn) {
            await loadProfile();
            await loadNotes();
        } else {
            openAuth();
        }
    } catch (error) {
        console.error(error);
        isLoggedIn = false;
        updateAccountButtons();
        openAuth();
    }
}

document.addEventListener("DOMContentLoaded", startApp);
