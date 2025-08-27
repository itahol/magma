import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Array, Console, Effect, Layer, Pretty, Schema } from "effect";
import * as Chroma from "./chroma";
import { NotePathSchema, NoteSchema, Obsidian, PathSchema, type NotePath } from "./obsidian";

const FolderPrinter = Pretty.make(Schema.Array(PathSchema));
const NotePrinter = Pretty.make(NoteSchema);
const CollectionsPrinter = Pretty.make(Schema.Array(Chroma.CollectionSchema));
const isNotePath = Schema.is(NotePathSchema);

const program = Effect.gen(function* () {
  const obsidian = yield* Obsidian;
  const rootContents = yield* obsidian.listFolder();

  const chromaClient = yield* Chroma.Chroma;
  const obsidianCollection = chromaClient.use((c) => c.getOrCreateCollection({ name: "obsidian_notes" }));
  yield* Effect.log("Got chroma collection");
  const rootNotesPaths = Array.filter(rootContents, isNotePath);
  const rootNotes = yield* Effect.forEach(rootNotesPaths, (path) => obsidian.getNote(path));
  yield* Effect.log("Fetched root notes");
  const reduced = rootNotes.reduce(
    (acc: { ids: NotePath[]; metadatas: Record<string, boolean>[]; contents: string[] }, note) => {
      const metadata = Object.fromEntries(note.tags.map((tag) => [`tag:${tag}`, true]));
      acc.ids.push(note.path);
      acc.contents.push(note.content);
      acc.metadatas.push(metadata);
      return acc;
    },
    { ids: [], metadatas: [], contents: [] },
  );
  yield* obsidianCollection.pipe(
    Effect.flatMap((c) => chromaClient.useCollection(c, (collection) => collection.upsert(reduced))),
  );

  const collections = yield* Chroma.listCollections;
  yield* Console.log(`Collections: ${CollectionsPrinter(collections)}`);
  const collectionName = collections.at(0)?.name;
  if (collectionName) {
    const collection = yield* Chroma.getCollection(collectionName);
    yield* Console.log(`First collection: ${Pretty.make(Chroma.CollectionSchema)(collection)}`);
  }
});

BunRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, Obsidian.Default, Chroma.fromEnv))));
