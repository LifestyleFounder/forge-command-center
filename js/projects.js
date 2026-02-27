/* ============================================================
   projects.js — Forge Command Center Projects Tab
   Kanban board, drag-and-drop, task CRUD, activity log
   ============================================================ */

import {
  getState,
  setState,
  subscribe,
  escapeHtml,
  formatDate,
  formatRelativeTime,
  generateId,
  debounce,
  $,
  $$,
  openModal,
  closeModal,
  showToast,
  saveLocal
} from './app.js';

// ---- Constants -----------------------------------------------

const COLUMNS = ['inbox', 'todo', 'progress', 'done'];

const COLUMN_LABELS = {
  inbox: 'Inbox',
  todo: 'To Do',
  progress: 'In Progress',
  done: 'Done'
};

const ACTIVITY_ICONS = {
  system: '\uD83D\uDD27',
  task: '\u2705',
  scheduled: '\uD83D\uDD52',
  communication: '\uD83D\uDCAC',
  research: '\uD83D\uDD0D',
  default: '\u25CF'
};

// ---- DOM Cache (module-scoped) --------------------------------

let el = {};
let dragState = { taskId: null, sourceStatus: null };
let doneCollapsed = false;
let activeDetailTaskId = null;

function cacheProjectElements() {
  el = {
    kanbanBoard: $('#kanbanBoard'),
    addTaskBtn: $('#addTaskBtn'),
    saveTaskBtn: $('#saveTaskBtn'),
    updateTaskBtn: $('#updateTaskBtn'),
    deleteTaskBtn: $('#deleteTaskBtn'),
    toggleDoneBtn: $('#toggleDoneBtn'),
    // Task modal inputs
    taskTitleInput: $('#taskTitleInput'),
    taskDescInput: $('#taskDescInput'),
    taskPriorityInput: $('#taskPriorityInput'),
    taskDueInput: $('#taskDueInput'),
    taskTagsInput: $('#taskTagsInput'),
    taskModalTitle: $('#taskModalTitle'),
    // Task detail
    taskDetailTitle: $('#taskDetailTitle'),
    taskDetailBody: $('#taskDetailBody'),
    // Column counts
    countInbox: $('#countInbox'),
    countTodo: $('#countTodo'),
    countProgress: $('#countProgress'),
    countDone: $('#countDone'),
    // Activity
    activityList: $('#activityList'),
    activitySearch: $('#activitySearch'),
  };
}

// ---- Public Init ----------------------------------------------

export function initProjects() {
  cacheProjectElements();

  renderKanban();
  renderActivity();
  initDragAndDrop();
  bindProjectEvents();

  subscribe((key) => {
    if (key === 'tasks') renderKanban();
    if (key === 'activities') renderActivity();
  });
}

// ---- Kanban Board ---------------------------------------------

function renderKanban() {
  const tasks = getState().tasks?.tasks || [];

  // Group by status
  const grouped = {};
  COLUMNS.forEach(col => { grouped[col] = []; });

  tasks.forEach(task => {
    const status = COLUMNS.includes(task.status) ? task.status : 'inbox';
    grouped[status].push(task);
  });

  // Sort each column: high priority first, then by due date
  COLUMNS.forEach(col => {
    grouped[col].sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 };
      const pa = pOrder[a.priority] != null ? pOrder[a.priority] : 1;
      const pb = pOrder[b.priority] != null ? pOrder[b.priority] : 1;
      if (pa !== pb) return pa - pb;
      // Then by due date (earliest first, no-due at end)
      if (a.due && b.due) return new Date(a.due) - new Date(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    });
  });

  // Render cards into each column
  COLUMNS.forEach(col => {
    const container = $(`.kanban-cards[data-status="${col}"]`, el.kanbanBoard);
    if (!container) return;

    const columnTasks = grouped[col];

    // If done column is collapsed, only show a few
    if (col === 'done' && doneCollapsed) {
      container.innerHTML = columnTasks.length === 0
        ? '<div class="kanban-empty">No completed tasks</div>'
        : columnTasks.slice(0, 3).map(renderKanbanCard).join('') +
          (columnTasks.length > 3 ? `<div class="kanban-more">+${columnTasks.length - 3} more</div>` : '');
    } else {
      container.innerHTML = columnTasks.length === 0
        ? '<div class="kanban-empty">Drop tasks here</div>'
        : columnTasks.map(renderKanbanCard).join('');
    }
  });

  // Update counts
  if (el.countInbox) el.countInbox.textContent = grouped.inbox.length;
  if (el.countTodo) el.countTodo.textContent = grouped.todo.length;
  if (el.countProgress) el.countProgress.textContent = grouped.progress.length;
  if (el.countDone) el.countDone.textContent = grouped.done.length;
}

