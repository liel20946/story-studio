import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { RootView } from "./root-view";
import { QueryClient } from "@tanstack/react-query";
import { ErrorBoundaryView } from "@/components/ui";
import { StoryView } from "./story-view";
import { RunView, HistoryRunDetailView } from "./run-view";
import { RecordView } from "./record-view";
import { BulkRunView } from "./bulk-run-view";
import { ScheduledOverviewView, ScheduledEditorView } from "./scheduled-view";
import { HomeView } from "./home-view";
import { GenerateHomeView, GenerateConversationRouteView } from "./generate-view";
import { SettingsView } from "./settings-view";
import { parseSettingsSection } from "../components/settings-sections";

const rootRoute = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootView,
  errorComponent: ErrorBoundaryView,
  notFoundComponent: () => {
    return (
      <div className="flex flex-col items-center justify-center h-screen">
        <div className="drag-region fixed top-0 left-0 right-0 h-13" />
        <p className="text-secondary">Route not found</p>
      </div>
    );
  },
});

// "/" — stories home (default landing)
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeView,
  staticData: { title: "Home" },
});

// "/stories" — alias for stories home
const storiesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stories",
  component: HomeView,
  staticData: { title: "Home" },
});

// "/story/$name" — story detail
const storyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/story/$name",
  component: StoryView,
  validateSearch: (search: Record<string, unknown>): { edit?: boolean } => ({
    edit: search.edit === true || search.edit === "true" ? true : undefined,
  }),
  staticData: { title: "Story" },
});

// "/run/$runId" — live run view
const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/run/$runId",
  component: RunView,
  staticData: { title: "Run" },
});

// "/history/$runId" — single historical run detail in the main pane
const historyRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history/$runId",
  component: HistoryRunDetailView,
  staticData: { title: "History" },
});

// "/record" — record dialog (renders as overlay within layout). Optional
// search params prefill the name + URL for the "Record again" action.
const recordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/record",
  component: RecordView,
  validateSearch: (search: Record<string, unknown>): {
    name?: string;
    url?: string;
    storyKey?: string;
    title?: string;
  } => ({
    name: typeof search.name === "string" ? search.name : undefined,
    url: typeof search.url === "string" ? search.url : undefined,
    storyKey: typeof search.storyKey === "string" ? search.storyKey : undefined,
    title: typeof search.title === "string" ? search.title : undefined,
  }),
  staticData: { title: "Record" },
});

// "/bulk-run" — select stories (by section / all) and run them in parallel
const bulkRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/bulk-run",
  component: BulkRunView,
  staticData: { title: "Run stories" },
});

// "/scheduled" — overview of scheduled runs
const scheduledRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scheduled",
  component: ScheduledOverviewView,
  staticData: { title: "Scheduled" },
});

// "/scheduled/$id" — create (id=new) or edit an existing schedule
const scheduledDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scheduled/$id",
  component: function ScheduledDetailRoute() {
    const { id } = scheduledDetailRoute.useParams();
    return (
      <ScheduledEditorView scheduleId={id === "new" ? undefined : id} />
    );
  },
  staticData: { title: "Schedule" },
});

// "/generate" — generate home (composer before a conversation exists)
const generateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/generate",
  component: GenerateHomeView,
  staticData: { title: "Generate" },
});

// "/generate/$conversationId" — generate chat
const generateConversationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/generate/$conversationId",
  component: GenerateConversationRouteView,
  staticData: { title: "Generate" },
});

// "/settings" — in-app settings (Codex-style sidebar + main pane)
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsView,
  validateSearch: (search: Record<string, unknown>) => ({
    section: parseSettingsSection(search.section),
  }),
  staticData: { title: "Settings" },
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  storiesRoute,
  storyRoute,
  runRoute,
  historyRunRoute,
  recordRoute,
  bulkRunRoute,
  scheduledRoute,
  scheduledDetailRoute,
  generateRoute,
  generateConversationRoute,
  settingsRoute,
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Local IPC fetches are cheap and rarely change between views; keep data
      // fresh for 30s so revisiting an item renders from cache instantly
      // instead of flashing a loading skeleton on every navigation.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

const router = createRouter({
  routeTree,
  history: createMemoryHistory(),
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  context: {
    queryClient,
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    title?: string;
    component?: unknown;
  }
}

export { router, queryClient };
