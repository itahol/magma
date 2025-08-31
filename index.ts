import { DefaultEmbeddingFunction } from "@chroma-core/default-embed";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import type { Collection, EmbeddingFunction } from "chromadb";
import { Array, Chunk, Config, Effect, Layer, Option, Schema, Stream } from "effect";
import * as Chroma from "./chroma";
import { ChromaError } from "./chroma";
import { type FolderPath, type Note, type NotePath, NotePathSchema, Obsidian } from "./obsidian";

const isNotePath = Schema.is(NotePathSchema);

const listTree = (root?: FolderPath) =>
  Stream.paginateEffect([root], (folders) =>
    Effect.gen(function* () {
      const obsidian = yield* Obsidian;
      const contents = yield* Effect.forEach(folders, obsidian.listFolder, { concurrency: "unbounded" }).pipe(
        Effect.map((listing) => listing.flat()),
      );
      const [childFoldersPaths, childNotesPaths] = Array.partition(contents, isNotePath);
      const nextFolders = Option.as(Option.fromIterable(childFoldersPaths), childFoldersPaths);
      return [childNotesPaths, nextFolders];
    }),
  ).pipe(Stream.flattenIterables);

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

const upsertChunk = Effect.fn("upsertChunk")(function* <E, R>(
  chunk: Chunk.Chunk<Note>,
  collection: Effect.Effect<Collection, E, R>,
) {
  const chromaClient = yield* Chroma.Chroma;
  yield* Effect.logDebug(`Upserting chunk of ${Chunk.size(chunk)} notes...`);
  const { withMetadata, withoutMetadata } = prepareNotes(Chunk.toArray(chunk), extractNoteMetdata);
  yield* Effect.logDebug(
    `Prepared notes: ${withMetadata.ids.length} with metadata, ${withoutMetadata.ids.length} without metadata`,
  );
  if (withMetadata.ids.length !== 0) {
    yield* collection.pipe(
      Effect.flatMap((c) => chromaClient.useCollection(c, (collection) => collection.upsert(withMetadata))),
    );
    yield* Effect.logDebug("Upserted notes with metadata to chroma collection");
  }
  if (withoutMetadata.ids.length !== 0) {
    yield* collection.pipe(
      Effect.flatMap((c) => chromaClient.useCollection(c, (collection) => collection.upsert(withoutMetadata))),
    );
    yield* Effect.logDebug("Upserted notes without metadata to chroma collection");
  }
});

const loadEmbeddingFunction = Effect.fn("loadEmbeddingFunction")((embeddingFunction: EmbeddingFunction) =>
  Effect.tryPromise({
    try: () => embeddingFunction.generate(["foo"]),
    catch: (cause) => new ChromaError({ message: "Failed to load model", cause }),
  }),
);

const program = Effect.gen(function* () {
  const obsidian = yield* Obsidian;
  yield* Effect.log("Listing all notes in vault...");
  const chromaClient = yield* Chroma.Chroma;
  const embeddingModelName = yield* Config.string("EMBEDDING_MODEL_NAME").pipe(Config.option);
  const embeddingFunction = embeddingModelName.pipe(
    Option.match({
      onSome: (modelName) => new DefaultEmbeddingFunction({ modelName }),
      onNone: () => new DefaultEmbeddingFunction(),
    }),
  );
  yield* loadEmbeddingFunction(embeddingFunction);
  const obsidianCollection = chromaClient.use((c) =>
    c.getOrCreateCollection({ name: "obsidian_notes", embeddingFunction }),
  );
  yield* listTree().pipe(
    Stream.tap((notePath) => Effect.log(`Found note path: ${notePath}`)),
    Stream.mapEffect((notePath) => obsidian.getNote(notePath), { concurrency: "unbounded" }),
    Stream.grouped(10),
    Stream.mapEffect((chunk) => upsertChunk(chunk, obsidianCollection), { concurrency: "unbounded" }),
    Stream.runDrain,
  );
}).pipe(Effect.withSpan("main"));

BunRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(BunContext.layer, Obsidian.Default, Chroma.fromEnv))));
