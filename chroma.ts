import { ChromaClient } from "chromadb";
import { Config, Context, Data, Effect, Layer } from "effect";

export class ChromaError extends Data.TaggedError("ChromaError")<{
  cause?: unknown;
  message?: string;
}> {}

interface ChromaImpl {
  use: <T>(fn: (client: ChromaClient) => T) => Effect.Effect<Awaited<T>, ChromaError, never>;
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
