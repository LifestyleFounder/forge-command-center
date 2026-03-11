// js/services/workspace-sync.js — Bidirectional Notion workspace sync
// ──────────────────────────────────────────────────────────────────────
// Syncs folders + docs between local storage and Notion.
// Notion structure: Workspace root → 📁 folder pages → doc pages.

import {
  getWorkspaceIndex, createNotionFolder, createDocInFolder,
  getPageBlocks, updatePageBlocks, updatePageTitle,
} from './notion-blocks.js';
import { notionBlocksToTiptap, tiptapToNotionBlocks } from '../notion-converter.js';

// ── Storage Keys ────────────────────────────────────────────────────
const FOLDER_MAP_KEY = 'forge-notion-folder-map';   // { localFolderId: notionPageId }
const SYNC_TS_KEY = 'forge-workspace-last-sync';
const SYNC_COOLDOWN = 30_000; // 30s minimum between full syncs

// ── Folder Map Helpers ──────────────────────────────────────────────

export function getFolderMap() {
  try { return JSON.parse(localStorage.getItem(FOLDER_MAP_KEY) || '{}'); }
  catch { return {}; }
}

export function saveFolderMap(map) {
  localStorage.setItem(FOLDER_MAP_KEY, JSON.stringify(map));
}

function buildReverseMap(folderMap) {
  const rev = {};
  for (const [localId, notionId] of Object.entries(folderMap)) {
    rev[notionId] = localId;
  }
  return rev;
}

// ── Main Sync ───────────────────────────────────────────────────────

/**
 * Full bidirectional sync between local workspace and Notion.
 * Call on workspace tab visit.
 *
 * @param {Object} opts
 * @param {Function} opts.getLocalFolders  - returns folder array
 * @param {Function} opts.getLocalDocs     - returns doc array
 * @param {Function} opts.saveLocalFolders - saves folder array (localStorage only)
 * @param {Function} opts.saveLocalDocs    - saves doc array (localStorage only)
 * @returns {{ synced: boolean, pulled: number, pushed: number }}
 */
