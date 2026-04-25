/* ═══════════════════════════════════════════════════════════════════
   RIED & RÔLE — Main Script
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─── Helpers ─────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FR_MONTHS = { Jan:0, 'Fév':1, Mar:2, Avr:3, Mai:4, Jun:5, Jul:6, 'Aoû':7, Sep:8, Oct:9, Nov:10, 'Déc':11 };

/* ─── In-memory data store (populated by loadAllData) ────────────── */
const _data = { events: [], games: [], team: [], registrations: [], tables: [], blog: [], subscriptions: [], agenda: [] };

const LS_KEYS = { events:'rr_events', games:'rr_games', team:'rr_team', registrations:'rr_registrations', tables:'rr_tables', blog:'rr_blog', subscriptions:'rr_subscriptions', agenda:'rr_agenda' };

const BLOG_CATS = {
  'annonce':        { label: 'Annonce',                color: 'blue',   icon: '📢', gradient: 'linear-gradient(135deg,#050b1a,#0e204d)', image: '/assets/blog/annonce.png' },
  'critique':       { label: 'Critique de jeu',        color: 'purple', icon: '🎮', gradient: 'linear-gradient(135deg,#1a0a2e,#4b1c7d)', image: '/assets/blog/critique.png' },
  'evenement':      { label: 'Événement',              color: 'red',    icon: '🎉', gradient: 'linear-gradient(135deg,#1a0808,#7d1c1c)', image: '/assets/blog/evenement.png' },
  'conseil-mj':     { label: 'Conseil MJ',             color: 'orange', icon: '📜', gradient: 'linear-gradient(135deg,#1a1a0a,#5c4b1c)', image: '/assets/blog/MJ.png' },
  'conseil-joueur': { label: 'Conseil Joueur',         color: 'green',  icon: '🎲', gradient: 'linear-gradient(135deg,#0a1a0a,#1c5c1c)', image: '/assets/blog/PJ.png' },
  'photos':         { label: 'Photos',                 color: 'teal',   icon: '📷', gradient: 'linear-gradient(135deg,#001014,#002535)' },
  'vie-asso':       { label: "Vie de l'asso",          color: 'pink',   icon: '🏠', gradient: 'linear-gradient(135deg,#1a0514,#5c0d3a)' },
  'compte-rendu':   { label: 'Compte rendu de partie', color: 'indigo', icon: '📖', gradient: 'linear-gradient(135deg,#08001a,#180040)' },
  'culture-geek':   { label: 'Culture Geek',           color: 'cyan',   icon: '🤓', gradient: 'linear-gradient(135deg,#001a1a,#004d4d)' },
};

function formatBlogDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  const months = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

async function loadAllData() {
  await Promise.all(Object.keys(_data).map(async key => {
    try {
      const res = await fetch(`/data/${key}.json`);
      if (res.ok) { _data[key] = await res.json(); return; }
    } catch {}
    // Fallback: localStorage (file:// or server down)
    try { _data[key] = JSON.parse(localStorage.getItem(LS_KEYS[key]) || '[]'); }
    catch { _data[key] = []; }
  }));
}

/* ══════════════════════════════════════════════════════════════════
   DYNAMIC CONTENT — loaded from data/ files (via server)
══════════════════════════════════════════════════════════════════ */
let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth();

(async function loadDynamicContent() {
  await loadAllData();
  loadDynamicEvents();
  loadDynamicGames();
  loadHomeGames();
  loadDynamicTeam();
  loadDynamicBlog();
  loadHomeBlog();
  loadDynamicAgenda();
  await applyStatConfig();
  initNotifWidget();
  _initBlogArticleModal();
})();

function loadHomeGames() {
  const container = document.getElementById('home-games-grid');
  if (!container) return;
  const games = _data.games;
  if (!games.length) return;

  const popular = games.filter(g => g.popular);
  const display = (popular.length >= 3 ? popular : games).slice(0, 3);

  container.innerHTML = display.map(g => `
    <div class="game-card${g.popular ? ' featured-card' : ''}">
      ${g.popular ? '<div class="ribbon">Populaire</div>' : ''}
      <div class="game-card-img" style="background:${escHtml(g.gradient || 'linear-gradient(135deg,#1a0a2e,#4b1c7d)')};">
        ${g.image ? `<img class="game-card-bg-img" src="${escHtml(g.image)}" alt="">` : ''}
        <div class="game-card-icon">${escHtml(g.icon || '⚔')}</div>
      </div>
      <div class="game-card-body">
        <span class="tag tag-${escHtml(g.tagColor)}">${escHtml(g.tag)}</span>
        <h3>${escHtml(g.title)}</h3>
        <p>${escHtml(g.description)}</p>
        <a href="#jeux" class="btn btn-sm nav-link" data-target="jeux" data-scroll-to="game-${escHtml(g.id)}">En savoir plus</a>
      </div>
    </div>`).join('');
}

function populateTableCheckboxes(eventId) {
  const container = document.getElementById('ins-univers-list');
  if (!container) return;
  const tables = (_data.tables || []).filter(t => t.eventId === eventId && !t.cancelled);
  if (!tables.length) {
    container.innerHTML = '<span class="univers-empty">Aucune table disponible pour cet événement.</span>';
    return;
  }
  container.innerHTML = tables.map(t =>
    `<label><input type="checkbox" value="${escHtml(t.gameName)}"> ${escHtml(t.gameName)}</label>`
  ).join('');
}

/* ─── Date helpers ────────────────────────────────────────────────── */
function eventToDate(e) {
  const day = parseInt(e.startDay || e.day, 10);
  const mon = FR_MONTHS[e.startMonth || e.month];
  const yr  = parseInt(e.startYear  || e.year, 10);
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return new Date(yr, mon, day);
}

function eventEffectiveEndDate(e) {
  if (e.endDay) {
    const day = parseInt(e.endDay, 10);
    const mon = FR_MONTHS[e.endMonth];
    const yr  = parseInt(e.endYear, 10);
    if (!isNaN(day) && mon !== undefined && !isNaN(yr)) return new Date(yr, mon, day);
  }
  return eventToDate(e);
}

function isEventPast(e) {
  const d = eventEffectiveEndDate(e);
  if (!d) return false;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() < Date.now();
}

