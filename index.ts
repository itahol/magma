import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Layer, Pretty, Schema } from "effect";
import * as Chroma from "./chroma";
import { FolderPathSchema, FolderSchema, NotePathSchema, NoteSchema, Obsidian } from "./obsidian";

const FolderPrinter = Pretty.make(FolderSchema);
const NotePrinter = Pretty.make(NoteSchema);
const CollectionsPrinter = Pretty.make(Schema.Array(Chroma.CollectionSchema));

const program = Effect.gen(function* () {
  const obsidian = yield* Obsidian;
  const rootContents = yield* obsidian.listFolder();
  yield* Console.log(`Root contents: ${FolderPrinter(rootContents)}`);
  const projectContents = yield* obsidian.listFolder(Schema.decodeUnknownSync(FolderPathSchema)("1 Projects/"));
  yield* Console.log(`Project contents: ${FolderPrinter(projectContents)}`);
  const note = yield* obsidian.getNote(
    Schema.decodeUnknownSync(NotePathSchema)("3 Resources/Access Framework Flow.md"),
  );
  yield* Console.log(`Note: ${NotePrinter(note)}`);

  const collections = yield* Chroma.listCollections;
  yield* Console.log(`Collections: ${CollectionsPrinter(collections)}`);
  const collectionName = collections.at(0)?.name;
  if (collectionName) {
    const collection = yield* Chroma.getCollection(collectionName);
    yield* Console.log(`First collection: ${Pretty.make(Chroma.CollectionSchema)(collection)}`);
  }
});

BunRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, Obsidian.Default, Chroma.fromEnv))));
