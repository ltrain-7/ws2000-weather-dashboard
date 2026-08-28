const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const loginMessage = document.getElementById("loginMessage");

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  try {
    const status = await fetchJson("/api/auth/status");
    if (!status.enabled || status.authenticated) {
      window.location.replace(safeDestination());
      return;
    }
    if (status.requiresHttps) {
      loginMessage.textContent = "Administrator login requires the HTTPS address configured through DSM or the app's native TLS setting.";
      loginButton.disabled = true;
      return;
    }
    loginForm.addEventListener("submit", submitLogin);
  } catch (error) {
    loginMessage.textContent = error.message;
  }
}

async function submitLogin(event) {
  event.preventDefault();
  loginButton.disabled = true;
  loginMessage.textContent = "Signing in…";
  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: usernameInput.value, password: passwordInput.value })
    });
    passwordInput.value = "";
    window.location.replace(safeDestination());
  } catch (error) {
    passwordInput.value = "";
    loginMessage.textContent = error.message;
    loginButton.disabled = false;
    passwordInput.focus();
  }
}

function safeDestination() {
  return "/admin.html";
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { accept: "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}