/* ─── Events ─────────────────────────────────────────────────────── */
function loadDynamicEvents() {
  const events = _data.events;

  // Hide static fallbacks as soon as data has loaded (even if empty)
  document.querySelector('.event-hero-card.static-fallback')?.style.setProperty('display', 'none');
  document.querySelectorAll('.events-timeline > .event-item').forEach(el => el.style.display = 'none');

  if (!events.length) return;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const upcoming = [], past = [];
  events.forEach(e => {
    const end = eventEffectiveEndDate(e);
    (end && end < today ? past : upcoming).push(e);
  });

  upcoming.sort((a, b) => (eventToDate(a) || 0) - (eventToDate(b) || 0));
  past.sort((a, b) => (eventEffectiveEndDate(b) || 0) - (eventEffectiveEndDate(a) || 0));

  const featured = upcoming[0];
  const timeline = upcoming.slice(1);

  if (featured) {
    const el = document.getElementById('dynamic-featured-event');
    if (el) el.innerHTML = buildFeaturedEventHTML(featured);
    _updateNextEventBar(featured);
  }

  const container = document.getElementById('dynamic-events');
  if (container) {
    container.innerHTML = timeline.map(buildTimelineEventHTML).join('');
  }

  const pastContainer = document.getElementById('past-events');
  const pastTitle     = document.getElementById('past-events-title');
  if (pastContainer && past.length) {
    pastContainer.innerHTML = past.map(buildTimelineEventHTML).join('');
    if (pastTitle) pastTitle.hidden = false;
  }
}

function eventTimeDisplay(e) {
  const sFrom = e.startTimeFrom || e.startTime || e.time || '';
  const sTo   = e.startTimeTo   || e.endTime   || '';
  const eFrom = e.endTimeFrom   || '';
  const eTo   = e.endTimeTo     || '';
  return {
    start: sFrom && sTo ? `${sFrom} – ${sTo}` : sFrom,
    end:   eFrom && eTo ? `${eFrom} – ${eTo}` : eFrom
  };
}

function registrationCount(eventId) {
  return (_data.registrations || []).filter(r => r.eventId === eventId).length;
}

function refreshSpots(eventId) {
  const e = (_data.events || []).find(ev => ev.id === eventId);
  if (!e) return;
  document.querySelectorAll(`[data-spots="${eventId}"]`).forEach(el => {
    el.innerHTML = `&#9998;${spotsLabel(e)}`;
  });
  const full = isEventFull(e);
  document.querySelectorAll(`.btn-inscrire[data-event-id="${eventId}"]`).forEach(btn => {
    btn.disabled = full;
  });
}

function spotsLabel(e) {
  if (!e.inscription) return '';
  const cap = parseInt(e.capacity, 10);
  if (!cap) return ' Inscription obligatoire';
  const taken = registrationCount(e.id);
  const left  = Math.max(0, cap - taken);
  if (left === 0) return ' Complet';
  return ` Inscription obligatoire — ${left} place${left !== 1 ? 's' : ''} restante${left !== 1 ? 's' : ''}`;
}

function isEventFull(e) {
  if (!e.inscription) return false;
  const cap = parseInt(e.capacity, 10);
  if (!cap) return false;
  return registrationCount(e.id) >= cap;
}

function buildDateRangeDisplay(e, times) {
  const sDay = escHtml(e.startDay   || e.day   || '');
  const sMon = escHtml(e.startMonth || e.month || '');
  const sYr  = escHtml(e.startYear  || e.year  || '');
  const startDate   = `${sDay} ${sMon} ${sYr}`.trim();
  const startSuffix = times.start ? ` : ${escHtml(times.start)}` : '';

  if (!e.endDay) return startDate + startSuffix;

  const endDate   = `${escHtml(e.endDay)} ${escHtml(e.endMonth)} ${escHtml(e.endYear)}`.trim();
  const endSuffix = times.end ? ` : ${escHtml(times.end)}` : '';
  return `Du ${startDate}${startSuffix} au ${endDate}${endSuffix}`;
}

function buildEventTablesHTML(eventId) {
  const tables = (_data.tables || []).filter(t => t.eventId === eventId && !t.cancelled);
  if (!tables.length) return '';
  return `<div class="event-tables-pub">
    <span class="event-tables-pub-label">&#127922; Tables :</span>
    ${tables.map(t => `<span class="event-tables-pub-chip">${escHtml(t.gameName)}</span>`).join('')}
  </div>`;
}

function _updateNextEventBar(e) {
  const bar = document.querySelector('.next-event-bar');
  if (!bar) return;

  const FR_DAYS   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const FR_MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const FR_M = { Jan:0,'Fév':1,Mar:2,Avr:3,Mai:4,Jun:5,Jul:6,'Aoû':7,Sep:8,Oct:9,Nov:10,'Déc':11 };

  const d = e.startDay || e.day || '';
  const m = e.startMonth || e.month || '';
  const y = e.startYear  || e.year  || '';
  let dateStr = `${d} ${m} ${y}`.trim();

  const mIdx = FR_M[m];
  if (d && mIdx !== undefined && y) {
    const dt  = new Date(parseInt(y), mIdx, parseInt(d));
    dateStr   = `${FR_DAYS[dt.getDay()]} ${parseInt(d)} ${FR_MONTHS_LONG[mIdx]} ${y}`;
  }

  const dateEl  = bar.querySelector('.next-event-date');
  const titleEl = bar.querySelector('.next-event-title');
  const linkEl  = bar.querySelector('a.nav-link');

  if (dateEl)  dateEl.textContent  = dateStr;
  if (titleEl) titleEl.textContent = e.title || '';
  if (linkEl && e.id) {
    linkEl.dataset.scrollTo = 'dynamic-featured-event';
  }
}

