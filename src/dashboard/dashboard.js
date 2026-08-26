const state = { token: localStorage.getItem('minehive.token') ?? '', bots: [], goals: [], admins: [], health: null, ai: null };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
$('#apiToken').value = state.token;

async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...options.headers };
  const response = await fetch(path, { ...options, headers }); const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`); return payload.data ?? payload;
}
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = `${error ? 'error ' : ''}show`; clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.className = ''; }, 3500); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]); }
function position(bot) { const p = bot.runtime?.position; return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}` : '—'; }
function online(bot) { return ['READY', 'ACTIVE', 'PAUSED'].includes(bot.status); }

async function refresh() {
  try {
    const [health, bots, goals, admins, ai] = await Promise.all([api('/health'), api('/api/v1/bots'), api('/api/v1/goals'), api('/api/v1/admins'), api('/api/v1/ai/status')]);
    Object.assign(state, { health, bots, goals, admins, ai }); render();
    $('#connectionDot').style.background = '#77e39e'; $('#connectionText').textContent = 'Connected'; $('#lastUpdate').textContent = new Date().toLocaleTimeString();
  } catch (error) { $('#connectionDot').style.background = '#ff7474'; $('#connectionText').textContent = 'Disconnected'; $('#lastUpdate').textContent = error.message; }
}
function render() {
  $('#statOnline').textContent = state.bots.filter(online).length; $('#statBots').textContent = state.bots.length;
  $('#statGoals').textContent = state.goals.filter(goal => goal.status === 'ACTIVE').length; $('#statHealth').textContent = state.health?.status ?? '—';
  $('#statAi').textContent = state.ai?.llm?.enabled ? state.ai.llm.provider : 'RULES'; $('#statAiModel').textContent = state.ai?.llm?.model ? `${state.ai.llm.model}${state.ai.llm.keyCount ? ` · key ${state.ai.llm.activeKey} · ready ${state.ai.llm.availableKeys}/${state.ai.llm.keyCount}` : ''}` : 'Deterministic fallback';
  $('#overviewBots').innerHTML = state.bots.length ? state.bots.map(botRow).join('') : empty('No bots registered');
  $('#goalList').innerHTML = state.goals.length ? state.goals.slice(-6).reverse().map(goal => `<div class="goal-row"><div><b>${escapeHtml(goal.description)}</b><small>${goal.progress}% · ${new Date(goal.updatedAt).toLocaleTimeString()}</small></div><span class="badge">${goal.status}</span></div>`).join('') : empty('No goals yet');
  $('#botManager').innerHTML = state.bots.length ? state.bots.map(botCard).join('') : empty('Add your first bot using the form');
  const classes = [...new Set(state.bots.map(bot => bot.metadata?.className).filter(Boolean))];
  $('#commandBot').innerHTML = `<option value="scope:global">All bots · !global</option>${classes.map(name => `<option value="class:${escapeHtml(name)}">Class ${escapeHtml(name)} · !${escapeHtml(name)}</option>`).join('')}${state.bots.map(bot => `<option value="bot:${escapeHtml(bot.id)}">${escapeHtml(bot.name)} · !${escapeHtml(bot.metadata?.commandAlias ?? bot.name)} · ${bot.status}</option>`).join('')}`;
  $('#adminList').innerHTML = state.admins.length ? state.admins.map(admin => `<div class="admin-row"><div><b>${escapeHtml(admin.username)}</b><div class="source">${admin.source}</div></div>${admin.removable ? `<button class="button danger" data-remove-admin="${escapeHtml(admin.username)}">Remove</button>` : '<span class="badge">.env</span>'}</div>`).join('') : empty('No chat admins configured');
  renderCameras(); bindDynamic();
}
function botRow(bot) { return `<div class="bot-row"><div class="bot-main"><i class="status-dot ${bot.status.toLowerCase()}"></i><div><b>${escapeHtml(bot.name)}</b><small>${bot.status} · ${position(bot)}</small></div></div><span class="badge">HP ${bot.runtime?.health ?? '—'}</span></div>`; }
function botCard(bot) { const ready = online(bot); return `<article class="bot-card"><div class="bot-card-head"><div><h3>${escapeHtml(bot.name)}</h3><small>!${escapeHtml(bot.metadata?.commandAlias ?? bot.name)} · class !${escapeHtml(bot.metadata?.className ?? 'worker')}</small></div><i class="status-dot ${bot.status.toLowerCase()}"></i></div><dl><div><dt>Status</dt><dd>${bot.status}</dd></div><div><dt>Health / food</dt><dd>${bot.runtime?.health ?? '—'} / ${bot.runtime?.food ?? '—'}</dd></div><div><dt>Position</dt><dd>${position(bot)}</dd></div><div><dt>Dimension</dt><dd>${bot.runtime?.dimension ?? '—'}</dd></div></dl><div class="actions"><button class="button primary" data-bot-action="${ready ? 'stop' : 'start'}" data-bot="${bot.id}">${ready ? 'Disconnect' : 'Join server'}</button><button class="button secondary" data-camera="${bot.runtime?.camera?.active ? 'stop' : 'start'}" data-bot="${bot.id}" ${ready ? '' : 'disabled'}>${bot.runtime?.camera?.active ? 'Stop camera' : 'Live camera'}</button><button class="button secondary" data-edit-class="${bot.id}">Edit routing</button><button class="button danger" data-delete-bot="${bot.id}">Delete</button></div></article>`; }
function renderCameras() {
  const wall = $('#cameraWall'); const active = state.bots.filter(bot => bot.runtime?.camera?.active && bot.runtime.camera.port); const ids = new Set(active.map(bot => bot.id));
  wall.querySelectorAll('[data-camera-card]').forEach(card => { if (!ids.has(card.dataset.cameraCard)) card.remove(); }); wall.querySelector('.camera-empty')?.remove();
  for (const bot of active) {
    if (wall.querySelector(`[data-camera-card="${CSS.escape(bot.id)}"]`)) continue;
    const card = document.createElement('article'); card.className = 'camera-card'; card.dataset.cameraCard = bot.id;
    const warning = bot.runtime.camera.versionSupported === false ? `<span class="camera-warning">${escapeHtml(bot.runtime.camera.version)} → renderer ${escapeHtml(bot.runtime.camera.renderVersion)}</span>` : '<span class="camera-live">LIVE</span>';
    card.innerHTML = `<header><div><b>◉ ${escapeHtml(bot.name)}</b>${warning}</div><button class="button danger" data-camera="stop" data-bot="${escapeHtml(bot.id)}">Stop</button></header><div class="camera-loading">Connecting to camera…</div><iframe loading="eager" title="Camera ${escapeHtml(bot.name)}" src="http://${location.hostname}:${bot.runtime.camera.port}"></iframe>`;
    const frame = card.querySelector('iframe'); frame.onload = () => card.querySelector('.camera-loading')?.remove(); wall.append(card);
  }
  if (!active.length && !wall.querySelector('.camera-empty')) wall.innerHTML = '<div class="camera-empty">Start a camera from the Bots menu to show it here.</div>';
}
function empty(text) { return `<div class="camera-empty" style="padding:28px">${text}</div>`; }

