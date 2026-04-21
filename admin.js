/* ═══════════════════════════════════════════════════════════════════
   RIED & RÔLE — Admin Panel Script
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONFIG ─────────────────────────────────────────────────────── */
const SESSION_KEY = 'rr_admin_auth';
const TOKEN_KEY   = 'rr_admin_token';
const PERMS_KEY   = 'rr_admin_perms';

const SECTION_PERMS = { evenements: 'evenements', jeux: 'jeux', equipe: 'equipe', blog: 'blog', site: 'site' };

let editingTeamId    = null;
let editingEventId   = null;
let editingGameId    = null;
let editingBlogId    = null;
let editingAccountId = null;
let currentPhotoData     = null;
let currentGameImageData = null;
let gameImageCleared     = false;

let _eventSnap = null;
let _gameSnap  = null;
let _blogSnap  = null;

/* ─── STORAGE KEYS (= file base names in data/) ──────────────────── */
const KEYS = {
  events:    'events',
  games:     'games',
  team:      'team',
  regs:      'registrations',
  tables:    'tables',
  blog:      'blog',
  site:      'site',
  subs:      'subscriptions',
  evtnotif:  'event_notif_subs',
  notif:     'notif_log',
  analytics: 'analytics'
};

const BLOG_CATS = {
  'annonce':        { label: 'Annonce',                color: 'blue',   icon: '📢', gradient: 'linear-gradient(135deg,#050b1a,#0e204d)' },
  'critique':       { label: 'Critique de jeu',        color: 'purple', icon: '🎮', gradient: 'linear-gradient(135deg,#1a0a2e,#4b1c7d)' },
  'evenement':      { label: 'Événement',              color: 'red',    icon: '🎉', gradient: 'linear-gradient(135deg,#1a0808,#7d1c1c)' },
  'conseil-mj':     { label: 'Conseil MJ',             color: 'orange', icon: '📜', gradient: 'linear-gradient(135deg,#1a1a0a,#5c4b1c)' },
  'conseil-joueur': { label: 'Conseil Joueur',         color: 'green',  icon: '🎲', gradient: 'linear-gradient(135deg,#0a1a0a,#1c5c1c)' },
  'photos':         { label: 'Photos',                 color: 'teal',   icon: '📷', gradient: 'linear-gradient(135deg,#001014,#002535)' },
  'vie-asso':       { label: "Vie de l'asso",          color: 'pink',   icon: '🏠', gradient: 'linear-gradient(135deg,#1a0514,#5c0d3a)' },
  'compte-rendu':   { label: 'Compte rendu de partie', color: 'indigo', icon: '📖', gradient: 'linear-gradient(135deg,#08001a,#180040)' },
};

/* ─── In-memory cache (populated by initData) ────────────────────── */
const _cache = {};

async function initData() {
  await Promise.all(Object.values(KEYS).map(async key => {
    try {
      const res = await fetch(`/data/${key}.json`);
      _cache[key] = res.ok ? await res.json() : [];
    } catch {
      try { _cache[key] = JSON.parse(localStorage.getItem('rr_' + key) || '[]'); }
      catch { _cache[key] = []; }
    }
  }));
}

/* ═══════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  await initData();
  checkAuth();
  bindLogin();
  bindLogout();
  bindSectionNav();
  bindGameCategoryAutoFill();
  bindMemberTypeToggle();
  bindPhotoInput();
  bindGameImageInput();
  bindForms();
  bindBlogForm();
  bindSiteForm();
  bindAccountForm();
  renderAll();
});

/* ═══════════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════════ */
function checkAuth() {
  if (sessionStorage.getItem(SESSION_KEY) === 'true') {
    showShell();
    const perms = JSON.parse(sessionStorage.getItem(PERMS_KEY) || 'null');
    applyPermissions(perms || ['evenements','jeux','equipe','blog','site']);
  }
}

function applyPermissions(perms) {
  const all = !perms || perms.length === 0;
  document.querySelectorAll('.admin-nav-btn[data-section]').forEach(btn => {
    const allowed = all || perms.includes(btn.dataset.section);
    btn.style.display = allowed ? '' : 'none';
  });
  // If active section is now hidden, switch to first visible section
  const activeBtn = document.querySelector('.admin-nav-btn.active');
  if (activeBtn && activeBtn.style.display === 'none') {
    const firstVisible = document.querySelector('.admin-nav-btn[data-section]:not([style*="none"])');
    if (firstVisible) firstVisible.click();
  }
}

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + (sessionStorage.getItem(TOKEN_KEY) || '')
  };
}

function showShell() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-shell').classList.remove('hidden');
}

function bindLogin() {
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const user    = document.getElementById('login-user').value.trim();
    const pass    = document.getElementById('login-pass').value;
    const errEl   = document.getElementById('login-error');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    errEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Connexion…';

    try {
      const res  = await fetch('/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ user, pass })
      });
      const data = await res.json();

      if (data.ok) {
        sessionStorage.setItem(SESSION_KEY, 'true');
        sessionStorage.setItem(TOKEN_KEY,   data.token);
        sessionStorage.setItem(PERMS_KEY,   JSON.stringify(data.permissions));
        showShell();
        applyPermissions(data.permissions);
        renderAll();
      } else {
        errEl.textContent = 'Identifiants incorrects.';
        errEl.hidden = false;
        document.getElementById('login-pass').value = '';
        document.getElementById('login-pass').focus();
      }
    } catch {
      errEl.textContent = 'Impossible de joindre le serveur.';
      errEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Se connecter';
    }
  });
}

function bindLogout() {
  document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(PERMS_KEY);
    location.reload();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   SECTION NAVIGATION
═══════════════════════════════════════════════════════════════════ */
function _fetchAndRenderAnalytics() {
  const btn = document.getElementById('btn-refresh-analytics');
  if (btn) { btn.textContent = '⟳ …'; btn.disabled = true; }
  fetch('/data/analytics.json', { cache: 'no-store' })
    .then(r => r.ok ? r.json() : {})
    .then(d => {
      _cache[KEYS.analytics] = d;
      renderAnalytics();
    })
    .catch(() => renderAnalytics())
    .finally(() => {
      if (btn) { btn.textContent = '⟳ Rafraîchir'; btn.disabled = false; }
    });
}

function bindSectionNav() {
  document.querySelectorAll('.admin-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.admin-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('section-' + btn.dataset.section).classList.add('active');

      if (btn.dataset.section === 'site') {
        renderNotifications();
        _fetchAndRenderAnalytics();
      }
    });
  });

  const refreshBtn = document.getElementById('btn-refresh-analytics');
  if (refreshBtn) refreshBtn.addEventListener('click', _fetchAndRenderAnalytics);
}