function buildFeaturedEventHTML(e) {
  const times    = eventTimeDisplay(e);
  const dateRange = buildDateRangeDisplay(e, times);
  return `
  <div class="event-hero-card">
    <div class="ehc-date-block">
      <span class="ehc-month">${escHtml(e.startMonth || e.month || '')}</span>
      <span class="ehc-day">${escHtml(e.startDay   || e.day   || '')}</span>
      <span class="ehc-year">${escHtml(e.startYear  || e.year  || '')}</span>
    </div>
    <div class="ehc-body">
      <span class="tag tag-${escHtml(e.tagColor)}">&#9733; ${escHtml(e.tag)}</span>
      <h2>${escHtml(e.title)}</h2>
      <p>${escHtml(e.description)}</p>
      <ul class="event-details">
        <li>&#128197; ${dateRange}</li>
        ${e.location    ? `<li>&#128205; ${escHtml(e.location)}</li>` : ''}
        ${e.capacity    ? `<li>&#128100; ${escHtml(e.capacity)}</li>` : ''}
        ${e.inscription ? `<li data-spots="${escHtml(e.id)}">&#9998;${spotsLabel(e)}</li>` : ''}
      </ul>
      ${buildEventTablesHTML(e.id)}
      ${!isEventPast(e) ? `<div class="event-btn-row">
        ${e.inscription ? `<button class="btn btn-primary btn-inscrire"${isEventFull(e) ? ' disabled' : ''} data-event-id="${escHtml(e.id)}" data-event-title="${escHtml(e.title)}">S'inscrire</button>` : ''}
        <button class="btn btn-outline btn-event-notif" data-notif-id="${escHtml(e.id)}" data-notif-title="${escHtml(e.title)}">&#128276; Être notifié</button>
      </div>` : ''}
    </div>
  </div>`;
}

function buildTimelineEventHTML(e) {
  const times     = eventTimeDisplay(e);
  const dateRange = buildDateRangeDisplay(e, times);
  return `
  <div class="event-item">
    <div class="event-date-col">
      <span class="ed-day">${escHtml(e.startDay   || e.day   || '')}</span>
      <span class="ed-month">${escHtml(e.startMonth || e.month || '')}</span>
    </div>
    <div class="event-connector">
      <div class="ec-dot"></div>
      <div class="ec-line"></div>
    </div>
    <div class="event-content">
      <span class="tag tag-${escHtml(e.tagColor)}">${escHtml(e.tag)}</span>
      <h4>${escHtml(e.title)}</h4>
      <p>${escHtml(e.description)}</p>
      <div class="event-meta">
        <span>&#128197; ${dateRange}</span>
        ${e.location    ? `<span>&#128205; ${escHtml(e.location)}</span>` : ''}
        ${e.capacity    ? `<span>&#128100; ${escHtml(e.capacity)}</span>` : ''}
        ${e.inscription ? `<span data-spots="${escHtml(e.id)}">&#9998;${spotsLabel(e)}</span>` : ''}
      </div>
      ${buildEventTablesHTML(e.id)}
      ${!isEventPast(e) ? `<div class="event-btn-row" style="margin-top:.8rem;">
        ${e.inscription ? `<button class="btn btn-primary btn-sm btn-inscrire"${isEventFull(e) ? ' disabled' : ''} data-event-id="${escHtml(e.id)}" data-event-title="${escHtml(e.title)}">S'inscrire</button>` : ''}
        <button class="btn btn-sm btn-event-notif" data-notif-id="${escHtml(e.id)}" data-notif-title="${escHtml(e.title)}">&#128276; Être notifié</button>
      </div>` : ''}
    </div>
  </div>`;
}

/* ─── Blog ───────────────────────────────────────────────────────── */
function _blogExcerpt(content, max = 200) {
  if (!content) return '';
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

function _openBlogArticle(id) {
  const a = (_data.blog || []).find(b => b.id === id);
  if (!a) return;
  const cat = BLOG_CATS[a.category] || { label: a.category, color: 'blue', icon: '📰', gradient: 'linear-gradient(135deg,#050b1a,#0e204d)' };
  const bamHeader = document.getElementById('bam-header');
  const bamIcon   = document.getElementById('bam-icon');
  const catImg    = cat.image || a.image;
  if (catImg) {
    bamHeader.style.background      = '#111';
    bamHeader.style.backgroundImage = `url('${catImg}')`;
    bamHeader.style.backgroundSize  = 'cover';
    bamHeader.style.backgroundPosition = 'center';
    bamIcon.textContent = '';
    bamIcon.style.display = 'none';
  } else {
    bamHeader.style.background      = a.gradient || cat.gradient;
    bamHeader.style.backgroundImage = '';
    bamHeader.style.backgroundSize  = '';
    bamHeader.style.backgroundPosition = '';
    bamIcon.textContent = a.icon || cat.icon;
    bamIcon.style.display = '';
  }
  document.getElementById('bam-tag').textContent   = a.catLabel || cat.label;
  document.getElementById('bam-tag').className     = `tag tag-${escHtml(a.tagColor || cat.color)}`;
  document.getElementById('bam-title').textContent = a.title;
  document.getElementById('bam-meta').textContent  = `Par ${a.author}  ·  ${formatBlogDate(a.date)}`;
  document.getElementById('bam-content').innerHTML = a.content || '<p><em>Contenu non disponible.</em></p>';
  document.getElementById('blog-article-overlay').hidden = false;
  document.body.style.overflow = 'hidden';
}

function _initBlogArticleModal() {
  const overlay = document.getElementById('blog-article-overlay');
  if (!overlay) return;

  function close() { overlay.hidden = true; document.body.style.overflow = ''; }
  document.getElementById('bam-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  document.getElementById('bam-share-fb').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}#blog`;
    window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url), '_blank', 'width=620,height=450,noopener');
  });
}

function loadDynamicBlog() {
  const container = document.getElementById('dynamic-blog');
  if (!container) return;
  const articles = _data.blog;
  if (!articles.length) {
    container.innerHTML = '<p class="blog-empty">Aucun article publié pour le moment.</p>';
    loadBlogSidebar();
    return;
  }
  container.innerHTML = articles.map(a => {
    const cat = BLOG_CATS[a.category] || { label: a.category, color: 'blue', icon: '📰', gradient: 'linear-gradient(135deg,#050b1a,#0e204d)' };
    const dateStr = formatBlogDate(a.date);
    const catImg  = cat.image || a.image;
    const baImgStyle = catImg
      ? `background:#111;background-image:url('${escHtml(catImg)}');background-size:cover;background-position:center`
      : `background:${escHtml(a.gradient || cat.gradient)}`;
    return `
    <article class="blog-article blog-article-clickable" data-blog-id="${escHtml(a.id)}">
      <div class="ba-img" style="${baImgStyle}">
        ${catImg ? '' : `<div class="ba-icon">${escHtml(a.icon || cat.icon)}</div>`}
        <span class="tag tag-${escHtml(a.tagColor || cat.color)} ba-img-tag">${escHtml(a.catLabel || cat.label)}</span>
        <div class="ba-date">${escHtml(dateStr)}</div>
      </div>
      <div class="ba-body">
        <h2>${escHtml(a.title)}</h2>
        <div class="ba-meta">Par <strong>${escHtml(a.author)}</strong> | ${escHtml(dateStr)}</div>
        <p>${escHtml(_blogExcerpt(a.content))}</p>
        <span class="ba-read-more">Lire la suite →</span>
      </div>
    </article>`;
  }).join('');
  container.querySelectorAll('.blog-article-clickable').forEach(el => {
    el.addEventListener('click', () => _openBlogArticle(el.dataset.blogId));
  });
  loadBlogSidebar();
}

