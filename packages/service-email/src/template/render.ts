import { render, toPlainText } from "@react-email/components";
import { createElement, type Attributes, type FunctionComponent } from "react";

export async function renderEmail<P extends {}>(props: {
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