/* ═══════════════════════════════════════════════════════════════════
   FORMS — BIND ALL
═══════════════════════════════════════════════════════════════════ */
function bindForms() {
  document.getElementById('form-events').addEventListener('submit', e => {
    e.preventDefault();
    const data = collectForm(e.target);

    if (!data.startDay || !data.startMonth || !data.startYear || !data.title || !data.description) {
      showToast('Merci de remplir les champs obligatoires (*)', true);
      return;
    }

    const fields = {
      startDay:      data.startDay,
      startMonth:    data.startMonth,
      startYear:     data.startYear,
      startTimeFrom: data.startTimeFrom || '',
      startTimeTo:   data.startTimeTo   || '',
      endDay:        data.endDay        || '',
      endMonth:      data.endMonth      || '',
      endYear:       data.endYear       || '',
      endTimeFrom:   data.endTimeFrom   || '',
      endTimeTo:     data.endTimeTo     || '',
      title:         data.title,
      tag:           data.tag || 'Événement',
      tagColor:      data.tagColor || 'orange',
      description:   data.description,
      location:      data.location  || '',
      capacity:      data.capacity  || '',
      inscription:   data.inscription === 'on',
      featured:      data.featured === 'on'
    };

    if (editingEventId) {
      const snap = _eventSnap || {};
      const items = getData(KEYS.events).map(ev =>
        ev.id === editingEventId ? { ...ev, ...fields } : ev
      );
      saveData(KEYS.events, items);
      cancelEventEdit();
      renderEvents();
      showToast('Événement modifié !');
      const changes = diffEvent(snap, fields);
      if (changes.length) logNotification('event_modified', `L'événement « ${fields.title} » a été modifié`, changes, '#evenements');
    } else {
      prepend(KEYS.events, { id: genId('evt'), ...fields });
      logNotification('event_added', `Nouvel événement : « ${fields.title} »`, [], '#evenements');
      e.target.reset();
      renderEvents();
      showToast('Événement ajouté !');
    }
  });

  document.getElementById('form-games').addEventListener('submit', e => {
    e.preventDefault();
    const data = collectForm(e.target);

    if (!data.category || !data.title || !data.description) {
      showToast('Merci de remplir les champs obligatoires (*)', true);
      return;
    }

    const categoryMap = {
      fantasy:        { tag: 'Fantasy',         color: 'purple', icon: '⚔',  gradient: 'linear-gradient(135deg,#1a0a2e,#4b1c7d)' },
      horreur:        { tag: 'Horreur',         color: 'red',    icon: '💀',  gradient: 'linear-gradient(135deg,#1a0808,#7d1c1c)' },
      scifi:          { tag: 'Sci-Fi',          color: 'green',  icon: '🚀',  gradient: 'linear-gradient(135deg,#0a0a1a,#1c1c5c)' },
      historique:     { tag: 'Historique',      color: 'orange', icon: '🏛️', gradient: 'linear-gradient(135deg,#1a1a0a,#5c4b1c)' },
      multivers:      { tag: 'Multivers',       color: 'pink',   icon: '🌀',  gradient: 'linear-gradient(135deg,#1a0514,#5c0d3a)' },
      cyberpunk:      { tag: 'Cyberpunk',       color: 'cyan',   icon: '🤖',  gradient: 'linear-gradient(135deg,#001a1a,#003d40)' },
      postapocalypse: { tag: 'Post-Apocalypse', color: 'amber',  icon: '☢️', gradient: 'linear-gradient(135deg,#1a0c00,#4a2200)' },
      caricatural:    { tag: 'Caricatural',     color: 'lime',   icon: '🃏',  gradient: 'linear-gradient(135deg,#081a00,#1a3d00)' },
      contemporain:   { tag: 'Contemporain',    color: 'blue',   icon: '🏙️', gradient: 'linear-gradient(135deg,#050b1a,#0e204d)' },
      fantasyjap:     { tag: 'Fantasy Jap.',    color: 'rose',   icon: '⛩️', gradient: 'linear-gradient(135deg,#1a0508,#4a0f18)' },
      superheros:     { tag: 'Super-Héros',     color: 'gold',   icon: '⚡',  gradient: 'linear-gradient(135deg,#1a1400,#403200)' },
      western:        { tag: 'Western',         color: 'brown',  icon: '🤠',  gradient: 'linear-gradient(135deg,#1a0e00,#3d2200)' },
      generique:      { tag: 'Générique',       color: 'slate',  icon: '⚙️', gradient: 'linear-gradient(135deg,#0d1117,#1e2432)' },
      autre:          { tag: 'Autre',           color: 'gray',   icon: '❓',  gradient: 'linear-gradient(135deg,#111111,#252525)' },
      pirates:        { tag: 'Pirates',         color: 'teal',   icon: '⚓',  gradient: 'linear-gradient(135deg,#001014,#002535)' },
      sciencefantasy: { tag: 'Sci-Fantasy',     color: 'indigo', icon: '🔮',  gradient: 'linear-gradient(135deg,#08001a,#180040)' },
    };
    const cat = categoryMap[data.category] || { tag: data.category, color: 'purple', icon: '⚔', gradient: 'linear-gradient(135deg,#1a0a2e,#4b1c7d)' };

    const item = {
      id:          genId('game'),
      title:       data.title,
      category:    data.category,
      tag:         cat.tag,
      tagColor:    cat.color,
      icon:        cat.icon,
      gradient:    cat.gradient,
      image:       currentGameImageData || null,
      description: data.description,
      badges:      data.badges ? data.badges.split(',').map(s => s.trim()).filter(Boolean) : [],
      popular:     data.popular === 'on'
    };

    if (editingGameId) {
      const snap = _gameSnap || {};
      if (currentGameImageData !== null) {
        item.image = currentGameImageData;
      } else if (!gameImageCleared) {
        item.image = snap.image || null;
      }
      const items = getData(KEYS.games).map(g =>
        g.id === editingGameId ? { ...g, ...item, id: editingGameId } : g
      );
      saveData(KEYS.games, items);
      cancelGameEdit();
      renderGames();
      showToast('Jeu modifié !');
      const changes = diffGame(snap, item);
      if (changes.length) logNotification('game_modified', `Le jeu « ${item.title} » a été modifié`, changes, '#jeux');
    } else {
      prepend(KEYS.games, item);
      logNotification('game_added', `Nouveau jeu de rôle : « ${item.title} »`, [], '#jeux');
      e.target.reset();
      _clearGameImage();
      renderGames();
      showToast('Jeu ajouté !');
    }
  });

  document.getElementById('form-team').addEventListener('submit', e => {
    e.preventDefault();
    const data = collectForm(e.target);

    if (!data.name || (data.type !== 'mj' && !data.role)) {
      showToast('Merci de remplir les champs obligatoires (*)', true);
      return;
    }

    const initials = data.name
      .split(' ')
      .map(w => w[0] || '')
      .join('')
      .toUpperCase()
      .slice(0, 2);

    if (editingTeamId) {
      const items = getData(KEYS.team).map(m => {
        if (m.id !== editingTeamId) return m;
        return {
          ...m,
          name:        data.name,
          initials:    initials,
          photo:       currentPhotoData !== null ? currentPhotoData : m.photo || null,
          role:        data.role,
          roleBadge:   data.roleBadge || data.role.split('&')[0].trim(),
          mjStyle:     data.mjStyle || '',
          bio:         data.bio || '',
          games:       getSelectedGames(),
          gradient:    data.gradient || 'linear-gradient(135deg,#1a0a2e,#4b1c7d)',
          type:        data.type || 'bureau',
          isPresident: data.isPresident === 'on'
        };
      });
      saveData(KEYS.team, items);
      cancelTeamEdit();
      renderTeam();
      showToast('Membre modifié !');
    } else {
      const item = {
        id:          genId('member'),
        name:        data.name,
        initials:    initials,
        photo:       currentPhotoData || null,
        role:        data.role,
        roleBadge:   data.roleBadge || data.role.split('&')[0].trim(),
        mjStyle:     data.mjStyle || '',
        bio:         data.bio || '',
        games:       getSelectedGames(),
        gradient:    data.gradient || 'linear-gradient(135deg,#1a0a2e,#4b1c7d)',
        type:        data.type || 'bureau',
        isPresident: data.isPresident === 'on'
      };
      prepend(KEYS.team, item);
      e.target.reset();
      currentPhotoData = null;
      document.getElementById('member-photo-preview').style.display = 'none';
      document.getElementById('member-photo-img').src = '';
      Array.from(document.getElementById('games-select').options).forEach(o => o.selected = false);
      renderTeam();
      showToast('Membre ajouté !');
    }
  });
}

/* ─── Photo input ────────────────────────────────────────────────── */
function bindPhotoInput() {
  const input    = document.getElementById('member-photo-input');
  const preview  = document.getElementById('member-photo-preview');
  const img      = document.getElementById('member-photo-img');
  const clearBtn = document.getElementById('member-photo-clear');

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      currentPhotoData = e.target.result;
      img.src = currentPhotoData;
      preview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  });

  clearBtn.addEventListener('click', () => {
    currentPhotoData = null;
    input.value = '';
    img.src = '';
    preview.style.display = 'none';
  });
}

/* ─── Game image input ───────────────────────────────────────────── */
function _clearGameImage() {
  currentGameImageData = null;
  gameImageCleared     = false;
  const input   = document.getElementById('game-image-input');
  const preview = document.getElementById('game-image-preview');
  const img     = document.getElementById('game-image-img');
  if (input)   input.value = '';
  if (img)     img.src = '';
  if (preview) preview.style.display = 'none';
}

function bindGameImageInput() {
  const input    = document.getElementById('game-image-input');
  const preview  = document.getElementById('game-image-preview');
  const img      = document.getElementById('game-image-img');
  const clearBtn = document.getElementById('game-image-clear');

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      currentGameImageData = e.target.result;
      gameImageCleared     = false;
      img.src = currentGameImageData;
      preview.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  });

  clearBtn.addEventListener('click', () => {
    currentGameImageData = null;
    gameImageCleared     = true;
    input.value = '';
    img.src = '';
    preview.style.display = 'none';
  });
}