function loadBlogSidebar() {
  const catList = document.getElementById('dynamic-cat-list');
  if (catList) {
    const counts = {};
    (_data.blog || []).forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });
    const rows = Object.keys(BLOG_CATS)
      .filter(k => counts[k])
      .map(k => `<li><a href="#">${escHtml(BLOG_CATS[k].label)} <span>${counts[k]}</span></a></li>`)
      .join('');
    catList.innerHTML = rows || '<li style="color:var(--text-muted);font-size:.9rem">Aucun article</li>';
  }
  const recentList = document.getElementById('dynamic-recent-posts');
  if (recentList) {
    const recent = (_data.blog || []).slice(0, 4);
    recentList.innerHTML = recent.length
      ? recent.map(a => `<li><a href="#">${escHtml(a.title)}</a><span>${escHtml(formatBlogDate(a.date))}</span></li>`).join('')
      : '<li style="color:var(--text-muted);font-size:.9rem">Aucun article</li>';
  }
}

function loadHomeBlog() {
  const container = document.getElementById('home-blog-grid');
  if (!container) return;
  const articles = (_data.blog || []).slice(0, 3);
  if (!articles.length) { container.innerHTML = ''; return; }
  const months = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  container.innerHTML = articles.map((a, i) => {
    const cat = BLOG_CATS[a.category] || { label: a.category, color: 'blue', icon: '📰', gradient: 'linear-gradient(135deg,#050b1a,#0e204d)' };
    const parts = (a.date || '').split('-');
    const dayNum = parts[2] ? parseInt(parts[2], 10) : '';
    const monStr = parts[1] ? (months[parseInt(parts[1], 10) - 1] || '') : '';
    const catImg  = cat.image || a.image;
    const cardImgStyle = catImg
      ? `background:#111;background-image:url('${escHtml(catImg)}');background-size:cover;background-position:center`
      : `background:${escHtml(a.gradient || cat.gradient)}`;
    return `
    <article class="blog-card${i === 0 ? ' wide' : ''}">
      <div class="blog-card-img" style="${cardImgStyle}">
        <div class="blog-date-badge"><span>${escHtml(String(dayNum))}</span><span>${escHtml(monStr)}</span></div>
        ${catImg ? '' : `<div class="blog-card-icon">${escHtml(a.icon || cat.icon)}</div>`}
      </div>
      <div class="blog-card-body">
        <span class="tag tag-${escHtml(a.tagColor || cat.color)}">${escHtml(a.catLabel || cat.label)}</span>
        <h3><a href="#blog" class="nav-link" data-target="blog">${escHtml(a.title)}</a></h3>
        <p>${escHtml(_blogExcerpt(a.content, 120))}</p>
        <div class="blog-meta"><span>Par ${escHtml(a.author)}</span><span>${escHtml(formatBlogDate(a.date))}</span></div>
      </div>
    </article>`;
  }).join('');
}

/* ─── Games ──────────────────────────────────────────────────────── */
function loadDynamicGames() {
  const games = [..._data.games].sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  const container = document.getElementById('dynamic-games');
  if (!container || !games.length) return;

  container.innerHTML = games.map(g => `
  <div class="game-full-card" id="game-${escHtml(g.id)}" data-cat="${escHtml(g.category)}">
    <div class="gfc-left" style="background:${escHtml(g.gradient || 'linear-gradient(135deg,#1a0a2e,#4b1c7d)')};">
      ${g.image ? `<img class="gfc-bg-img" src="${escHtml(g.image)}" alt="">` : ''}
      <div class="gfc-icon">${escHtml(g.icon || '⚔')}</div>
      <span class="tag tag-${escHtml(g.tagColor)}">${escHtml(g.tag)}</span>
    </div>
    <div class="gfc-right">
      <h3>${escHtml(g.title)}</h3>
      <p>${escHtml(g.description)}</p>
      <div class="gfc-tags">
        ${(g.badges || []).map(b => `<span>${escHtml(b)}</span>`).join('')}
      </div>
      <a href="#contacts" class="btn btn-primary btn-sm nav-link" data-target="contacts">Rejoindre une table</a>
    </div>
  </div>`).join('');
}

/* ─── Team ───────────────────────────────────────────────────────── */
function loadDynamicTeam() {
  const team = _data.team;
  if (!team.length) return;

  const bureauContainer = document.getElementById('dynamic-team-bureau');
  const mjContainer     = document.getElementById('dynamic-team-mj');

  const bureau = team.filter(m => m.type === 'bureau')
                     .sort((a, b) => (b.isPresident ? 1 : 0) - (a.isPresident ? 1 : 0));
  const mjs    = team.filter(m => m.type === 'mj');

  if (bureauContainer && bureau.length) {
    bureauContainer.innerHTML = bureau.map(m => {
      const badges = String(m.roleBadge || '').split(',').map(s => s.trim()).filter(Boolean);
      return `
    <div class="team-card ${m.isPresident ? 'president' : ''}">
      <div class="tc-avatar" style="background:${m.photo ? 'none' : escHtml(m.gradient || 'linear-gradient(135deg,#1a0a2e,#4b1c7d)')};">
        ${m.photo
          ? `<img class="tc-photo" src="${escHtml(m.photo)}" alt="${escHtml(m.name)}" />`
          : `<span class="tc-initials">${escHtml(m.initials)}</span>`}
        <div class="tc-badges-wrap">
          ${badges.map(b => `<div class="tc-role-badge">${escHtml(b)}</div>`).join('')}
        </div>
      </div>
      <div class="tc-body">
        <h3>${escHtml(m.name)}</h3>
        <p class="tc-bio">${escHtml(m.bio)}</p>
      </div>
    </div>`;
    }).join('');
    const staticBureau = document.getElementById('static-bureau-cards');
    if (staticBureau) staticBureau.style.display = 'none';
  }

  if (mjContainer && mjs.length) {
    mjContainer.innerHTML = mjs.map(m => `
    <div class="mj-card">
      <div class="mj-avatar" style="background:${m.photo ? 'none' : escHtml(m.gradient || 'linear-gradient(135deg,#0a1a0a,#1c5c1c)')};">
        ${m.photo
          ? `<img class="mj-photo" src="${escHtml(m.photo)}" alt="${escHtml(m.name)}" />`
          : `<span>${escHtml(m.initials)}</span>`}
      </div>
      <h4>${escHtml(m.name)}</h4>
      <p>${escHtml(m.role)}</p>
      ${(m.games || []).length ? `<div class="mj-games">${(m.games).map(g => `<span>${escHtml(g)}</span>`).join('')}</div>` : ''}
    </div>`).join('');
    const staticMj = document.getElementById('static-mj-cards');
    if (staticMj) staticMj.style.display = 'none';
  }
}