function bindDynamic() {
  $$('[data-bot-action]').forEach(button => button.onclick = () => performBot(button.dataset.bot, button.dataset.botAction));
  $$('[data-camera]').forEach(button => button.onclick = () => camera(button.dataset.bot, button.dataset.camera));
  $$('[data-delete-bot]').forEach(button => button.onclick = () => deleteBot(button.dataset.deleteBot));
  $$('[data-edit-class]').forEach(button => button.onclick = () => editClass(button.dataset.editClass));
  $$('[data-remove-admin]').forEach(button => button.onclick = () => removeAdmin(button.dataset.removeAdmin));
}
async function performBot(id, action) { try { await api(`/api/v1/bots/${id}/${action}`, { method: 'POST' }); toast(action === 'start' ? 'Bot is joining the server' : 'Bot disconnected'); await refresh(); } catch (error) { toast(error.message, true); } }
async function camera(id, action) { try { await api(`/api/v1/bots/${id}/camera/${action}`, { method: 'POST' }); toast(`Camera ${action}ed`); await refresh(); if (action === 'start') showView('cameras'); } catch (error) { toast(error.message, true); } }
async function deleteBot(id) { if (!confirm('Disconnect and permanently remove this bot profile?')) return; try { await api(`/api/v1/bots/${id}`, { method: 'DELETE' }); toast('Bot removed'); await refresh(); } catch (error) { toast(error.message, true); } }
async function editClass(id) { const bot = state.bots.find(item => item.id === id); const commandAlias = prompt('Command alias without !', bot?.metadata?.commandAlias ?? bot?.name); if (!commandAlias) return; const className = prompt('Bot class (example: miner, builder, scout)', bot?.metadata?.className ?? 'worker'); if (!className) return; try { await api(`/api/v1/bots/${id}`, { method: 'PATCH', body: JSON.stringify({ commandAlias, className }) }); toast('Bot routing updated'); await refresh(); } catch (error) { toast(error.message, true); } }
async function removeAdmin(username) { try { await api(`/api/v1/admins/${encodeURIComponent(username)}`, { method: 'DELETE' }); toast('Admin removed'); await refresh(); } catch (error) { toast(error.message, true); } }