/* ─── Blog form handler ───────────────────────────────────────────── */
function bindBlogForm() {
  document.getElementById('form-blog').addEventListener('submit', e => {
    e.preventDefault();
    const data = collectForm(e.target);
    if (!data.title || !data.category || !data.author || !data.date || !data.excerpt) return;
    const cat = BLOG_CATS[data.category] || { label: data.category, color: 'blue', icon: '📰', gradient: 'linear-gradient(135deg,#050b1a,#0e204d)' };
    const item = {
      title:    data.title.trim(),
      category: data.category,
      catLabel: cat.label,
      tagColor: cat.color,
      icon:     cat.icon,
      gradient: cat.gradient,
      author:   data.author.trim(),
      date:     data.date,
      excerpt:  data.excerpt.trim(),
      createdAt: new Date().toISOString()
    };
    if (editingBlogId) {
      const snap = _blogSnap || {};
      item.id = editingBlogId;
      _cache[KEYS.blog] = getData(KEYS.blog).map(b => b.id === editingBlogId ? item : b);
      saveData(KEYS.blog, _cache[KEYS.blog]);
      cancelBlogEdit();
      renderBlog();
      showToast('Article modifié !');
      const changes = diffBlog(snap, item);
      if (changes.length) logNotification('blog_modified', `L'article « ${item.title} » a été modifié`, changes, '#blog');
    } else {
      prepend(KEYS.blog, { id: genId('blog'), ...item });
      logNotification('blog_added', `Nouvel article : « ${item.title} »`, [], '#blog');
      e.target.reset();
      renderBlog();
      showToast('Article ajouté !');
    }
  });
}

/* ─── Auto-fill game tag from category ───────────────────────────── */
function bindGameCategoryAutoFill() {
  // tag/color/icon are now fully derived from category at save time — nothing to bind
}

/* ─── Populate games multi-select from catalog ───────────────────── */
function populateGamesSelect(selectedGames) {
  const sel = document.getElementById('games-select');
  if (!sel) return;
  const prev = selectedGames || Array.from(sel.selectedOptions).map(o => o.value);
  sel.innerHTML = '';
  getData(KEYS.games).forEach(g => {
    const opt = document.createElement('option');
    opt.value       = g.title;
    opt.textContent = g.title;
    opt.selected    = prev.includes(g.title);
    sel.appendChild(opt);
  });
}

function getSelectedGames() {
  const sel = document.getElementById('games-select');
  return sel ? Array.from(sel.selectedOptions).map(o => o.value) : [];
}

/* ─── Show/hide MJ style field based on type select ──────────────── */
function bindMemberTypeToggle() {
  const typeSelect      = document.getElementById('member-type');
  const presidentGroup  = document.getElementById('president-group');
  const gamesGroup      = document.getElementById('games-group');
  const roleBadgeGroup  = document.getElementById('role-badge-group');
  const roleInput       = document.getElementById('role-input');

  typeSelect.addEventListener('change', () => {
    const isMJ = typeSelect.value === 'mj';
    presidentGroup.style.display = isMJ ? 'none'  : 'block';
    gamesGroup.style.display     = isMJ ? 'block' : 'none';
    roleBadgeGroup.style.display = isMJ ? 'none'  : '';
    roleInput.required           = !isMJ;
    if (isMJ) populateGamesSelect();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER ALL
═══════════════════════════════════════════════════════════════════ */
function renderAll() {
  renderEvents();
  renderGames();
  renderTeam();
  renderBlog();
  renderSite();
}

/* ─── Events list ────────────────────────────────────────────────── */
function renderEvents() {
  const items = getData(KEYS.events);
  const list  = document.getElementById('list-events');
  const count = document.getElementById('count-events');
  count.textContent = items.length;

  if (!items.length) {
    list.innerHTML = '<p class="empty-msg">Aucun événement enregistré.</p>';
    return;
  }

  list.innerHTML = items.map(item => `
    <div class="admin-item admin-item--event">
      <div class="admin-item-row">
        <div class="admin-item-info">
          <div class="admin-item-title">${esc(item.title)}</div>
          <div class="admin-item-meta">
              ${esc(item.startDay || item.day || '')} ${esc(item.startMonth || item.month || '')} ${esc(item.startYear || item.year || '')}${item.endDay ? ` → ${esc(item.endDay)} ${esc(item.endMonth)} ${esc(item.endYear)}` : ''}
              — ${esc(item.location || '—')}
            </div>
          <div class="admin-item-badges">
            <span class="admin-item-badge badge-${esc(item.tagColor)}">${esc(item.tag)}</span>
            ${item.featured ? '<span class="admin-item-badge badge-orange">★ Vedette</span>' : ''}
          </div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-add-table" data-event-id="${esc(item.id)}" data-event-title="${esc(item.title)}">+ Table</button>
          <button class="btn-registrations" data-reg-event="${esc(item.id)}" data-reg-title="${esc(item.title)}">
            Inscriptions <span class="reg-count">${getRegistrationCount(item.id)}</span>
          </button>
          <button class="btn-edit" data-edit-event="${esc(item.id)}">Modifier</button>
          <button class="btn-danger" data-delete="${esc(item.id)}" data-key="${KEYS.events}">Supprimer</button>
        </div>
      </div>
      <div class="event-tables-section" id="evt-tables-${esc(item.id)}">
        ${renderEventTablesHtml(item.id)}
      </div>
    </div>`).join('');

  bindDeleteButtons(list, KEYS.events, renderEvents, id => {
    const ev = getData(KEYS.events).find(e => e.id === id);
    if (ev) logNotification('event_deleted', `L'événement « ${ev.title} » a été supprimé`, [], '#evenements');
  });
  list.querySelectorAll('.btn-registrations').forEach(btn => {
    btn.addEventListener('click', () => openRegistrationsModal(btn.dataset.regEvent, btn.dataset.regTitle));
  });
  list.querySelectorAll('.btn-edit[data-edit-event]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = getData(KEYS.events).find(ev => ev.id === btn.dataset.editEvent);
      if (item) populateEventForm(item);
    });
  });
  list.querySelectorAll('.btn-add-table').forEach(btn => {
    btn.addEventListener('click', () => openAddTableModal(btn.dataset.eventId, btn.dataset.eventTitle));
  });
  bindTableDeleteBtns(list);
}

/* ─── Event Tables ────────────────────────────────────────────── */
function getEventTables(eventId) {
  return (getData(KEYS.tables) || []).filter(t => t.eventId === eventId);
}

