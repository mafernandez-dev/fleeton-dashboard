// ==========================================
// CONFIGURACIÓN DE SUPABASE
// ==========================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let supabaseClient = null;

if (SUPABASE_URL !== 'TU_SUPABASE_URL' && SUPABASE_URL.startsWith('http')) {
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (error) {
        console.error('Error inicializando Supabase:', error);
    }
}

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

// ==========================================
// UTILIDAD: MOSTRAR/OCULTAR CONTRASEÑA
// ==========================================
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

    if (!supabaseClient) {
        showMessage('⚠️ Supabase no está configurado. Reemplaza las credenciales en el código.', 'warning');
        return;
    }

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    setLoading('login-btn', true, 'Ingresar');

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

        if (error) {
            showMessage(error.message, 'error');
            setLoading('login-btn', false, 'Ingresar');
        } else {
            showMessage('¡Inicio de sesión exitoso! Redirigiendo...', 'success');
            setTimeout(() => { window.location.href = 'index.html'; }, 800);
        }
    } catch (err) {
        showMessage('Error de conexión. Intenta de nuevo.', 'error');
        setLoading('login-btn', false, 'Ingresar');
    }
}

// ==========================================
// MANEJO DE REGISTRO
// ==========================================
async function handleRegister(event) {
    event.preventDefault();
    hideMessage();

    if (!supabaseClient) {
        showMessage('⚠️ Supabase no está configurado. Reemplaza las credenciales en el código.', 'warning');
        return;
    }

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    if (password.length < 6) {
        showMessage('La contraseña debe tener al menos 6 caracteres', 'error');
        return;
    }

    setLoading('register-btn', true, 'Crear cuenta');

    try {
        const { data, error } = await supabaseClient.auth.signUp({
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
                setTimeout(() => { window.location.href = 'index.html'; }, 1500);
            }
            setLoading('register-btn', false, 'Crear cuenta');
        }
    } catch (err) {
        showMessage('Error de conexión. Intenta de nuevo.', 'error');
        setLoading('register-btn', false, 'Crear cuenta');
    }
}

// ==========================================
// INICIALIZACIÓN
// ==========================================
async function checkExistingSession() {
    if (!supabaseClient) return;
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user) window.location.href = 'index.html';
    } catch (error) {
        console.error('Error verificando sesión:', error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    checkExistingSession();

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('mode') === 'register') {
        switchTab('register');
    }
});