/* ══════════════════════════════════════════════════════════════════
   SPA Navigation
══════════════════════════════════════════════════════════════════ */
const pages    = document.querySelectorAll('.page');
const navLinks = document.querySelectorAll('.nav-link');
const navMenu  = document.getElementById('main-nav');
const navToggle= document.getElementById('nav-toggle');

function _sendBeacon(type, page, label) {
  const payload = JSON.stringify({ type, page, label: label || '' });
  // sendBeacon can return false if the UA can't queue the request; always fall back to fetch
  const queued = typeof navigator.sendBeacon === 'function' &&
    navigator.sendBeacon('/api/analytics', new Blob([payload], { type: 'application/json' }));
  if (!queued) {
    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  }
}

function showPage(target, scrollToId) {
  pages.forEach(p => p.classList.toggle('active', p.id === target));

  navLinks.forEach(l => {
    l.classList.toggle('active', l.dataset.target === target);
  });

  _sendBeacon('pageview', target);
  try { history.pushState(null, '', '#' + target); } catch {}

  if (scrollToId) {
    setTimeout(() => {
      const el = document.getElementById(scrollToId);
      if (!el) return;
      const header = document.getElementById('site-header');
      const offset = header ? header.offsetHeight + 16 : 80;
      const top = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }, 50);
  } else {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (navMenu) navMenu.classList.remove('open');
  if (navToggle) navToggle.setAttribute('aria-expanded', 'false');

  if (target === 'home' && _statDataReady) runCounters();
}

document.addEventListener('click', e => {
  const link = e.target.closest('.nav-link');
  if (!link) return;
  const target = link.dataset.target;
  if (!target) return;
  e.preventDefault();
  showPage(target, link.dataset.scrollTo);
});

window.addEventListener('popstate', () => {
  const hash = location.hash.replace('#', '') || 'home';
  showPage(hash);
});

/* ─── Click analytics ─────────────────────────────────────────────── */
document.addEventListener('click', e => {
  const btn = e.target.closest('button, a, .btn, [data-event-id]');
  if (!btn) return;
  const currentPage = document.querySelector('.page.active')?.id || 'home';
  const label = (btn.textContent || btn.getAttribute('aria-label') || btn.className || '').trim().slice(0, 60);
  if (label) _sendBeacon('click', currentPage, label);
}, { passive: true });

(function init() {
  try {
    const hash = location.hash.replace('#', '') || 'home';
    showPage(hash);
  } catch (e) { console.error('init error', e); }
})();

/* ─── Mobile nav toggle ───────────────────────────────────────────── */
if (navToggle) navToggle.addEventListener('click', () => {
  const open = navMenu.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open);
});

/* ─── Header scroll shadow ────────────────────────────────────────── */
const header = document.getElementById('site-header');
window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

/* ─── Site stats config ───────────────────────────────────────────── */
let _statDataReady = false;

async function applyStatConfig() {
  let cfg = {};
  try {
    const res = await fetch('/data/site.json');
    if (res.ok) cfg = await res.json();
  } catch {
    try { cfg = JSON.parse(localStorage.getItem('rr_site') || '{}'); } catch {}
  }
  const map = { membres: 'stat-membres', parties: 'stat-parties', evenements: 'stat-evenements', annees: 'stat-annees' };
  for (const [key, id] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el || cfg[key] == null) continue;
    el.dataset.target = cfg[key];
  }
  _statDataReady = true;
  const homeEl = document.getElementById('home');
  if (homeEl && homeEl.classList.contains('active')) runCounters();
}

/* ─── Animated counters ───────────────────────────────────────────── */
let countersRun = false;

function runCounters() {
  if (countersRun) return;
  countersRun = true;

  document.querySelectorAll('.stat-number').forEach(el => {
    const target = +el.dataset.target;
    const duration = 1400;
    const step = 16;
    const increments = Math.ceil(duration / step);
    let current = 0;
    let count = 0;

    const timer = setInterval(() => {
      count++;
      current = Math.round((target * count) / increments);
      el.textContent = current;
      if (count >= increments) {
        el.textContent = target;
        clearInterval(timer);
      }
    }, step);
  });
}

/* ─── Filter buttons (Jeux de rôles) ─────────────────────────────── */
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const filter = btn.dataset.filter;
    document.querySelectorAll('.game-full-card').forEach(card => {
      if (filter === 'all' || card.dataset.cat === filter) {
        card.classList.remove('hidden');
        card.style.animation = 'none';
        card.offsetHeight;
        card.style.animation = 'fadeSlideIn .35s ease forwards';
      } else {
        card.classList.add('hidden');
      }
    });
  });
});

/* ─── Contact form ────────────────────────────────────────────────── */
const form    = document.getElementById('contact-form');
const success = document.getElementById('form-success');

if (form) form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = form.querySelector('button[type="submit"]');
  btn.textContent = 'Envoi en cours…';
  btn.disabled = true;

  try {
    const data = {
      fname:   form.fname.value.trim(),
      lname:   form.lname.value.trim(),
      email:   form.email.value.trim(),
      subject: form.subject?.value || '',
      message: form.message.value.trim(),
    };
    await fetch('/api/contact', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
  } catch {}

  if (success) success.classList.add('visible');
  form.reset();
  btn.textContent = 'Envoyer le message ›';
  btn.disabled = false;
  if (success) setTimeout(() => success.classList.remove('visible'), 5000);
});

