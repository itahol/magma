import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse, Url } from "@effect/platform";
import { Config, Data, Effect, Either, Schema } from "effect";

export const FolderPathSchema = Schema.String.pipe(
  Schema.endsWith("/"),
  Schema.transform(Schema.String, {
    decode: (input) => input.slice(0, -1),
    encode: (input) => input + "/",
  }),
  Schema.brand("FolderPath"),
);
export type FolderPath = Schema.Schema.Type<typeof FolderPathSchema>;

export const NotePathSchema = Schema.String.pipe(
  Schema.filter((path) => !path.endsWith("/")),
  Schema.brand("NotePath"),
);
export type NotePath = Schema.Schema.Type<typeof NotePathSchema>;

export const NoteSchema = Schema.Struct({
  path: NotePathSchema,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
});
export type Note = Schema.Schema.Type<typeof NoteSchema>;

const PathSchema = Schema.Union(FolderPathSchema, NotePathSchema);

export const FolderSchema = Schema.Struct({
  notes: Schema.propertySignature(Schema.Array(PathSchema)).pipe(Schema.fromKey("files")),
});

export class ObsidianError extends Data.TaggedError("ObsidianError")<{
  cause?: unknown;
  message?: string;
}> {}

export class NoteDoesNotExistError extends Data.TaggedError("NoteDoesNotExistError")<{
  notePath: NotePath;
  cause?: unknown;
  message?: string;
}> {
  constructor(props: { notePath: NotePath; cause?: unknown }) {
    super({ ...props, message: `Note at "${props.notePath}" does not exist` });
  }
}

export class Obsidian extends Effect.Service<Obsidian>()("obsidian", {
  // Define how to create the service
  effect: Effect.gen(function* () {
    const url = yield* Config.string("OBSIDIAN_API_URL");
    const port = yield* Config.integer("OBSIDIAN_API_PORT");
    const apiToken = yield* Config.redacted(Config.string("OBSIDIAN_API_KEY"));
    const baseUrl = Url.fromString(url).pipe(Either.map(Url.setPort(port)), Either.getOrThrow);
    const defaultClient = yield* HttpClient.HttpClient;
    const clientWithBaseUrl = defaultClient.pipe(
      HttpClient.filterStatusOk,
      HttpClient.mapRequest(HttpClientRequest.prependUrl(baseUrl.toString())),
      HttpClient.mapRequest(HttpClientRequest.bearerToken(apiToken)),
    );

    const getNote = Effect.fn("getNote")(function* (notePath: NotePath) {
      const request = HttpClientRequest.get(`/vault/${encodeURIComponent(notePath)}`).pipe(
        HttpClientRequest.setHeader("Accept", "application/vnd.olrapi.note+json"),
      );
      const response = yield* clientWithBaseUrl.execute(request).pipe(
        Effect.catchIf(
          (error) => error._tag === "ResponseError" && error.response.status === 404,
          (error) => Effect.fail(new NoteDoesNotExistError({ notePath, cause: error })),
        ),
      );

      return yield* HttpClientResponse.schemaBodyJson(NoteSchema)(response).pipe(
        Effect.catchTag("ParseError", Effect.die),
      );
    });

    const listNotes = Effect.fn("listNotes")(function* (folderPath?: FolderPath) {
      const encodedFolderPath = folderPath ? Schema.encodeSync(FolderPathSchema)(folderPath) : "";
      const request = HttpClientRequest.get(`/vault/${encodeURIComponent(encodedFolderPath)}`).pipe(
        HttpClientRequest.setHeader("Accept", "application/vnd.olrapi.note-list+json"),
      );
      const response = yield* clientWithBaseUrl.execute(request);
      return yield* HttpClientResponse.schemaBodyJson(FolderSchema)(response).pipe(
        Effect.catchTag("ParseError", Effect.die),
      );
    });

    return { getNote, listNotes };
  }),
  dependencies: [FetchHttpClient.layer],
}) {}
