/* ============================================================
   project-store.js — Shared project data layer
   Prevents circular imports between projects.js and google-tasks.js
   ============================================================ */

const STORAGE_KEY = 'forge-projects';
const changeListeners = [];

function getProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: [] };
    const data = JSON.parse(raw);
    return data && Array.isArray(data.projects) ? data : { projects: [] };
  } catch {
    return { projects: [] };
  }
}

function saveProjects(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  changeListeners.forEach(fn => {
    try { fn(data); } catch (e) { console.error('[project-store] listener error', e); }
  });
}

function getProjectForTask(listId, taskId) {
  const { projects } = getProjects();
  return projects.find(p =>
    p.linkedTasks && p.linkedTasks.some(t => t.listId === listId && t.taskId === taskId)
  ) || null;
}

function getAllProjectOptions() {
  const { projects } = getProjects();
  return projects
    .filter(p => p.status !== 'done')
    .map(p => ({ id: p.id, name: p.name, color: p.color }));
}

function onProjectsChange(fn) {
  changeListeners.push(fn);
  return () => {
    const i = changeListeners.indexOf(fn);
    if (i > -1) changeListeners.splice(i, 1);
  };
}

export { getProjects, saveProjects, getProjectForTask, getAllProjectOptions, onProjectsChange };