function renderEventTablesHtml(eventId) {
  const tables = getEventTables(eventId);
  if (!tables.length) return '';
  return `<div class="event-tables-list">${tables.map(t => `
    <div class="event-table-card${t.cancelled ? ' event-table-card--cancelled' : ''}">
      <div class="event-table-main">
        <div class="event-table-name">
          ${t.cancelled ? '<span class="table-cancelled-badge">Annulée</span> ' : ''}${esc(t.gameName)}
        </div>
        <div class="event-table-meta">
          <span>&#128100; ${esc(String(t.playersMin))}–${esc(String(t.playersMax))} joueurs</span>
          <span>&#9201; ${esc(t.duration)}</span>
          ${t.gm ? `<span>&#127922; ${esc(t.gm)}</span>` : ''}
        </div>
        ${t.synopsis ? `<div class="event-table-synopsis">${esc(t.synopsis)}</div>` : ''}
        ${t.tags && t.tags.length ? `<div class="event-table-tags">${t.tags.map(tag => `<span class="event-table-tag">${esc(tag)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="event-table-actions">
        <button class="btn-edit" data-edit-table="${esc(t.id)}" title="Modifier la table">Modifier</button>
        <button class="btn-cancel-table${t.cancelled ? ' btn-cancel-table--active' : ''}"
          data-cancel-table="${esc(t.id)}" data-event-id="${esc(eventId)}"
          title="${t.cancelled ? 'Réactiver la table' : 'Annuler la table'}">
          ${t.cancelled ? '&#x21A9; Réactiver' : '&#x2715; Annuler'}
        </button>
        <button class="btn-danger-sm" data-delete-table="${esc(t.id)}" data-event-id="${esc(eventId)}" title="Supprimer cette table">&#x1F5D1;</button>
      </div>
    </div>`).join('')}</div>`;
}

function bindTableActionBtns(container) {
  container.querySelectorAll('[data-delete-table]').forEach(btn => {
    btn.addEventListener('click', () => deleteEventTable(btn.dataset.deleteTable, btn.dataset.eventId));
  });
  container.querySelectorAll('[data-cancel-table]').forEach(btn => {
    btn.addEventListener('click', () => toggleCancelTable(btn.dataset.cancelTable, btn.dataset.eventId));
  });
  container.querySelectorAll('[data-edit-table]').forEach(btn => {
    btn.addEventListener('click', () => openEditTableModal(btn.dataset.editTable));
  });
}

function bindTableDeleteBtns(container) {
  bindTableActionBtns(container);
}

function deleteEventTable(tableId, eventId) {
  _cache[KEYS.tables] = (_cache[KEYS.tables] || []).filter(t => t.id !== tableId);
  saveData(KEYS.tables, _cache[KEYS.tables]);
  refreshTableSection(eventId);
  showToast('Table supprimée.');
}

function toggleCancelTable(tableId, eventId) {
  _cache[KEYS.tables] = (_cache[KEYS.tables] || []).map(t =>
    t.id === tableId ? { ...t, cancelled: !t.cancelled } : t
  );
  saveData(KEYS.tables, _cache[KEYS.tables]);
  const table = _cache[KEYS.tables].find(t => t.id === tableId);
  refreshTableSection(eventId);
  showToast(table && table.cancelled ? 'Table annulée.' : 'Table réactivée.');
}

function refreshTableSection(eventId) {
  const section = document.getElementById('evt-tables-' + eventId);
  if (section) {
    section.innerHTML = renderEventTablesHtml(eventId);
    bindTableActionBtns(section);
  }
}

let _tableModalEventId = null;
let _editingTableId    = null;
let _tableTags = [];

function _resetTableModal(eventId, eventTitle) {
  _tableModalEventId = eventId;
  _editingTableId    = null;
  _tableTags = [];
  document.getElementById('table-event-label').textContent = eventTitle || '';
  document.getElementById('form-table').reset();
  document.getElementById('table-tags-list').innerHTML = '';
  document.getElementById('table-tag-input').value = '';

  const gmSel = document.getElementById('table-gm');
  gmSel.innerHTML = '<option value="">— Aucun —</option>';
  getData(KEYS.team)
    .filter(m => m.type === 'mj')
    .forEach(m => {
      const opt = document.createElement('option');
      opt.value       = m.name;
      opt.textContent = m.name;
      gmSel.appendChild(opt);
    });

  const errEl = document.getElementById('table-form-error');
  errEl.hidden = true;
  errEl.textContent = '';

  const sel = document.getElementById('table-game-select');
  sel.innerHTML = '<option value="">— Choisir dans le catalogue —</option>';
  getData(KEYS.games).forEach(g => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.title;
    sel.appendChild(opt);
  });
}

function openAddTableModal(eventId, eventTitle) {
  _resetTableModal(eventId, eventTitle);
  document.querySelector('#table-overlay .modal-title').textContent = 'Ajouter une table';
  document.querySelector('#form-table [type="submit"]').textContent = 'Ajouter la table';
  document.getElementById('table-overlay').hidden = false;
}

function openEditTableModal(tableId) {
  const t = (getData(KEYS.tables) || []).find(t => t.id === tableId);
  if (!t) return;

  const event = (getData(KEYS.events) || []).find(ev => ev.id === t.eventId);
  _resetTableModal(t.eventId, event ? event.title : '');
  _editingTableId = tableId;
  _tableTags = Array.isArray(t.tags) ? [...t.tags] : [];

  document.getElementById('table-game-select').value = t.gameId || '';
  document.getElementById('table-players-min').value  = t.playersMin || '';
  document.getElementById('table-players-max').value  = t.playersMax || '';
  document.getElementById('table-duration').value     = t.duration || '';
  document.getElementById('table-synopsis').value     = t.synopsis || '';
  document.getElementById('table-gm').value           = t.gm || '';

  const tagsList = document.getElementById('table-tags-list');
  tagsList.innerHTML = _tableTags.map((tag, i) =>
    `<span class="tag-chip">${esc(tag)}<span class="tag-chip-remove" data-idx="${i}">&#x2715;</span></span>`
  ).join('');
  tagsList.querySelectorAll('.tag-chip-remove').forEach(x => {
    x.addEventListener('click', () => { _tableTags.splice(Number(x.dataset.idx), 1); x.closest('.tag-chip').remove(); });
  });

  document.querySelector('#table-overlay .modal-title').textContent = 'Modifier la table';
  document.querySelector('#form-table [type="submit"]').textContent = 'Enregistrer les modifications';
  document.getElementById('table-overlay').hidden = false;
}

function bindTableModal() {
  const overlay  = document.getElementById('table-overlay');
  const form     = document.getElementById('form-table');
  const tagInput = document.getElementById('table-tag-input');
  const tagsList = document.getElementById('table-tags-list');

  function refreshChips() {
    tagsList.innerHTML = _tableTags.map((tag, i) =>
      `<span class="tag-chip">${esc(tag)}<span class="tag-chip-remove" data-idx="${i}">&#x2715;</span></span>`
    ).join('');
    tagsList.querySelectorAll('.tag-chip-remove').forEach(x => {
      x.addEventListener('click', () => { _tableTags.splice(Number(x.dataset.idx), 1); refreshChips(); });
    });
  }

  tagInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.value.trim().replace(/,$/, '');
      if (val && !_tableTags.includes(val)) { _tableTags.push(val); refreshChips(); }
      tagInput.value = '';
    }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const gameId   = document.getElementById('table-game-select').value;
    const pMin     = Number(document.getElementById('table-players-min').value);
    const pMax     = Number(document.getElementById('table-players-max').value);
    const duration = document.getElementById('table-duration').value.trim();
    const synopsis = document.getElementById('table-synopsis').value.trim();
    const gm       = document.getElementById('table-gm').value.trim();
    const errEl    = document.getElementById('table-form-error');

    const pending = tagInput.value.trim();
    if (pending && !_tableTags.includes(pending)) { _tableTags.push(pending); tagInput.value = ''; refreshChips(); }

    errEl.hidden = true;
    if (!gameId)                        { errEl.textContent = 'Veuillez sélectionner un jeu.'; errEl.hidden = false; return; }
    if (!pMin || !pMax || pMin > pMax)  { errEl.textContent = 'Nombre de joueurs invalide (min ≤ max).'; errEl.hidden = false; return; }
    if (!duration)                      { errEl.textContent = 'Veuillez indiquer une durée.'; errEl.hidden = false; return; }
    if (!synopsis)                      { errEl.textContent = 'Veuillez saisir un synopsis.'; errEl.hidden = false; return; }

    const game = getData(KEYS.games).find(g => g.id === gameId);
    const fields = {
      gameId,
      gameName:   game ? game.title : gameId,
      gm,
      playersMin: pMin,
      playersMax: pMax,
      duration,
      synopsis,
      tags:       [..._tableTags]
    };

    if (_editingTableId) {
      _cache[KEYS.tables] = (_cache[KEYS.tables] || []).map(t =>
        t.id === _editingTableId ? { ...t, ...fields } : t
      );
      saveData(KEYS.tables, _cache[KEYS.tables]);
      refreshTableSection(_tableModalEventId);
      overlay.hidden = true;
      showToast('Table modifiée !');
    } else {
      prepend(KEYS.tables, { id: genId('tbl'), eventId: _tableModalEventId, ...fields });
      const _ev = getData(KEYS.events).find(e => e.id === _tableModalEventId);
      logNotification('table_added', `Nouvelle table « ${fields.gameName} »${_ev ? ` à l'événement « ${_ev.title} »` : ''}`, [], '#evenements');
      refreshTableSection(_tableModalEventId);
      overlay.hidden = true;
      showToast('Table ajoutée !');
    }
  });

  document.getElementById('table-cancel').addEventListener('click', () => { overlay.hidden = true; });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
}

function populateEventForm(item) {
  editingEventId = item.id;
  _eventSnap = JSON.parse(JSON.stringify(item));
  const form = document.getElementById('form-events');
  const set  = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = val || ''; };
  const chk  = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.checked = !!val; };

  set('startDay',      item.startDay    || item.day   || '');
  set('startMonth',    item.startMonth  || item.month || '');
  set('startYear',     item.startYear   || item.year  || '');
  set('startTimeFrom', item.startTimeFrom || '');
  set('startTimeTo',   item.startTimeTo   || '');
  set('endDay',        item.endDay      || '');
  set('endMonth',      item.endMonth    || '');
  set('endYear',       item.endYear     || '');
  set('endTimeFrom',   item.endTimeFrom || '');
  set('endTimeTo',     item.endTimeTo   || '');
  set('title',         item.title);
  set('tag',           item.tag);
  set('tagColor',      item.tagColor);
  set('description',   item.description);
  set('location',      item.location);
  set('capacity',      item.capacity);
  chk('inscription',   item.inscription);
  chk('featured',      item.featured);

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Enregistrer les modifications';

  if (!form.querySelector('.btn-cancel-edit')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-outline-sm btn-full btn-cancel-edit';
    cancelBtn.textContent = 'Annuler la modification';
    cancelBtn.style.marginTop = '0.5rem';
    cancelBtn.addEventListener('click', cancelEventEdit);
    submitBtn.after(cancelBtn);
  }

  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEventEdit() {
  editingEventId = null;
  _eventSnap = null;
  const form = document.getElementById('form-events');
  form.reset();
  form.querySelector('button[type="submit"]').textContent = 'Ajouter l\'événement';
  const cancelBtn = form.querySelector('.btn-cancel-edit');
  if (cancelBtn) cancelBtn.remove();
}