/* ─── Particle generator ─────────────────────────────────────────── */
function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    p.style.left              = Math.random() * 100 + '%';
    p.style.width             = (Math.random() * 3 + 1) + 'px';
    p.style.height            = p.style.width;
    p.style.animationDuration = (Math.random() * 12 + 8) + 's';
    p.style.animationDelay    = (Math.random() * 10) + 's';
    p.style.opacity           = Math.random() * 0.5 + 0.1;
    container.appendChild(p);
  }
}
createParticles();

/* ─── Scroll reveal ──────────────────────────────────────────────── */
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

function observeCards() {
  document.querySelectorAll(
    '.game-card, .game-full-card, .blog-article, .team-card, .mj-card, .event-content, .ci-block'
  ).forEach(el => {
    if (el.dataset.observed) return;
    el.dataset.observed = '1';
    el.style.opacity   = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity .5s ease, transform .5s ease';
    revealObserver.observe(el);
  });
}
observeCards();

const pageObserver = new MutationObserver(() => observeCards());
pages.forEach(p => pageObserver.observe(p, { attributes: true, attributeFilter: ['class'] }));

/* ─── Keyboard navigation ─────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    navMenu.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }
});

/* ─── CSS animation for filter ───────────────────────────────────── */
const animStyle = document.createElement('style');
animStyle.textContent = `
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateX(-12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
`;
document.head.appendChild(animStyle);

/* ══════════════════════════════════════════════════════════════════
   MODAL INSCRIPTION
══════════════════════════════════════════════════════════════════ */
(function initInscriptionModal() {
  const overlay   = document.getElementById('inscription-overlay');
  const insForm   = document.getElementById('inscription-form');
  const titleEl   = document.getElementById('inscription-event-title');
  const cancelBtn = document.getElementById('inscription-cancel');
  const errEl     = document.getElementById('ins-error');
  if (!overlay || !insForm || !titleEl || !cancelBtn || !errEl) {
    console.error('initInscriptionModal: missing DOM elements');
    return;
  }
  let currentEventId    = null;
  let currentEventTitle = null;

  function openModal(eventId, eventTitle) {
    currentEventId    = eventId;
    currentEventTitle = eventTitle;
    titleEl.textContent = eventTitle || '';
    insForm.reset();
    populateTableCheckboxes(eventId);
    errEl.hidden = true;
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    overlay.hidden = true;
    document.body.style.overflow = '';
    currentEventId = null;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn-inscrire');
    if (btn) openModal(btn.dataset.eventId, btn.dataset.eventTitle);
  });

  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  insForm.addEventListener('submit', e => {
    e.preventDefault();
    const name  = document.getElementById('ins-name').value.trim();
    const email = document.getElementById('ins-email').value.trim();
    if (!name || !email) { errEl.hidden = false; return; }

    const reg = {
      id:         'reg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      eventId:    currentEventId,
      eventTitle: currentEventTitle,
      name,
      email,
      firstTime:  document.getElementById('ins-firsttime').checked,
      univers:    Array.from(document.querySelectorAll('#ins-univers-list input:checked')).map(cb => cb.value).join(', '),
      createdAt:  new Date().toISOString()
    };

    _data.registrations.push(reg);
    fetch('/data/registrations.json', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(_data.registrations)
    }).catch(() => {
      try { localStorage.setItem('rr_registrations', JSON.stringify(_data.registrations)); } catch {}
    });

    const savedEventId = currentEventId;
    closeModal();
    refreshSpots(savedEventId);
    const ok = document.createElement('div');
    ok.className = 'ins-success-toast';
    ok.textContent = '✓ Inscription enregistrée !';
    document.body.appendChild(ok);
    setTimeout(() => ok.remove(), 3500);
  });
})();

/* ══════════════════════════════════════════════════════════════════
   WIDGET NOTIFICATIONS
══════════════════════════════════════════════════════════════════ */
function initNotifWidget() {
  const emailInput = document.getElementById('notif-email-input');
  const subBtn     = document.getElementById('btn-subscribe');
  const msgEl      = document.getElementById('notif-msg');
  if (!emailInput || !subBtn) return;

  subBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _notifMsg('Adresse e-mail invalide.', false); return;
    }
    const subs = _data.subscriptions || [];
    if (subs.find(s => s.email === email)) {
      _notifMsg('Cette adresse est déjà abonnée.', false); return;
    }
    const _uid  = 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const _tok  = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : (_uid + '_' + Math.random().toString(36).slice(2, 10));
    const entry = { id: _uid, token: _tok, email, createdAt: new Date().toISOString() };
    subs.push(entry);
    _data.subscriptions = subs;
    try {
      await fetch('/data/subscriptions.json', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(subs)
      });
    } catch {
      try { localStorage.setItem('rr_subscriptions', JSON.stringify(subs)); } catch {}
    }
    emailInput.value = '';
    _notifMsg('Abonnement confirmé ! Vous recevrez un e-mail pour vous désabonner.', true);
  });

  function _notifMsg(text, ok) {
    msgEl.textContent = text;
    msgEl.style.color   = ok ? '#4ade80' : '#fca5a5';
    msgEl.style.display = '';
    setTimeout(() => { msgEl.style.display = 'none'; }, 5000);
  }
}