function renderKanbanCard(task) {
  const isOverdue = task.due && new Date(task.due) < new Date() && task.status !== 'done';
  const priorityClass = task.priority ? `priority-${escapeHtml(task.priority)}` : 'priority-medium';
  const tagsHtml = (task.tags && task.tags.length)
    ? `<div class="kanban-card-tags">${task.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';
  const dueHtml = task.due
    ? `<div class="kanban-card-due ${isOverdue ? 'is-overdue' : ''}">${formatDate(task.due)}</div>`
    : '';

  return `
    <div class="kanban-card ${priorityClass}" data-id="${escapeHtml(task.id)}" data-priority="${escapeHtml(task.priority || 'medium')}" draggable="true">
      <div class="kanban-card-title">${escapeHtml(task.title)}</div>
      ${tagsHtml}
      ${dueHtml}
    </div>
  `;
}

// ---- Drag and Drop --------------------------------------------

function initDragAndDrop() {
  if (!el.kanbanBoard) return;

  // Drag start — delegated
  el.kanbanBoard.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.kanban-card');
    if (!card) return;

    dragState.taskId = card.dataset.id;
    dragState.sourceStatus = card.closest('.kanban-column')?.dataset.status || null;

    card.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.id);

    // Slight delay to let the browser create the ghost image
    requestAnimationFrame(() => {
      card.style.opacity = '0.4';
    });
  });

  // Drag over — allow drop, highlight column
  el.kanbanBoard.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const column = e.target.closest('.kanban-column');
    if (!column) return;

    // Remove highlight from all columns, add to this one
    $$('.kanban-column', el.kanbanBoard).forEach(col => {
      col.classList.toggle('is-drag-over', col === column);
    });
  });

  // Drag leave — remove highlight
  el.kanbanBoard.addEventListener('dragleave', (e) => {
    const column = e.target.closest('.kanban-column');
    if (column && !column.contains(e.relatedTarget)) {
      column.classList.remove('is-drag-over');
    }
  });

  // Drop — update task status
  el.kanbanBoard.addEventListener('drop', (e) => {
    e.preventDefault();

    const column = e.target.closest('.kanban-column');
    if (!column) return;

    const newStatus = column.dataset.status;
    const taskId = e.dataTransfer.getData('text/plain') || dragState.taskId;

    // Clean up drag styles
    $$('.kanban-column', el.kanbanBoard).forEach(col => col.classList.remove('is-drag-over'));
    const draggedCard = $(`.kanban-card[data-id="${taskId}"]`, el.kanbanBoard);
    if (draggedCard) {
      draggedCard.classList.remove('is-dragging');
      draggedCard.style.opacity = '';
    }

    if (!taskId || !newStatus) return;

    // Update task
    const tasksData = getState().tasks;
    if (!tasksData || !tasksData.tasks) return;

    const task = tasksData.tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const oldStatus = task.status;
    task.status = newStatus;

    // Set completedAt if moved to done
    if (newStatus === 'done' && !task.completedAt) {
      task.completedAt = new Date().toISOString();
    }
    // Clear completedAt if moved out of done
    if (newStatus !== 'done' && task.completedAt) {
      delete task.completedAt;
    }

    tasksData.lastUpdated = new Date().toISOString();
    setState('tasks', tasksData);
    saveLocal('tasks.json', tasksData);

    addActivity('task', `Moved "${task.title}" from ${COLUMN_LABELS[oldStatus] || oldStatus} to ${COLUMN_LABELS[newStatus] || newStatus}`);
    showToast(`Task moved to ${COLUMN_LABELS[newStatus]}`, 'success');
  });

  // Drag end — clean up
  el.kanbanBoard.addEventListener('dragend', (e) => {
    const card = e.target.closest('.kanban-card');
    if (card) {
      card.classList.remove('is-dragging');
      card.style.opacity = '';
    }
    $$('.kanban-column', el.kanbanBoard).forEach(col => col.classList.remove('is-drag-over'));
    dragState.taskId = null;
    dragState.sourceStatus = null;
  });
}

// ---- Task CRUD -------------------------------------------------

function bindProjectEvents() {
  // Add Task button
  if (el.addTaskBtn) {
    el.addTaskBtn.addEventListener('click', () => {
      resetTaskForm();
      if (el.taskModalTitle) el.taskModalTitle.textContent = 'Add Task';
      openModal('taskModal');
    });
  }

  // Save Task (new)
  if (el.saveTaskBtn) {
    el.saveTaskBtn.addEventListener('click', handleSaveTask);
  }

  // Update Task (edit)
  if (el.updateTaskBtn) {
    el.updateTaskBtn.addEventListener('click', handleUpdateTask);
  }

  // Delete Task
  if (el.deleteTaskBtn) {
    el.deleteTaskBtn.addEventListener('click', handleDeleteTask);
  }

  // Toggle Done column
  if (el.toggleDoneBtn) {
    el.toggleDoneBtn.addEventListener('click', () => {
      doneCollapsed = !doneCollapsed;
      el.toggleDoneBtn.classList.toggle('is-collapsed', doneCollapsed);
      renderKanban();
    });
  }

  // Card click (event delegation on kanban board)
  if (el.kanbanBoard) {
    el.kanbanBoard.addEventListener('click', (e) => {
      // Ignore if user is dragging
      if (dragState.taskId) return;

      const card = e.target.closest('.kanban-card');
      if (!card) return;

      const taskId = card.dataset.id;
      if (!taskId) return;

      openTaskDetail(taskId);
    });
  }

  // Activity search (debounced)
  if (el.activitySearch) {
    const debouncedFilter = debounce((query) => {
      renderActivity(query);
    }, 200);

    el.activitySearch.addEventListener('input', () => {
      debouncedFilter(el.activitySearch.value.trim());
    });
  }
}

function resetTaskForm() {
  if (el.taskTitleInput) el.taskTitleInput.value = '';
  if (el.taskDescInput) el.taskDescInput.value = '';
  if (el.taskPriorityInput) el.taskPriorityInput.value = 'medium';
  if (el.taskDueInput) el.taskDueInput.value = '';
  if (el.taskTagsInput) el.taskTagsInput.value = '';
}

function handleSaveTask() {
  const title = el.taskTitleInput ? el.taskTitleInput.value.trim() : '';
  if (!title) {
    showToast('Task title is required', 'error');
    if (el.taskTitleInput) el.taskTitleInput.focus();
    return;
  }

  const description = el.taskDescInput ? el.taskDescInput.value.trim() : '';
  const priority = el.taskPriorityInput ? el.taskPriorityInput.value : 'medium';
  const due = el.taskDueInput ? el.taskDueInput.value : '';
  const tagsRaw = el.taskTagsInput ? el.taskTagsInput.value.trim() : '';
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const newTask = {
    id: generateId(),
    title: title,
    description: description,
    priority: priority,
    status: 'inbox',
    due: due,
    createdAt: new Date().toISOString(),
    tags: tags
  };

  const tasksData = getState().tasks || { lastUpdated: null, tasks: [] };
  tasksData.tasks.push(newTask);
  tasksData.lastUpdated = new Date().toISOString();
  tasksData.updatedBy = 'forge-ui';

  setState('tasks', tasksData);
  saveLocal('tasks.json', tasksData);

  closeModal();
  showToast('Task created', 'success');
  addActivity('task', `Created task: ${title}`);
}

function openTaskDetail(taskId) {
  const tasksData = getState().tasks;
  if (!tasksData || !tasksData.tasks) return;

  const task = tasksData.tasks.find(t => t.id === taskId);
  if (!task) return;

  activeDetailTaskId = taskId;

  if (el.taskDetailTitle) {
    el.taskDetailTitle.textContent = escapeHtml(task.title);
  }

  if (el.taskDetailBody) {
    el.taskDetailBody.innerHTML = renderTaskDetailForm(task);
  }

  openModal('taskDetailModal');
}

function renderTaskDetailForm(task) {
  const statusOptions = COLUMNS.map(col =>
    `<option value="${escapeHtml(col)}" ${task.status === col ? 'selected' : ''}>${escapeHtml(COLUMN_LABELS[col])}</option>`
  ).join('');

  const priorityOptions = ['low', 'medium', 'high'].map(p =>
    `<option value="${escapeHtml(p)}" ${task.priority === p ? 'selected' : ''}>${escapeHtml(p.charAt(0).toUpperCase() + p.slice(1))}</option>`
  ).join('');

  const tagsValue = (task.tags || []).join(', ');

  return `
    <div class="form-group">
      <label class="form-label" for="detailTitle">Title</label>
      <input type="text" class="form-input" id="detailTitle" value="${escapeHtml(task.title)}">
    </div>
    <div class="form-group">
      <label class="form-label" for="detailDesc">Description</label>
      <textarea class="form-input" id="detailDesc" rows="3">${escapeHtml(task.description || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="detailStatus">Status</label>
        <select class="form-select" id="detailStatus">${statusOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="detailPriority">Priority</label>
        <select class="form-select" id="detailPriority">${priorityOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="detailDue">Due Date</label>
        <input type="date" class="form-input" id="detailDue" value="${escapeHtml(task.due || '')}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="detailTags">Tags</label>
      <input type="text" class="form-input" id="detailTags" value="${escapeHtml(tagsValue)}">
    </div>
    <div class="task-meta">
      <span>Created ${formatRelativeTime(task.createdAt)}</span>
      ${task.completedAt ? `<span>Completed ${formatRelativeTime(task.completedAt)}</span>` : ''}
    </div>
  `;
}

function handleUpdateTask() {
  if (!activeDetailTaskId) return;

  const tasksData = getState().tasks;
  if (!tasksData || !tasksData.tasks) return;

  const task = tasksData.tasks.find(t => t.id === activeDetailTaskId);
  if (!task) return;

  const titleInput = $('#detailTitle');
  const descInput = $('#detailDesc');
  const statusInput = $('#detailStatus');
  const priorityInput = $('#detailPriority');
  const dueInput = $('#detailDue');
  const tagsInput = $('#detailTags');

  const newTitle = titleInput ? titleInput.value.trim() : task.title;
  if (!newTitle) {
    showToast('Title is required', 'error');
    return;
  }

  const oldStatus = task.status;
  const newStatus = statusInput ? statusInput.value : task.status;

  task.title = newTitle;
  task.description = descInput ? descInput.value.trim() : task.description;
  task.status = newStatus;
  task.priority = priorityInput ? priorityInput.value : task.priority;
  task.due = dueInput ? dueInput.value : task.due;
  task.tags = tagsInput ? tagsInput.value.split(',').map(t => t.trim()).filter(Boolean) : task.tags;

  // Handle completedAt based on status change
  if (newStatus === 'done' && !task.completedAt) {
    task.completedAt = new Date().toISOString();
  }
  if (newStatus !== 'done' && task.completedAt) {
    delete task.completedAt;
  }

  tasksData.lastUpdated = new Date().toISOString();
  tasksData.updatedBy = 'forge-ui';

  setState('tasks', tasksData);
  saveLocal('tasks.json', tasksData);

  closeModal();
  activeDetailTaskId = null;
  showToast('Task updated', 'success');

  if (oldStatus !== newStatus) {
    addActivity('task', `Moved "${task.title}" from ${COLUMN_LABELS[oldStatus] || oldStatus} to ${COLUMN_LABELS[newStatus] || newStatus}`);
  } else {
    addActivity('task', `Updated task: ${task.title}`);
  }
}

function handleDeleteTask() {
  if (!activeDetailTaskId) return;

  const tasksData = getState().tasks;
  if (!tasksData || !tasksData.tasks) return;

  const taskIdx = tasksData.tasks.findIndex(t => t.id === activeDetailTaskId);
  if (taskIdx === -1) return;

  const task = tasksData.tasks[taskIdx];

  // Confirm deletion
  if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return;

  tasksData.tasks.splice(taskIdx, 1);
  tasksData.lastUpdated = new Date().toISOString();
  tasksData.updatedBy = 'forge-ui';

  setState('tasks', tasksData);
  saveLocal('tasks.json', tasksData);

  closeModal();
  activeDetailTaskId = null;
  showToast('Task deleted', 'info');
  addActivity('task', `Deleted task: ${task.title}`);
}

// ---- Activity Log ---------------------------------------------

function renderActivity(filterQuery) {
  if (!el.activityList) return;

  const activitiesData = getState().activities;
  let entries = activitiesData?.entries || [];

  // Apply filter
  if (filterQuery && filterQuery.length >= 2) {
    const lowerQ = filterQuery.toLowerCase();
    entries = entries.filter(entry =>
      (entry.action && entry.action.toLowerCase().includes(lowerQ)) ||
      (entry.details && entry.details.toLowerCase().includes(lowerQ)) ||
      (entry.type && entry.type.toLowerCase().includes(lowerQ))
    );
  }

  if (entries.length === 0) {
    el.activityList.innerHTML = '<div class="empty-state"><p>No activity recorded yet</p></div>';
    return;
  }

  // Show up to 50 entries
  el.activityList.innerHTML = entries.slice(0, 50).map(entry => {
    const icon = ACTIVITY_ICONS[entry.type] || ACTIVITY_ICONS.default;
    return `
      <div class="activity-item" data-type="${escapeHtml(entry.type || '')}">
        <span class="activity-icon">${icon}</span>
        <div class="activity-text">
          <span class="activity-action">${escapeHtml(entry.action || '')}</span>
          ${entry.details ? `<span class="activity-details">${escapeHtml(entry.details)}</span>` : ''}
        </div>
        <span class="activity-time">${formatRelativeTime(entry.timestamp)}</span>
      </div>
    `;
  }).join('');
}

// ---- Add Activity Helper --------------------------------------

function addActivity(type, description) {
  const activitiesData = getState().activities || { lastUpdated: null, entries: [] };

  activitiesData.entries.unshift({
    id: generateId(),
    timestamp: new Date().toISOString(),
    type: type,
    action: description,
    details: '',
    session: 'forge-ui'
  });

  activitiesData.lastUpdated = new Date().toISOString();

  setState('activities', activitiesData);
  saveLocal('activity-log.json', activitiesData);
}
