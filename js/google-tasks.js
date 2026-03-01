// js/google-tasks.js — Google Tasks tab
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe,
  escapeHtml, formatDate, formatRelativeTime,
  generateId, debounce, $, $$, showToast
} from './app.js';

import { getProjects, saveProjects, getProjectForTask, getAllProjectOptions, onProjectsChange } from './project-store.js';

const PROJECT_COLORS = {
  gold: 'var(--color-gold, #C8A24A)',
  forest: 'var(--color-forest, #0F2A1E)',
  info: 'var(--color-info, #3B82F6)',
  warning: 'var(--color-warning, #F59E0B)',
  success: 'var(--color-success, #10B981)',
  error: 'var(--color-error, #EF4444)'
};

// ── State ────────────────────────────────────────────────────────────
let taskLists = [];
let activeListId = null;
let tasks = [];
let loading = false;
let editingTaskId = null;

// ── Public init ──────────────────────────────────────────────────────
export function initGoogleTasks() {
  bindGoogleTaskEvents();
}

export async function loadGoogleTaskData() {
  if (loading) return;
  loading = true;
  const container = $('#googleTasksContainer');
  if (container) container.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Connecting to Google Tasks...</span></div>';

  await loadTaskLists();
  loading = false;
  renderGoogleTasks();
}

async function loadTaskLists() {
  try {
    const res = await fetch('/api/lists');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    taskLists = Array.isArray(data) ? data : [];
    if (taskLists.length > 0 && !activeListId) {
      activeListId = taskLists[0].id;
    }
    if (activeListId) await loadTasks(activeListId);
  } catch (err) {
    console.warn('[google-tasks] Failed to load task lists', err);
    taskLists = [];
  }
}

