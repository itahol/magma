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

export const PathSchema = Schema.Union(FolderPathSchema, NotePathSchema);

const FolderListingResponseSchema = Schema.Struct({
  files: Schema.Array(Schema.String),
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

export class FolderDoesNotExistError extends Data.TaggedError("FolderDoesNotExistError")<{
  folderPath: FolderPath | undefined;
  cause?: unknown;
  message?: string;
}> {
  constructor(props: { folderPath: FolderPath | undefined; cause?: unknown }) {
    super({ ...props, message: `Folder at "${props.folderPath}" does not exist` });
  }
}

export class Obsidian extends Effect.Service<Obsidian>()("obsidian", {
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

    const getNote = Effect.fn("getNote")(function (notePath: NotePath) {
      const request = HttpClientRequest.get(`/vault/${encodeURIComponent(notePath)}`).pipe(
        HttpClientRequest.setHeader("Accept", "application/vnd.olrapi.note+json"),
      );
      const response = clientWithBaseUrl.execute(request);
      return response.pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(NoteSchema)),
        Effect.catchTags({
          ParseError: (cause) => new ObsidianError({ cause, message: `Failed to parse note at "${notePath}"` }),
          RequestError: (cause) => new ObsidianError({ cause, message: `Failed to fetch note at "${notePath}"` }),
          ResponseError: (cause) => {
            if (cause.response.status === 404) {
              return new NoteDoesNotExistError({ notePath, cause });
            }
            return new ObsidianError({ cause, message: `Failed to fetch note at "${notePath}"` });
          },
        }),
      );
    });

    const listFolder = Effect.fn("listFolder")(function (folderPath?: FolderPath) {
      const targetPath = folderPath ? Schema.encodeSync(FolderPathSchema)(folderPath) : "";
      const request = HttpClientRequest.get(`/vault/${encodeURIComponent(targetPath)}`).pipe(
        HttpClientRequest.setHeader("Accept", "application/vnd.olrapi.note-list+json"),
      );
      const parsed = clientWithBaseUrl.execute(request).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(FolderListingResponseSchema)),
        Effect.catchTags({
          ParseError: (cause) =>
            new ObsidianError({ cause, message: `Failed to parse folder listing at "${targetPath}"` }),
          RequestError: (cause) => new ObsidianError({ cause, message: `Failed to fetch folder listing` }),
          ResponseError: (cause) => {
            if (cause.response.status === 404) {
              return new FolderDoesNotExistError({ folderPath, cause });
            }
            return new ObsidianError({ cause, message: `Failed to fetch folder listing at "${targetPath}"` });
          },
        }),
      );
      return parsed.pipe(
        Effect.map(({ files }) => files.map((path) => `${targetPath}${path}`)),
        Effect.flatMap(Schema.decode(Schema.Array(PathSchema))),
        Effect.catchTag("ParseError", Effect.orDie),
      );
    });

    return { getNote, listFolder };
  }).pipe(Effect.orDie),
  dependencies: [FetchHttpClient.layer],
}) {}