$('#botForm').onsubmit = async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target)); data.port = Number(data.port); data.autoConnect = data.autoConnect === 'on'; if (!data.version) delete data.version; try { const bot = await api('/api/v1/bots', { method: 'POST', body: JSON.stringify(data) }); toast(`Bot ${bot.name} added`); event.target.reset(); await refresh(); } catch (error) { toast(error.message, true); } };
$('#adminForm').onsubmit = async event => { event.preventDefault(); const username = new FormData(event.target).get('username'); try { await api('/api/v1/admins', { method: 'POST', body: JSON.stringify({ username }) }); event.target.reset(); toast('Admin added'); await refresh(); } catch (error) { toast(error.message, true); } };
$('#commandForm').onsubmit = async event => { event.preventDefault(); await executeCommand($('#commandBot').value, $('#commandInput').value); };
$('#aiForm').onsubmit = async event => { event.preventDefault(); const text = $('#aiInput').value.trim(); if (!text) return; log(`> AI ${$('#commandBot').value}: ${text}`); try { const result = await api('/api/v1/ai/command', { method: 'POST', body: JSON.stringify({ text, selector: selectorForApi($('#commandBot').value) }) }); log(JSON.stringify(result, null, 2)); await refresh(); } catch (error) { log(`AI ERROR: ${error.message}`, true); } };
$$('.quick-commands button').forEach(button => button.onclick = () => { $('#commandInput').value = button.dataset.command; $('#commandInput').focus(); });
async function executeCommand(target, text) {
  const [command, ...args] = text.trim().split(/\s+/); let action = command; let input = {};
  if (command === 'collect') { log(`> coordinator ${target}: ${text}`); try { const result = await api('/api/v1/ai/command', { method: 'POST', body: JSON.stringify({ text, selector: selectorForApi(target) }) }); log(JSON.stringify(result, null, 2)); await refresh(); } catch (error) { log(`COORDINATOR ERROR: ${error.message}`, true); } return; }
  if (command === 'status' || command === 'inventory') action = 'observe';
  else if (command === 'goto') { action = 'navigate'; input = { x: Number(args[0]), y: Number(args[1]), z: Number(args[2]) }; }
  else if (command === 'follow') input = { username: args[0] };
  else if (command === 'sethome') { action = 'sethome'; input = { name: args[0] ?? 'home' }; }
  else if (command === 'home') input = { name: args[0] ?? 'home' };
  else if (command === 'craft') input = { item: args[0], count: Number(args[1] ?? 1) };
  else if (command === 'chat') input = { message: args.join(' ') };
  else if (command !== 'stop' && command !== 'observe') return log(`Unknown command: ${command}`, true);
  const targets = target === 'scope:global' ? state.bots : target.startsWith('class:') ? state.bots.filter(bot => bot.metadata?.className === target.slice(6)) : state.bots.filter(bot => bot.id === target.slice(4));
  if (!targets.length) return log('No bots match the selected target', true);
  log(`> ${target}: ${text}`); const results = await Promise.allSettled(targets.map(bot => api(`/api/v1/bots/${bot.id}/actions/${action}`, { method: 'POST', body: JSON.stringify(input) })));
  results.forEach((result, index) => log(`${targets[index].name}: ${result.status === 'fulfilled' ? JSON.stringify(result.value) : `ERROR ${result.reason.message}`}`, result.status === 'rejected')); await refresh();
}
function selectorForApi(target) { return target === 'scope:global' ? 'global' : target.startsWith('class:') ? target : `bot:${state.bots.find(bot => bot.id === target.slice(4))?.metadata?.commandAlias ?? target.slice(4)}`; }
function log(message, error = false) { const output = $('#commandLog'); output.textContent += `\n[${new Date().toLocaleTimeString()}] ${message}`; output.scrollTop = output.scrollHeight; if (error) toast(message, true); }
$('#clearLog').onclick = () => { $('#commandLog').textContent = 'Log cleared.'; }; $('#refreshBots').onclick = refresh;
$('#saveToken').onclick = () => { state.token = $('#apiToken').value.trim(); localStorage.setItem('minehive.token', state.token); toast('API token saved in this browser'); refresh(); };
$$('.nav').forEach(button => button.onclick = () => showView(button.dataset.view)); $$('.goto').forEach(button => button.onclick = () => showView(button.dataset.target));
function showView(id) { $$('.view').forEach(view => view.classList.toggle('active', view.id === id)); $$('.nav').forEach(nav => nav.classList.toggle('active', nav.dataset.view === id)); $('#pageTitle').textContent = ({ overview: 'System overview', bots: 'Bots & server join', cameras: 'Live camera wall', commands: 'Command center', admins: 'Admin access' })[id]; }

refresh(); setInterval(refresh, 3000);
