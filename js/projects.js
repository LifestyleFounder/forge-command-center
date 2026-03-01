/* ============================================================
   projects.js — Forge Command Center Projects Tab
   Personal project board with linked Google Tasks
   ============================================================ */

import {
  escapeHtml,
  formatRelativeTime,
  generateId,
  $,
  $$,
  openModal,
  closeModal,
  showToast
} from './app.js';

import { getProjects, saveProjects, onProjectsChange } from './project-store.js';
import {
  completeTaskById,
  uncompleteTaskById,
  fetchTasksForList,
  getTaskLists
} from './google-tasks.js';

// ---- Constants -----------------------------------------------

const COLUMNS = ['todo', 'progress', 'done'];

const COLUMN_LABELS = {
  todo: 'To Do',
  progress: 'In Progress',
  done: 'Done'
};

const PROJECT_COLORS = {
  gold: 'var(--color-gold, #C8A24A)',
  forest: 'var(--color-forest, #0F2A1E)',
  info: 'var(--color-info, #3B82F6)',
  warning: 'var(--color-warning, #F59E0B)',
  success: 'var(--color-success, #10B981)',
  error: 'var(--color-error, #EF4444)'
};

// ---- DOM Cache (module-scoped) --------------------------------

let el = {};
let dragState = { projectId: null, sourceStatus: null };
let activeDetailProjectId = null;

function cacheProjectElements() {
  el = {
    kanbanBoard: $('#kanbanBoard'),
    addProjectBtn: $('#addProjectBtn'),
    saveProjectBtn: $('#saveProjectBtn'),
    projectNameInput: $('#projectNameInput'),
    projectDescInput: $('#projectDescInput'),
    projectColorPicker: $('#projectColorPicker'),
    projectDetailTitle: $('#projectDetailTitle'),
    projectDetailBody: $('#projectDetailBody'),
    countTodo: $('#countTodo'),
    countProgress: $('#countProgress'),
    countDone: $('#countDone'),
  };
}

// ---- Public Init ----------------------------------------------

export function initProjects() {
  cacheProjectElements();
  renderKanban();
  initDragAndDrop();
  bindProjectEvents();
  onProjectsChange(() => renderKanban());
}

// ---- Kanban Board ---------------------------------------------

function renderKanban() {
  const { projects } = getProjects();

  const grouped = {};
  COLUMNS.forEach(col => { grouped[col] = []; });

  projects.forEach(project => {
    const status = COLUMNS.includes(project.status) ? project.status : 'todo';
    grouped[status].push(project);
  });

  COLUMNS.forEach(col => {
    const container = $(`.kanban-cards[data-status="${col}"]`, el.kanbanBoard);
    if (!container) return;

    const items = grouped[col];
    container.innerHTML = items.length === 0
      ? `<div class="kanban-empty">${col === 'done' ? 'No completed projects' : 'Drop projects here'}</div>`
      : items.map(renderProjectCard).join('');
  });

  if (el.countTodo) el.countTodo.textContent = grouped.todo.length;
  if (el.countProgress) el.countProgress.textContent = grouped.progress.length;
  if (el.countDone) el.countDone.textContent = grouped.done.length;
}

function renderProjectCard(project) {
  const color = PROJECT_COLORS[project.color] || PROJECT_COLORS.gold;
  const taskCount = (project.linkedTasks || []).length;
  const descSnippet = project.description
    ? escapeHtml(project.description.length > 80 ? project.description.slice(0, 80) + '...' : project.description)
    : '';

  return `
    <div class="kanban-card project-card" data-id="${escapeHtml(project.id)}" data-color="${escapeHtml(project.color || 'gold')}" draggable="true" style="border-left-color: ${color}">
      <div class="kanban-card-title">${escapeHtml(project.name)}</div>
      ${descSnippet ? `<div class="project-card-desc">${descSnippet}</div>` : ''}
      ${taskCount > 0 ? `<div class="project-card-meta"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> ${taskCount} task${taskCount !== 1 ? 's' : ''}</div>` : ''}
    </div>
  `;
}

// ---- Drag and Drop --------------------------------------------