export async function syncWorkspace({ getLocalFolders, getLocalDocs, saveLocalFolders, saveLocalDocs }) {
  // Cooldown check
  const lastSync = parseInt(localStorage.getItem(SYNC_TS_KEY) || '0');
  if (Date.now() - lastSync < SYNC_COOLDOWN) {
    console.log('[workspace-sync] Skipping — cooldown active');
    return { synced: false, pulled: 0, pushed: 0 };
  }

  let pulled = 0, pushed = 0;

  try {
    // 1. Fetch Notion workspace index
    const index = await getWorkspaceIndex();
    if (!index) {
      console.warn('[workspace-sync] Could not fetch workspace index');
      return { synced: false, pulled: 0, pushed: 0 };
    }

    const { folders: notionFolders, unfiled } = index;
    const localFolders = getLocalFolders();
    const localDocs = getLocalDocs();
    const folderMap = getFolderMap();
    let reverseMap = buildReverseMap(folderMap);

    // ── 2. Sync folders ────────────────────────────────────────

    // 2a. Ensure every local folder has a Notion page
    for (const folder of localFolders) {
      if (folder.type === 'divider') continue; // dividers are local-only UI

      if (!folderMap[folder.id]) {
        // Try to match by name first
        const match = notionFolders.find(nf =>
          nf.title.toLowerCase() === folder.name.toLowerCase() && !reverseMap[nf.id]
        );
        if (match) {
          folderMap[folder.id] = match.id;
          reverseMap[match.id] = folder.id;
        } else {
          // Create folder in Notion
          const result = await createNotionFolder(folder.name);
          if (result?.folderId) {
            folderMap[folder.id] = result.folderId;
            reverseMap[result.folderId] = folder.id;
            pushed++;
          }
        }
      }
    }

    // 2b. Notion folders not in local → create locally
    for (const nf of notionFolders) {
      if (reverseMap[nf.id]) continue; // already mapped

      // Generate a unique local ID from the title
      let localId = nf.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!localId) localId = `notion-${nf.id.slice(0, 8)}`;
      // Ensure uniqueness
      while (localFolders.some(f => f.id === localId)) {
        localId += '-' + Math.random().toString(36).slice(2, 5);
      }

      localFolders.push({
        id: localId,
        name: nf.title,
        parentId: null,
        order: localFolders.filter(f => !f.parentId).length,
        type: 'folder',
      });
      folderMap[localId] = nf.id;
      reverseMap[nf.id] = localId;
      pulled++;
    }

    saveFolderMap(folderMap);

    // ── 3. Sync docs ──────────────────────────────────────────

    // Build lookup: notionPageId → local doc
    const localDocsByNotion = {};
    for (const doc of localDocs) {
      if (doc.notionPageId) localDocsByNotion[doc.notionPageId] = doc;
    }

    // 3a. Check docs in each Notion folder
    for (const nf of notionFolders) {
      const localFolderId = reverseMap[nf.id];
      if (!localFolderId) continue;

      for (const nd of (nf.docs || [])) {
        const localDoc = localDocsByNotion[nd.id];

        if (!localDoc) {
          // New doc from Notion — add to local (content lazy-loaded on open)
          localDocs.push({
            id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: nd.title,
            folder: localFolderId,
            content: null,
            notionPageId: nd.id,
            notionLastEdited: nd.lastEdited,
            needsNotionPull: true,
            createdAt: nd.lastEdited,
            updatedAt: nd.lastEdited,
          });
          pulled++;
        } else {
          // Existing doc — compare timestamps
          const notionTime = new Date(nd.lastEdited).getTime();
          const localTime = new Date(localDoc.updatedAt || 0).getTime();

          if (notionTime > localTime + 5000) {
            // Notion is newer — flag for content pull on open
            localDoc.notionLastEdited = nd.lastEdited;
            localDoc.needsNotionPull = true;
            localDoc.title = nd.title;
            pulled++;
          } else if (localTime > notionTime + 5000 && localDoc.content) {
            // Local is newer — push to Notion in background
            pushDocToNotion(localDoc).catch(() => {});
            pushed++;
          }

          // Ensure folder mapping is correct
          localDoc.folder = localFolderId;
        }
      }
    }

    // 3b. Handle unfiled docs (root-level in Notion, no folder)
    if (unfiled.length > 0) {
      let unfiledFolderId = localFolders.find(f => f.type === 'folder')?.id;
      if (!unfiledFolderId) {
        localFolders.push({
          id: 'unfiled',
          name: 'Unfiled',
          parentId: null,
          order: 0,
          type: 'folder',
        });
        unfiledFolderId = 'unfiled';
      }

      for (const ud of unfiled) {
        if (!localDocsByNotion[ud.id]) {
          localDocs.push({
            id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            title: ud.title,
            folder: unfiledFolderId,
            content: null,
            notionPageId: ud.id,
            notionLastEdited: ud.lastEdited,
            needsNotionPull: true,
            createdAt: ud.lastEdited,
            updatedAt: ud.lastEdited,
          });
          pulled++;
        }
      }
    }

    // 3c. Push local docs without notionPageId to Notion
    for (const doc of localDocs) {
      if (!doc.notionPageId && doc.content) {
        const notionFolderId = folderMap[doc.folder];
        if (!notionFolderId) continue;

        try {
          const blocks = tiptapToNotionBlocks(doc.content);
          const result = await createDocInFolder(notionFolderId, doc.title || 'Untitled', blocks);
          if (result?.pageId) {
            doc.notionPageId = result.pageId;
            pushed++;
          }
        } catch (err) {
          console.warn('[workspace-sync] Failed to push doc to Notion:', doc.title, err);
        }
      }
    }

    // ── 4. Save everything ────────────────────────────────────

    saveLocalFolders(localFolders);
    saveLocalDocs(localDocs);
    localStorage.setItem(SYNC_TS_KEY, String(Date.now()));

    console.log(`[workspace-sync] Done: pulled ${pulled}, pushed ${pushed}`);
    return { synced: true, pulled, pushed };

  } catch (err) {
    console.error('[workspace-sync] Failed:', err);
    return { synced: false, pulled, pushed };
  }
}

// ── Doc-level Sync Helpers ──────────────────────────────────────────

/**
 * Pull doc content from Notion and convert to Tiptap JSON.
 * Call when opening a doc that has needsNotionPull = true.
 */
export async function pullDocContent(notionPageId) {
  if (!notionPageId) return null;

  try {
    const blocks = await getPageBlocks(notionPageId);
    if (!blocks || blocks.length === 0) return null;
    return notionBlocksToTiptap(blocks);
  } catch (err) {
    console.error('[workspace-sync] pullDocContent failed:', err);
    return null;
  }
}

/**
 * Push doc content to Notion (convert Tiptap → Notion blocks + save).
 * Also updates the page title if changed.
 */
export async function pushDocToNotion(doc) {
  if (!doc.notionPageId || !doc.content) return false;

  try {
    const blocks = tiptapToNotionBlocks(doc.content);
    const success = await updatePageBlocks(doc.notionPageId, blocks);

    // Also update title
    if (doc.title) {
      await updatePageTitle(doc.notionPageId, doc.title);
    }

    return success;
  } catch (err) {
    console.error('[workspace-sync] pushDocToNotion failed:', err);
    return false;
  }
}

/**
 * Create a new doc in Notion inside a folder, returns notionPageId or null.
 */
export async function createDocInNotion(doc, folderMap) {
  const notionFolderId = folderMap[doc.folder];
  if (!notionFolderId) {
    console.warn('[workspace-sync] No Notion folder for local folder:', doc.folder);
    return null;
  }

  try {
    const blocks = doc.content ? tiptapToNotionBlocks(doc.content) : [];
    const result = await createDocInFolder(notionFolderId, doc.title || 'Untitled', blocks);
    return result?.pageId || null;
  } catch (err) {
    console.error('[workspace-sync] createDocInNotion failed:', err);
    return null;
  }
}
