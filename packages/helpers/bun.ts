import * as util from "util";
import * as v from "valibot";

export function parseArgs<
  TEntries extends v.ObjectEntries,
  TMessage extends v.ErrorMessage<v.ObjectIssue> | undefined,
>(
  schema: v.ObjectSchema<TEntries, TMessage>,
): v.InferOutput<v.ObjectSchema<TEntries, TMessage>> {
  const { values } = util.parseArgs({
    args: Bun.argv,
    options: Object.fromEntries(
      Object.keys(schema.entries).map((key) => [key, { type: "string" }]),
    ),
    strict: true,
    allowPositionals: true,
  });

  const result = v.safeParse(schema, values);
  if (!result.success) {
    const issues = v.flatten(result.issues);
    const generic = [...(issues.root ?? []), ...(issues.other ?? [])];

    throw new Error(
      JSON.stringify({
        message: `Error parsing args.`,
        details: {
          ...issues.nested,
          generic: generic.length === 0 ? undefined : generic,
        },
      }),
    );
  }

  return result.output;
}
