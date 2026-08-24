import { create } from "zustand";

interface ProjectSummary {
  id: string;
  name: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectRecord {
  id: string;
  name: string;
  nodesJson: string;
  edgesJson: string;
  viewportJson: string;
  historyJson: string;
  imagePoolJson: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectState {
  projects: ProjectSummary[];
  currentProject: ProjectRecord | null;
  isLoading: boolean;
  loadProjects: () => Promise<void>;
  autoOpenLastProject: () => Promise<void>;
  createProject: (name: string) => Promise<string>;
  openProject: (id: string) => Promise<void>;
  saveProject: (params: {
    nodesJson: string;
    edgesJson: string;
    historyJson: string;
    nodeCount: number;
  }) => Promise<void>;
  saveViewport: (viewportJson: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  closeProject: () => void;
}

const STORAGE_KEY = "xiakeman-canvas-projects";
const LAST_PROJECT_KEY = "xiakeman-canvas-last-project";

function readRecords(): ProjectRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecords(records: ProjectRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function toSummary(record: ProjectRecord): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    nodeCount: record.nodeCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function makeRecord(name: string): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    nodesJson: "[]",
    edgesJson: "[]",
    viewportJson: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
    historyJson: "[]",
    imagePoolJson: "[]",
    nodeCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProject: null,
  isLoading: false,

  loadProjects: async () => {
    set({ isLoading: true });
    const projects = readRecords()
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    set({ projects, isLoading: false });
  },

  autoOpenLastProject: async () => {
    await get().loadProjects();
    const records = readRecords();
    if (records.length === 0) {
      await get().createProject("默认画布");
      return;
    }

    const lastId = localStorage.getItem(LAST_PROJECT_KEY);
    const target =
      records.find((record) => record.id === lastId) ??
      records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

    if (target) {
      await get().openProject(target.id);
    }
  },

  createProject: async (name: string) => {
    const record = makeRecord(name);
    const records = [record, ...readRecords()];
    writeRecords(records);
    localStorage.setItem(LAST_PROJECT_KEY, record.id);
    set({
      currentProject: record,
      projects: records.map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    });
    return record.id;
  },

  openProject: async (id: string) => {
    const record = readRecords().find((item) => item.id === id);
    if (!record) return;
    localStorage.setItem(LAST_PROJECT_KEY, id);
    set({ currentProject: record });
  },

  saveProject: async ({ nodesJson, edgesJson, historyJson, nodeCount }) => {
    const currentProject = get().currentProject ?? makeRecord("默认画布");
    const updated: ProjectRecord = {
      ...currentProject,
      nodesJson,
      edgesJson,
      historyJson,
      nodeCount,
      updatedAt: new Date().toISOString(),
    };

    const exists = readRecords().some((record) => record.id === updated.id);
    const records = exists
      ? readRecords().map((record) => (record.id === updated.id ? updated : record))
      : [updated, ...readRecords()];

    writeRecords(records);
    localStorage.setItem(LAST_PROJECT_KEY, updated.id);
    set({
      currentProject: updated,
      projects: records.map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    });
  },

  saveViewport: async (viewportJson: string) => {
    const currentProject = get().currentProject;
    if (!currentProject) return;
    const updated = { ...currentProject, viewportJson, updatedAt: new Date().toISOString() };
    writeRecords(readRecords().map((record) => (record.id === updated.id ? updated : record)));
    set({ currentProject: updated });
  },

  renameProject: async (id: string, name: string) => {
    const records = readRecords().map((record) =>
      record.id === id ? { ...record, name, updatedAt: new Date().toISOString() } : record,
    );
    writeRecords(records);
    set({
      projects: records.map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      currentProject:
        get().currentProject?.id === id
          ? records.find((record) => record.id === id) ?? null
          : get().currentProject,
    });
  },

  deleteProject: async (id: string) => {
    const records = readRecords().filter((record) => record.id !== id);
    writeRecords(records);
    if (localStorage.getItem(LAST_PROJECT_KEY) === id) {
      localStorage.removeItem(LAST_PROJECT_KEY);
    }
    set({
      projects: records.map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      currentProject: get().currentProject?.id === id ? null : get().currentProject,
    });
  },

  closeProject: () => {
    localStorage.removeItem(LAST_PROJECT_KEY);
    set({ currentProject: null });
  },
}));

export type { ProjectSummary, ProjectRecord };