/* ─── Games list ─────────────────────────────────────────────────── */
function renderGames() {
  const items = getData(KEYS.games);
  const list  = document.getElementById('list-games');
  const count = document.getElementById('count-games');
  count.textContent = items.length;

  if (!items.length) {
    list.innerHTML = '<p class="empty-msg">Aucun jeu enregistré.</p>';
    return;
  }

  const catLabel = { fantasy:'Fantasy', horreur:'Horreur', scifi:'Sci-Fi', historique:'Historique', multivers:'Multivers' };

  list.innerHTML = items.map(item => `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-title">${esc(item.icon)} ${esc(item.title)}${item.popular ? ' <span class="admin-item-badge badge-orange">★ Populaire</span>' : ''}</div>
        <div class="admin-item-badges">
          ${item.badges && item.badges.length ? item.badges.map(b => `<span class="admin-item-badge badge-slate">${esc(b)}</span>`).join('') : '<span class="admin-item-meta-empty">—</span>'}
        </div>
        <div class="admin-item-badges">
          <span class="admin-item-badge badge-${esc(item.tagColor)}">${esc(item.tag)}</span>
        </div>
      </div>
      <div class="admin-item-actions">
        <button class="btn-edit" data-edit-game="${esc(item.id)}">Modifier</button>
        <button class="btn-danger" data-delete="${esc(item.id)}" data-key="${KEYS.games}">Supprimer</button>
      </div>
    </div>`).join('');

  bindDeleteButtons(list, KEYS.games, renderGames);
  list.querySelectorAll('.btn-edit[data-edit-game]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = getData(KEYS.games).find(g => g.id === btn.dataset.editGame);
      if (item) populateGameForm(item);
    });
  });
}

function populateGameForm(item) {
  editingGameId = item.id;
  _gameSnap = JSON.parse(JSON.stringify(item));
  const form = document.getElementById('form-games');
  const set  = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = val || ''; };
  const chk  = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.checked = !!val; };

  set('title',       item.title);
  set('category',    item.category);
  set('description', item.description);
  set('badges',      Array.isArray(item.badges) ? item.badges.join(', ') : (item.badges || ''));
  chk('popular',     item.popular);

  currentGameImageData = null;
  gameImageCleared     = false;
  const imgEl      = document.getElementById('game-image-img');
  const previewEl  = document.getElementById('game-image-preview');
  const inputEl    = document.getElementById('game-image-input');
  if (inputEl) inputEl.value = '';
  if (item.image && imgEl && previewEl) {
    imgEl.src = item.image;
    previewEl.style.display = 'flex';
  } else if (previewEl) {
    previewEl.style.display = 'none';
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Enregistrer les modifications';

  if (!form.querySelector('.btn-cancel-edit')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-outline-sm btn-full btn-cancel-edit';
    cancelBtn.textContent = 'Annuler la modification';
    cancelBtn.style.marginTop = '0.5rem';
    cancelBtn.addEventListener('click', cancelGameEdit);
    submitBtn.after(cancelBtn);
  }

  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelGameEdit() {
  editingGameId = null;
  _gameSnap = null;
  const form = document.getElementById('form-games');
  form.reset();
  _clearGameImage();
  form.querySelector('button[type="submit"]').textContent = 'Ajouter le jeu';
  const cancelBtn = form.querySelector('.btn-cancel-edit');
  if (cancelBtn) cancelBtn.remove();
}

/* ─── Team list ──────────────────────────────────────────────────── */
function renderTeam() {
  const items = getData(KEYS.team);
  const list  = document.getElementById('list-team');
  const count = document.getElementById('count-team');
  count.textContent = items.length;

  if (!items.length) {
    list.innerHTML = '<p class="empty-msg">Aucun membre enregistré.</p>';
    return;
  }

  const gamesCatalog = getData(KEYS.games);

  list.innerHTML = items.map(item => {
    const isMJ = item.type === 'mj';
    const gameBadges = isMJ && item.games && item.games.length
      ? item.games.map(title => {
          const g = gamesCatalog.find(x => x.title === title);
          const color = g ? esc(g.tagColor) : 'slate';
          return `<span class="admin-item-badge badge-${color}">${esc(title)}</span>`;
        }).join('')
      : '';

    return `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-title">
          ${item.photo ? `<img src="${esc(item.photo)}" alt="" class="admin-member-thumb">` : `<span class="admin-member-initials">${esc(item.initials)}</span>`}
          ${esc(item.name)}
        </div>
        <div class="admin-item-meta">${esc(item.role)}</div>
        <div class="admin-item-badges">
          <span class="admin-item-badge badge-${isMJ ? 'mj' : 'bureau'}">${isMJ ? 'Maître du Jeu' : 'Bureau'}</span>
          ${item.isPresident ? '<span class="admin-item-badge badge-orange">★ Président</span>' : ''}
        </div>
        ${gameBadges ? `<div class="admin-item-badges"><span class="admin-item-meta-label">Jeux pratiqués&nbsp;:</span>${gameBadges}</div>` : ''}
      </div>
      <div class="admin-item-actions">
        <button class="btn-edit" data-edit="${esc(item.id)}">Modifier</button>
        <button class="btn-danger" data-delete="${esc(item.id)}" data-key="${KEYS.team}">Supprimer</button>
      </div>
    </div>`;
  }).join('');

  bindDeleteButtons(list, KEYS.team, renderTeam);
  bindEditTeamButtons(list);
}

function bindEditTeamButtons(container) {
  container.querySelectorAll('.btn-edit[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = getData(KEYS.team).find(m => m.id === btn.dataset.edit);
      if (item) populateTeamForm(item);
    });
  });
}

function populateTeamForm(item) {
  editingTeamId = item.id;
  const form = document.getElementById('form-team');
  form.querySelector('[name="name"]').value      = item.name || '';
  form.querySelector('[name="role"]').value      = item.role || '';
  form.querySelector('[name="roleBadge"]').value = item.roleBadge || '';
  form.querySelector('[name="bio"]').value       = item.bio || '';
  form.querySelector('[name="gradient"]').value  = item.gradient || '';
  form.querySelector('[name="type"]').value      = item.type || 'bureau';
  form.querySelector('[name="isPresident"]').checked = !!item.isPresident;
  document.getElementById('member-type').dispatchEvent(new Event('change'));
  populateGamesSelect(item.games || []);

  currentPhotoData = null;
  const preview = document.getElementById('member-photo-preview');
  const img     = document.getElementById('member-photo-img');
  if (item.photo) {
    img.src = item.photo;
    preview.style.display = 'flex';
  } else {
    img.src = '';
    preview.style.display = 'none';
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Enregistrer les modifications';

  if (!form.querySelector('.btn-cancel-edit')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-outline-sm btn-full btn-cancel-edit';
    cancelBtn.textContent = 'Annuler la modification';
    cancelBtn.style.marginTop = '0.5rem';
    cancelBtn.addEventListener('click', cancelTeamEdit);
    submitBtn.after(cancelBtn);
  }

  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelTeamEdit() {
  editingTeamId    = null;
  currentPhotoData = null;
  const form = document.getElementById('form-team');
  form.reset();
  form.querySelector('button[type="submit"]').textContent = 'Ajouter le membre';
  const cancelBtn = form.querySelector('.btn-cancel-edit');
  if (cancelBtn) cancelBtn.remove();
  document.getElementById('member-photo-preview').style.display = 'none';
  document.getElementById('member-photo-img').src = '';
  Array.from(document.getElementById('games-select').options).forEach(o => o.selected = false);
  document.getElementById('member-type').dispatchEvent(new Event('change'));
}

/* ─── Blog list ──────────────────────────────────────────────────── */
function renderBlog() {
  const items = getData(KEYS.blog);
  const list  = document.getElementById('list-blog');
  const count = document.getElementById('count-blog');
  if (!list) return;
  count.textContent = items.length;
  if (!items.length) {
    list.innerHTML = '<p class="empty-msg">Aucun article enregistré.</p>';
    return;
  }
  list.innerHTML = items.map(item => {
    const cat = BLOG_CATS[item.category] || { label: item.category, color: 'blue', icon: '📰' };
    return `
    <div class="admin-item">
      <div class="admin-item-info">
        <div class="admin-item-title">${esc(cat.icon)} ${esc(item.title)}</div>
        <div class="admin-item-meta">${esc(item.author)} · ${esc(item.date)}</div>
        <div class="admin-item-badges">
          <span class="admin-item-badge badge-${esc(cat.color)}">${esc(cat.label)}</span>
        </div>
      </div>
      <div class="admin-item-actions">
        <button class="btn-edit" data-edit-blog="${esc(item.id)}">Modifier</button>
        <button class="btn-danger" data-delete="${esc(item.id)}" data-key="${KEYS.blog}">Supprimer</button>
      </div>
    </div>`;
  }).join('');
  bindDeleteButtons(list, KEYS.blog, renderBlog);
  list.querySelectorAll('.btn-edit[data-edit-blog]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = getData(KEYS.blog).find(b => b.id === btn.dataset.editBlog);
      if (item) populateBlogForm(item);
    });
  });
}