function initDragAndDrop() {
  if (!el.kanbanBoard) return;

  el.kanbanBoard.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;
    dragState.projectId = card.dataset.id;
    dragState.sourceStatus = card.closest('.kanban-column')?.dataset.status || null;
    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);
    requestAnimationFrame(() => { card.style.opacity = '0.4'; });
  });

  el.kanbanBoard.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const column = e.target.closest('.kanban-column');
    if (!column) return;
    $$('.kanban-column', el.kanbanBoard).forEach(col => {
      col.classList.toggle('is-drag-over', col === column);
    });
  });

  el.kanbanBoard.addEventListener('dragleave', (e) => {
    const column = e.target.closest('.kanban-column');
    if (column && !column.contains(e.relatedTarget)) {
      column.classList.remove('is-drag-over');
    }
  });

  el.kanbanBoard.addEventListener('drop', (e) => {
    e.preventDefault();
    const column = e.target.closest('.kanban-column');
    if (!column) return;

    const newStatus = column.dataset.status;
    const projectId = e.dataTransfer.getData('text/plain') || dragState.projectId;

    $$('.kanban-column', el.kanbanBoard).forEach(col => col.classList.remove('is-drag-over'));
    const draggedCard = $(`.kanban-card[data-id="${projectId}"]`, el.kanbanBoard);
    if (draggedCard) {
      draggedCard.classList.remove('is-dragging');
      draggedCard.style.opacity = '';
    }

    if (!projectId || !newStatus) return;

    const data = getProjects();
    const project = data.projects.find(p => p.id === projectId);
    if (!project || project.status === newStatus) return;

    project.status = newStatus;
    if (newStatus === 'done' && !project.completedAt) {
      project.completedAt = new Date().toISOString();
    }
    if (newStatus !== 'done' && project.completedAt) {
      delete project.completedAt;
    }
    saveProjects(data);
    showToast(`Moved to ${COLUMN_LABELS[newStatus]}`, 'success');
  });

  el.kanbanBoard.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card');
    if (card) {
      card.classList.remove('is-dragging');
      card.style.opacity = '';
    }
    $$('.kanban-column', el.kanbanBoard).forEach(col => col.classList.remove('is-drag-over'));
    dragState.projectId = null;
    dragState.sourceStatus = null;
  });
}

// ---- Project CRUD ---------------------------------------------

function bindProjectEvents() {
  // Add Project button
  if (el.addProjectBtn) {
    el.addProjectBtn.addEventListener('click', () => {
      resetProjectForm();
      openModal('projectModal');
    });
  }

  // Save Project (new)
  if (el.saveProjectBtn) {
    el.saveProjectBtn.addEventListener('click', handleSaveProject);
  }

  // Color picker
  if (el.projectColorPicker) {
    el.projectColorPicker.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      $$('.color-swatch', el.projectColorPicker).forEach(s => s.classList.remove('is-selected'));
      swatch.classList.add('is-selected');
    });
  }

  // Card click (event delegation on kanban board)
  if (el.kanbanBoard) {
    el.kanbanBoard.addEventListener('click', (e) => {
      if (dragState.projectId) return;
      const card = e.target.closest('.kanban-card');
      if (!card) return;
      openProjectDetail(card.dataset.id);
    });
  }

  // Detail modal delegation — handle all dynamic buttons
  if (el.projectDetailBody) {
    el.projectDetailBody.addEventListener('click', handleDetailClick);
    el.projectDetailBody.addEventListener('change', handleDetailChange);
  }
}

function resetProjectForm() {
  if (el.projectNameInput) el.projectNameInput.value = '';
  if (el.projectDescInput) el.projectDescInput.value = '';
  if (el.projectColorPicker) {
    $$('.color-swatch', el.projectColorPicker).forEach((s, i) => {
      s.classList.toggle('is-selected', i === 0);
    });
  }
}

function getSelectedColor() {
  const selected = $('.color-swatch.is-selected', el.projectColorPicker);
  return selected ? selected.dataset.color : 'gold';
}

function handleSaveProject() {
  const name = el.projectNameInput ? el.projectNameInput.value.trim() : '';
  if (!name) {
    showToast('Project name is required', 'error');
    if (el.projectNameInput) el.projectNameInput.focus();
    return;
  }

  const description = el.projectDescInput ? el.projectDescInput.value.trim() : '';
  const color = getSelectedColor();

  const newProject = {
    id: 'prj_' + generateId(),
    name,
    description,
    status: 'todo',
    color,
    createdAt: new Date().toISOString(),
    completedAt: null,
    linkedTasks: []
  };

  const data = getProjects();
  data.projects.push(newProject);
  saveProjects(data);

  closeModal();
  showToast('Project created', 'success');
}

// ---- Expanded Project View ------------------------------------

