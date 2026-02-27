// js/google-tasks.js — Google Tasks tab
// ──────────────────────────────────────────────────────────────────────

import {
  getState, setState, subscribe,
  escapeHtml, formatDate, formatRelativeTime,
  generateId, debounce, $, $$, showToast
} from './app.js';

// ── Config ──────────────────────────────────────────────────────────
const LOCAL_API = 'http://localhost:3010';
const VERCEL_API = 'https://google-tasks-api.vercel.app';
let apiBase = LOCAL_API;

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

  // Try local API first, fall back to Vercel
  try {
    const res = await fetch(`${LOCAL_API}/tasklists`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      apiBase = LOCAL_API;
    } else {
      apiBase = VERCEL_API;
    }
  } catch {
    apiBase = VERCEL_API;
  }

  await loadTaskLists();
  loading = false;
  renderGoogleTasks();
}

async function loadTaskLists() {
  try {
    const res = await fetch(`${apiBase}/tasklists`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    taskLists = data.items || data || [];
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
    const res = await fetch(`${apiBase}/tasklists/${encodeURIComponent(listId)}/tasks`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    tasks = (data.items || data || []).sort((a, b) => {
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
    const res = await fetch(`${apiBase}/tasklists/${encodeURIComponent(listId)}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
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
    const res = await fetch(`${apiBase}/tasklists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
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
    const res = await fetch(`${apiBase}/tasklists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
    return res.ok;
  } catch (err) {
    console.error('[google-tasks] Delete failed', err);
    return false;
  }
}

async function apiCompleteTask(listId, taskId) {
  return apiUpdateTask(listId, taskId, { status: 'completed' });
}

async function apiUncompleteTask(listId, taskId) {
  return apiUpdateTask(listId, taskId, { status: 'needsAction' });
}

// ── Rendering ───────────────────────────────────────────────────────

function renderGoogleTasks() {
  const container = $('#googleTasksContainer');
  if (!container) return;

  if (taskLists.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Could not connect to Google Tasks API.</p>
        <p class="text-secondary">Make sure the local server is running at ${escapeHtml(LOCAL_API)}</p>
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

  return `
    <div class="gt-task-item ${isCompleted ? 'gt-task-completed' : ''}" data-task-id="${escapeHtml(task.id)}">
      <button class="gt-checkbox ${isCompleted ? 'is-checked' : ''}" data-task-id="${escapeHtml(task.id)}" aria-label="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">
        ${isCompleted ? '✓' : ''}
      </button>
      <div class="gt-task-content">
        <span class="gt-task-title ${isCompleted ? 'gt-task-done-text' : ''}">${escapeHtml(task.title || 'Untitled')}</span>
        ${task.notes ? `<span class="gt-task-notes text-xs text-tertiary">${escapeHtml(task.notes.slice(0, 100))}</span>` : ''}
      </div>
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
  // Resolve API base if not yet done
  if (apiBase === LOCAL_API) {
    try {
      const res = await fetch(`${LOCAL_API}/tasklists`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) apiBase = VERCEL_API;
    } catch {
      apiBase = VERCEL_API;
    }
  }

  try {
    // Load task lists if not loaded
    if (taskLists.length === 0) {
      const res = await fetch(`${apiBase}/tasklists`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      taskLists = data.items || data || [];
    }

    if (taskLists.length === 0) return [];

    const listId = taskLists[0].id;
    const res = await fetch(`${apiBase}/tasklists/${encodeURIComponent(listId)}/tasks`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const allTasks = data.items || data || [];

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
}