function populateBlogForm(item) {
  editingBlogId = item.id;
  _blogSnap = JSON.parse(JSON.stringify(item));
  const form = document.getElementById('form-blog');
  const set  = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = val || ''; };
  set('title',    item.title);
  set('category', item.category);
  set('author',   item.author);
  set('date',     item.date);
  set('excerpt',  item.excerpt);
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Enregistrer les modifications';
  if (!form.querySelector('.btn-cancel-edit')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-outline-sm btn-full btn-cancel-edit';
    cancelBtn.textContent = 'Annuler la modification';
    cancelBtn.style.marginTop = '0.5rem';
    cancelBtn.addEventListener('click', cancelBlogEdit);
    submitBtn.after(cancelBtn);
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelBlogEdit() {
  editingBlogId = null;
  _blogSnap = null;
  const form = document.getElementById('form-blog');
  form.reset();
  form.querySelector('button[type="submit"]').textContent = "Ajouter l'article";
  const cancelBtn = form.querySelector('.btn-cancel-edit');
  if (cancelBtn) cancelBtn.remove();
}

/* ─── Site config ────────────────────────────────────────────────── */
function getSiteConfig() {
  const v = _cache['site'];
  if (v && !Array.isArray(v) && typeof v === 'object') return v;
  return { membres: 42, parties: 8, evenements: 15, annees: 6, milestone1Hours: 168, milestone2Hours: 24 };
}

function renderSite() {
  const cfg = getSiteConfig();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  set('site-membres',     cfg.membres);
  set('site-parties',     cfg.parties);
  set('site-evenements',  cfg.evenements);
  set('site-annees',      cfg.annees);
  set('site-milestone1',  cfg.milestone1Hours ?? 168);
  set('site-milestone2',  cfg.milestone2Hours ?? 24);
  loadAndRenderAccounts();
  renderNotifications();
  renderAnalytics();
}

/* ─── Analytics ──────────────────────────────────────────────────── */
function renderAnalytics() {
  const el = document.getElementById('analytics-panel');
  if (!el) return;

  const raw = _cache[KEYS.analytics];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    el.innerHTML = '<p class="empty-msg">Aucune donnée disponible.</p>'; return;
  }

  const PAGE_LABELS = { home:'Accueil', jeux:'Jeux', evenements:'Événements', blog:'Blog', equipe:'Équipe', contacts:'Contacts' };
  const days = Object.keys(raw).sort().reverse().slice(0, 30);

  if (!days.length) { el.innerHTML = '<p class="empty-msg">Aucune donnée disponible.</p>'; return; }

  const rows = days.map(day => {
    const d = raw[day];
    const visitors   = (d.v || []).length;
    const pageviews  = Object.values(d.p || {}).reduce((s, n) => s + n, 0);
    const clicks     = Object.values(d.c || {}).reduce((s, n) => s + n, 0);
    const topPage    = Object.entries(d.p || {}).sort((a, b) => b[1] - a[1])[0];
    const topLabel   = topPage ? `${PAGE_LABELS[topPage[0]] || topPage[0]} (${topPage[1]})` : '—';

    const pageBreakdown = Object.entries(d.p || {})
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `<span class="analytics-page-chip">${PAGE_LABELS[p] || p} <strong>${n}</strong></span>`)
      .join('');

    const clickBreakdown = Object.entries(d.c || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, n]) => {
        const [pg, ...lblParts] = k.split('/');
        const lbl = lblParts.join('/').trim() || pg;
        return `<span class="analytics-page-chip analytics-click-chip">${esc(lbl.slice(0,35))} <strong>${n}</strong></span>`;
      }).join('');

    return `
      <div class="analytics-day-row">
        <div class="analytics-day-header" data-toggle>
          <span class="analytics-date">${day}</span>
          <span class="analytics-stat"><span class="analytics-stat-label">Visiteurs</span><strong>${visitors}</strong></span>
          <span class="analytics-stat"><span class="analytics-stat-label">Pages vues</span><strong>${pageviews}</strong></span>
          <span class="analytics-stat"><span class="analytics-stat-label">Clics</span><strong>${clicks}</strong></span>
          <span class="analytics-stat analytics-top"><span class="analytics-stat-label">Top page</span>${topLabel}</span>
          <span class="analytics-toggle-icon">▾</span>
        </div>
        <div class="analytics-day-detail" hidden>
          <div class="analytics-detail-section"><strong>Pages :</strong> ${pageBreakdown || '—'}</div>
          <div class="analytics-detail-section"><strong>Top clics :</strong> ${clickBreakdown || '—'}</div>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="analytics-summary">
      <span class="analytics-summary-item">&#128200; <strong>${days.length}</strong> jour(s) de données</span>
      <span class="analytics-summary-item">&#128101; <strong>${[...new Set(days.flatMap(d => raw[d].v || []))].length}</strong> visiteurs uniques (total)</span>
    </div>
    <div class="analytics-table">${rows}</div>`;

  el.querySelectorAll('[data-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const detail = header.nextElementSibling;
      const icon   = header.querySelector('.analytics-toggle-icon');
      const open   = !detail.hidden;
      detail.hidden = open;
      icon.textContent = open ? '▾' : '▴';
    });
  });
}

/* ─── Notification subscribers + log ────────────────────────────── */
const NOTIF_ICONS = {
  game_added:    '🎲',
  event_added:   '📅',
  event_deleted: '🗑️',
  table_added:   '🪑',
  blog_added:    '📝',
};

function renderNotifications() {
  const subs      = getData(KEYS.subs);
  const evtSubs   = getData(KEYS.evtnotif).filter(s => s.eventMs && s.eventMs > Date.now());
  const log       = getData(KEYS.notif);
  const subList   = document.getElementById('list-subscribers');
  const subCount  = document.getElementById('count-subscribers');
  const logList   = document.getElementById('list-notif-log');
  if (!subList || !logList) return;

  subCount.textContent = subs.length + evtSubs.length;

  if (!subs.length && !evtSubs.length) {
    subList.innerHTML = '<p class="empty-msg">Aucun abonné.</p>';
  } else {
    const regularHTML = subs.map(s => `
      <div class="admin-item">
        <div class="admin-item-info">
          <div class="admin-item-title">&#128231; ${esc(s.email)}</div>
          <div class="admin-item-meta">${new Date(s.createdAt).toLocaleString('fr-FR')}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-danger" data-delete-sub="${esc(s.id)}">Supprimer</button>
        </div>
      </div>`).join('');

    const evtHTML = evtSubs.map(s => `
      <div class="admin-item">
        <div class="admin-item-info">
          <div class="admin-item-title">&#128276; ${esc(s.email)} <span class="sub-event-badge">${esc(s.eventTitle || '')}</span></div>
          <div class="admin-item-meta">${new Date(s.createdAt).toLocaleString('fr-FR')}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-danger" data-delete-evtsub="${esc(s.id)}">Supprimer</button>
        </div>
      </div>`).join('');

    subList.innerHTML = regularHTML + evtHTML;

    subList.querySelectorAll('[data-delete-sub]').forEach(btn => {
      btn.addEventListener('click', () => {
        const filtered = getData(KEYS.subs).filter(s => s.id !== btn.dataset.deleteSub);
        saveData(KEYS.subs, filtered);
        renderNotifications();
        showToast('Abonné supprimé.');
      });
    });

    subList.querySelectorAll('[data-delete-evtsub]').forEach(btn => {
      btn.addEventListener('click', () => {
        const filtered = getData(KEYS.evtnotif).filter(s => s.id !== btn.dataset.deleteEvtsub);
        saveData(KEYS.evtnotif, filtered);
        renderNotifications();
        showToast('Abonné supprimé.');
      });
    });
  }

  if (!log.length) {
    logList.innerHTML = '<p class="empty-msg">Aucune notification enregistrée.</p>';
  } else {
    logList.innerHTML = log.map(n => `
      <div class="notif-log-item">
        <span class="notif-log-icon">${NOTIF_ICONS[n.type] || '🔔'}</span>
        <span class="notif-log-msg">${esc(n.message)}</span>
        <span class="notif-log-date">${new Date(n.createdAt).toLocaleString('fr-FR')}</span>
      </div>`).join('');
  }

  const clearBtn = document.getElementById('btn-clear-notif-log');
  if (clearBtn) {
    clearBtn.onclick = () => {
      saveData(KEYS.notif, []);
      renderNotifications();
      showToast('Journal effacé.');
    };
  }
}

