import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Layer, Schema } from "effect";
import { NotePathSchema, Obsidian } from "./obsidian";

const program = Effect.gen(function* () {
  const obsidian = yield* Obsidian;
  const note = yield* obsidian.getNote(
    Schema.decodeUnknownSync(NotePathSchema)("4 Resources/Access Framework Flow.md"),
  );
  return yield* Console.log(`Note: ${JSON.stringify(note)}`);
});

BunRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, Obsidian.Default))));
