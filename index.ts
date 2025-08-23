import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Layer, Schema } from "effect";
import { FolderPathSchema, NotePathSchema, Obsidian } from "./obsidian";

const program = Effect.gen(function* () {
  const obsidian = yield* Obsidian;
  const rootNotes = yield* obsidian.listNotes();
  yield* Console.log(`Root notes: ${JSON.stringify(rootNotes)}`);
  const projectNotes = yield* obsidian.listNotes(Schema.decodeUnknownSync(FolderPathSchema)("1 Projects"));
  yield* Console.log(`Project notes: ${JSON.stringify(projectNotes)}`);
  const note = yield* obsidian.getNote(
    Schema.decodeUnknownSync(NotePathSchema)("3 Resources/Access Framework Flow.md"),
  );
  return yield* Console.log(`Note: ${JSON.stringify(note)}`);
});

BunRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, Obsidian.Default))));
