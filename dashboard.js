/**
 * Fleet OS - Dashboard Core
 * Arquitectura: Delegación de Eventos, Estado Centralizado, Cero Contaminación Global
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUserId = null;

// =========================================
// 1. SANITIZATION & VALIDATION UTILITIES
// =========================================
function sanitizeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Sanitización estricta para atributos HTML (data-id, data-action, etc.)
function strictSanitize(str) {
    if (!str) return '';
    return str.replace(/[<>"'&]/g, (char) => ({
        '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;'
    }[char]));
}

// Para descripciones de actividad (permite <strong>)
function sanitizeActivityDescription(str) {
    if (!str) return '';
    return str.replace(/<(?!\/?strong\b)[^>]*>/gi, '');
}

// Validación de URLs
function isValidImageUrl(url) {
    if (!url) return false;
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
}

// Parseo seguro de enteros
function safeParseInt(value, min, max) {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < min || num > max) return null;
    return num;
}

function sanitizeInput(str) {
    if (!str) return '';
    return str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/on\w+\s*=/gi, '')
              .trim();
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validatePhone(phone) { return /^[\d\s\-\+\(\)]{10,20}$/.test(phone); }
function validatePlate(plate) { return /^[A-Z0-9\-]{6,10}$/i.test(plate); }
function validateYear(year) { const currentYear = new Date().getFullYear(); return year >= 1900 && year <= currentYear + 1; }
function validateRequired(value, fieldName) {
    if (!value || (typeof value === 'string' && !value.trim())) return { valid: false, message: `${fieldName} es obligatorio` };
    return { valid: true };
}

// =========================================
// 2. STATE & PERSISTENCE
// =========================================
const PLANS = {
    free: { id: 'free', name: 'Free', price: 0, limits: { units: 5, drivers: 5, alerts: 'basic' } },
    pro: { id: 'pro', name: 'Pro', price: 29, limits: { units: 25, drivers: 10, alerts: 'advanced' } },
    enterprise: { id: 'enterprise', name: 'Enterprise', price: 99, limits: { units: Infinity, drivers: Infinity, alerts: 'advanced' } }
};

const DefaultState = {
    user: { name: 'Usuario', email: '', role: 'Administrador', avatar_url: '', plan: 'free' },
    fleet: [], // Lista vacía
    drivers: [], // Lista vacía
    alerts: [], // Lista vacía
    activityLog: [],
    filters: { fleet: { status: 'all', search: '' }, alerts: { severity: 'all' }, drivers: { search: '' }, activity: { type: 'all' } },
    preferences: { notifications: true, darkMode: false },
    listeners: [],
    isLoading: false
};

let State = JSON.parse(JSON.stringify(DefaultState));
const STORAGE_KEY = 'fleet_os_state_v1';

function saveToLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            // Solo preferencias UI, NO datos de usuario
            preferences: State.preferences,
            saved_at: new Date().toISOString()
            // fleet, drivers, alerts vendrán de Supabase en producción
        }));
    } catch (e) { console.error('Error saving to localStorage:', e); }
}

function loadFromLocalStorage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // Solo carga preferencias, no datos de usuario
            if (parsed.preferences) {
                State.preferences = { ...DefaultState.preferences, ...parsed.preferences };
            }
            return true;
        }
    } catch (e) { console.error('Error loading from localStorage:', e); localStorage.removeItem(STORAGE_KEY); }
    return false;
}

// =========================================
// 3. ACTIVITY & UTILITIES
// =========================================
function logActivity(type, entity, entityId, description) {
    State.activityLog.unshift({
        id: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        timestamp: new Date().toISOString(), type, entity, entityId,
        description: sanitizeActivityDescription(description), user: sanitizeHTML(State.user.name)
    });
    if (State.activityLog.length > 100) State.activityLog = State.activityLog.slice(0, 100);
    saveToLocalStorage();
}

function timeAgo(dateString) {
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    const intervals = [{ label: 'año', seconds: 31536000 }, { label: 'mes', seconds: 2592000 }, { label: 'día', seconds: 86400 }, { label: 'hora', seconds: 3600 }, { label: 'minuto', seconds: 60 }];
    for (const interval of intervals) {
        const count = Math.floor(seconds / interval.seconds);
        if (count >= 1) return `hace ${count} ${interval.label}${count > 1 ? 's' : ''}`;
    }
    return 'hace unos segundos';
}

function getActivityIcon(type) {
    const icons = { unit_created: 'truck', unit_updated: 'edit-2', unit_deleted: 'trash-2', status_changed: 'refresh-cw', driver_created: 'user-plus', driver_updated: 'user', driver_deleted: 'user-x', alert_resolved: 'check-circle', alert_created: 'alert-triangle', maintenance_updated: 'wrench', profile_updated: 'user', plan_changed: 'credit-card', data_exported: 'download' };
    return icons[type] || 'activity';
}

function getActivityCategory(type) {
    if (type.startsWith('unit') || type === 'status_changed' || type === 'maintenance_updated') return 'unit';
    if (type.startsWith('driver')) return 'driver';
    if (type.startsWith('alert')) return 'alert';
    return 'unit';
}

function generateSeedActivity() {
    if (State.activityLog.length > 0) return;
    const now = new Date();
    const userName = State.user.name || 'Usuario'; // Usa el nombre del usuario actual
    
    [{ offset: -3600000, type: 'status_changed', entity: 'unit', entityId: 'u-003', description: '<strong>Mercedes Actros</strong> cambió a estado Taller', user: userName },
     { offset: -7200000, type: 'alert_created', entity: 'alert', entityId: 'a-001', description: 'Alerta creada: <strong>Mantenimiento Vencido</strong>', user: 'Sistema' },
     { offset: -86400000, type: 'unit_created', entity: 'unit', entityId: 'u-005', description: '<strong>MAN TGX</strong> agregada a la flota', user: userName }
    ].forEach(entry => {
        State.activityLog.push({ 
            id: 'log-seed-' + Math.random().toString(36).substr(2, 9), 
            timestamp: new Date(now.getTime() + entry.offset).toISOString(), 
            type: entry.type, 
            entity: entry.entity, 
            entityId: entry.entityId, 
            description: entry.description, 
            user: entry.user 
        });
    });
}

function getUpcomingExpirations() {
    const now = new Date();
    const upcoming = [];
    State.fleet.forEach(unit => {
        if (unit.insurance_expiry) {
            const daysUntil = Math.ceil((new Date(unit.insurance_expiry) - now) / (1000 * 60 * 60 * 24));
            if (daysUntil <= 30) upcoming.push({ id: 'ins-' + unit.id, type: 'insurance', unit_id: unit.id, unit_name: unit.unit_name, title: daysUntil < 0 ? 'Seguro vencido' : 'Seguro por vencer', detail: daysUntil < 0 ? `Venció hace ${Math.abs(daysUntil)} días` : `Vence el ${formatDate(unit.insurance_expiry)}`, days: daysUntil, severity: daysUntil <= 7 ? 'critical' : 'warning' });
        }
        if (unit.next_maintenance_date) {
            const daysUntil = Math.ceil((new Date(unit.next_maintenance_date) - now) / (1000 * 60 * 60 * 24));
            if (daysUntil <= 30 && daysUntil >= 0) upcoming.push({ id: 'maint-' + unit.id, type: 'maintenance', unit_id: unit.id, unit_name: unit.unit_name, title: 'Mantenimiento próximo', detail: `Programado para ${formatDate(unit.next_maintenance_date)}`, days: daysUntil, severity: daysUntil <= 7 ? 'critical' : 'warning' });
        }
    });
    return upcoming.sort((a, b) => a.days - b.days);
}

function getStatusLabel(status) { return ({ active: 'Activa', maintenance: 'Taller', idle: 'Inactiva' }[status]) || status; }
function formatDate(dateString) { return dateString ? new Date(dateString).toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No definida'; }
function getLimitStatus(current, limit) {
    if (limit === Infinity) return { text: `${current}/∞`, class: '' };
    const percentage = (current / limit) * 100;
    return { text: `${current}/${limit}`, class: percentage >= 90 ? 'critical' : (percentage >= 75 ? 'warning' : '') };
}
function checkUnitLimit() { const limit = PLANS[State.user.plan].limits.units; if (State.fleet.length >= limit) { showToast(`Límite alcanzado: ${limit} unidades`); return false; } return true; }
function checkDriverLimit() { const limit = PLANS[State.user.plan].limits.drivers; if (State.drivers.length >= limit) { showToast(`Límite alcanzado: ${limit} conductores`); return false; } return true; }

// =========================================
// 4. DOM & RENDER ENGINE
// =========================================
const DOM = {
    fleetContainer: document.getElementById('fleet-container'), alertsContainer: document.getElementById('alerts-container'),
    upcomingContainer: document.getElementById('upcoming-container'), upcomingFullContainer: document.getElementById('upcoming-full-container'),
    activityContainer: document.getElementById('activity-container'), activityFullContainer: document.getElementById('activity-full-container'),
    metricActive: document.getElementById('metric-active'), metricMaintenance: document.getElementById('metric-maintenance'),
    metricIdle: document.getElementById('metric-idle'), metricAlerts: document.getElementById('metric-alerts'),
    fleetFullContainer: document.getElementById('fleet-full-container'), fleetSearch: document.getElementById('fleet-search'),
    alertsFullContainer: document.getElementById('alerts-full-container'), driversContainer: document.getElementById('drivers-container'),
    driverSearch: document.getElementById('driver-search'), navItems: document.querySelectorAll('.nav-item'),
    views: document.querySelectorAll('.view'), sheetOverlay: document.getElementById('sheet-overlay'),
    bottomSheet: document.getElementById('bottom-sheet'), sheetContent: document.getElementById('sheet-content'),
    modalOverlay: document.getElementById('modal-overlay'), modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modal-title'), modalBody: document.getElementById('modal-body'),
    modalFooter: document.getElementById('modal-footer'), toastContainer: document.getElementById('toast-container')
};

function subscribe(listener) { State.listeners.push(listener); }
function notify() { State.listeners.forEach(listener => listener()); saveToLocalStorage(); }

function renderSkeleton(count = 3) { return Array(count).fill(0).map(() => `<div class="skeleton-item"><div class="skeleton skeleton-icon"></div><div class="skeleton-content"><div class="skeleton skeleton-line skeleton-line-short"></div><div class="skeleton skeleton-line"></div></div><div class="skeleton skeleton-pill"></div></div>`).join(''); }
function renderSkeletonAlerts(count = 2) { return Array(count).fill(0).map(() => `<div class="skeleton-item skeleton-alert"><div class="skeleton-content"><div class="skeleton skeleton-line skeleton-line-short"></div><div class="skeleton skeleton-line"></div></div></div>`).join(''); }

function renderMetrics() {
    DOM.metricActive.textContent = State.fleet.filter(u => u.status === 'active').length;
    DOM.metricMaintenance.textContent = State.fleet.filter(u => u.status === 'maintenance').length;
    DOM.metricIdle.textContent = State.fleet.filter(u => u.status === 'idle').length;
    DOM.metricAlerts.textContent = State.alerts.filter(a => !a.resolved).length;
}

function renderAlertBadges() {
    const unresolved = State.alerts.filter(a => !a.resolved).length;
    const critical = State.alerts.filter(a => !a.resolved && a.severity === 'critical').length;
    const alertBadge = document.getElementById('alert-badge');
    alertBadge.style.display = unresolved > 0 ? 'flex' : 'none';
    if (unresolved > 0) alertBadge.textContent = unresolved > 99 ? '99+' : unresolved;
    
    const criticalBadge = document.getElementById('critical-badge');
    if (critical > 0) { criticalBadge.style.display = 'inline-flex'; document.getElementById('critical-count').textContent = critical; }
    else { criticalBadge.style.display = 'none'; }
}

function renderAvatar() {
    const avatarImage = document.getElementById('avatar-image');
    const avatarInitials = document.getElementById('avatar-initials');
    if (State.user.avatar_url) { avatarImage.src = sanitizeHTML(State.user.avatar_url); avatarImage.style.display = 'block'; avatarInitials.style.display = 'none'; }
    else { avatarImage.style.display = 'none'; avatarInitials.style.display = 'flex'; avatarInitials.textContent = State.user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2); }
}

function renderCurrentPlan() {
    const currentPlan = PLANS[State.user.plan];
    const unitsStatus = getLimitStatus(State.fleet.length, currentPlan.limits.units);
    const driversStatus = getLimitStatus(State.drivers.length, currentPlan.limits.drivers);
    document.getElementById('current-plan-name').textContent = currentPlan.name;
    document.getElementById('current-plan-price').textContent = currentPlan.price === 0 ? 'Gratis' : `$${currentPlan.price}/mes`;
    const unitsLimitEl = document.getElementById('plan-units-limit');
    unitsLimitEl.textContent = unitsStatus.text; unitsLimitEl.className = `plan-limit-value ${unitsStatus.class}`;
    const driversLimitEl = document.getElementById('plan-drivers-limit');
    driversLimitEl.textContent = driversStatus.text; driversLimitEl.className = `plan-limit-value ${driversStatus.class}`;
}

function createFleetItemHTML(unit) {
    return `<div class="fleet-item" data-action="show-unit" data-id="${strictSanitize(unit.id)}"><div class="fleet-icon"><i data-lucide="truck"></i></div><div class="fleet-details"><div class="fleet-name">${sanitizeHTML(unit.unit_name)}</div><div class="fleet-driver">${sanitizeHTML(unit.driver)}</div></div><span class="status-pill ${sanitizeHTML(unit.status)}">${getStatusLabel(unit.status)}</span><div class="fleet-chevron"><i data-lucide="chevron-right"></i></div></div>`;
}

function createAlertItemHTML(alert) {
    return `<div class="alert-item ${sanitizeHTML(alert.severity)} ${alert.resolved ? 'resolved' : ''}" data-action="show-alert" data-id="${sanitizeHTML(alert.id)}"><div class="alert-info"><h4>${sanitizeHTML(alert.title)}</h4><p>${sanitizeHTML(alert.alert_desc)}</p></div><button class="alert-action" aria-label="Acción"><i data-lucide="chevron-right"></i></button></div>`;
}

function createUpcomingItemHTML(item) {
    const icon = item.type === 'insurance' ? 'shield' : 'wrench';
    const daysText = item.days < 0 ? 'Vencido' : (item.days === 0 ? 'Hoy' : `${item.days} días`);
    return `<div class="upcoming-item ${sanitizeHTML(item.severity)}" data-action="show-unit" data-id="${sanitizeHTML(item.unit_id)}"><div class="upcoming-icon ${sanitizeHTML(item.type)}"><i data-lucide="${icon}"></i></div><div class="upcoming-content"><div class="upcoming-title">${sanitizeHTML(item.unit_name)}</div><div class="upcoming-detail">${sanitizeHTML(item.title)} - ${sanitizeHTML(item.detail)}</div></div><div class="upcoming-days ${sanitizeHTML(item.severity)}">${daysText}</div></div>`;
}

function createActivityItemHTML(entry) {
    return `<div class="activity-item"><div class="activity-icon ${getActivityCategory(entry.type)}"><i data-lucide="${getActivityIcon(entry.type)}"></i></div><div class="activity-content"><div class="activity-description">${entry.description}</div><div class="activity-meta"><i data-lucide="clock"></i><span>${timeAgo(entry.timestamp)}</span><span>•</span><span>${sanitizeHTML(entry.user)}</span></div></div></div>`;
}

function createDriverItemHTML(driver) {
    const initials = driver.name.split(' ').map(n => n[0]).join('').toUpperCase();
    const unitsCount = State.fleet.filter(u => u.driver === driver.name).length;
    return `<div class="driver-item" data-id="${sanitizeHTML(driver.id)}"><div class="driver-avatar">${initials}</div><div class="driver-info"><div class="driver-name">${sanitizeHTML(driver.name)}</div><div class="driver-units">${unitsCount} unidad${unitsCount !== 1 ? 'es' : ''} asignada${unitsCount !== 1 ? 's' : ''}</div></div><div class="driver-actions"><button class="driver-action-btn" data-action="edit-driver" data-id="${sanitizeHTML(driver.id)}"><i data-lucide="edit-2"></i></button><button class="driver-action-btn" data-action="delete-driver" data-id="${sanitizeHTML(driver.id)}"><i data-lucide="trash-2"></i></button></div></div>`;
}

function renderDashboardFleet() { DOM.fleetContainer.innerHTML = State.fleet.slice(0, 3).map(createFleetItemHTML).join(''); lucide.createIcons(); }
function renderDashboardAlerts() { DOM.alertsContainer.innerHTML = State.alerts.filter(a => !a.resolved).slice(0, 2).map(createAlertItemHTML).join(''); lucide.createIcons(); }
function renderDashboardUpcoming() {
    const upcoming = getUpcomingExpirations().slice(0, 3);
    const upcomingSection = document.getElementById('upcoming-section');
    if (upcoming.length === 0) { upcomingSection.style.display = 'none'; }
    else { upcomingSection.style.display = 'block'; DOM.upcomingContainer.innerHTML = upcoming.map(createUpcomingItemHTML).join(''); }
    lucide.createIcons();
}
function renderUpcomingFull() {
    const upcoming = getUpcomingExpirations();
    DOM.upcomingFullContainer.innerHTML = upcoming.length === 0 ? '<div class="empty-state"><i data-lucide="check-circle"></i><h3>Sin vencimientos</h3><p>Todo está al día</p></div>' : upcoming.map(createUpcomingItemHTML).join('');
    lucide.createIcons();
}
function renderDashboardActivity() {
    const recent = State.activityLog.slice(0, 4);
    DOM.activityContainer.innerHTML = recent.length === 0 ? '<div class="empty-state"><i data-lucide="activity"></i><h3>Sin actividad</h3><p>Las acciones aparecerán aquí</p></div>' : recent.map(createActivityItemHTML).join('');
    lucide.createIcons();
}
function renderFleetFull() {
    let filtered = [...State.fleet];
    if (State.filters.fleet.status !== 'all') filtered = filtered.filter(u => u.status === State.filters.fleet.status);
    if (State.filters.fleet.search) {
        const search = State.filters.fleet.search.toLowerCase();
        filtered = filtered.filter(u => u.unit_name.toLowerCase().includes(search) || u.driver.toLowerCase().includes(search));
    }
    DOM.fleetFullContainer.innerHTML = filtered.length === 0 ? '<div class="empty-state"><i data-lucide="search-x"></i><h3>Sin resultados</h3><p>Intenta con otros filtros</p></div>' : filtered.map(createFleetItemHTML).join('');
    lucide.createIcons();
}
function renderAlertsFull() {
    let filtered = [...State.alerts];
    if (State.filters.alerts.severity === 'critical') filtered = filtered.filter(a => a.severity === 'critical' && !a.resolved);
    else if (State.filters.alerts.severity === 'warning') filtered = filtered.filter(a => a.severity === 'warning' && !a.resolved);
    else if (State.filters.alerts.severity === 'resolved') filtered = filtered.filter(a => a.resolved);
    DOM.alertsFullContainer.innerHTML = filtered.length === 0 ? '<div class="empty-state"><i data-lucide="check-circle"></i><h3>Sin alertas</h3><p>Todo está en orden</p></div>' : filtered.map(createAlertItemHTML).join('');
    lucide.createIcons();
}
function renderActivityFull() {
    let filtered = [...State.activityLog];
    if (State.filters.activity.type !== 'all') filtered = filtered.filter(a => getActivityCategory(a.type) === State.filters.activity.type);
    DOM.activityFullContainer.innerHTML = filtered.length === 0 ? '<div class="empty-state"><i data-lucide="activity"></i><h3>Sin actividad</h3><p>No hay registros en esta categoría</p></div>' : filtered.map(createActivityItemHTML).join('');
    lucide.createIcons();
}
function renderDrivers() {
    let filtered = [...State.drivers];
    if (State.filters.drivers.search) filtered = filtered.filter(d => d.name.toLowerCase().includes(State.filters.drivers.search.toLowerCase()));
    DOM.driversContainer.innerHTML = filtered.length === 0 ? '<div class="empty-state"><i data-lucide="search-x"></i><h3>Sin resultados</h3></div>' : filtered.map(createDriverItemHTML).join('');
    lucide.createIcons();
}

// =========================================
// 5. UI COMPONENTS (SHEETS & MODALS)
// =========================================
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = sanitizeHTML(message);
    DOM.toastContainer.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 200); }, 3000);
}

function setModalLoading(isLoading) {
    const btn = document.querySelector('#modal-footer .btn-modal-primary');
    if (btn) {
        if (isLoading) { btn.classList.add('is-loading'); btn.dataset.originalText = btn.textContent; btn.textContent = 'Procesando...'; }
        else { btn.classList.remove('is-loading'); btn.textContent = btn.dataset.originalText || 'Guardar'; }
    }
}

function openSheet(content) { DOM.sheetContent.innerHTML = content; DOM.sheetOverlay.classList.add('active'); DOM.bottomSheet.classList.add('active'); document.body.style.overflow = 'hidden'; lucide.createIcons(); }
function closeSheet() { 
    DOM.sheetOverlay.classList.remove('active'); 
    DOM.bottomSheet.classList.remove('active');
    DOM.bottomSheet.classList.remove('dragging');
    DOM.bottomSheet.classList.remove('closing');
    DOM.bottomSheet.style.transform = ''; // Limpia estilo inline del drag
    DOM.sheetOverlay.style.opacity = ''; // Limpia estilo inline del drag
    document.body.style.overflow = ''; 
}
function openModal(title, body, footer) { DOM.modalTitle.textContent = sanitizeHTML(title); DOM.modalBody.innerHTML = body; DOM.modalFooter.innerHTML = footer; DOM.modalOverlay.classList.add('active'); DOM.modal.classList.add('active'); document.body.style.overflow = 'hidden'; lucide.createIcons(); }
function closeModal() { DOM.modalOverlay.classList.remove('active'); DOM.modal.classList.remove('active'); document.body.style.overflow = ''; }

// =========================================
// 6. BUSINESS LOGIC (Refactored & Bug-Free)
// =========================================
function showUnitDetail(unitId) {
    const unit = State.fleet.find(u => u.id === unitId);
    if (!unit) return;
    const unitActivity = State.activityLog.filter(a => a.entityId === unitId).slice(0, 10);
    let maintenanceSection = '';
    if (unit.status === 'maintenance' && unit.maintenance_info) {
        const info = unit.maintenance_info;
        maintenanceSection = `<div class="sheet-section"><div class="sheet-section-title">Información de Taller</div><div class="sheet-info-row"><span class="sheet-info-label">Fecha de entrada</span><span class="sheet-info-value">${formatDate(info.entry_date)}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Problema</span><span class="sheet-info-value">${sanitizeHTML(info.issue)}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Piezas requeridas</span><span class="sheet-info-value">${sanitizeHTML(info.parts_needed)}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Mecánico</span><span class="sheet-info-value">${sanitizeHTML(info.mechanic)}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Salida estimada</span><span class="sheet-info-value">${formatDate(info.estimated_exit)}</span></div></div>`;
    }
    let activitySection = unitActivity.length > 0 ? `<div class="sheet-section"><div class="sheet-section-title">Historial de Actividad</div><div class="activity-list" style="padding: 0;">${unitActivity.map(createActivityItemHTML).join('')}</div></div>` : '';
    
    const content = `<h3 class="sheet-title">${sanitizeHTML(unit.unit_name)}</h3><div class="sheet-section"><div class="sheet-section-title">Información</div><div class="sheet-info-row"><span class="sheet-info-label">Conductor</span><span class="sheet-info-value">${sanitizeHTML(unit.driver)}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Placa</span><span class="sheet-info-value">${sanitizeHTML(unit.plate)}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Año</span><span class="sheet-info-value">${unit.year}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Kilometraje</span><span class="sheet-info-value">${unit.mileage.toLocaleString()} km</span></div><div class="sheet-info-row"><span class="sheet-info-label">Estado</span><span class="sheet-info-value"><span class="status-pill ${sanitizeHTML(unit.status)}">${getStatusLabel(unit.status)}</span></span></div>${unit.status_comment ? `<div class="sheet-info-row"><span class="sheet-info-label">Motivo</span><span class="sheet-info-value">${sanitizeHTML(unit.status_comment)}</span></div>` : ''}${unit.insurance_expiry ? `<div class="sheet-info-row"><span class="sheet-info-label">Seguro</span><span class="sheet-info-value">${formatDate(unit.insurance_expiry)}</span></div>` : ''}</div>${maintenanceSection}${activitySection}<div class="sheet-section"><div class="sheet-section-title">Acciones</div><div class="sheet-actions"><button class="sheet-btn" data-action="edit-unit" data-id="${strictSanitize(unit.id)}"><i data-lucide="edit-2"></i><span>Editar Unidad</span></button><button class="sheet-btn" data-action="change-status" data-id="${strictSanitize(unit.id)}"><i data-lucide="refresh-cw"></i><span>Cambiar Estado</span></button>${unit.status === 'maintenance' ? `<button class="sheet-btn" data-action="edit-maintenance" data-id="${strictSanitize(unit.id)}"><i data-lucide="wrench"></i><span>Editar Info de Taller</span></button>` : ''}<button class="sheet-btn danger" data-action="delete-unit" data-id="${strictSanitize(unit.id)}"><i data-lucide="trash-2"></i><span>Eliminar Unidad</span></button></div></div>`;
    openSheet(content);
}

function showAlertDialog(alertId) {
    const alert = State.alerts.find(a => a.id === alertId);
    if (!alert) return;
    const unit = State.fleet.find(u => u.id === alert.unit_id);
    const content = `<h3 class="sheet-title">${sanitizeHTML(alert.title)}</h3><div class="sheet-section"><div class="sheet-info-row"><span class="sheet-info-label">Unidad</span><span class="sheet-info-value">${unit ? sanitizeHTML(unit.unit_name) : 'N/A'}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Detalle</span><span class="sheet-info-value">${sanitizeHTML(alert.alert_desc)}</span></div><div class="sheet-info-row"><span class="sheet-info-label">Severidad</span><span class="sheet-info-value"><span class="status-pill ${alert.severity === 'critical' ? 'maintenance' : 'idle'}">${sanitizeHTML(alert.severity)}</span></span></div></div>${!alert.resolved ? `<div class="sheet-section"><div class="sheet-actions"><button class="sheet-btn" data-action="resolve-alert" data-id="${sanitizeHTML(alert.id)}"><i data-lucide="check-circle"></i><span>Marcar como Resuelta</span></button></div></div>` : ''}`;
    openSheet(content);
}

function editUnit(unitId) {
    closeSheet();
    const unit = State.fleet.find(u => u.id === unitId);
    if (!unit) return;
    const body = `<div class="form-group"><label class="form-label">Nombre de Unidad *</label><input type="text" class="form-input" id="edit-unit-name" value="${sanitizeHTML(unit.unit_name)}"></div><div class="form-group"><label class="form-label">Conductor *</label><input type="text" class="form-input" id="edit-unit-driver" value="${sanitizeHTML(unit.driver)}"></div><div class="form-group"><label class="form-label">Placa *</label><input type="text" class="form-input" id="edit-unit-plate" value="${sanitizeHTML(unit.plate)}" placeholder="ABC-123"><p class="form-hint">Formato: 6-10 caracteres alfanuméricos</p></div><div class="form-group"><label class="form-label">Año *</label><input type="number" class="form-input" id="edit-unit-year" value="${unit.year}" min="1900" max="${new Date().getFullYear() + 1}"></div><div class="form-group"><label class="form-label">Kilometraje *</label><input type="number" class="form-input" id="edit-unit-mileage" value="${unit.mileage}" min="0"></div><div class="form-group"><label class="form-label">Vencimiento Seguro</label><input type="date" class="form-input" id="edit-unit-insurance" value="${unit.insurance_expiry || ''}"></div><div class="form-group"><label class="form-label">Próx. Mant. (km)</label><input type="number" class="form-input" id="edit-unit-maint-km" value="${unit.next_maintenance_km || ''}" min="0"></div><div class="form-group"><label class="form-label">Próx. Mant. (fecha)</label><input type="date" class="form-input" id="edit-unit-maint-date" value="${unit.next_maintenance_date || ''}"></div>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" data-action="save-unit-edit" data-id="${strictSanitize(unit.id)}">Guardar</button>`;
    openModal('Editar Unidad', body, footer);
}

function saveUnitEdit(unitId) {
    setModalLoading(true);
    const unit = State.fleet.find(u => u.id === unitId); // BUG FIX: Added missing declaration
    if (!unit) return;
    const name = sanitizeInput(document.getElementById('edit-unit-name').value);
    const driver = sanitizeInput(document.getElementById('edit-unit-driver').value);
    const plate = sanitizeInput(document.getElementById('edit-unit-plate').value).toUpperCase();
    const year = safeParseInt(document.getElementById('edit-unit-year').value, 1900, new Date().getFullYear() + 1);
const mileage = safeParseInt(document.getElementById('edit-unit-mileage').value, 0, 9999999);

if (year === null || mileage === null) {
    setModalLoading(false);
    showToast('Valores numéricos inválidos');
    return;
}
    
    if (!validateRequired(name, 'Nombre de unidad').valid) { setModalLoading(false); showToast('Nombre de unidad es obligatorio'); return; }
    if (!validateRequired(driver, 'Conductor').valid) { setModalLoading(false); showToast('Conductor es obligatorio'); return; }
    if (!validateRequired(plate, 'Placa').valid || !validatePlate(plate)) { setModalLoading(false); showToast('Formato de placa inválido'); return; }
    if (!validateYear(year) || mileage < 0) { setModalLoading(false); showToast('Año o kilometraje inválido'); return; }

    const oldName = unit.unit_name;
    Object.assign(unit, { unit_name: name, driver, plate, year, mileage, insurance_expiry: document.getElementById('edit-unit-insurance').value, next_maintenance_km: parseInt(document.getElementById('edit-unit-maint-km').value) || null, next_maintenance_date: document.getElementById('edit-unit-maint-date').value });
    logActivity('unit_updated', 'unit', unitId, `<strong>${sanitizeHTML(oldName)}</strong> actualizada`);
    closeModal(); notify(); showToast('Unidad actualizada');
}

function changeStatus(unitId) {
    closeSheet();
    const unit = State.fleet.find(u => u.id === unitId);
    if (!unit) return;
    const body = `<div class="form-group"><label class="form-label">Nuevo Estado *</label><select class="form-select" id="change-status-select"><option value="active" ${unit.status === 'active' ? 'selected' : ''}>Activa</option><option value="maintenance" ${unit.status === 'maintenance' ? 'selected' : ''}>Taller</option><option value="idle" ${unit.status === 'idle' ? 'selected' : ''}>Inactiva</option></select></div><div class="form-group" id="status-comment-group" style="display: none;"><label class="form-label">Motivo *</label><textarea class="form-textarea" id="change-status-comment" placeholder="Explica por qué cambia el estado..."></textarea><p class="form-hint">Obligatorio para estados Taller e Inactiva</p></div>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" data-action="save-status-change" data-id="${strictSanitize(unit.id)}">Cambiar</button>`;
    openModal('Cambiar Estado', body, footer);
    setTimeout(() => {
        const select = document.getElementById('change-status-select');
        const commentGroup = document.getElementById('status-comment-group');
        select.addEventListener('change', (e) => { commentGroup.style.display = (e.target.value === 'maintenance' || e.target.value === 'idle') ? 'block' : 'none'; });
        if (select.value === 'maintenance' || select.value === 'idle') commentGroup.style.display = 'block';
    }, 100);
}

function saveStatusChange(unitId) {
    setModalLoading(true);
    const unit = State.fleet.find(u => u.id === unitId); // BUG FIX: Added missing declaration
    if (!unit) return;
    const newStatus = document.getElementById('change-status-select').value;
    const comment = sanitizeInput(document.getElementById('change-status-comment').value.trim());
    const oldStatus = unit.status;
    
    if ((newStatus === 'maintenance' || newStatus === 'idle') && !comment) { setModalLoading(false); showToast('El motivo es obligatorio'); return; }
    
    unit.status = newStatus; unit.status_comment = comment;
    logActivity('status_changed', 'unit', unitId, `<strong>${sanitizeHTML(unit.unit_name)}</strong> cambió de ${getStatusLabel(oldStatus)} a ${getStatusLabel(newStatus)}`);
    
    if (newStatus === 'maintenance') { closeModal(); setTimeout(() => editMaintenanceInfo(unitId), 300); }
    else { if (newStatus !== 'maintenance') unit.maintenance_info = null; closeModal(); notify(); showToast('Estado cambiado a ' + getStatusLabel(newStatus)); }
}

function editMaintenanceInfo(unitId) {
    closeSheet();
    const unit = State.fleet.find(u => u.id === unitId);
    if (!unit) return;
    const info = unit.maintenance_info || { entry_date: new Date().toISOString().split('T')[0], issue: '', parts_needed: '', mechanic: '', estimated_exit: '' };
    const body = `<div class="form-group"><label class="form-label">Fecha de Entrada *</label><input type="date" class="form-input" id="maint-entry-date" value="${info.entry_date}"></div><div class="form-group"><label class="form-label">Problema / Diagnóstico *</label><textarea class="form-textarea" id="maint-issue" placeholder="Describe el problema...">${sanitizeHTML(info.issue)}</textarea></div><div class="form-group"><label class="form-label">Piezas Requeridas</label><textarea class="form-textarea" id="maint-parts" placeholder="Lista de piezas necesarias...">${sanitizeHTML(info.parts_needed)}</textarea></div><div class="form-group"><label class="form-label">Mecánico / Taller</label><input type="text" class="form-input" id="maint-mechanic" value="${sanitizeHTML(info.mechanic)}" placeholder="Nombre del taller o mecánico"></div><div class="form-group"><label class="form-label">Fecha Estimada de Salida</label><input type="date" class="form-input" id="maint-estimated-exit" value="${info.estimated_exit}"></div>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" data-action="save-maintenance-info" data-id="${strictSanitize(unit.id)}">Guardar</button>`;
    openModal('Información de Taller', body, footer);
}

function saveMaintenanceInfo(unitId) {
    setModalLoading(true);
    const unit = State.fleet.find(u => u.id === unitId); // BUG FIX: Added missing declaration
    if (!unit) return;
    const entry_date = document.getElementById('maint-entry-date').value;
    const issue = sanitizeInput(document.getElementById('maint-issue').value.trim());
    if (!entry_date || !issue) { setModalLoading(false); showToast('Fecha de entrada y problema son obligatorios'); return; }
    
    unit.maintenance_info = { entry_date, issue, parts_needed: sanitizeInput(document.getElementById('maint-parts').value.trim()), mechanic: sanitizeInput(document.getElementById('maint-mechanic').value.trim()), estimated_exit: document.getElementById('maint-estimated-exit').value };
    logActivity('maintenance_updated', 'unit', unitId, `Información de taller actualizada para <strong>${sanitizeHTML(unit.unit_name)}</strong>`);
    closeModal(); notify(); showToast('Información de taller actualizada');
}

function deleteUnit(unitId) {
    closeSheet();
    const unit = State.fleet.find(u => u.id === unitId);
    const body = `<p>¿Estás seguro de que deseas eliminar <strong>${unit ? sanitizeHTML(unit.unit_name) : 'esta unidad'}</strong>? Esta acción no se puede deshacer.</p>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" style="background: var(--color-critical);" data-action="confirm-delete-unit" data-id="${sanitizeHTML(unitId)}">Eliminar</button>`;
    openModal('Eliminar Unidad', body, footer);
}

function confirmDeleteUnit(unitId) {
    const unit = State.fleet.find(u => u.id === unitId);
    if (unit) logActivity('unit_deleted', 'unit', unitId, `<strong>${sanitizeHTML(unit.unit_name)}</strong> eliminada de la flota`);
    State.fleet = State.fleet.filter(u => u.id !== unitId);
    closeModal(); notify(); showToast('Unidad eliminada');
}

function resolveAlert(alertId) {
    const alert = State.alerts.find(a => a.id === alertId);
    if (!alert) return;
    alert.resolved = true;
    logActivity('alert_resolved', 'alert', alertId, `Alerta resuelta: <strong>${sanitizeHTML(alert.title)}</strong>`);
    closeSheet(); notify(); showToast('Alerta resuelta');
}

function addUnit() {
    const body = `<div class="form-group"><label class="form-label">Nombre de Unidad *</label><input type="text" class="form-input" id="new-unit-name" placeholder="Ej: Volvo FH16"></div><div class="form-group"><label class="form-label">Conductor *</label><input type="text" class="form-input" id="new-unit-driver" placeholder="Nombre del conductor"></div><div class="form-group"><label class="form-label">Placa *</label><input type="text" class="form-input" id="new-unit-plate" placeholder="ABC-123"><p class="form-hint">Formato: 6-10 caracteres alfanuméricos</p></div><div class="form-group"><label class="form-label">Año *</label><input type="number" class="form-input" id="new-unit-year" placeholder="2023" min="1900" max="${new Date().getFullYear() + 1}"></div>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" data-action="save-new-unit">Agregar</button>`;
    openModal('Nueva Unidad', body, footer);
}

function saveNewUnit() {
    setModalLoading(true);
    if (!checkUnitLimit()) { setModalLoading(false); closeModal(); return; }
    
    const name = sanitizeInput(document.getElementById('new-unit-name').value);
    const driver = sanitizeInput(document.getElementById('new-unit-driver').value);
    const plate = sanitizeInput(document.getElementById('new-unit-plate').value).toUpperCase();
    const year = safeParseInt(document.getElementById('new-unit-year').value, 1900, new Date().getFullYear() + 1);

    // CORRECCIÓN: Validamos solo el año, ya que el kilometraje inicial es 0 por defecto
    if (year === null) {
        setModalLoading(false);
        showToast('Año inválido');
        return;
    }
    
    if (!validateRequired(name, 'Nombre de unidad').valid || !validateRequired(driver, 'Conductor').valid || !validateRequired(plate, 'Placa').valid) { 
        setModalLoading(false); 
        showToast('Completa los campos obligatorios'); 
        return; 
    }
    if (!validatePlate(plate) || !validateYear(year)) { 
        setModalLoading(false); 
        showToast('Formato de placa o año inválido'); 
        return; 
    }
    
    const newUnit = { 
        id: 'u-' + Date.now(), 
        unit_name: name, 
        driver, 
        plate, 
        year, 
        mileage: 0, 
        status: 'idle', 
        status_comment: 'Unidad recién agregada', 
        maintenance_info: null, 
        insurance_expiry: '', 
        next_maintenance_km: null, 
        next_maintenance_date: '' 
    };
    
    State.fleet.unshift(newUnit);
    logActivity('unit_created', 'unit', newUnit.id, `<strong>${sanitizeHTML(name)}</strong> agregada a la flota`);
    closeModal(); 
    notify(); 
    showToast('Unidad agregada');
}

function editProfile() {
    const body = `<div class="form-group"><label class="form-label">Foto de Perfil (URL)</label><input type="url" class="form-input" id="profile-avatar" value="${sanitizeHTML(State.user.avatar_url)}" placeholder="https://ejemplo.com/foto.jpg"><p class="form-hint">Deja vacío para usar iniciales</p></div><div class="form-group"><label class="form-label">Nombre *</label><input type="text" class="form-input" id="profile-name" value="${sanitizeHTML(State.user.name)}"></div><div class="form-group"><label class="form-label">Email *</label><input type="email" class="form-input" id="profile-email" value="${sanitizeHTML(State.user.email)}"></div><div class="form-group"><label class="form-label">Rol</label><input type="text" class="form-input" id="profile-role" value="${sanitizeHTML(State.user.role)}" readonly></div>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" data-action="save-profile">Guardar</button>`;
    openModal('Editar Perfil', body, footer);
}

function saveProfile() {
    setModalLoading(true);
    const avatar_url = sanitizeInput(document.getElementById('profile-avatar').value.trim());
    const name = sanitizeInput(document.getElementById('profile-name').value);
    const email = sanitizeInput(document.getElementById('profile-email').value);
    
    if (!validateRequired(name, 'Nombre').valid || !validateRequired(email, 'Email').valid || !validateEmail(email)) { 
        setModalLoading(false); 
        showToast('Nombre o email inválido'); 
        return; 
    }
    
    if (avatar_url && !isValidImageUrl(avatar_url)) { 
        setModalLoading(false); 
        showToast('URL de imagen inválida'); 
        return; 
    } 
    
    State.user.avatar_url = avatar_url; 
    State.user.name = name; 
    State.user.email = email;
    
    document.querySelector('.greeting-name').textContent = sanitizeHTML(name);
    logActivity('profile_updated', 'user', 'self', `Perfil actualizado por <strong>${sanitizeHTML(name)}</strong>`);
    
    closeModal(); 
    notify(); 
    showToast('Perfil actualizado');
}

function showProfileSheet() {
    const initials = State.user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const avatarHtml = State.user.avatar_url ? `<img src="${sanitizeHTML(State.user.avatar_url)}" class="profile-sheet-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="profile-sheet-avatar-fallback" style="display:none;">${initials}</div>` : `<div class="profile-sheet-avatar-fallback">${initials}</div>`;
    const content = `<div class="profile-sheet-header"><div class="profile-sheet-avatar">${avatarHtml}</div><h3 class="profile-sheet-name">${sanitizeHTML(State.user.name)}</h3><p class="profile-sheet-email">${sanitizeHTML(State.user.email)}</p><span class="profile-sheet-role">${sanitizeHTML(State.user.role)}</span></div><div class="profile-sheet-actions"><button class="sheet-btn" data-action="edit-profile"><i data-lucide="user"></i><span>Editar Perfil</span></button><button class="sheet-btn" data-nav="settings"><i data-lucide="settings"></i><span>Configuración</span></button><button class="sheet-btn danger" data-action="logout"><i data-lucide="log-out"></i><span>Cerrar Sesión</span></button></div>`;
    openSheet(content);
}

function addDriver() {
    const body = `<div class="form-group"><label class="form-label">Nombre Completo *</label><input type="text" class="form-input" id="new-driver-name" placeholder="Ej: Juan Pérez"></div><div class="form-group"><label class="form-label">Teléfono *</label><input type="tel" class="form-input" id="new-driver-phone" placeholder="+52 555 123 4567"></div><div class="form-group"><label class="form-label">Licencia *</label><input type="text" class="form-input" id="new-driver-license" placeholder="A-12345"></div>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" data-action="save-new-driver">Agregar</button>`;
    openModal('Nuevo Conductor', body, footer);
}

function saveNewDriver() {
    setModalLoading(true);
    if (!checkDriverLimit()) { setModalLoading(false); closeModal(); return; }
    const name = sanitizeInput(document.getElementById('new-driver-name').value);
    const phone = sanitizeInput(document.getElementById('new-driver-phone').value);
    const license = sanitizeInput(document.getElementById('new-driver-license').value);
    
    if (!validateRequired(name, 'Nombre').valid || !validateRequired(phone, 'Teléfono').valid || !validateRequired(license, 'Licencia').valid || !validatePhone(phone)) { setModalLoading(false); showToast('Completa los campos con formatos válidos'); return; }
    
    const newDriver = { id: 'd-' + Date.now(), name, phone, license };
    State.drivers.push(newDriver);
    logActivity('driver_created', 'driver', newDriver.id, `<strong>${sanitizeHTML(name)}</strong> registrado como conductor`);
    closeModal(); renderDrivers(); notify(); showToast('Conductor agregado');
}

function editDriver(driverId) {
    const driver = State.drivers.find(d => d.id === driverId);
    if (!driver) return;
    const body = `<div class="form-group"><label class="form-label">Nombre Completo *</label><input type="text" class="form-input" id="edit-driver-name" value="${sanitizeHTML(driver.name)}"></div><div class="form-group"><label class="form-label">Teléfono *</label><input type="tel" class="form-input" id="edit-driver-phone" value="${sanitizeHTML(driver.phone)}"></div><div class="form-group"><label class="form-label">Licencia *</label><input type="text" class="form-input" id="edit-driver-license" value="${sanitizeHTML(driver.license)}"></div>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" data-action="save-driver-edit" data-id="${sanitizeHTML(driver.id)}">Guardar</button>`;
    openModal('Editar Conductor', body, footer);
}

function saveDriverEdit(driverId) {
    setModalLoading(true);
    const driver = State.drivers.find(d => d.id === driverId);
    if (!driver) return;
    const name = sanitizeInput(document.getElementById('edit-driver-name').value);
    const phone = sanitizeInput(document.getElementById('edit-driver-phone').value);
    const license = sanitizeInput(document.getElementById('edit-driver-license').value);
    
    if (!validateRequired(name, 'Nombre').valid || !validateRequired(phone, 'Teléfono').valid || !validatePhone(phone)) { setModalLoading(false); showToast('Datos inválidos'); return; }
    
    const oldName = driver.name;
    Object.assign(driver, { name, phone, license });
    logActivity('driver_updated', 'driver', driverId, `Conductor <strong>${sanitizeHTML(oldName)}</strong> actualizado`);
    closeModal(); renderDrivers(); showToast('Conductor actualizado');
}

function deleteDriver(driverId) {
    const driver = State.drivers.find(d => d.id === driverId);
    if (!driver) return;
    const body = `<p>¿Estás seguro de que deseas eliminar a <strong>${sanitizeHTML(driver.name)}</strong>?</p>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" style="background: var(--color-critical);" data-action="confirm-delete-driver" data-id="${sanitizeHTML(driverId)}">Eliminar</button>`;
    openModal('Eliminar Conductor', body, footer);
}

function confirmDeleteDriver(driverId) {
    const driver = State.drivers.find(d => d.id === driverId);
    if (driver) logActivity('driver_deleted', 'driver', driverId, `Conductor <strong>${sanitizeHTML(driver.name)}</strong> eliminado`);
    State.drivers = State.drivers.filter(d => d.id !== driverId);
    closeModal(); renderDrivers(); notify(); showToast('Conductor eliminado');
}

function exportData() {
    const data = { export_date: new Date().toISOString(), user: State.user, fleet: State.fleet, drivers: State.drivers, alerts: State.alerts, activity_log: State.activityLog };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'fleet-os-export-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('Datos exportados');
    logActivity('data_exported', 'system', 'export', 'Datos exportados por <strong>' + State.user.name + '</strong>');
}

function syncData() {
    const btn = document.querySelector('[data-action="sync-data"]');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-2"></i><span>Sincronizando...</span>'; btn.disabled = true; lucide.createIcons();
    setTimeout(() => { btn.innerHTML = originalContent; btn.disabled = false; lucide.createIcons(); showToast('Datos sincronizados'); }, 2000);
}

function logout() {
    const body = `<p>¿Estás seguro de que deseas cerrar sesión?</p>`;
    const footer = `<button class="btn-secondary" data-action="close-modal">Cancelar</button><button class="btn-modal-primary" style="background: var(--color-critical);" data-action="confirm-logout">Cerrar Sesión</button>`;
    openModal('Cerrar Sesión', body, footer);
}

async function confirmLogout() {
    // 1. Cerrar sesión en Supabase
    await supabase.auth.signOut();
    
    // 2. Limpiar el estado local
    localStorage.removeItem(STORAGE_KEY);
    
    // 3. Mostrar mensaje y redirigir
    closeModal();
    showToast('Sesión cerrada');
    setTimeout(() => { window.location.href = 'auth.html'; }, 500);
}

function showUpgradeModal() {
    const currentPlanId = State.user.plan;
    const plansHTML = Object.values(PLANS).map(plan => {
        const isCurrent = plan.id === currentPlanId;
        const features = [(plan.limits.units === Infinity ? 'Ilimitadas' : plan.limits.units) + ' unidades', (plan.limits.drivers === Infinity ? 'Ilimitados' : plan.limits.drivers) + ' conductores', 'Alertas ' + (plan.limits.alerts === 'advanced' ? 'avanzadas' : 'básicas')];
        return `<div class="plan-option ${isCurrent ? 'current' : ''}" data-action="${isCurrent ? '' : 'select-plan'}" data-id="${plan.id}"><div class="plan-option-header"><span class="plan-option-name">${plan.name}</span><span class="plan-option-price">${plan.price === 0 ? 'Gratis' : '$' + plan.price + '/mes'}</span></div><ul class="plan-option-features">${features.map(f => `<li>${f}</li>`).join('')}</ul></div>`;
    }).join('');
    openModal('Mejorar Plan', `<div class="plans-grid">${plansHTML}</div>`, `<button class="btn-secondary" data-action="close-modal">Cancelar</button>`);
}

function selectPlan(planId) {
    if (planId === State.user.plan) return;
    const oldPlan = PLANS[State.user.plan].name;
    State.user.plan = planId;
    logActivity('plan_changed', 'user', 'self', `Plan cambiado de <strong>${oldPlan}</strong> a <strong>${PLANS[planId].name}</strong>`);
    closeModal(); notify(); showToast('Plan actualizado a ' + PLANS[planId].name);
}

// =========================================
// 7. GLOBAL EVENT DELEGATION (The Elite Way)
// =========================================
document.addEventListener('click', (e) => {
    // 1. Handle specific component clicks that don't use data-action
const fleetItem = e.target.closest('.fleet-item');
if (fleetItem) { showUnitDetail(fleetItem.dataset.id); return; }
const alertItem = e.target.closest('.alert-item');
if (alertItem) { showAlertDialog(alertItem.dataset.id); return; }
const upcomingItem = e.target.closest('.upcoming-item');
if (upcomingItem) { 
    // CORREGIDO: Usar dataset.id en lugar de dataset.unitId
    showUnitDetail(upcomingItem.dataset.id); 
    return; 
}
    
    // 2. Handle data-action clicks
    const target = e.target.closest('[data-action]');
    if (!target) {
        // Fallback for navigation links
        const navLink = e.target.closest('[data-nav]');
        if (navLink) { document.querySelector(`[data-view="${navLink.dataset.nav}"]`).click(); return; }
        return;
    }
    
    e.preventDefault();
    const action = target.dataset.action;
    const id = target.dataset.id;

    switch(action) {
        case 'show-unit': showUnitDetail(id); break;
        case 'show-alert': showAlertDialog(id); break;
        case 'edit-unit': editUnit(id); break;
        case 'save-unit-edit': saveUnitEdit(id); break;
        case 'change-status': changeStatus(id); break;
        case 'save-status-change': saveStatusChange(id); break;
        case 'edit-maintenance': editMaintenanceInfo(id); break;
        case 'save-maintenance-info': saveMaintenanceInfo(id); break;
        case 'delete-unit': deleteUnit(id); break;
        case 'confirm-delete-unit': confirmDeleteUnit(id); break;
        case 'resolve-alert': resolveAlert(id); break;
        case 'add-unit': addUnit(); break;
        case 'save-new-unit': saveNewUnit(); break;
        case 'edit-profile': editProfile(); break;
        case 'save-profile': saveProfile(); break;
        case 'show-profile': showProfileSheet(); break;
        case 'add-driver': addDriver(); break;
        case 'save-new-driver': saveNewDriver(); break;
        case 'edit-driver': editDriver(id); break;
        case 'save-driver-edit': saveDriverEdit(id); break;
        case 'delete-driver': deleteDriver(id); break;
        case 'confirm-delete-driver': confirmDeleteDriver(id); break;
        case 'upgrade-plan': showUpgradeModal(); break;
        case 'select-plan': selectPlan(id); break;
        case 'sync-data': syncData(); break;
        case 'export-data': exportData(); break;
        case 'logout': logout(); break;
        case 'confirm-logout': confirmLogout(); break;
        case 'close-modal': closeModal(); break;
        case 'close-search': closeGlobalSearch(); break;
        case 'open-search':
            document.getElementById('search-overlay').classList.add('active');
            document.getElementById('search-modal').classList.add('active');
            setTimeout(() => document.getElementById('global-search-input').focus(), 100);
            lucide.createIcons();
            break;
            
        case 'manage-drivers':
            document.getElementById('view-drivers').classList.add('active');
            document.querySelectorAll('.view').forEach(v => { if (v.id !== 'view-drivers') v.classList.remove('active'); });
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            renderDrivers();
            break;

case 'view-alerts':
    const alertsBtn = document.querySelector('[data-view="alerts"]');
    if (alertsBtn) alertsBtn.click();
    break;
    
case 'view-activity':
    // Navegación directa ya que no hay botón en el nav
    document.getElementById('view-activity').classList.add('active');
    document.querySelectorAll('.view').forEach(v => { 
        if (v.id !== 'view-activity') v.classList.remove('active'); 
    });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    renderActivityFull();
    break;
    
case 'view-upcoming':
    // Navegación directa ya que no hay botón en el nav
    document.getElementById('view-upcoming').classList.add('active');
    document.querySelectorAll('.view').forEach(v => { 
        if (v.id !== 'view-upcoming') v.classList.remove('active'); 
    });
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    renderUpcomingFull();
    break;
    }
});

// Input & Change Delegation
document.addEventListener('input', (e) => {
    if (e.target.id === 'fleet-search') { State.filters.fleet.search = sanitizeInput(e.target.value); renderFleetFull(); }
    if (e.target.id === 'driver-search') { State.filters.drivers.search = sanitizeInput(e.target.value); renderDrivers(); }
    if (e.target.id === 'global-search-input') {
        clearTimeout(window.searchTimeout);
        window.searchTimeout = setTimeout(() => {
            const query = e.target.value;
            if (!query || query.length < 2) {
                document.getElementById('search-modal-body').innerHTML = '<div class="search-empty"><i data-lucide="search"></i><p>Empieza a escribir para buscar</p></div>';
                lucide.createIcons(); return;
            }
            // Simplified search logic for brevity, matches original intent
            const search = query.toLowerCase();
            let html = '';
            const units = State.fleet.filter(u => u.unit_name.toLowerCase().includes(search) || u.driver.toLowerCase().includes(search) || u.plate.toLowerCase().includes(search));
            if (units.length > 0) {
                html += `<div class="search-category"><div class="search-category-title">Unidades (${units.length})</div>${units.map(u => `<div class="search-result-item" data-action="show-unit" data-id="${sanitizeHTML(u.id)}"><div class="search-result-title">${sanitizeHTML(u.unit_name)}</div><div class="search-result-subtitle">${sanitizeHTML(u.driver)} • ${sanitizeHTML(u.plate)}</div></div>`).join('')}</div>`;
            }
            document.getElementById('search-modal-body').innerHTML = html || `<div class="search-empty"><i data-lucide="search-x"></i><p>Sin resultados para "${sanitizeHTML(query)}"</p></div>`;
            lucide.createIcons();
        }, 300);
    }
});

document.addEventListener('change', (e) => {
    if (e.target.id === 'toggle-notifications') {
        State.preferences.notifications = e.target.checked;
        showToast(e.target.checked ? 'Notificaciones activadas' : 'Notificaciones desactivadas');
        saveToLocalStorage();
    }
    if (e.target.id === 'toggle-dark-mode') {
        State.preferences.darkMode = e.target.checked;
        document.body.classList.toggle('dark-mode', e.target.checked);
        showToast(e.target.checked ? 'Modo oscuro activado' : 'Modo claro activado');
    }
});

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const targetView = item.dataset.view;
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.view').forEach(view => { view.classList.remove('active'); if (view.id === 'view-' + targetView) view.classList.add('active'); });
    });
});

document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
        const parent = chip.parentElement;
        parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (parent.id === 'view-fleet' || parent.closest('#view-fleet')) { State.filters.fleet.status = chip.dataset.status; renderFleetFull(); }
        else if (parent.closest('#view-alerts')) { State.filters.alerts.severity = chip.dataset.severity; renderAlertsFull(); }
        else if (parent.closest('#view-activity')) { State.filters.activity.type = chip.dataset.activityType; renderActivityFull(); }
    });
});

function closeGlobalSearch() {
    document.getElementById('search-overlay').classList.remove('active');
    document.getElementById('search-modal').classList.remove('active');
    document.getElementById('global-search-input').value = '';
    document.getElementById('search-modal-body').innerHTML = '<div class="search-empty"><i data-lucide="search"></i><p>Empieza a escribir para buscar</p></div>';
    lucide.createIcons();
}

document.getElementById('search-overlay').addEventListener('click', closeGlobalSearch);
document.getElementById('sheet-overlay').addEventListener('click', closeSheet);
document.getElementById('modal-overlay').addEventListener('click', closeModal);

document.getElementById('critical-badge').addEventListener('click', () => {
    document.querySelector('[data-view="alerts"]').click();
    setTimeout(() => {
        document.querySelectorAll('#view-alerts .chip').forEach(c => c.classList.remove('active'));
        const criticalChip = document.querySelector('#view-alerts .chip[data-severity="critical"]');
        if (criticalChip) { criticalChip.classList.add('active'); State.filters.alerts.severity = 'critical'; renderAlertsFull(); }
    }, 100);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (DOM.modal.classList.contains('active')) closeModal();
        if (DOM.bottomSheet.classList.contains('active')) closeSheet();
        if (document.getElementById('search-modal').classList.contains('active')) closeGlobalSearch();
    }
});

// =========================================
// DRAG TO DISMISS (Bottom Sheet) - Corregido
// =========================================
(function initDragToDismiss() {
    const sheet = document.getElementById('bottom-sheet');
    const overlay = document.getElementById('sheet-overlay');
    const handle = sheet.querySelector('.sheet-handle');
    let startY = 0;
    let currentY = 0;
    let isDragging = false;
    const CLOSE_THRESHOLD = 0.3;

    function onStart(e) {
        isDragging = true;
        startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
        sheet.classList.add('dragging');
        sheet.classList.remove('closing');
    }

    function onMove(e) {
        if (!isDragging) return;
        
        const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
        currentY = clientY - startY;
        
        // Solo permitir arrastre hacia abajo
        if (currentY > 0) {
            e.preventDefault();
            sheet.style.transform = `translateX(-50%) translateY(${currentY}px)`;
            
            // Feedback visual: opacidad del overlay
            const overlay = document.getElementById('sheet-overlay');
            const opacity = Math.max(0, 1 - (currentY / 300));
            overlay.style.opacity = opacity;
        }
    }

    function onEnd() {
    if (!isDragging) return;
    isDragging = false;
    sheet.classList.remove('dragging');
    
    const sheetHeight = sheet.offsetHeight;
    const dragPercentage = currentY / sheetHeight;
    
    if (dragPercentage > CLOSE_THRESHOLD) {
        // Cerrar: animar hacia abajo
        sheet.classList.add('closing');
        sheet.style.transform = `translateX(-50%) translateY(100%)`;
        overlay.style.opacity = '0';
        
        setTimeout(() => {
            closeSheet(); // closeSheet ahora limpia todo
        }, 250);
    } else {
        // Volver a la posición original
        sheet.style.transform = '';
        overlay.style.opacity = '';
    }
    
    currentY = 0;
}

    // Touch events (móvil)
    handle.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);

    // Mouse events (desktop)
    handle.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
})();

// Manejo global de errores
window.addEventListener('error', (e) => {
    console.error('Error no capturado:', e.error);
    showToast('Ocurrió un error inesperado');
});

window.addEventListener('unhandledrejection', (e) => {
    console.error('Promise rechazada:', e.reason);
    showToast('Error de conexión');
});

// =========================================
// 8. INITIALIZATION
// =========================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. VERIFICAR SESIÓN
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = 'auth.html';
        return;
    }
    currentUserId = session.user.id;

    // 2. CARGAR PERFIL PRIMERO
    try {
        const { data: profileData } = await supabase.from('profiles').select('*').eq('id', currentUserId).single();
        if (profileData) {
            State.user.name = profileData.full_name || 'Usuario';
            State.user.email = session.user.email;
            State.user.plan = profileData.plan || 'free';
            State.user.avatar_url = profileData.avatar_url || '';
            
            // Actualiza el nombre INMEDIATAMENTE
            const greetingElement = document.querySelector('.greeting-name');
            if (greetingElement) {
                greetingElement.textContent = State.user.name;
            }
        }
    } catch (error) {
        console.error('Error cargando perfil:', error);
    }

    // 3. CARGAR RESTO DE DATOS
    try {
        const { data: fleetData } = await supabase.from('fleet').select('*').order('created_at', { ascending: false });
        if (fleetData && fleetData.length > 0) State.fleet = fleetData;

        const { data: driversData } = await supabase.from('drivers').select('*');
        if (driversData && driversData.length > 0) State.drivers = driversData;

        const { data: alertsData } = await supabase.from('alerts').select('*');
        if (alertsData && alertsData.length > 0) State.alerts = alertsData;
    } catch (error) {
        console.error('Error cargando datos:', error);
    }

    // 4. RENDERIZAR TODO
    [renderMetrics, renderDashboardFleet, renderDashboardAlerts, renderDashboardUpcoming, renderUpcomingFull, renderDashboardActivity, renderFleetFull, renderAlertsFull, renderActivityFull, renderAlertBadges, renderAvatar, renderCurrentPlan].forEach(subscribe);
    
    notify();
    lucide.createIcons();
    
    if (State.preferences.darkMode) { 
        document.body.classList.add('dark-mode'); 
        document.getElementById('toggle-dark-mode').checked = true; 
    }

    // 5. ✅ OCULTAR SPLASH SCREEN (con un pequeño delay para suavidad)
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.classList.add('hidden');
            // Remover del DOM después de la animación
            setTimeout(() => splash.remove(), 400);
        }
    }, 300);
});