// ============================================================================
// Story Studio — story sections store
// Lets the user group stories into named, collapsible sections (Codex-style).
// Section definitions, story→section assignments, and per-section collapse
// state are local UI preferences, so they live in localStorage (no backend).
//
// Two sections are built-in and not user-managed:
//   • DEFAULT_SECTION_ID ("Stories") — holds every unassigned story.
//   • HISTORY_SECTION_ID ("History") — lists recent runs; rendered separately.
// ============================================================================

import * as React from "react";

export const DEFAULT_SECTION_ID = "__default__";
export const HISTORY_SECTION_ID = "__history__";

export interface StorySection {
  id: string;
  name: string;
}

interface SectionsState {
  sections: StorySection[]; // user-created, ordered
  assignments: Record<string, string>; // storyName -> sectionId
  collapsed: Record<string, boolean>; // sectionId -> collapsed (true = closed)
}

interface SectionsValue extends SectionsState {
  createSection: (name: string) => string;
  renameSection: (id: string, name: string) => void;
  deleteSection: (id: string) => void;
  /** Assign a story to a section, or `null` to move it back to the default group. */
  assignStory: (storyName: string, sectionId: string | null) => void;
  setCollapsed: (sectionId: string, collapsed: boolean) => void;
}

const STORAGE_KEY = "story-studio-sections-v1";

function loadState(): SectionsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SectionsState>;
      return {
        sections: Array.isArray(parsed.sections) ? parsed.sections : [],
        assignments:
          parsed.assignments && typeof parsed.assignments === "object"
            ? parsed.assignments
            : {},
        collapsed:
          parsed.collapsed && typeof parsed.collapsed === "object"
            ? parsed.collapsed
            : {},
      };
    }
  } catch {
    // Corrupt storage — start fresh.
  }
  return { sections: [], assignments: {}, collapsed: {} };
}

const SectionsContext = React.createContext<SectionsValue | null>(null);

export function SectionsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SectionsState>(loadState);

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota / serialization failures — preferences are non-critical.
    }
  }, [state]);

  const createSection = React.useCallback((name: string) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const trimmed = name.trim() || "Untitled";
    setState((s) => ({ ...s, sections: [...s.sections, { id, name: trimmed }] }));
    return id;
  }, []);

  const renameSection = React.useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setState((s) => ({
      ...s,
      sections: s.sections.map((sec) =>
        sec.id === id ? { ...sec, name: trimmed } : sec,
      ),
    }));
  }, []);

  const deleteSection = React.useCallback((id: string) => {
    setState((s) => {
      const assignments = { ...s.assignments };
      for (const [story, secId] of Object.entries(assignments)) {
        if (secId === id) delete assignments[story];
      }
      const collapsed = { ...s.collapsed };
      delete collapsed[id];
      return {
        ...s,
        sections: s.sections.filter((sec) => sec.id !== id),
        assignments,
        collapsed,
      };
    });
  }, []);

  const assignStory = React.useCallback(
    (storyName: string, sectionId: string | null) => {
      setState((s) => {
        const assignments = { ...s.assignments };
        if (sectionId === null || sectionId === DEFAULT_SECTION_ID) {
          delete assignments[storyName];
        } else {
          assignments[storyName] = sectionId;
        }
        return { ...s, assignments };
      });
    },
    [],
  );

  const setCollapsed = React.useCallback(
    (sectionId: string, collapsed: boolean) => {
      setState((s) => ({
        ...s,
        collapsed: { ...s.collapsed, [sectionId]: collapsed },
      }));
    },
    [],
  );

  const value = React.useMemo<SectionsValue>(
    () => ({
      ...state,
      createSection,
      renameSection,
      deleteSection,
      assignStory,
      setCollapsed,
    }),
    [state, createSection, renameSection, deleteSection, assignStory, setCollapsed],
  );

  return (
    <SectionsContext.Provider value={value}>
      {children}
    </SectionsContext.Provider>
  );
}

export function useSections(): SectionsValue {
  const ctx = React.useContext(SectionsContext);
  if (!ctx) {
    throw new Error("useSections must be used within a SectionsProvider");
  }
  return ctx;
}