/* ══════════════════════════════════════════════════════════════════
   MODAL ÊTRE NOTIFIÉ (rappels événement)
══════════════════════════════════════════════════════════════════ */
(function initEventNotifModal() {
  const overlay    = document.getElementById('event-notif-overlay');
  const titleEl    = document.getElementById('event-notif-event-title');
  const emailInput = document.getElementById('event-notif-email');
  const submitBtn  = document.getElementById('event-notif-submit');
  const cancelBtn  = document.getElementById('event-notif-cancel');
  const msgEl      = document.getElementById('event-notif-msg');
  if (!overlay) return;

  let currentEventId = null;

  function openModal(eventId, eventTitle) {
    currentEventId = eventId;
    titleEl.textContent = eventTitle || '';
    emailInput.value = '';
    msgEl.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = '🔔 Me notifier';
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => emailInput.focus(), 50);
  }

  function closeModal() {
    overlay.hidden = true;
    document.body.style.overflow = '';
    currentEventId = null;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.btn-event-notif');
    if (btn) openModal(btn.dataset.notifId, btn.dataset.notifTitle);
  });

  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  submitBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _showMsg('Adresse e-mail invalide.', false); return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '…';
    try {
      const res  = await fetch('/api/event-subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, eventId: currentEventId })
      });
      const data = await res.json();
      if (data.ok) {
        _showMsg('Inscription confirmée ! Vous recevrez des rappels par e-mail.', true);
        emailInput.value = '';
        setTimeout(closeModal, 3000);
      } else {
        _showMsg(data.error || 'Erreur. Veuillez réessayer.', false);
        submitBtn.disabled = false;
        submitBtn.textContent = '🔔 Me notifier';
      }
    } catch {
      _showMsg('Erreur réseau. Veuillez réessayer.', false);
      submitBtn.disabled = false;
      submitBtn.textContent = '🔔 Me notifier';
    }
  });

  function _showMsg(text, ok) {
    msgEl.textContent = text;
    msgEl.style.color = ok ? '#4ade80' : '#fca5a5';
    msgEl.hidden = false;
  }
})();

/* ══════════════════════════════════════════════════════════════════
   MODAL PRÉFÉRENCES NOTIFICATIONS
══════════════════════════════════════════════════════════════════ */
(function initNotifPrefModal() {
  const overlay    = document.getElementById('notif-pref-overlay');
  const emailInput = document.getElementById('notif-pref-email');
  const submitBtn  = document.getElementById('notif-pref-submit');
  const cancelBtn  = document.getElementById('notif-pref-cancel');
  const msgEl      = document.getElementById('notif-pref-msg');
  const heroBtn    = document.getElementById('btn-notif-hero');
  if (!overlay || !heroBtn) return;

  const toutCb     = document.getElementById('notif-topic-tout');
  const specificCbs = [...document.querySelectorAll('[name="notif-topic"]')].filter(cb => cb.value !== 'tout');

  toutCb.addEventListener('change', () => {
    if (toutCb.checked) specificCbs.forEach(cb => cb.checked = false);
  });
  specificCbs.forEach(cb => cb.addEventListener('change', () => {
    if (cb.checked) toutCb.checked = false;
  }));

  function openModal() {
    toutCb.checked = true;
    specificCbs.forEach(cb => cb.checked = false);
    emailInput.value = '';
    msgEl.hidden = true;
    submitBtn.disabled = false;
    submitBtn.textContent = "S'abonner";
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    overlay.hidden = true;
    document.body.style.overflow = '';
  }

  heroBtn.addEventListener('click', openModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  submitBtn.addEventListener('click', async () => {
    const email  = emailInput.value.trim();
    const topics = [...document.querySelectorAll('[name="notif-topic"]:checked')].map(cb => cb.value);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      _showMsg('Adresse e-mail invalide.', false); return;
    }
    if (!topics.length) {
      _showMsg('Choisissez au moins un sujet.', false); return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '…';
    try {
      const res  = await fetch('/api/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, topics })
      });
      const data = await res.json();
      if (data.ok) {
        _showMsg('Abonnement confirmé ! Un e-mail de confirmation vous a été envoyé.', true);
        setTimeout(closeModal, 3000);
      } else {
        _showMsg(data.error || 'Erreur. Veuillez réessayer.', false);
        submitBtn.disabled = false;
        submitBtn.textContent = "S'abonner";
      }
    } catch {
      _showMsg('Erreur réseau. Veuillez réessayer.', false);
      submitBtn.disabled = false;
      submitBtn.textContent = "S'abonner";
    }
  });

  function _showMsg(text, ok) {
    msgEl.textContent = text;
    msgEl.style.color = ok ? '#4ade80' : '#fca5a5';
    msgEl.hidden = false;
  }
})();


/* ═══════════════════════════════════════════════════════════════════
   AGENDA — Calendrier
═══════════════════════════════════════════════════════════════════ */
const CAL_MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const CAL_DAYS_SHORT  = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const CAL_AGENDA_COLORS = {
  'Gros-jeu Ludoried': '#7c3aed',
  'Réunion bureau':    '#0891b2'
};
const CAL_AGENDA_COLOR_DEFAULT = '#15803d';

let _calEntries = [];

function _fmtISODate(ds) {
  if (!ds) return '';
  const [y, m, d] = ds.split('-').map(Number);
  return `${d} ${CAL_MONTHS_LONG[m - 1]} ${y}`;
}

function _fmtEventDate(ev) {
  const sD = ev.startDay || ev.day || '';
  const sM = ev.startMonth || ev.month || '';
  const sY = ev.startYear  || ev.year  || '';
  const eD = ev.endDay || '';
  const eM = ev.endMonth || '';
  const eY = ev.endYear  || '';
  if (eD && eM && eY && (eD !== sD || eM !== sM || eY !== sY)) {
    if (eM === sM && eY === sY) return `${sD} – ${eD} ${sM} ${sY}`;
    return `${sD} ${sM} ${sY} – ${eD} ${eM} ${eY}`;
  }
  return `${sD} ${sM} ${sY}`;
}

function loadDynamicAgenda() {
  const container = document.getElementById('agenda-calendar');
  if (!container) return;
  renderCalendar(container);
  _initAgendaEntryModal();
}