function bindSiteForm() {
  const form = document.getElementById('form-site');
  if (!form) return;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const cfg = {
      membres:         parseInt(document.getElementById('site-membres').value,     10) || 0,
      parties:         parseInt(document.getElementById('site-parties').value,     10) || 0,
      evenements:      parseInt(document.getElementById('site-evenements').value,  10) || 0,
      annees:          parseInt(document.getElementById('site-annees').value,      10) || 0,
      milestone1Hours: parseInt(document.getElementById('site-milestone1').value,  10) || 168,
      milestone2Hours: parseInt(document.getElementById('site-milestone2').value,  10) || 24,
    };
    _cache['site'] = cfg;
    fetch('/data/site.json', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(cfg)
    }).catch(() => {
      try { localStorage.setItem('rr_site', JSON.stringify(cfg)); } catch {}
    });
    showToast('Paramètres du site enregistrés.');
  });
}

/* ─── Admin accounts ─────────────────────────────────────────────── */
const PW_RE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

async function loadAndRenderAccounts() {
  const listEl = document.getElementById('list-accounts');
  const countEl = document.getElementById('count-accounts');
  if (!listEl) return;
  try {
    const res = await fetch('/api/accounts', { headers: getAuthHeaders() });
    if (!res.ok) { listEl.innerHTML = '<p class="empty-msg">Accès refusé.</p>'; return; }
    const accounts = await res.json();
    if (countEl) countEl.textContent = accounts.length;
    if (!accounts.length) {
      listEl.innerHTML = '<p class="empty-msg">Aucun compte enregistré.</p>';
      return;
    }
    const currentLogin = sessionStorage.getItem(TOKEN_KEY) ? null : ''; // can't easily get login here
    listEl.innerHTML = accounts.map(a => `
      <div class="admin-item">
        <div class="admin-item-info">
          <div class="admin-item-title">&#128100; ${esc(a.fullName || a.login)}</div>
          <div class="admin-item-meta">${esc(a.login)}</div>
          <div class="admin-item-badges">${buildPermBadges(a.permissions)}</div>
        </div>
        <div class="admin-item-actions">
          <button class="btn-edit" data-edit-account="${esc(a.id)}">Modifier</button>
          <button class="btn-danger" data-delete-account="${esc(a.id)}">Supprimer</button>
        </div>
      </div>`).join('');

    listEl.querySelectorAll('.btn-edit[data-edit-account]').forEach(btn => {
      btn.addEventListener('click', () => populateAccountForm(accounts.find(a => a.id === btn.dataset.editAccount)));
    });
    listEl.querySelectorAll('.btn-danger[data-delete-account]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Supprimer ce compte ?')) return;
        await fetch(`/api/accounts/${btn.dataset.deleteAccount}`, { method: 'DELETE', headers: getAuthHeaders() });
        showToast('Compte supprimé.');
        loadAndRenderAccounts();
      });
    });
  } catch {
    if (listEl) listEl.innerHTML = '<p class="empty-msg">Erreur de chargement.</p>';
  }
}

function buildPermBadges(perms) {
  if (!perms || !perms.length) return '<span class="admin-item-badge badge-gray">Aucune</span>';
  const labels = { evenements: 'Événements', jeux: 'Jeux', equipe: 'Équipe', blog: 'Blog', site: 'Site' };
  if (perms.length === 5) return '<span class="admin-item-badge badge-orange">Tous</span>';
  return perms.map(p => `<span class="admin-item-badge badge-blue">${esc(labels[p] || p)}</span>`).join('');
}

function populateAccountForm(item) {
  if (!item) return;
  editingAccountId = item.id;
  const form = document.getElementById('form-account');
  if (!form) return;
  form.querySelector('#acc-login').value    = item.login;
  form.querySelector('#acc-login').readOnly = true;
  form.querySelector('#acc-fullname').value = item.fullName || '';
  form.querySelector('#acc-password').value = '';
  form.querySelector('#acc-password2').value = '';
  form.querySelector('#acc-password').placeholder = 'Laisser vide pour conserver';

  const perms = item.permissions || [];
  form.querySelectorAll('.acc-perm-cb').forEach(cb => { cb.checked = perms.includes(cb.value); });
  updateTousCheckbox();

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Enregistrer les modifications';
  document.getElementById('acc-form-title').textContent = 'Modifier un compte';

  if (!form.querySelector('.btn-cancel-edit')) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-outline-sm btn-full btn-cancel-edit';
    cancelBtn.textContent = 'Annuler la modification';
    cancelBtn.style.marginTop = '0.5rem';
    cancelBtn.addEventListener('click', cancelAccountEdit);
    submitBtn.after(cancelBtn);
  }
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelAccountEdit() {
  editingAccountId = null;
  const form = document.getElementById('form-account');
  if (!form) return;
  form.reset();
  form.querySelector('#acc-login').readOnly = false;
  form.querySelector('#acc-password').placeholder = '12 car. min, 1 maj., 1 chiffre, 1 spécial';
  document.getElementById('acc-form-title').textContent = 'Nouveau compte';
  form.querySelector('button[type="submit"]').textContent = 'Créer le compte';
  const cancelBtn = form.querySelector('.btn-cancel-edit');
  if (cancelBtn) cancelBtn.remove();
}

function updateTousCheckbox() {
  const tous = document.getElementById('acc-perm-tous');
  if (!tous) return;
  const cbs  = document.querySelectorAll('.acc-perm-cb');
  tous.checked = Array.from(cbs).every(cb => cb.checked);
}

function bindAccountForm() {
  const form = document.getElementById('form-account');
  if (!form) return;

  // "Tous" master toggle
  const tousCb = document.getElementById('acc-perm-tous');
  if (tousCb) {
    tousCb.addEventListener('change', () => {
      document.querySelectorAll('.acc-perm-cb').forEach(cb => { cb.checked = tousCb.checked; });
    });
  }
  document.querySelectorAll('.acc-perm-cb').forEach(cb => {
    cb.addEventListener('change', updateTousCheckbox);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const login    = form.querySelector('#acc-login').value.trim();
    const fullName = form.querySelector('#acc-fullname').value.trim();
    const password = form.querySelector('#acc-password').value;
    const password2 = form.querySelector('#acc-password2').value;
    const errEl    = document.getElementById('acc-form-error');

    const perms = Array.from(form.querySelectorAll('.acc-perm-cb:checked')).map(cb => cb.value);

    errEl.hidden = true;

    const showErr = msg => { errEl.textContent = msg; errEl.hidden = false; };

    if (!login)    { showErr('Le login est obligatoire.'); return; }
    if (!fullName) { showErr('Le nom complet est obligatoire.'); return; }

    if (!editingAccountId || password) {
      if (!password) { showErr('Le mot de passe est obligatoire.'); return; }
      if (password !== password2) { showErr('Les mots de passe ne correspondent pas.'); return; }
      if (!PW_RE.test(password)) {
        showErr('Le mot de passe doit contenir au moins 12 caractères, une majuscule, un chiffre et un caractère spécial.');
        return;
      }
    }

    const payload = { fullName, permissions: perms };
    if (editingAccountId) {
      payload.id = editingAccountId;
    } else {
      payload.login = login;
    }
    if (password) payload.password = password;

    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.status === 409) { showErr('Ce login existe déjà.'); return; }
      if (!res.ok) { showErr('Erreur serveur.'); return; }
      showToast(editingAccountId ? 'Compte mis à jour.' : 'Compte créé.');
      cancelAccountEdit();
      loadAndRenderAccounts();
    } catch {
      showErr('Impossible de joindre le serveur.');
    }
  });
}

