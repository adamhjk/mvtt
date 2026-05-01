import {
  defineCommand,
  defineEvent,
  defineSystem,
  defineTrait,
  EntityId,
  ok,
  z,
} from "@vtt/substrate";

/**
 * Per-tab UI state for a Scene view. Lives on the workbench's per-tab
 * sentinel entity (one per open tab); plugins look up the sentinel via
 * `useTabSentinel(tabId)` from `@vtt/shell-workbench/client` and bind
 * this trait through `createOptimisticTrait`.
 *
 * `dockOpen` and `dockActiveId` together drive the bottom dock —
 * which tab is showing, and whether the dock is collapsed. They survive
 * tab focus changes / page reloads and replicate to the user's other
 * connections via the broadcast scope on `SceneUiStateChanged`.
 */
export const SceneUiState = defineTrait({
  name: "@vtt/scene/UiState",
  schema: z
    .object({
      dockOpen: z.boolean().default(false),
      dockActiveId: z.string().nullable().default(null),
    })
    .default({ dockOpen: false, dockActiveId: null }),
});

export const SceneUiStateChanged = defineEvent({
  name: "@vtt/scene/UiStateChanged",
  schema: z.object({
    entityId: EntityId,
    value: z.object({
      dockOpen: z.boolean(),
      dockActiveId: z.string().nullable(),
    }),
  }),
  transient: true,
  broadcast: true,
});

export const SetSceneUiState = defineCommand({
  name: "@vtt/scene/SetUiState",
  schema: z.object({
    entityId: EntityId,
    value: z.object({
      dockOpen: z.boolean(),
      dockActiveId: z.string().nullable(),
    }),
  }),
  validate: () => ok(),
  apply: ({ cmd }) => [
    SceneUiStateChanged({ entityId: cmd.entityId, value: cmd.value }),
  ],
});

export const SceneUiStateMirror = defineSystem({
  name: "SceneUiStateMirror",
  on: SceneUiStateChanged,
  reads: [],
  writes: [SceneUiState],
  run: ({ event, world }) => {
    if (!world.has(event.entityId)) return [];
    world.set(event.entityId, SceneUiState, event.value);
    return [];
  },
});
