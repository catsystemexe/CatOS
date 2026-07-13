let runId = '';
let started = 0;
let selected = '';
let latestRows = [];
let spinnerIndex = 0;

const spinnerFrames = ['|', '/', '-', '\\'];
const $ = (id) => document.getElementById(id);

function mmss(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || response.statusText);
  return payload;
}

function projectLabel(project) {
  if (project.status === 'ready') return project.id;
  return `${project.id} [${project.blockingReason || (project.status === 'invalid' ? 'invalid config' : project.status)}]`;
}

async function loadProjects() {
  const previous = $('project').value;
  const { projects } = await api('/api/projects');
  window.projects = projects;
  $('project').innerHTML = projects.map((project) => `<option value="${escapeHtml(project.id)}">${escapeHtml(projectLabel(project))}</option>`).join('');
  if (projects.length === 0) {
    $('project').innerHTML = '<option value="">No project configs found</option>';
    $('repo').value = '';
    $('base').value = '';
    $('target').value = '';
    $('sandbox').textContent = 'Sandbox: -';
    $('projectStatus').textContent = 'Project status: No project configs found';
    $('runReason').textContent = 'RUN disabled: No project configs found';
    $('run').disabled = true;
    return;
  }
  const next = projects.some((project) => project.id === previous) ? previous : projects[0].id;
  $('project').value = next;
  fillProject();
}

function fillProject() {
  const project = (window.projects || []).find((item) => item.id === $('project').value);
  if (!project) return;
  $('repo').value = project.repository || project.repositoryPath || '';
  $('base').value = project.baseBranch || '';
  $('target').value = project.prTarget || project.prTargetBranch || project.baseBranch || '';
  $('sandbox').textContent = `Sandbox: ${project.sandbox || '-'}`;
  const reason = project.blockingReason || (project.status === 'ready' ? 'ready' : project.status);
  $('projectStatus').textContent = `Project status: ${reason}`;
  $('run').disabled = project.status !== 'ready';
  $('runReason').textContent = project.status === 'ready' ? '' : `RUN disabled: ${reason}`;
}

async function start() {
  const project = (window.projects || []).find((item) => item.id === $('project').value);
  if (!project || project.status !== 'ready') {
    fillProject();
    return;
  }
  const payload = {
    projectId: $('project').value,
    task: $('task').value,
    baseBranch: $('base').value,
    prTarget: $('target').value,
  };
  const result = await api('/api/runs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  runId = result.runId;
  started = Date.now();
  $('runNo').textContent = `RUN #${runId || '-'}`;
  await refreshRun();
}

async function stop() {
  if (runId) await api(`/api/runs/${runId}/stop`, { method: 'POST' });
  await refreshRun();
}

async function view(outputPath) {
  selected = outputPath;
  const result = await api(`/api/runs/${runId}/output?path=${encodeURIComponent(outputPath)}`);
  $('viewerTitle').textContent = result.path;
  if (result.path.endsWith('.diff')) {
    $('viewer').innerHTML = result.content
      .split('\n')
      .map((line) => `<span class="${line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''}">${escapeHtml(line)}</span>`)
      .join('\n');
  } else {
    $('viewer').textContent = result.content;
  }
}

function rowStatus(row) {
  if (row.status !== 'running') return row.status;
  return `running ${spinnerFrames[spinnerIndex]}`;
}

function renderCurrentStep() {
  const activeStep = latestRows.find((row) => row.status === 'running');
  const currentStep = $('currentStep');
  if (!activeStep) {
    currentStep.hidden = true;
    currentStep.textContent = '';
    return;
  }
  currentStep.hidden = false;
  currentStep.textContent = `Current Step: ${activeStep.label} -- Running... ${spinnerFrames[spinnerIndex]}`;
}

function renderTimelineRows() {
  $('timeline').innerHTML = latestRows.map((row) => {
    const output = row.output
      ? `${row.output.label} <a data-copy="${row.output.path}">/copy/</a> <a data-view="${row.output.path}">/view/</a>`
      : '-';
    return `<tr><td>${String(row.order).padStart(2, '0')}</td><td>${row.label}</td><td class="${row.status}">${rowStatus(row)}</td><td>${output}</td><td>${row.durationSeconds == null ? '-' : mmss(row.durationSeconds)}</td></tr>`;
  }).join('');
  renderCurrentStep();
}

async function refreshRun() {
  if (!runId) return;
  const state = await api(`/api/runs/${runId}`);
  $('status').textContent = state.status;
  $('status').className = state.status;
  $('elapsed').textContent = mmss((Date.now() - started) / 1000);
  latestRows = (await api(`/api/runs/${runId}/timeline`)).rows;
  renderTimelineRows();
  $('stop').hidden = state.status !== 'running';
  $('f5').hidden = state.status !== 'running';
  const system = state.system || {};
  $('system').innerHTML = (system.terminalMessage ? `<div class="${state.status}">${system.terminalMessage}</div>` : '')
    + (system.humanReview ? '<div>[ ACCEPT ] [ RETRY ] [ REVISE ] [ REJECT ]<br>Use CLI Human Gate command for decisions.</div>' : '')
    + (system.finalExport ? `<div class="final">Final export:<br>${system.finalExport.label} <a data-copy="${system.finalExport.path}">/copy/</a> <a data-view="${system.finalExport.path}">/view/</a></div>` : '<div class="pending">FINAL EXPORT pending</div>');
}

async function refreshAll() {
  await loadProjects();
  await refreshRun();
}

document.body.addEventListener('click', (event) => {
  const target = event.target;
  if (target.dataset.view) view(target.dataset.view);
  if (target.dataset.copy) navigator.clipboard?.writeText(target.dataset.copy);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'F2') {
    event.preventDefault();
    refreshAll().catch((error) => { $('runReason').textContent = error.message; });
  }
});

$('project').onchange = fillProject;
$('run').onclick = start;
$('stop').onclick = stop;
setInterval(refreshRun, 1500);
setInterval(() => {
  spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
  renderTimelineRows();
}, 200);
refreshAll().catch((error) => { $('runReason').textContent = error.message; });