/* ─── Notification log ───────────────────────────────────────────── */
/* ─── Diff helpers ───────────────────────────────────────────────── */
function _norm(v, max = 80) {
  const s = String(v ?? '').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function diffEvent(snap, neo) {
  const ch = [];
  const n  = (v) => _norm(v);

  const oldStart = [snap.startDay, snap.startMonth, snap.startYear].map(n).filter(Boolean).join(' ');
  const newStart = [neo.startDay,  neo.startMonth,  neo.startYear ].map(n).filter(Boolean).join(' ');
  if (oldStart !== newStart) ch.push(`Date de début : ${oldStart||'—'} → ${newStart||'—'}`);

  if (n(snap.startTimeFrom) !== n(neo.startTimeFrom)) ch.push(`Heure de début : ${n(snap.startTimeFrom)||'—'} → ${n(neo.startTimeFrom)||'—'}`);
  if (n(snap.startTimeTo)   !== n(neo.startTimeTo))   ch.push(`Heure de fin : ${n(snap.startTimeTo)||'—'} → ${n(neo.startTimeTo)||'—'}`);

  const oldEnd = [snap.endDay, snap.endMonth, snap.endYear].map(n).filter(Boolean).join(' ');
  const newEnd = [neo.endDay,  neo.endMonth,  neo.endYear ].map(n).filter(Boolean).join(' ');
  if (oldEnd !== newEnd) ch.push(`Date de fin : ${oldEnd||'—'} → ${newEnd||'—'}`);

  for (const [k, label] of [['title','Titre'],['description','Description'],['location','Lieu'],['capacity','Capacité'],['tag','Type']]) {
    if (n(snap[k]) !== n(neo[k])) ch.push(`${label} : ${n(snap[k])||'—'} → ${n(neo[k])||'—'}`);
  }
  if (!!snap.inscription !== !!neo.inscription) ch.push(`Inscription : ${snap.inscription ? 'oui' : 'non'} → ${neo.inscription ? 'oui' : 'non'}`);
  if (!!snap.featured    !== !!neo.featured)    ch.push(`Mis en avant : ${snap.featured ? 'oui' : 'non'} → ${neo.featured ? 'oui' : 'non'}`);
  return ch;
}

function diffGame(snap, neo) {
  const ch = [];
  const n  = (v) => _norm(v);
  for (const [k, label] of [['title','Titre'],['tag','Catégorie'],['description','Description']]) {
    if (n(snap[k]) !== n(neo[k])) ch.push(`${label} : ${n(snap[k])||'—'} → ${n(neo[k])||'—'}`);
  }
  if (!!snap.popular !== !!neo.popular) ch.push(`Populaire : ${snap.popular ? 'oui' : 'non'} → ${neo.popular ? 'oui' : 'non'}`);
  return ch;
}

function diffBlog(snap, neo) {
  const ch = [];
  const n  = (v) => _norm(v);
  for (const [k, label] of [['title','Titre'],['catLabel','Catégorie'],['author','Auteur'],['date','Date'],['excerpt','Extrait']]) {
    if (n(snap[k]) !== n(neo[k])) ch.push(`${label} : ${n(snap[k])||'—'} → ${n(neo[k])||'—'}`);
  }
  return ch;
}

function logNotification(type, message, details = [], anchor = '') {
  const entry = { id: genId('notif'), type, message, createdAt: new Date().toISOString() };
  const items = getData(KEYS.notif).slice();
  items.unshift(entry);
  saveData(KEYS.notif, items.slice(0, 100));
  renderNotifications();

  fetch('/api/notify', {
    method:  'POST',
    headers: getAuthHeaders(),
    body:    JSON.stringify({ type, message, details, anchor })
  }).then(r => r.json()).then(d => {
    if (d.ok && d.sent > 0) showToast(`📧 ${d.sent} notification(s) envoyée(s).`);
  }).catch(() => {});
}

/* ─── Bind delete buttons ────────────────────────────────────────── */
function bindDeleteButtons(container, key, reRender, beforeDelete) {
  container.querySelectorAll('.btn-danger[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id    = btn.dataset.delete;
      if (beforeDelete) beforeDelete(id);
      const items = getData(key).filter(item => item.id !== id);
      saveData(key, items);
      reRender();
      showToast('Élément supprimé.');
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════════ */
function getData(key) {
  return _cache[key] || [];
}

function saveData(key, arr) {
  _cache[key] = arr;
  fetch(`/data/${key}.json`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(arr)
  }).catch(err => {
    console.warn(`Sauvegarde fichier échouée pour ${key}, fallback localStorage`, err);
    try { localStorage.setItem('rr_' + key, JSON.stringify(arr)); } catch {}
  });
}

function prepend(key, item) {
  const arr = getData(key);
  arr.unshift(item);
  saveData(key, arr);
}

function genId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function collectForm(form) {
  const fd = new FormData(form);
  const obj = {};
  for (const [k, v] of fd.entries()) obj[k] = v;
  return obj;
}

/* ═══════════════════════════════════════════════════════════════════
   INSCRIPTIONS
═══════════════════════════════════════════════════════════════════ */
function getRegistrations(eventId) {
  const all = _cache[KEYS.regs] || [];
  return eventId ? all.filter(r => r.eventId === eventId) : all;
}

function getRegistrationCount(eventId) {
  return getRegistrations(eventId).length;
}

let _currentRegEventId    = null;
let _currentRegEventTitle = null;

function openRegistrationsModal(eventId, eventTitle) {
  _currentRegEventId    = eventId;
  _currentRegEventTitle = eventTitle;
  document.getElementById('reg-event-title').textContent = eventTitle;
  const regs = getRegistrations(eventId);
  const list = document.getElementById('reg-list');

  if (!regs.length) {
    list.innerHTML = '<p class="empty-msg">Aucune inscription pour cet événement.</p>';
  } else {
    list.innerHTML = regs.map((r, i) => `
      <div class="reg-item">
        <div class="reg-num">${i + 1}</div>
        <div class="reg-info">
          <div class="reg-name">${esc(r.name)}</div>
          <div class="reg-email">${esc(r.email)}</div>
          ${r.firstTime ? '<span class="reg-badge">Débutant</span>' : ''}
          ${r.univers ? `<div class="reg-univers"><span>${esc(r.univers)}</span></div>` : ''}
          <div class="reg-date">${new Date(r.createdAt).toLocaleString('fr-FR')}</div>
        </div>
        <button class="btn-danger" data-delete-reg="${esc(r.id)}" data-event-id="${esc(eventId)}" data-event-title="${esc(eventTitle)}">Supprimer</button>
      </div>`).join('');

    list.querySelectorAll('[data-delete-reg]').forEach(btn => {
      btn.addEventListener('click', () => {
        _cache[KEYS.regs] = (_cache[KEYS.regs] || []).filter(r => r.id !== btn.dataset.deleteReg);
        saveData(KEYS.regs, _cache[KEYS.regs]);
        openRegistrationsModal(btn.dataset.eventId, btn.dataset.eventTitle);
        renderEvents();
      });
    });
  }

  document.getElementById('reg-overlay').hidden = false;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('reg-close').addEventListener('click', () => {
    document.getElementById('reg-overlay').hidden = true;
  });
  document.getElementById('reg-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('reg-overlay'))
      document.getElementById('reg-overlay').hidden = true;
  });

  document.getElementById('reg-save').addEventListener('click', () => {
    const regs = getRegistrations(_currentRegEventId);
    if (!regs.length) { showToast('Aucune inscription à sauvegarder.', true); return; }

    const pad  = (s, n) => String(s).padEnd(n);
    const lines = [
      `Inscriptions — ${_currentRegEventTitle}`,
      `Exporté le ${new Date().toLocaleString('fr-FR')}`,
      '',
      `${'#'.padEnd(4)}  ${'Nom'.padEnd(30)}  ${'Email'.padEnd(40)}  Débutant`,
      '─'.repeat(90),
      ...regs.map((r, i) =>
        `${pad(i + 1, 4)}  ${pad(r.name, 30)}  ${pad(r.email, 40)}  ${r.firstTime ? 'Oui' : 'Non'}`
      )
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `inscriptions_${_currentRegEventTitle.replace(/\s+/g, '_').toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  bindTableModal();
});

/* ─── Toast ──────────────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg, isError = false) {
  const toast = document.getElementById('admin-toast');
  toast.textContent = msg;
  toast.className   = 'admin-toast' + (isError ? ' error' : '');
  toast.offsetHeight;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}