function buildCalendarDayMap(year, month) {
  const map = {};
  const add = (ds, entry) => { (map[ds] = map[ds] || []).push(entry); };
  const monthStart = new Date(year, month, 1);
  const monthEnd   = new Date(year, month + 1, 0);

  (_data.events || []).forEach(ev => {
    const start = eventToDate(ev);
    if (!start) return;
    const end = eventEffectiveEndDate(ev) || start;
    if (start > monthEnd || end < monthStart) return;
    const from = start < monthStart ? new Date(monthStart) : new Date(start);
    const to   = end   > monthEnd   ? new Date(monthEnd)   : new Date(end);
    const timeLabel = [ev.startTimeFrom, ev.startTimeTo].filter(Boolean).join(' – ');
    const d = new Date(from);
    while (d <= to) {
      add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, {
        title:       ev.title,
        color:       '#e8a020',
        type:        'event',
        dateLabel:   _fmtEventDate(ev),
        timeLabel,
        description: ev.description || '',
        location:    ev.location    || ''
      });
      d.setDate(d.getDate() + 1);
    }
  });

  (_data.agenda || []).forEach(ag => {
    if (!ag.date) return;
    const [ay, am, ad] = ag.date.split('-').map(Number);
    const start = new Date(ay, am - 1, ad);
    if (start > monthEnd || start < monthStart) return;
    const dateLabel = _fmtISODate(ag.date);
    const _dH = parseInt(ag.durationH || 0, 10);
    const _dM = parseInt(ag.durationM || 0, 10);
    let timeLabel = '';
    if (ag.timeStart) {
      const startFmt = ag.timeStart.replace(':', 'h');
      if (_dH || _dM) {
        const [h, m] = ag.timeStart.split(':').map(Number);
        const totalMin = h * 60 + m + _dH * 60 + _dM;
        const eH = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
        const eM = String(totalMin % 60).padStart(2, '0');
        timeLabel = `${startFmt} – ${eH}h${eM}`;
      } else {
        timeLabel = startFmt;
      }
    } else if (_dH || _dM) {
      timeLabel = `Durée : ${_dH}h${String(_dM).padStart(2, '0')}`;
    }
    const d = new Date(start);
    {
      add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`, {
        title:       ag.title,
        color:       CAL_AGENDA_COLORS[ag.title] || ag.color || CAL_AGENDA_COLOR_DEFAULT,
        type:        'agenda',
        dateLabel,
        timeLabel,
        description: ag.description || '',
        location:    ''
      });
    }
  });

  return map;
}

function renderCalendar(container) {
  _calEntries = [];
  const year   = _calYear;
  const month  = _calMonth;
  const dayMap = buildCalendarDayMap(year, month);
  const firstDow  = new Date(year, month, 1).getDay();
  const offset    = (firstDow + 6) % 7;
  const daysInMth = new Date(year, month + 1, 0).getDate();
  const today     = new Date();
  const todayStr  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const headers = CAL_DAYS_SHORT.map(d => `<div class="cal-day-header">${d}</div>`).join('');
  let cells = '<div class="cal-cell cal-cell-empty"></div>'.repeat(offset);

  for (let d = 1; d <= daysInMth; d++) {
    const ds      = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const entries = dayMap[ds] || [];
    const isToday = ds === todayStr;
    const isPast  = ds < todayStr;

    const chips = entries.slice(0, 3).map(e => {
      const idx = _calEntries.length;
      _calEntries.push(e);
      return `<span class="cal-chip" data-cal-idx="${idx}" style="background:${e.color}22;border-color:${e.color};color:${e.color}">${escHtml(e.title)}</span>`;
    }).join('');

    const moreEntries = entries.slice(3);
    let more = '';
    if (moreEntries.length) {
      const firstIdx = _calEntries.length;
      moreEntries.forEach(e => _calEntries.push(e));
      more = `<span class="cal-chip-more" data-cal-idx="${firstIdx}" style="cursor:pointer" title="Voir plus">+${moreEntries.length}</span>`;
    }

    cells += `<div class="cal-cell${isToday ? ' cal-today' : ''}${isPast ? ' cal-past' : ''}"><span class="cal-day-num">${d}</span><div class="cal-chips">${chips}${more}</div></div>`;
  }

  const tail = (offset + daysInMth) % 7 === 0 ? 0 : 7 - ((offset + daysInMth) % 7);
  cells += '<div class="cal-cell cal-cell-empty"></div>'.repeat(tail);

  container.innerHTML = `
    <div class="cal-header">
      <button class="cal-nav" id="cal-prev">&#8249;</button>
      <span class="cal-month-label">${CAL_MONTHS_LONG[month]} ${year}</span>
      <button class="cal-nav" id="cal-next">&#8250;</button>
    </div>
    <div class="cal-grid">${headers}${cells}</div>
    <div class="cal-legend">
      <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#e8a020"></span>Événements</span>
      <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#7c3aed"></span>Gros-jeu Ludoried</span>
      <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#0891b2"></span>Réunion bureau</span>
      <span class="cal-legend-item"><span class="cal-legend-dot" style="background:#15803d"></span>Autre</span>
    </div>`;

  container.querySelectorAll('[data-cal-idx]').forEach(chip => {
    chip.addEventListener('click', () => {
      const entry = _calEntries[parseInt(chip.dataset.calIdx, 10)];
      if (entry) openAgendaEntry(entry);
    });
  });

  document.getElementById('cal-prev').addEventListener('click', () => {
    _calMonth--; if (_calMonth < 0) { _calMonth = 11; _calYear--; }
    renderCalendar(container);
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    _calMonth++; if (_calMonth > 11) { _calMonth = 0; _calYear++; }
    renderCalendar(container);
  });
}

function openAgendaEntry(entry) {
  const overlay  = document.getElementById('agenda-entry-overlay');
  const colorBar = document.getElementById('agenda-entry-color-bar');
  const titleEl  = document.getElementById('agenda-entry-title');
  const dateEl   = document.getElementById('agenda-entry-date');
  const timeEl   = document.getElementById('agenda-entry-time');
  const locEl    = document.getElementById('agenda-entry-location');
  const descEl   = document.getElementById('agenda-entry-desc');

  colorBar.style.background = entry.color;
  titleEl.textContent = entry.title;
  dateEl.textContent  = entry.dateLabel;

  if (entry.timeLabel) {
    timeEl.textContent = entry.timeLabel;
    timeEl.hidden = false;
  } else {
    timeEl.hidden = true;
  }

  if (entry.location) {
    locEl.textContent = entry.location;
    locEl.hidden = false;
  } else {
    locEl.hidden = true;
  }

  if (entry.description) {
    descEl.textContent = entry.description;
    descEl.hidden = false;
  } else {
    descEl.hidden = true;
  }

  overlay.removeAttribute('hidden');
}

function _initAgendaEntryModal() {
  const overlay = document.getElementById('agenda-entry-overlay');
  if (!overlay || overlay.dataset.bound) return;
  overlay.dataset.bound = '1';
  const close = () => overlay.setAttribute('hidden', '');
  document.getElementById('agenda-entry-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hasAttribute('hidden')) close(); });
}
