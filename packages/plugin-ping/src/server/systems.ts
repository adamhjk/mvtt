import { defineSystem } from "@vtt/substrate";
import { Pong } from "../shared/traits.js";
import { PingReceived } from "../shared/events.js";

export const PongRecordingSystem = defineSystem({
  name: "PongRecording",
  on: PingReceived,
  reads: [],
  writes: [Pong],
  run: ({ event, world }) => {
    world.spawnAt(event.pongId, [
      Pong({
        message: event.message,
        pingedAt: event.pingedAt,
        pongedAt: event.pongedAt,
      }),
    ]);
    return [];
  },
});
