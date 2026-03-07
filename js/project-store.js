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

async function seedProjects() {
  try {
    const res = await fetch(`data/seed-projects.json?t=${Date.now()}`);
    if (!res.ok) return;
    const seed = await res.json();
    if (!seed.projects || !Array.isArray(seed.projects)) return;

    const data = getProjects();
    const existingIds = new Set(data.projects.map(p => p.id));
    let added = 0;

    seed.projects.forEach(sp => {
      if (!existingIds.has(sp.id)) {
        data.projects.push(sp);
        added++;
      }
    });

    if (added > 0) {
      saveProjects(data);
      console.log(`[project-store] Seeded ${added} project(s)`);
    }
  } catch (e) {
    console.warn('[project-store] Seed file not found or invalid', e);
  }
}

export { getProjects, saveProjects, getProjectForTask, getAllProjectOptions, onProjectsChange, seedProjects };
