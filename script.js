// =========================================
// CONFIGURACIÓN SUPABASE (Opcional - No rompe si no hay credenciales)
// =========================================
let supabaseClient = null;

const initSupabase = () => {
    const supabaseUrl = 'TU_SUPABASE_URL';
    const supabaseKey = 'TU_SUPABASE_ANON_KEY';
    
    // Solo inicializar si hay credenciales válidas
    if (supabaseUrl && supabaseKey && supabaseUrl.startsWith('http')) {
        try {
            supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
            console.log('✅ Supabase inicializado');
            return true;
        } catch (error) {
            console.warn('⚠️ Error inicializando Supabase:', error.message);
            return false;
        }
    } else {
        console.warn('⚠️ Supabase no configurado - Modo demo activo');
        return false;
    }
};

// =========================================
// AUTH STATUS (Ahora es una función declarada, no flecha)
// =========================================
function checkAuthStatus() {
    if (!supabaseClient) {
        console.log('Modo demo: Sin autenticación');
        return;
    }
    
    supabaseClient.auth.getUser()
        .then(({ data: { user } }) => {
            updateAuthUI(user);
        })
        .catch((error) => {
            console.warn('Error verificando auth:', error.message);
            updateAuthUI(null);
        });
}

function updateAuthUI(user) {
    const loginBtn = document.getElementById('nav-login-btn');
    const registerBtn = document.getElementById('nav-register-btn');
    const heroCta = document.getElementById('hero-cta-primary');

    if (user) {
        if (loginBtn) { loginBtn.textContent = 'Dashboard'; loginBtn.href = 'index.html'; }
        if (registerBtn) { registerBtn.style.display = 'none'; }
        if (heroCta) { 
            heroCta.innerHTML = 'Ir al Dashboard <i data-lucide="arrow-right"></i>'; 
            heroCta.href = 'index.html'; 
        }
    } else {
        if (loginBtn) { loginBtn.textContent = 'Iniciar Sesión'; loginBtn.href = 'auth.html'; }
        if (registerBtn) { registerBtn.style.display = 'inline-block'; }
        if (heroCta) { 
            heroCta.innerHTML = 'Comenzar gratis <i data-lucide="arrow-right"></i>'; 
            heroCta.href = 'auth.html?mode=register'; 
        }
    }
    if (window.lucide) lucide.createIcons();
}

// =========================================
// MENÚ MÓVIL (Simplificado y robusto)
// =========================================
function setupMobileMenu() {
    const mobileToggle = document.getElementById('mobile-toggle');
    const navLinks = document.querySelector('.nav-links');
    const overlay = document.getElementById('menu-overlay');
    
    if (!mobileToggle || !navLinks || !overlay) {
        console.error('❌ Elementos del menú no encontrados');
        return;
    }

    const updateIcon = (isOpen) => {
        const svg = mobileToggle.querySelector('svg');
        if (!svg) return;
        
        svg.innerHTML = isOpen
            ? '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'
            : '<line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="18" x2="20" y2="18"></line>';
    };

    const openMenu = () => {
        navLinks.classList.add('mobile-menu-active');
        overlay.classList.add('active');
        updateIcon(true);
        document.body.style.overflow = 'hidden'; // Bloquea scroll del fondo
    };

    const closeMenu = () => {
        navLinks.classList.remove('mobile-menu-active');
        overlay.classList.remove('active');
        updateIcon(false);
        document.body.style.overflow = ''; // Restaura scroll
    };

    mobileToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navLinks.classList.contains('mobile-menu-active') ? closeMenu() : openMenu();
    });

    // Cerrar al tocar el overlay
    overlay.addEventListener('click', closeMenu);

    // Cerrar al hacer clic en un enlace
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', closeMenu);
    });
    
    // Cerrar con tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu();
    });
}

// =========================================
// ANIMACIONES SCROLL
// =========================================
function setupScrollAnimations() {
    if (!('IntersectionObserver' in window)) return;
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.feature-card, .pricing-card, .testimonial-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });
}

// =========================================
// SMOOTH SCROLL
// =========================================
function setupSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const target = document.querySelector(targetId);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// =========================================
// INICIALIZACIÓN (DOM Content Loaded)
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Fleet OS cargando...');
    
    // Inicializar Supabase (opcional)
    initSupabase();
    
    // Inicializar íconos
    if (window.lucide) {
        lucide.createIcons();
        console.log('✅ Íconos Lucide cargados');
    }
    
    // Configurar todo
    setupMobileMenu();
    setupScrollAnimations();
    setupSmoothScroll();
    checkAuthStatus();
    
    // Escuchar cambios de auth
    if (supabaseClient) {
        supabaseClient.auth.onAuthStateChange(() => {
            checkAuthStatus();
        });
    }
    
    console.log('✅ Todo inicializado correctamente');
});