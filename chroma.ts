import { ChromaClient, type Collection as ChromaCollection } from "chromadb";
import { Config, Context, Data, Effect, Layer, Schema } from "effect";

// Single regex: starts and ends with [a-zA-Z0-9], only [a-zA-Z0-9._-] in between
const collectionNamePattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

const hasConsecutiveDots = (name: string) => name.includes("..");

/**
 * Schema for validating collection names.
 * - Length: 3-512 characters
 * - Allowed characters: [a-zA-Z0-9._-]
 * - Must start and end with [a-zA-Z0-9]
 * - Must not contain consecutive dots
 */
export const CollectionNameSchema = Schema.String.pipe(
  Schema.length({ min: 3, max: 512 }),
  Schema.pattern(collectionNamePattern),
  Schema.filter((name) => !hasConsecutiveDots(name) || "Collection name must not contain consecutive dots"),
  Schema.brand("Chroma/CollectionName"),
);
export type CollectionName = Schema.Schema.Type<typeof CollectionNameSchema>;

export const CollectionSchema = Schema.Struct({
  id: Schema.String,
  name: CollectionNameSchema,
}).pipe(Schema.brand("Chroma/Collection"));
export type Collection = Schema.Schema.Type<typeof CollectionSchema>;

export class ChromaError extends Data.TaggedError("ChromaError")<{
  cause?: unknown;
  message?: string;
}> {}

interface ChromaImpl {
  use: <T>(fn: (client: ChromaClient) => T) => Effect.Effect<Awaited<T>, ChromaError, never>;
  useCollection: <T>(
    collection: ChromaCollection,
    fn: (collection: ChromaCollection) => T,
  ) => Effect.Effect<Awaited<T>, ChromaError, never>;
}
export class Chroma extends Context.Tag("Chroma")<Chroma, ChromaImpl>() {}

type ConstructorArgs<T extends new (...args: any) => any> = T extends new (...args: infer A) => infer _R ? A : never;

export const make = (options: ConstructorArgs<typeof ChromaClient>[0]) =>
  Effect.gen(function* () {
    const client = yield* Effect.try({
      try: () => new ChromaClient(options),
      catch: (e) => new ChromaError({ cause: e }),
    });
    return Chroma.of({
      use: (fn) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () => fn(client),
            catch: (e) =>
              new ChromaError({
                cause: e,
                message: "Syncronous error in `Chroma.use`",
              }),
          });
          if (result instanceof Promise) {
            return yield* Effect.tryPromise({
              try: () => result,
              catch: (e) =>
                new ChromaError({
                  cause: e,
                  message: "Asyncronous error in `Chroma.use`",
                }),
            });
          } else {
            return result;
          }
        }),
      useCollection: (collection, fn) =>
        Effect.gen(function* () {
          const result = yield* Effect.try({
            try: () => fn(collection),
            catch: (e) =>
              new ChromaError({
                cause: e,
                message: "Syncronous error in `Chroma.use`",
              }),
          });
          if (result instanceof Promise) {
            return yield* Effect.tryPromise({
              try: () => result,
              catch: (e) =>
                new ChromaError({
                  cause: e,
                  message: "Asyncronous error in `Chroma.use`",
                }),
            });
          } else {
            return result;
          }
        }),
    });
  });

export const layer = (options: ConstructorArgs<typeof ChromaClient>[0]) => Layer.scoped(Chroma, make(options));

export const fromEnv = Layer.scoped(
  Chroma,
  Effect.gen(function* () {
    const host = yield* Config.string("CHROMA_HOST");
    const port = yield* Config.integer("CHROMA_PORT");
    const ssl = yield* Config.boolean("CHROMA_SSL").pipe(Config.withDefault(false));
    const client = yield* make({
      host,
      port,
      ssl,
    });
    yield* client.use((client) => client.heartbeat());
    return client;
  }),
);

export const listCollections = Effect.gen(function* () {
  const chroma = yield* Chroma;
  const rawCollections = yield* chroma.use((client) => client.listCollections());
  return yield* Schema.decode(Schema.Array(CollectionSchema))(rawCollections).pipe(Effect.orDie);
}).pipe(Effect.withSpan("Chroma/listCollections"));

export const getCollection = Effect.fn("Chroma/getCollection")(function* (name: CollectionName) {
  const chroma = yield* Chroma;
  const rawCollection = yield* chroma.use((client) => client.getCollection({ name }));
  return yield* Schema.decode(CollectionSchema)(rawCollection).pipe(Effect.orDie);
});
