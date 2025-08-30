import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Array, Console, Effect, Layer, Pretty, Schema } from "effect";
import * as Chroma from "./chroma";
import { NotePathSchema, Obsidian, PathSchema, type Note, type NotePath } from "./obsidian";

const FolderPrinter = Pretty.make(Schema.Array(PathSchema));
const CollectionsPrinter = Pretty.make(Schema.Array(Chroma.CollectionSchema));
const isNotePath = Schema.is(NotePathSchema);

function extractNoteMetdata(note: Note) {
  if (note.tags.length === 0) {
    return undefined;
  }
  return Object.fromEntries(note.tags.map((tag) => [`tag:${tag}`, true]));
}

function prepareNotes(notes: Note[], noteMetadataExtractor: (note: Note) => Record<string, boolean> | undefined) {
  const withMetadata: { ids: NotePath[]; metadatas: Record<string, boolean>[]; documents: string[] } = {
    ids: [],
    metadatas: [],
    documents: [],
  };
  const withoutMetadata: { ids: NotePath[]; documents: string[] } = {
    ids: [],
    documents: [],
  };
  for (const note of notes) {
    const metadata = noteMetadataExtractor(note);
    if (metadata !== undefined) {
      withMetadata.ids.push(note.path);
      withMetadata.documents.push(note.content);
      withMetadata.metadatas.push(metadata);
    } else {
      withoutMetadata.ids.push(note.path);
      withoutMetadata.documents.push(note.content);
    }
  }
  return { withMetadata, withoutMetadata };
}

const program = Effect.gen(function* () {
  const obsidian = yield* Obsidian;
  const rootContents = yield* obsidian.listFolder();

  const chromaClient = yield* Chroma.Chroma;
  const obsidianCollection = chromaClient.use((c) => c.getOrCreateCollection({ name: "obsidian_notes" }));
  yield* Effect.log("Got chroma collection");
  yield* Effect.log(`Root contents: ${FolderPrinter(rootContents)}`);
  const rootNotesPaths = Array.filter(rootContents, isNotePath);
  yield* Effect.log(`Root notes paths: ${FolderPrinter(rootNotesPaths)}`);
  const rootNotes = yield* Effect.forEach(rootNotesPaths, (path) => obsidian.getNote(path));
  yield* Effect.log("Fetched root notes");

  const { withMetadata, withoutMetadata } = prepareNotes(rootNotes, extractNoteMetdata);

  yield* obsidianCollection.pipe(
    Effect.flatMap((c) => chromaClient.useCollection(c, (collection) => collection.upsert(withMetadata))),
  );
  yield* Effect.log("Upserted notes with metadata to chroma collection");
  yield* obsidianCollection.pipe(
    Effect.flatMap((c) => chromaClient.useCollection(c, (collection) => collection.upsert(withoutMetadata))),
  );
  yield* Effect.log("Upserted notes to chroma collection");

  const collections = yield* Chroma.listCollections;
  yield* Console.log(`Collections: ${CollectionsPrinter(collections)}`);
  const collectionName = collections.at(0)?.name;
  if (collectionName) {
    const collection = yield* Chroma.getCollection(collectionName);
    yield* Console.log(`First collection: ${Pretty.make(Chroma.CollectionSchema)(collection)}`);
  }
}).pipe(Effect.withSpan("main"));

BunRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, Obsidian.Default, Chroma.fromEnv))));