async function openProjectDetail(projectId) {
  const data = getProjects();
  const project = data.projects.find(p => p.id === projectId);
  if (!project) return;

  activeDetailProjectId = projectId;

  if (el.projectDetailTitle) {
    el.projectDetailTitle.textContent = project.name;
  }

  if (el.projectDetailBody) {
    el.projectDetailBody.innerHTML = renderDetailLoading(project);
  }

  openModal('projectDetailModal');

  // Fetch linked GT tasks live
  const linkedTaskDetails = await fetchLinkedTasks(project);
  // Re-read project in case it changed
  const freshData = getProjects();
  const freshProject = freshData.projects.find(p => p.id === projectId);
  if (!freshProject || activeDetailProjectId !== projectId) return;

  if (el.projectDetailBody) {
    el.projectDetailBody.innerHTML = renderProjectDetailView(freshProject, linkedTaskDetails);
  }
}

function renderDetailLoading(project) {
  const color = PROJECT_COLORS[project.color] || PROJECT_COLORS.gold;
  return `
    <div class="project-detail-header" style="border-left: 4px solid ${color}; padding-left: var(--space-4);">
      <div class="form-group"><label class="form-label">Name</label><div class="text-primary" style="font-weight: 500;">${escapeHtml(project.name)}</div></div>
      ${project.description ? `<div class="form-group"><label class="form-label">Description</label><div class="text-secondary text-sm">${escapeHtml(project.description)}</div></div>` : ''}
    </div>
    <div class="loading-state"><div class="spinner"></div><span>Loading tasks...</span></div>
  `;
}

async function fetchLinkedTasks(project) {
  const linked = project.linkedTasks || [];
  if (linked.length === 0) return [];

  const byList = {};
  linked.forEach(ref => {
    if (!byList[ref.listId]) byList[ref.listId] = [];
    byList[ref.listId].push(ref.taskId);
  });

  const results = [];
  for (const [listId, taskIds] of Object.entries(byList)) {
    try {
      const allTasks = await fetchTasksForList(listId);
      taskIds.forEach(taskId => {
        const task = allTasks.find(t => t.id === taskId);
        if (task) {
          results.push({ ...task, listId });
        }
      });
    } catch (err) {
      console.warn('[projects] Failed to fetch tasks for list', listId, err);
    }
  }
  return results;
}

function renderProjectDetailView(project, linkedTasks) {
  const color = PROJECT_COLORS[project.color] || PROJECT_COLORS.gold;
  const totalTasks = linkedTasks.length;
  const completedTasks = linkedTasks.filter(t => t.status === 'completed').length;
  const progressPct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const statusOptions = COLUMNS.map(col =>
    `<option value="${col}" ${project.status === col ? 'selected' : ''}>${COLUMN_LABELS[col]}</option>`
  ).join('');

  const colorSwatches = Object.keys(PROJECT_COLORS).map(c =>
    `<button type="button" class="color-swatch ${project.color === c ? 'is-selected' : ''}" data-color="${c}" data-action="changeColor" aria-label="${c}"></button>`
  ).join('');

  const taskListHtml = linkedTasks.length === 0
    ? '<div class="project-tasks-empty">No linked tasks yet</div>'
    : linkedTasks.map(task => {
        const isCompleted = task.status === 'completed';
        return `
          <div class="project-task-item ${isCompleted ? 'is-completed' : ''}" data-list-id="${escapeHtml(task.listId)}" data-task-id="${escapeHtml(task.id)}">
            <button class="gt-checkbox ${isCompleted ? 'is-checked' : ''}" data-action="toggleTask" data-list-id="${escapeHtml(task.listId)}" data-task-id="${escapeHtml(task.id)}" aria-label="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">
              ${isCompleted ? '&#10003;' : ''}
            </button>
            <span class="project-task-title ${isCompleted ? 'gt-task-done-text' : ''}">${escapeHtml(task.title || 'Untitled')}</span>
            <button class="btn-icon btn-xs project-task-unlink" data-action="unlinkTask" data-list-id="${escapeHtml(task.listId)}" data-task-id="${escapeHtml(task.id)}" aria-label="Unlink task" title="Unlink task">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `;
      }).join('');

  return `
    <div class="project-detail-header" style="border-left: 4px solid ${color}; padding-left: var(--space-4);">
      <div class="form-group">
        <label class="form-label" for="detailProjectName">Name</label>
        <input type="text" class="form-input" id="detailProjectName" value="${escapeHtml(project.name)}">
      </div>
      <div class="form-group">
        <label class="form-label" for="detailProjectDesc">Description</label>
        <textarea class="form-input" id="detailProjectDesc" rows="2">${escapeHtml(project.description || '')}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="detailProjectStatus">Status</label>
          <select class="form-select" id="detailProjectStatus" data-action="changeStatus">${statusOptions}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <div class="color-picker">${colorSwatches}</div>
        </div>
      </div>
    </div>
    ${totalTasks > 0 ? `
      <div class="project-progress">
        <div class="project-progress-label">${completedTasks}/${totalTasks} tasks complete</div>
        <div class="project-progress-bar"><div class="project-progress-fill" style="width: ${progressPct}%"></div></div>
      </div>
    ` : ''}
    <div class="project-tasks-section">
      <div class="project-tasks-header">
        <h3>Linked Google Tasks</h3>
        <button class="btn btn-ghost btn-sm" data-action="showTaskPicker">+ Link Google Task</button>
      </div>
      <div class="project-task-list">${taskListHtml}</div>
      <div class="project-task-picker" id="taskPickerArea" hidden></div>
    </div>
    <div class="project-detail-footer">
      <button class="btn btn-danger btn-sm" data-action="deleteProject">Delete Project</button>
      <div class="footer-right">
        <button class="btn btn-ghost btn-sm" data-close-modal>Cancel</button>
        <button class="btn btn-primary btn-sm" data-action="saveProjectDetail">Save Changes</button>
      </div>
    </div>
    <div class="project-meta">
      <span>Created ${formatRelativeTime(project.createdAt)}</span>
      ${project.completedAt ? `<span>Completed ${formatRelativeTime(project.completedAt)}</span>` : ''}
    </div>
  `;
}

