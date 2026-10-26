import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// FUNCIONES DE UI
// ==========================================
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
    });
    
    const activeTab = document.querySelector(`[data-tab="${tab}"]`);
    activeTab.classList.add('active');
    activeTab.setAttribute('aria-selected', 'true');

    document.querySelectorAll('.form-container').forEach(f => f.classList.remove('active'));
    document.getElementById(`${tab}-form`).classList.add('active');

    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    
    if (tab === 'login') {
        title.textContent = 'Bienvenido de vuelta';
        subtitle.textContent = 'Inicia sesión para gestionar tu flota';
    } else {
        title.textContent = 'Crear tu cuenta';
        subtitle.textContent = 'Comienza a gestionar tu flota hoy';
    }

    hideMessage();
}

function showMessage(text, type) {
    const msgBox = document.getElementById('message-box');
    const icons = {
        error: '<i data-lucide="alert-circle"></i>',
        success: '<i data-lucide="check-circle"></i>',
        warning: '<i data-lucide="alert-triangle"></i>'
    };
    msgBox.innerHTML = `${icons[type] || ''}<span>${text}</span>`;
    msgBox.className = `message show ${type}`;
    lucide.createIcons();
}

function hideMessage() {
    document.getElementById('message-box').className = 'message';
}

function setLoading(buttonId, isLoading, originalText) {
    const btn = document.getElementById(buttonId);
    if (isLoading) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner"></div><span>Procesando...</span>';
    } else {
        btn.disabled = false;
        btn.innerHTML = `<span>${originalText}</span>`;
    }
}

function togglePassword(inputId, button) {
    const input = document.getElementById(inputId);
    const icon = button.querySelector('i');
    
    if (input.type === 'password') {
        input.type = 'text';
        icon.setAttribute('data-lucide', 'eye-off');
    } else {
        input.type = 'password';
        icon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
}

// ==========================================
// MANEJO DE LOGIN
// ==========================================
async function handleLogin(event) {
    event.preventDefault();
    hideMessage();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    setLoading('login-btn', true, 'Ingresar');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
        showMessage(error.message, 'error');
        setLoading('login-btn', false, 'Ingresar');
    } else {
        showMessage('¡Inicio de sesión exitoso! Redirigiendo...', 'success');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
    }
}

// ==========================================
// MANEJO DE REGISTRO
// ==========================================
async function handleRegister(event) {
    event.preventDefault();
    hideMessage();

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    if (password.length < 6) {
        showMessage('La contraseña debe tener al menos 6 caracteres', 'error');
        return;
    }

    setLoading('register-btn', true, 'Crear cuenta');

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } }
    });

    if (error) {
        showMessage(error.message, 'error');
        setLoading('register-btn', false, 'Crear cuenta');
    } else {
        if (data.user && !data.user.confirmed_at) {
            showMessage('¡Cuenta creada! Revisa tu email para confirmar y luego inicia sesión.', 'success');
            setTimeout(() => {
                switchTab('login');
                document.getElementById('login-email').value = email;
            }, 2000);
        } else {
            showMessage('¡Cuenta creada! Redirigiendo al dashboard...', 'success');
            setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
        }
        setLoading('register-btn', false, 'Crear cuenta');
    }
}

// ==========================================
// VERIFICAR SESIÓN
// ==========================================
async function checkExistingSession() {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) window.location.href = 'dashboard.html';
    } catch (error) {
        console.error('Error verificando sesión:', error);
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    checkExistingSession();

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Toggle password
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const input = btn.previousElementSibling;
            togglePassword(input.id, btn);
        });
    });

    // Forms
    document.getElementById('login-form').querySelector('form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').querySelector('form').addEventListener('submit', handleRegister);

    // URL params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'register') {
        switchTab('register');
    }
});