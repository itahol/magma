import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Layer, Pretty, Schema } from "effect";
import { FolderPathSchema, FolderSchema, NotePathSchema, NoteSchema, Obsidian } from "./obsidian";

const FolderPrinter = Pretty.make(FolderSchema);
const NotePrinter = Pretty.make(NoteSchema);

const program = Effect.gen(function* () {
  const obsidian = yield* Obsidian;
  const rootNotes = yield* obsidian.listNotes();
  yield* Console.log(`Root notes: ${FolderPrinter(rootNotes)}`);
  const projectNotes = yield* obsidian.listNotes(Schema.decodeUnknownSync(FolderPathSchema)("1 Projects/"));
  yield* Console.log(`Project notes: ${FolderPrinter(projectNotes)}`);
  const note = yield* obsidian.getNote(
    Schema.decodeUnknownSync(NotePathSchema)("3 Resources/Access Framework Flow.md"),
  );
  return yield* Console.log(`Note: ${NotePrinter(note)}`);
});

BunRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, Obsidian.Default))));