// ---- Detail Modal Event Handlers --------------------------------

async function handleDetailClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  switch (action) {
    case 'toggleTask': {
      const btn = e.target.closest('[data-action="toggleTask"]');
      const listId = btn.dataset.listId;
      const taskId = btn.dataset.taskId;
      const isChecked = btn.classList.contains('is-checked');

      // Optimistic UI update
      btn.classList.toggle('is-checked');
      btn.innerHTML = isChecked ? '' : '&#10003;';
      const taskItem = btn.closest('.project-task-item');
      const titleEl = taskItem?.querySelector('.project-task-title');
      if (taskItem) taskItem.classList.toggle('is-completed');
      if (titleEl) titleEl.classList.toggle('gt-task-done-text');

      const result = isChecked
        ? await uncompleteTaskById(listId, taskId)
        : await completeTaskById(listId, taskId);

      if (!result) {
        // Revert on failure
        btn.classList.toggle('is-checked');
        btn.innerHTML = isChecked ? '&#10003;' : '';
        if (taskItem) taskItem.classList.toggle('is-completed');
        if (titleEl) titleEl.classList.toggle('gt-task-done-text');
        showToast('Failed to update task', 'error');
      } else {
        // Update progress bar
        updateProgressBar();
      }
      break;
    }

    case 'unlinkTask': {
      const btn = e.target.closest('[data-action="unlinkTask"]');
      const listId = btn.dataset.listId;
      const taskId = btn.dataset.taskId;

      const data = getProjects();
      const project = data.projects.find(p => p.id === activeDetailProjectId);
      if (!project) return;

      project.linkedTasks = (project.linkedTasks || []).filter(
        t => !(t.listId === listId && t.taskId === taskId)
      );
      saveProjects(data);

      // Remove from UI
      const taskItem = btn.closest('.project-task-item');
      if (taskItem) taskItem.remove();
      updateProgressBar();
      showToast('Task unlinked', 'info');
      break;
    }

    case 'showTaskPicker': {
      const picker = $('#taskPickerArea', el.projectDetailBody);
      if (!picker) return;
      picker.hidden = false;
      picker.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading task lists...</span></div>';

      const lists = getTaskLists();
      if (lists.length === 0) {
        picker.innerHTML = '<div class="project-tasks-empty">No Google Task lists available. Visit the Google Tasks tab first.</div>';
        return;
      }

      const listOptions = lists.map(l => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.title)}</option>`).join('');
      picker.innerHTML = `
        <div class="task-picker-controls">
          <select class="form-select" id="taskPickerList">${listOptions}</select>
          <button class="btn btn-ghost btn-xs" data-action="closeTaskPicker">Cancel</button>
        </div>
        <div class="task-picker-results" id="taskPickerResults">
          <div class="loading-state"><div class="spinner"></div></div>
        </div>
      `;

      // Load tasks for first list
      await loadPickerTasks(lists[0].id);
      break;
    }

    case 'closeTaskPicker': {
      const picker = $('#taskPickerArea', el.projectDetailBody);
      if (picker) picker.hidden = true;
      break;
    }

    case 'linkTask': {
      const btn = e.target.closest('[data-action="linkTask"]');
      const listId = btn.dataset.listId;
      const taskId = btn.dataset.taskId;

      const data = getProjects();
      const project = data.projects.find(p => p.id === activeDetailProjectId);
      if (!project) return;

      if (!project.linkedTasks) project.linkedTasks = [];

      // Check if already linked
      if (project.linkedTasks.some(t => t.listId === listId && t.taskId === taskId)) {
        showToast('Task already linked', 'warning');
        return;
      }

      project.linkedTasks.push({ listId, taskId });
      saveProjects(data);

      showToast('Task linked', 'success');
      // Refresh the detail view
      openProjectDetail(activeDetailProjectId);
      break;
    }

    case 'deleteProject': {
      if (!activeDetailProjectId) return;
      const data = getProjects();
      const idx = data.projects.findIndex(p => p.id === activeDetailProjectId);
      if (idx === -1) return;
      const name = data.projects[idx].name;
      if (!confirm(`Delete "${name}"? This cannot be undone. (Google Tasks will not be affected.)`)) return;
      data.projects.splice(idx, 1);
      saveProjects(data);
      closeModal();
      activeDetailProjectId = null;
      showToast('Project deleted', 'info');
      break;
    }

    case 'saveProjectDetail': {
      handleSaveProjectDetail();
      break;
    }

    case 'changeColor': {
      const btn = e.target.closest('[data-action="changeColor"]');
      if (!btn) return;
      $$('.color-swatch', el.projectDetailBody).forEach(s => s.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      break;
    }
  }
}

function handleDetailChange(e) {
  // Task picker list change
  if (e.target.id === 'taskPickerList') {
    loadPickerTasks(e.target.value);
  }
}

async function loadPickerTasks(listId) {
  const results = $('#taskPickerResults', el.projectDetailBody);
  if (!results) return;
  results.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  try {
    const tasks = await fetchTasksForList(listId);
    const data = getProjects();
    const project = data.projects.find(p => p.id === activeDetailProjectId);
    const linked = (project?.linkedTasks || []).map(t => `${t.listId}:${t.taskId}`);

    const incomplete = tasks.filter(t => t.status !== 'completed');

    if (incomplete.length === 0) {
      results.innerHTML = '<div class="project-tasks-empty">No incomplete tasks in this list</div>';
      return;
    }

    results.innerHTML = incomplete.map(task => {
      const isLinked = linked.includes(`${listId}:${task.id}`);
      return `
        <div class="task-picker-item ${isLinked ? 'is-linked' : ''}">
          <span class="task-picker-title">${escapeHtml(task.title || 'Untitled')}</span>
          ${isLinked
            ? '<span class="task-picker-badge">Linked</span>'
            : `<button class="btn btn-ghost btn-xs" data-action="linkTask" data-list-id="${escapeHtml(listId)}" data-task-id="${escapeHtml(task.id)}">Link</button>`
          }
        </div>
      `;
    }).join('');
  } catch (err) {
    results.innerHTML = '<div class="project-tasks-empty">Failed to load tasks</div>';
  }
}

function handleSaveProjectDetail() {
  if (!activeDetailProjectId) return;
  const data = getProjects();
  const project = data.projects.find(p => p.id === activeDetailProjectId);
  if (!project) return;

  const nameInput = $('#detailProjectName', el.projectDetailBody);
  const descInput = $('#detailProjectDesc', el.projectDetailBody);
  const statusInput = $('#detailProjectStatus', el.projectDetailBody);
  const selectedColor = $('.color-swatch.is-selected', el.projectDetailBody);

  const newName = nameInput ? nameInput.value.trim() : project.name;
  if (!newName) {
    showToast('Name is required', 'error');
    return;
  }

  const oldStatus = project.status;
  const newStatus = statusInput ? statusInput.value : project.status;

  project.name = newName;
  project.description = descInput ? descInput.value.trim() : project.description;
  project.status = newStatus;
  project.color = selectedColor ? selectedColor.dataset.color : project.color;

  if (newStatus === 'done' && !project.completedAt) {
    project.completedAt = new Date().toISOString();
  }
  if (newStatus !== 'done' && project.completedAt) {
    delete project.completedAt;
  }

  saveProjects(data);
  closeModal();
  activeDetailProjectId = null;
  showToast('Project updated', 'success');
}

function updateProgressBar() {
  const bar = $('.project-progress-fill', el.projectDetailBody);
  const label = $('.project-progress-label', el.projectDetailBody);
  if (!bar || !label) return;

  const items = $$('.project-task-item', el.projectDetailBody);
  const total = items.length;
  const completed = items.filter(i => i.classList.contains('is-completed')).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  bar.style.width = `${pct}%`;
  label.textContent = `${completed}/${total} tasks complete`;
}
