import { render, toPlainText } from "@react-email/components";
import { type Attributes, createElement, type FunctionComponent } from "react";

export async function renderEmail<P extends object>(props: {
  readonly template: FunctionComponent<P>;
  readonly props?: (Attributes & P) | null;
}): Promise<{ readonly html: string; readonly text: string }> {
  const html = await render(createElement(props.template, props.props));
  const text = toPlainText(html);

  return {
    html,
    text,
  };
}

/**
 * Replaces `$$$__KEY__$$$` placeholder tokens in a pre-built template with runtime values.
 *
 * Use this at Lambda runtime together with a pre-built template loaded from disk.
 * See docs/react-email-templates.md for the recommended pre-build workflow.
 */
export function hydrateTemplate(props: {
  readonly template: { readonly html: string; readonly text: string };
  readonly props: Record<string, string>;
  readonly subject: string;
}): { readonly subject: string; readonly html: string; readonly text: string } {
  const { html, text } = Object.entries(props.props).reduce(
    (result, [key, value]) => ({
      html: result.html.replaceAll(`$$$__${key}__$$$`, value),
      text: result.text
        .replaceAll(`$$$__${key}__$$$`, value)
        .replaceAll(`$$$__${key.toUpperCase()}__$$$`, value),
    }),
    props.template,
  );

  return { subject: props.subject, html, text };
}