async function loadTasks(listId) {
  try {
    const res = await fetch(`/api/tasks?list=${encodeURIComponent(listId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    tasks = (data.tasks || []).sort((a, b) => {
      // Incomplete first, then by position
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;
      return (a.position || '').localeCompare(b.position || '');
    });
  } catch (err) {
    console.warn('[google-tasks] Failed to load tasks', err);
    tasks = [];
  }
}

// ── API Actions ─────────────────────────────────────────────────────

async function apiCreateTask(listId, task) {
  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: listId, title: task.title, notes: task.notes, due: task.due }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[google-tasks] Create failed', err);
    return null;
  }
}

async function apiUpdateTask(listId, taskId, updates) {
  try {
    const res = await fetch('/api/tasks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: listId, taskId, ...updates }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[google-tasks] Update failed', err);
    return null;
  }
}

async function apiDeleteTask(listId, taskId) {
  try {
    const res = await fetch(`/api/tasks?list=${encodeURIComponent(listId)}&taskId=${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.error('[google-tasks] Delete failed', err);
    return false;
  }
}

async function apiCompleteTask(listId, taskId) {
  try {
    const res = await fetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: listId, taskId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[google-tasks] Complete failed', err);
    return null;
  }
}

async function apiUncompleteTask(listId, taskId) {
  try {
    const res = await fetch('/api/uncomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: listId, taskId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[google-tasks] Uncomplete failed', err);
    return null;
  }
}

// ── Rendering ───────────────────────────────────────────────────────

function renderGoogleTasks() {
  const container = $('#googleTasksContainer');
  if (!container) return;

  if (taskLists.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Could not connect to Google Tasks API.</p>
        <p class="text-secondary">Make sure the Vercel env vars (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) are set.</p>
        <button class="btn btn-primary btn-sm" id="gtRetryBtn">Retry</button>
      </div>
    `;
    return;
  }

  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const pendingCount = tasks.length - completedCount;

  container.innerHTML = `
    <div class="gt-toolbar">
      <select class="form-select" id="gtListSelector" aria-label="Task list">
        ${taskLists.map(l => `<option value="${escapeHtml(l.id)}" ${l.id === activeListId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`).join('')}
      </select>
      <span class="text-sm text-secondary">${pendingCount} pending, ${completedCount} done</span>
      <button class="btn btn-primary btn-sm" id="gtAddTaskBtn">Add Task</button>
    </div>
    <div class="gt-new-task" id="gtNewTask" hidden>
      <input type="text" class="form-input" id="gtNewTaskTitle" placeholder="Task title..." aria-label="New task title">
      <div class="gt-new-task-row">
        <input type="date" class="form-input gt-new-task-date" id="gtNewTaskDue" aria-label="Due date">
        <textarea class="form-input gt-new-task-notes" id="gtNewTaskNotes" placeholder="Notes..." rows="2" aria-label="Notes"></textarea>
      </div>
      <div class="gt-new-task-actions">
        <button class="btn btn-ghost btn-sm" id="gtCancelNewBtn">Cancel</button>
        <button class="btn btn-primary btn-sm" id="gtSaveNewBtn">Add</button>
      </div>
    </div>
    <div class="gt-task-list" id="gtTaskList">
      ${tasks.length === 0
        ? '<div class="empty-state"><p>No tasks in this list.</p></div>'
        : tasks.map(renderTaskItem).join('')}
    </div>
  `;
}

function renderTaskItem(task) {
  const isCompleted = task.status === 'completed';
  const isOverdue = !isCompleted && task.due && new Date(task.due) < new Date();
  const isEditing = editingTaskId === task.id;

  if (isEditing) {
    return `
      <div class="gt-task-item gt-task-editing" data-task-id="${escapeHtml(task.id)}">
        <input type="text" class="form-input gt-edit-title" value="${escapeHtml(task.title || '')}" aria-label="Task title">
        <input type="date" class="form-input gt-edit-due" value="${escapeHtml(task.due ? task.due.slice(0, 10) : '')}" aria-label="Due date">
        <textarea class="form-input gt-edit-notes" rows="2" aria-label="Notes">${escapeHtml(task.notes || '')}</textarea>
        <div class="gt-edit-actions">
          <button class="btn btn-danger btn-xs gt-delete-btn" data-task-id="${escapeHtml(task.id)}">Delete</button>
          <button class="btn btn-ghost btn-xs gt-cancel-edit-btn">Cancel</button>
          <button class="btn btn-primary btn-xs gt-save-edit-btn" data-task-id="${escapeHtml(task.id)}">Save</button>
        </div>
      </div>
    `;
  }

  // Project badge
  const assignedProject = getProjectForTask(activeListId, task.id);
  const projectBadgeHtml = assignedProject
    ? `<span class="gt-project-badge" data-task-id="${escapeHtml(task.id)}" title="${escapeHtml(assignedProject.name)}"><span class="gt-project-dot" style="background:${PROJECT_COLORS[assignedProject.color] || PROJECT_COLORS.gold}"></span>${escapeHtml(assignedProject.name)}</span>`
    : `<button class="gt-assign-btn" data-task-id="${escapeHtml(task.id)}" aria-label="Assign to project" title="Assign to project"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>`;

  return `
    <div class="gt-task-item ${isCompleted ? 'gt-task-completed' : ''}" data-task-id="${escapeHtml(task.id)}">
      <button class="gt-checkbox ${isCompleted ? 'is-checked' : ''}" data-task-id="${escapeHtml(task.id)}" aria-label="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">
        ${isCompleted ? '✓' : ''}
      </button>
      <div class="gt-task-content">
        <span class="gt-task-title ${isCompleted ? 'gt-task-done-text' : ''}">${escapeHtml(task.title || 'Untitled')}</span>
        ${task.notes ? `<span class="gt-task-notes text-xs text-tertiary">${escapeHtml(task.notes.slice(0, 100))}</span>` : ''}
      </div>
      ${projectBadgeHtml}
      ${task.due ? `<span class="gt-task-due ${isOverdue ? 'gt-task-overdue' : ''}">${formatDate(task.due)}</span>` : ''}
      <button class="btn btn-ghost btn-xs gt-edit-btn" data-task-id="${escapeHtml(task.id)}" aria-label="Edit">✎</button>
    </div>
  `;
}

// ── Home Dashboard Exports ──────────────────────────────────────────

/**
 * Fetch upcoming incomplete tasks for the Home dashboard widget.
 * Returns max 8 tasks sorted by due date (soonest first).
 */
export async function getUpcomingTasks() {
  try {
    // Load task lists if not loaded
    if (taskLists.length === 0) {
      const res = await fetch('/api/lists');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      taskLists = Array.isArray(data) ? data : [];
    }

    if (taskLists.length === 0) return [];

    const listId = taskLists[0].id;
    const res = await fetch(`/api/tasks?list=${encodeURIComponent(listId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const allTasks = data.tasks || [];

    // Filter incomplete, sort by due date (soonest first, no-due last)
    return allTasks
      .filter(t => t.status !== 'completed')
      .sort((a, b) => {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return new Date(a.due) - new Date(b.due);
      })
      .slice(0, 8)
      .map(t => ({ ...t, listId }));
  } catch (err) {
    console.warn('[google-tasks] getUpcomingTasks failed', err);
    return [];
  }
}

/**
 * Complete a task from the Home dashboard widget.
 */
export async function completeTaskFromHome(listId, taskId) {
  return apiCompleteTask(listId, taskId);
}

// ── Project Integration Exports ─────────────────────────────────────

/**
 * Complete a GT task by ID (used by projects.js).
 */
export async function completeTaskById(listId, taskId) {
  return apiCompleteTask(listId, taskId);
}

/**
 * Uncomplete a GT task by ID (used by projects.js).
 */
export async function uncompleteTaskById(listId, taskId) {
  return apiUncompleteTask(listId, taskId);
}

/**
 * Fetch tasks for a given list (used by projects.js task picker).
 */
export async function fetchTasksForList(listId) {
  try {
    const res = await fetch(`/api/tasks?list=${encodeURIComponent(listId)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.tasks || []).sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1;
      if (a.status !== 'completed' && b.status === 'completed') return -1;
      return (a.position || '').localeCompare(b.position || '');
    });
  } catch (err) {
    console.warn('[google-tasks] fetchTasksForList failed', err);
    return [];
  }
}

/**
 * Return the cached task lists array (used by projects.js task picker).
 */
export function getTaskLists() {
  return taskLists;
}

// ── Events ──────────────────────────────────────────────────────────

function bindGoogleTaskEvents() {
  const container = $('#googleTasksContainer');
  if (!container) return;

  container.addEventListener('click', async (e) => {
    // Retry
    if (e.target.closest('#gtRetryBtn')) {
      await loadGoogleTaskData();
      return;
    }

    // Add task toggle
    if (e.target.closest('#gtAddTaskBtn')) {
      const newTask = $('#gtNewTask');
      if (newTask) {
        newTask.hidden = !newTask.hidden;
        if (!newTask.hidden) $('#gtNewTaskTitle')?.focus();
      }
      return;
    }

    // Cancel new task
    if (e.target.closest('#gtCancelNewBtn')) {
      const newTask = $('#gtNewTask');
      if (newTask) newTask.hidden = true;
      return;
    }

    // Save new task
    if (e.target.closest('#gtSaveNewBtn')) {
      const title = $('#gtNewTaskTitle')?.value?.trim();
      if (!title) { showToast('Title required', 'warning'); return; }
      const due = $('#gtNewTaskDue')?.value || undefined;
      const notes = $('#gtNewTaskNotes')?.value?.trim() || undefined;
      showToast('Creating task...');
      const result = await apiCreateTask(activeListId, { title, due: due ? new Date(due).toISOString() : undefined, notes });
      if (result) {
        await loadTasks(activeListId);
        renderGoogleTasks();
        showToast('Task created', 'success');
      } else {
        showToast('Failed to create task', 'error');
      }
      return;
    }

    // Checkbox toggle
    const checkbox = e.target.closest('.gt-checkbox');
    if (checkbox) {
      const taskId = checkbox.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;
      const isCompleted = task.status === 'completed';
      const fn = isCompleted ? apiUncompleteTask : apiCompleteTask;
      const result = await fn(activeListId, taskId);
      if (result) {
        task.status = isCompleted ? 'needsAction' : 'completed';
        renderGoogleTasks();
      }
      return;
    }

    // Assign to project
    const assignBtn = e.target.closest('.gt-assign-btn');
    if (assignBtn) {
      const taskId = assignBtn.dataset.taskId;
      showAssignDropdown(assignBtn, taskId);
      return;
    }

    // Pick project from assign dropdown
    const assignOption = e.target.closest('.gt-assign-option');
    if (assignOption) {
      const projectId = assignOption.dataset.projectId;
      const taskId = assignOption.dataset.taskId;
      assignTaskToProject(projectId, activeListId, taskId);
      // Remove dropdown
      const dropdown = assignOption.closest('.gt-assign-dropdown');
      if (dropdown) dropdown.remove();
      return;
    }

    // Edit
    const editBtn = e.target.closest('.gt-edit-btn');
    if (editBtn) {
      editingTaskId = editBtn.dataset.taskId;
      renderGoogleTasks();
      return;
    }

    // Cancel edit
    if (e.target.closest('.gt-cancel-edit-btn')) {
      editingTaskId = null;
      renderGoogleTasks();
      return;
    }

    // Save edit
    const saveEditBtn = e.target.closest('.gt-save-edit-btn');
    if (saveEditBtn) {
      const taskId = saveEditBtn.dataset.taskId;
      const item = container.querySelector(`.gt-task-item[data-task-id="${taskId}"]`);
      if (!item) return;
      const title = item.querySelector('.gt-edit-title')?.value?.trim();
      const due = item.querySelector('.gt-edit-due')?.value || undefined;
      const notes = item.querySelector('.gt-edit-notes')?.value?.trim() || undefined;
      if (!title) { showToast('Title required', 'warning'); return; }
      const result = await apiUpdateTask(activeListId, taskId, {
        title,
        due: due ? new Date(due).toISOString() : undefined,
        notes,
      });
      if (result) {
        editingTaskId = null;
        await loadTasks(activeListId);
        renderGoogleTasks();
        showToast('Task updated', 'success');
      } else {
        showToast('Failed to update task', 'error');
      }
      return;
    }

    // Delete
    const deleteBtn = e.target.closest('.gt-delete-btn');
    if (deleteBtn) {
      const taskId = deleteBtn.dataset.taskId;
      if (!confirm('Delete this task?')) return;
      const ok = await apiDeleteTask(activeListId, taskId);
      if (ok) {
        editingTaskId = null;
        tasks = tasks.filter(t => t.id !== taskId);
        renderGoogleTasks();
        showToast('Task deleted');
      } else {
        showToast('Failed to delete task', 'error');
      }
      return;
    }
  });

  // List selector change
  container.addEventListener('change', async (e) => {
    if (e.target.id === 'gtListSelector') {
      activeListId = e.target.value;
      await loadTasks(activeListId);
      renderGoogleTasks();
    }
  });

  // Close assign dropdowns when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.gt-assign-dropdown') && !e.target.closest('.gt-assign-btn')) {
      const dropdowns = container.querySelectorAll('.gt-assign-dropdown');
      dropdowns.forEach(d => d.remove());
    }
  });

  // Re-render when projects change (badge updates)
  onProjectsChange(() => {
    if (tasks.length > 0) renderGoogleTasks();
  });
}

function showAssignDropdown(btn, taskId) {
  // Remove any existing dropdowns
  const container = $('#googleTasksContainer');
  container.querySelectorAll('.gt-assign-dropdown').forEach(d => d.remove());

  const options = getAllProjectOptions();
  if (options.length === 0) {
    showToast('No projects available. Create a project first.', 'warning');
    return;
  }

  const dropdown = document.createElement('div');
  dropdown.className = 'gt-assign-dropdown';
  dropdown.innerHTML = options.map(p =>
    `<button class="gt-assign-option" data-project-id="${escapeHtml(p.id)}" data-task-id="${escapeHtml(taskId)}">
      <span class="gt-project-dot" style="background:${PROJECT_COLORS[p.color] || PROJECT_COLORS.gold}"></span>
      ${escapeHtml(p.name)}
    </button>`
  ).join('');

  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(dropdown);
}

function assignTaskToProject(projectId, listId, taskId) {
  const data = getProjects();
  const project = data.projects.find(p => p.id === projectId);
  if (!project) return;

  if (!project.linkedTasks) project.linkedTasks = [];
  if (project.linkedTasks.some(t => t.listId === listId && t.taskId === taskId)) {
    showToast('Already linked to this project', 'warning');
    return;
  }

  project.linkedTasks.push({ listId, taskId });
  saveProjects(data);
  showToast(`Linked to ${project.name}`, 'success');
}
